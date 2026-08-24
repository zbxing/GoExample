package queueclient

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultWorkerCount               = 1
	maxWorkerCount                   = 64
	defaultDeliveryMaxAttempts       = 3
	maximumDeliveryMaxAttempts       = 10
	defaultDeliveryInitialBackoff    = 100 * time.Millisecond
	defaultDeliveryMaxBackoff        = 2 * time.Second
	defaultDeliverySettlementTimeout = 3 * time.Second
	minimumLeaseExtensionInterval    = 10 * time.Millisecond
	maximumLeaseExtensionInterval    = 10 * time.Minute
	maximumLeaseExtensionTimeout     = 30 * time.Second
)

var (
	// ErrWorkerStarted indicates that Start was called more than once.
	ErrWorkerStarted = errors.New("queue worker group has already started")
	// ErrWorkerNotStarted indicates that a lifecycle method requires Start.
	ErrWorkerNotStarted = errors.New("queue worker group has not started")
	// ErrWorkerClosed indicates that a worker group cannot be started again.
	ErrWorkerClosed = errors.New("queue worker group has stopped")
	// ErrWorkerPanic indicates that a source or handler panicked. The recovered
	// value is deliberately not returned or logged by this package.
	ErrWorkerPanic = errors.New("queue worker callback panicked")
	// ErrInvalidDelivery indicates that a reliable delivery did not provide
	// both acknowledgement and dead-letter callbacks.
	ErrInvalidDelivery = errors.New("queue delivery is missing a settlement callback")
	// ErrDeliveryNotRetryable lets a handler explicitly skip retries. The
	// delivery is still dead-lettered before the worker receives more work.
	ErrDeliveryNotRetryable = errors.New("queue delivery failure is not retryable")
	// ErrDeliverySettlement indicates that acknowledgement or dead-letter
	// settlement failed, timed out, or panicked. Backend details are not exposed.
	ErrDeliverySettlement = errors.New("queue delivery settlement failed")
	// ErrDeliveryLeaseExtension indicates that a configured broker lease
	// extension failed, timed out, or panicked. Backend details are not exposed.
	ErrDeliveryLeaseExtension = errors.New("queue delivery lease extension failed")
	errInvalidLeaseBudget     = errors.New("queue delivery lease budget is invalid")
)

// ReceiveFunc obtains the next message from a broker-specific adapter. The
// adapter owns acknowledgement, retry, ordering, and dead-letter semantics.
type ReceiveFunc func(context.Context) (Message, error)

// Delivery carries one received message and private broker settlement
// callbacks. Concrete adapters capture their acknowledgement handle inside the
// callbacks so it never becomes message data or telemetry.
type Delivery struct {
	Message     Message
	ExtendLease func(context.Context) error
	Acknowledge func(context.Context) error
	DeadLetter  func(context.Context) error
}

// ReceiveDeliveryFunc obtains the next delivery from a broker-specific
// adapter. It is mutually exclusive with ReceiveFunc.
type ReceiveDeliveryFunc func(context.Context) (Delivery, error)

// HandleFunc processes one message after Client.Process has applied its
// bounded timeout, cloning, validation, and trace-context extraction.
type HandleFunc func(context.Context, Message) error

// WorkerObserver receives fixed-cardinality worker lifecycle events. Observer
// methods must return promptly and must not inspect message data or errors;
// panics from an observer are isolated so instrumentation cannot change worker
// behavior.
type WorkerObserver interface {
	WorkerStarted()
	WorkerStopped()
	WorkerFailed()
}

// DeliveryObserver receives fixed-cardinality reliable-delivery outcomes. It
// never receives messages, callbacks, attempts, or errors. Panics are isolated.
type DeliveryObserver interface {
	DeliveryAcknowledged()
	DeliveryRetried()
	DeliveryDeadLettered()
	DeliverySettlementFailed()
}

// DeliveryLeaseObserver receives fixed-cardinality lease-extension outcomes.
// It never receives messages, callbacks, intervals, or errors. Panics are
// isolated so instrumentation cannot change delivery behavior.
type DeliveryLeaseObserver interface {
	DeliveryLeaseExtended()
	DeliveryLeaseExtensionFailed()
}

// DeliveryRetryConfig bounds reliable-delivery attempts, exponential backoff,
// and acknowledgement/dead-letter callback duration. Zero values select
// conservative defaults.
type DeliveryRetryConfig struct {
	MaxAttempts            int
	InitialBackoff         time.Duration
	MaxBackoff             time.Duration
	SettlementTimeout      time.Duration
	LeaseExtensionInterval time.Duration
	LeaseExtensionTimeout  time.Duration
}

// MinimumDeliveryLease returns the minimum broker acknowledgement lease needed
// for the configured delivery path: every bounded handler attempt, all retry
// backoffs, one acknowledgement or dead-letter settlement, and an explicit
// positive safety margin. Handlers and settlement callbacks must honor their
// context deadlines for this calculated bound to hold.
func (client *Client) MinimumDeliveryLease(config DeliveryRetryConfig, safetyMargin time.Duration) (time.Duration, error) {
	if client == nil || client.tracer == nil {
		return 0, errNilClient
	}
	config = defaultDeliveryRetryConfig(config)
	if err := validateDeliveryRetryConfig(config); err != nil {
		return 0, err
	}
	if safetyMargin <= 0 {
		return 0, errInvalidLeaseBudget
	}
	if deliveryLeaseExtensionEnabled(config) {
		longestCallback := config.SettlementTimeout
		if config.LeaseExtensionTimeout > longestCallback {
			longestCallback = config.LeaseExtensionTimeout
		}
		total, ok := addDeliveryBudget(config.LeaseExtensionInterval, longestCallback)
		if !ok {
			return 0, errInvalidLeaseBudget
		}
		total, ok = addDeliveryBudget(total, safetyMargin)
		if !ok {
			return 0, errInvalidLeaseBudget
		}
		return total, nil
	}

	total := time.Duration(0)
	for attempt := 1; attempt <= config.MaxAttempts; attempt++ {
		var ok bool
		total, ok = addDeliveryBudget(total, client.processTimeout)
		if !ok {
			return 0, errInvalidLeaseBudget
		}
		if attempt < config.MaxAttempts {
			total, ok = addDeliveryBudget(total, deliveryBackoff(config, attempt))
			if !ok {
				return 0, errInvalidLeaseBudget
			}
		}
	}
	for _, duration := range []time.Duration{config.SettlementTimeout, safetyMargin} {
		var ok bool
		total, ok = addDeliveryBudget(total, duration)
		if !ok {
			return 0, errInvalidLeaseBudget
		}
	}
	return total, nil
}

// WorkerConfig defines a bounded consumer worker group. Exactly one receive
// callback is required. Receive preserves fail-fast legacy behavior;
// ReceiveDelivery enables bounded retry, acknowledgement, and dead-lettering.
type WorkerConfig struct {
	Workers          int
	Receive          ReceiveFunc
	ReceiveDelivery  ReceiveDeliveryFunc
	Handle           HandleFunc
	Observer         WorkerObserver
	DeliveryObserver DeliveryObserver
	LeaseObserver    DeliveryLeaseObserver
	Retry            DeliveryRetryConfig
}

const (
	workerNew uint32 = iota
	workerRunning
	workerStopped
)

// WorkerGroup coordinates broker-neutral receive/process callbacks. Legacy
// Receive mode remains fail-fast and leaves settlement to the adapter.
// ReceiveDelivery mode adds bounded in-process retry and explicit ack/DLQ
// settlement, but never claims ordering, dedupe, persistence, or exactly-once.
type WorkerGroup struct {
	client           *Client
	workers          int
	receive          ReceiveFunc
	receiveDelivery  ReceiveDeliveryFunc
	handle           HandleFunc
	observer         WorkerObserver
	deliveryObserver DeliveryObserver
	leaseObserver    DeliveryLeaseObserver
	retry            DeliveryRetryConfig

	state  atomic.Uint32
	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
	err    error
	wg     sync.WaitGroup
}

// NewWorkerGroup validates and constructs a bounded consumer worker group.
func NewWorkerGroup(client *Client, config WorkerConfig) (*WorkerGroup, error) {
	if client == nil || client.tracer == nil {
		return nil, errNilClient
	}
	if (config.Receive == nil) == (config.ReceiveDelivery == nil) {
		return nil, errors.New("queue worker requires exactly one receive callback")
	}
	if config.Handle == nil {
		return nil, errors.New("queue worker handle callback cannot be nil")
	}
	if config.Workers == 0 {
		config.Workers = defaultWorkerCount
	}
	if config.Workers < 1 || config.Workers > maxWorkerCount {
		return nil, errors.New("queue worker count must be between 1 and 64")
	}
	if config.ReceiveDelivery != nil {
		config.Retry = defaultDeliveryRetryConfig(config.Retry)
		if err := validateDeliveryRetryConfig(config.Retry); err != nil {
			return nil, err
		}
		if config.LeaseObserver != nil && !deliveryLeaseExtensionEnabled(config.Retry) {
			return nil, errors.New("queue delivery lease observer requires lease extension")
		}
	} else if config.DeliveryObserver != nil || config.LeaseObserver != nil || config.Retry != (DeliveryRetryConfig{}) {
		return nil, errors.New("queue delivery retry and observer require a delivery receive callback")
	}
	return &WorkerGroup{
		client:           client,
		workers:          config.Workers,
		receive:          config.Receive,
		receiveDelivery:  config.ReceiveDelivery,
		handle:           config.Handle,
		observer:         config.Observer,
		deliveryObserver: config.DeliveryObserver,
		leaseObserver:    config.LeaseObserver,
		retry:            config.Retry,
		done:             make(chan struct{}),
	}, nil
}

// Start launches the configured workers. The parent context controls the
// group lifetime; cancellation is treated as a normal stop.
func (group *WorkerGroup) Start(ctx context.Context) error {
	if group == nil {
		return errNilWorkerGroup
	}
	if ctx == nil {
		return errNilContext
	}
	if !group.state.CompareAndSwap(workerNew, workerRunning) {
		if group.state.Load() == workerStopped {
			return ErrWorkerClosed
		}
		return ErrWorkerStarted
	}
	runContext, cancel := context.WithCancel(ctx)
	group.mu.Lock()
	group.cancel = cancel
	group.mu.Unlock()
	group.wg.Add(group.workers)
	for index := 0; index < group.workers; index++ {
		go group.runWorker(runContext)
	}
	go func() {
		group.wg.Wait()
		cancel()
		group.state.Store(workerStopped)
		close(group.done)
	}()
	return nil
}

// Shutdown requests cancellation and waits for all workers until ctx expires.
// A deadline only bounds the caller's wait; workers remain owned by the group
// and can be observed later through Wait.
func (group *WorkerGroup) Shutdown(ctx context.Context) error {
	if group == nil {
		return errNilWorkerGroup
	}
	if ctx == nil {
		return errNilContext
	}
	if group.state.Load() == workerNew {
		return ErrWorkerNotStarted
	}
	group.mu.Lock()
	cancel := group.cancel
	group.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	select {
	case <-group.done:
		return group.Err()
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Wait blocks until all workers stop and returns the first non-cancellation
// failure, if any. It must be called after Start.
func (group *WorkerGroup) Wait() error {
	if group == nil {
		return errNilWorkerGroup
	}
	if group.state.Load() == workerNew {
		return ErrWorkerNotStarted
	}
	<-group.done
	return group.Err()
}

// Err returns the first worker failure after a group has stopped. It returns
// nil while the group is still running or when it was canceled normally.
func (group *WorkerGroup) Err() error {
	if group == nil {
		return errNilWorkerGroup
	}
	group.mu.Lock()
	defer group.mu.Unlock()
	return group.err
}

func (group *WorkerGroup) runWorker(ctx context.Context) {
	group.observeStarted()
	defer group.wg.Done()
	defer group.observeStopped()
	defer func() {
		if recovered := recover(); recovered != nil {
			group.fail(ErrWorkerPanic)
		}
	}()
	for {
		if ctx.Err() != nil {
			return
		}
		if group.receiveDelivery != nil {
			delivery, err := group.receiveDelivery(ctx)
			if err != nil {
				if isWorkerCancellation(ctx, err) {
					return
				}
				group.fail(err)
				return
			}
			if err := group.processDelivery(ctx, delivery); err != nil {
				if isWorkerCancellation(ctx, err) {
					return
				}
				group.fail(err)
				return
			}
			continue
		}
		message, err := group.receive(ctx)
		if err != nil {
			if isWorkerCancellation(ctx, err) {
				return
			}
			group.fail(err)
			return
		}
		err = group.client.Process(ctx, message, group.handle)
		if err != nil {
			if isWorkerCancellation(ctx, err) {
				return
			}
			group.fail(err)
			return
		}
	}
}

func (group *WorkerGroup) processDelivery(ctx context.Context, delivery Delivery) error {
	extensionEnabled := deliveryLeaseExtensionEnabled(group.retry)
	if delivery.Acknowledge == nil || delivery.DeadLetter == nil || (extensionEnabled && delivery.ExtendLease == nil) {
		return ErrInvalidDelivery
	}
	if !extensionEnabled {
		settlement, success, err := group.deliverySettlementPlan(ctx, delivery)
		if err != nil {
			return err
		}
		return group.settleDelivery(ctx, settlement, success)
	}

	deliveryContext, cancelDelivery := context.WithCancel(ctx)
	defer cancelDelivery()
	stopExtension := make(chan struct{})
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { close(stopExtension) }) }
	defer stop()
	extensionResult := make(chan error, 1)
	go func() {
		err := group.extendDeliveryLease(deliveryContext, delivery.ExtendLease, stopExtension)
		if err != nil && ctx.Err() == nil {
			cancelDelivery()
		}
		extensionResult <- err
	}()

	settlement, success, processErr := group.deliverySettlementPlan(deliveryContext, delivery)
	stop()
	extensionErr := <-extensionResult
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if extensionErr != nil {
		group.observeLeaseExtensionFailed()
		return ErrDeliveryLeaseExtension
	}
	if processErr != nil {
		return processErr
	}
	return group.settleDelivery(ctx, settlement, success)
}

func (group *WorkerGroup) deliverySettlementPlan(
	ctx context.Context,
	delivery Delivery,
) (func(context.Context) error, func(), error) {
	for attempt := 1; attempt <= group.retry.MaxAttempts; attempt++ {
		err := group.client.Process(ctx, delivery.Message, group.handle)
		if err == nil {
			return delivery.Acknowledge, group.observeAcknowledged, nil
		}
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		if attempt == group.retry.MaxAttempts || permanentDeliveryFailure(err) {
			return delivery.DeadLetter, group.observeDeadLettered, nil
		}
		group.observeRetried()
		if err := waitDeliveryBackoff(ctx, deliveryBackoff(group.retry, attempt)); err != nil {
			return nil, nil, err
		}
	}
	return nil, nil, nil
}

func (group *WorkerGroup) extendDeliveryLease(
	ctx context.Context,
	callback func(context.Context) error,
	stop <-chan struct{},
) error {
	timer := time.NewTimer(group.retry.LeaseExtensionInterval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-stop:
			return nil
		case <-timer.C:
			if err := group.callDeliveryLeaseExtension(ctx, callback); err != nil {
				return err
			}
			group.observeLeaseExtended()
			timer.Reset(group.retry.LeaseExtensionInterval)
		}
	}
}

func (group *WorkerGroup) callDeliveryLeaseExtension(ctx context.Context, callback func(context.Context) error) error {
	extensionContext, cancel := context.WithTimeout(ctx, group.retry.LeaseExtensionTimeout)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- callDeliveryLeaseExtension(extensionContext, callback)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-extensionContext.Done():
		if err := ctx.Err(); err != nil {
			return err
		}
		return ErrDeliveryLeaseExtension
	case err := <-result:
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if err != nil {
			return ErrDeliveryLeaseExtension
		}
		return nil
	}
}

func callDeliveryLeaseExtension(ctx context.Context, callback func(context.Context) error) (err error) {
	defer func() {
		if recover() != nil {
			err = ErrDeliveryLeaseExtension
		}
	}()
	return callback(ctx)
}

func (group *WorkerGroup) settleDelivery(ctx context.Context, callback func(context.Context) error, success func()) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	settlementContext, cancel := context.WithTimeout(ctx, group.retry.SettlementTimeout)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- callDeliverySettlement(settlementContext, callback)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-settlementContext.Done():
		if err := ctx.Err(); err != nil {
			return err
		}
		group.observeSettlementFailed()
		return ErrDeliverySettlement
	case err := <-result:
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if err != nil {
			group.observeSettlementFailed()
			return ErrDeliverySettlement
		}
		success()
		return nil
	}
}

func callDeliverySettlement(ctx context.Context, callback func(context.Context) error) (err error) {
	defer func() {
		if recover() != nil {
			err = ErrDeliverySettlement
		}
	}()
	return callback(ctx)
}

func permanentDeliveryFailure(err error) bool {
	return errors.Is(err, ErrDeliveryNotRetryable) || errors.Is(err, ErrMessageTooLarge) ||
		errors.Is(err, ErrHeadersTooLarge) || errors.Is(err, ErrInvalidHeader)
}

func waitDeliveryBackoff(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func deliveryBackoff(config DeliveryRetryConfig, retry int) time.Duration {
	delay := config.InitialBackoff
	for index := 1; index < retry; index++ {
		if delay >= config.MaxBackoff || delay > config.MaxBackoff/2 {
			return config.MaxBackoff
		}
		delay *= 2
	}
	if delay > config.MaxBackoff {
		return config.MaxBackoff
	}
	return delay
}

func addDeliveryBudget(total, duration time.Duration) (time.Duration, bool) {
	const maximumDuration = time.Duration(1<<63 - 1)
	if duration <= 0 || total > maximumDuration-duration {
		return 0, false
	}
	return total + duration, true
}

func defaultDeliveryRetryConfig(config DeliveryRetryConfig) DeliveryRetryConfig {
	if config.MaxAttempts == 0 {
		config.MaxAttempts = defaultDeliveryMaxAttempts
	}
	if config.InitialBackoff == 0 {
		config.InitialBackoff = defaultDeliveryInitialBackoff
	}
	if config.MaxBackoff == 0 {
		config.MaxBackoff = defaultDeliveryMaxBackoff
	}
	if config.SettlementTimeout == 0 {
		config.SettlementTimeout = defaultDeliverySettlementTimeout
	}
	return config
}

func validateDeliveryRetryConfig(config DeliveryRetryConfig) error {
	if config.MaxAttempts < 1 || config.MaxAttempts > maximumDeliveryMaxAttempts {
		return errors.New("queue delivery attempts must be between 1 and 10")
	}
	if config.InitialBackoff <= 0 || config.MaxBackoff < config.InitialBackoff {
		return errors.New("queue delivery backoff must be positive and ordered")
	}
	if config.SettlementTimeout <= 0 {
		return errors.New("queue delivery settlement timeout must be positive")
	}
	intervalConfigured := config.LeaseExtensionInterval != 0
	timeoutConfigured := config.LeaseExtensionTimeout != 0
	if intervalConfigured != timeoutConfigured {
		return errors.New("queue delivery lease extension interval and timeout must be configured together")
	}
	if intervalConfigured && (config.LeaseExtensionInterval < minimumLeaseExtensionInterval ||
		config.LeaseExtensionInterval > maximumLeaseExtensionInterval ||
		config.LeaseExtensionTimeout <= 0 || config.LeaseExtensionTimeout > maximumLeaseExtensionTimeout ||
		config.LeaseExtensionTimeout > config.LeaseExtensionInterval) {
		return errors.New("queue delivery lease extension interval or timeout is invalid")
	}
	return nil
}

func deliveryLeaseExtensionEnabled(config DeliveryRetryConfig) bool {
	return config.LeaseExtensionInterval > 0 && config.LeaseExtensionTimeout > 0
}

func (group *WorkerGroup) fail(err error) {
	if err == nil {
		return
	}
	group.mu.Lock()
	firstFailure := false
	if group.err == nil {
		group.err = err
		firstFailure = true
	}
	cancel := group.cancel
	group.mu.Unlock()
	if firstFailure {
		group.observeFailure()
	}
	if cancel != nil {
		cancel()
	}
}

func (group *WorkerGroup) observeStarted() {
	if group == nil || group.observer == nil {
		return
	}
	defer func() { _ = recover() }()
	group.observer.WorkerStarted()
}

func (group *WorkerGroup) observeStopped() {
	if group == nil || group.observer == nil {
		return
	}
	defer func() { _ = recover() }()
	group.observer.WorkerStopped()
}

func (group *WorkerGroup) observeFailure() {
	if group == nil || group.observer == nil {
		return
	}
	defer func() { _ = recover() }()
	group.observer.WorkerFailed()
}

func (group *WorkerGroup) observeAcknowledged() {
	if group == nil || group.deliveryObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.deliveryObserver.DeliveryAcknowledged()
}

func (group *WorkerGroup) observeRetried() {
	if group == nil || group.deliveryObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.deliveryObserver.DeliveryRetried()
}

func (group *WorkerGroup) observeDeadLettered() {
	if group == nil || group.deliveryObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.deliveryObserver.DeliveryDeadLettered()
}

func (group *WorkerGroup) observeSettlementFailed() {
	if group == nil || group.deliveryObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.deliveryObserver.DeliverySettlementFailed()
}

func (group *WorkerGroup) observeLeaseExtended() {
	if group == nil || group.leaseObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.leaseObserver.DeliveryLeaseExtended()
}

func (group *WorkerGroup) observeLeaseExtensionFailed() {
	if group == nil || group.leaseObserver == nil {
		return
	}
	defer func() { _ = recover() }()
	group.leaseObserver.DeliveryLeaseExtensionFailed()
}

func isWorkerCancellation(ctx context.Context, err error) bool {
	return ctx.Err() != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded))
}

var errNilWorkerGroup = errors.New("queue worker group is nil")
