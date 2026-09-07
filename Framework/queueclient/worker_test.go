package queueclient

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewWorkerGroupValidatesCallbacksAndConcurrency(t *testing.T) {
	client, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	validReceive := func(context.Context) (Message, error) { return Message{}, nil }
	validDeliveryReceive := func(context.Context) (Delivery, error) {
		return Delivery{
			Acknowledge: func(context.Context) error { return nil },
			DeadLetter:  func(context.Context) error { return nil },
		}, nil
	}
	validHandle := func(context.Context, Message) error { return nil }
	for name, config := range map[string]WorkerConfig{
		"nil receive":            {Handle: validHandle},
		"both receive modes":     {Receive: validReceive, ReceiveDelivery: validDeliveryReceive, Handle: validHandle},
		"nil handle":             {Receive: validReceive},
		"negative workers":       {Workers: -1, Receive: validReceive, Handle: validHandle},
		"too many workers":       {Workers: maxWorkerCount + 1, Receive: validReceive, Handle: validHandle},
		"retry without delivery": {Receive: validReceive, Handle: validHandle, Retry: DeliveryRetryConfig{MaxAttempts: 2}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewWorkerGroup(client, config); err == nil {
				t.Fatal("NewWorkerGroup() error = nil")
			}
		})
	}
	if _, err := NewWorkerGroup(nil, WorkerConfig{Receive: validReceive, Handle: validHandle}); !errors.Is(err, errNilClient) {
		t.Fatalf("nil client error = %v", err)
	}
	group, err := NewWorkerGroup(client, WorkerConfig{Receive: validReceive, Handle: validHandle})
	if err != nil {
		t.Fatalf("default worker group error = %v", err)
	}
	if group.workers != defaultWorkerCount {
		t.Fatalf("default workers = %d, want %d", group.workers, defaultWorkerCount)
	}
	for name, retry := range map[string]DeliveryRetryConfig{
		"negative attempts":       {MaxAttempts: -1},
		"too many attempts":       {MaxAttempts: maximumDeliveryMaxAttempts + 1},
		"negative backoff":        {InitialBackoff: -time.Second},
		"inverted backoff":        {InitialBackoff: time.Second, MaxBackoff: time.Millisecond},
		"negative settlement":     {SettlementTimeout: -time.Second},
		"extension interval only": {LeaseExtensionInterval: time.Second},
		"extension timeout only":  {LeaseExtensionTimeout: time.Second},
		"extension too frequent":  {LeaseExtensionInterval: time.Millisecond, LeaseExtensionTimeout: time.Millisecond},
		"extension too sparse":    {LeaseExtensionInterval: maximumLeaseExtensionInterval + time.Second, LeaseExtensionTimeout: time.Second},
		"extension timeout longer": {LeaseExtensionInterval: time.Second,
			LeaseExtensionTimeout: 2 * time.Second},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewWorkerGroup(client, WorkerConfig{
				ReceiveDelivery: validDeliveryReceive,
				Handle:          validHandle,
				Retry:           retry,
			}); err == nil {
				t.Fatal("NewWorkerGroup() error = nil")
			}
		})
	}
	if _, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: validDeliveryReceive,
		Handle:          validHandle,
		LeaseObserver:   &deliveryLeaseObserverRecorder{},
	}); err == nil {
		t.Fatal("NewWorkerGroup(lease observer without extension) error = nil")
	}
}

func TestMinimumDeliveryLeaseUsesEffectiveRetryBudget(t *testing.T) {
	client, err := New(Config{System: SystemNATS, ProcessTimeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	budget, err := client.MinimumDeliveryLease(DeliveryRetryConfig{
		MaxAttempts:       4,
		InitialBackoff:    100 * time.Millisecond,
		MaxBackoff:        250 * time.Millisecond,
		SettlementTimeout: 3 * time.Second,
	}, 500*time.Millisecond)
	if err != nil {
		t.Fatalf("MinimumDeliveryLease() error = %v", err)
	}
	if budget != 12*time.Second+150*time.Millisecond {
		t.Fatalf("delivery lease budget = %s, want 12.15s", budget)
	}
	renewedBudget, err := client.MinimumDeliveryLease(DeliveryRetryConfig{
		MaxAttempts:            4,
		InitialBackoff:         100 * time.Millisecond,
		MaxBackoff:             250 * time.Millisecond,
		SettlementTimeout:      3 * time.Second,
		LeaseExtensionInterval: 250 * time.Millisecond,
		LeaseExtensionTimeout:  100 * time.Millisecond,
	}, 500*time.Millisecond)
	if err != nil {
		t.Fatalf("MinimumDeliveryLease(extension) error = %v", err)
	}
	if renewedBudget != 3*time.Second+750*time.Millisecond {
		t.Fatalf("renewed delivery lease budget = %s, want 3.75s", renewedBudget)
	}
	renewalDominatedBudget, err := client.MinimumDeliveryLease(DeliveryRetryConfig{
		MaxAttempts:            1,
		InitialBackoff:         time.Millisecond,
		MaxBackoff:             time.Millisecond,
		SettlementTimeout:      50 * time.Millisecond,
		LeaseExtensionInterval: 200 * time.Millisecond,
		LeaseExtensionTimeout:  150 * time.Millisecond,
	}, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("MinimumDeliveryLease(extension timeout) error = %v", err)
	}
	if renewalDominatedBudget != 400*time.Millisecond {
		t.Fatalf("renewal-dominated delivery lease budget = %s, want 400ms", renewalDominatedBudget)
	}

	defaultClient, err := New(Config{System: SystemNATS})
	if err != nil {
		t.Fatalf("New(defaults) error = %v", err)
	}
	defaultBudget, err := defaultClient.MinimumDeliveryLease(DeliveryRetryConfig{}, time.Second)
	if err != nil {
		t.Fatalf("MinimumDeliveryLease(defaults) error = %v", err)
	}
	if defaultBudget != 94*time.Second+450*time.Millisecond {
		t.Fatalf("default delivery lease budget = %s, want 1m34.45s", defaultBudget)
	}

	maximumAttemptsBudget, err := client.MinimumDeliveryLease(DeliveryRetryConfig{
		MaxAttempts:       maximumDeliveryMaxAttempts,
		InitialBackoff:    time.Nanosecond,
		MaxBackoff:        4 * time.Nanosecond,
		SettlementTimeout: time.Nanosecond,
	}, time.Nanosecond)
	if err != nil {
		t.Fatalf("MinimumDeliveryLease(max attempts) error = %v", err)
	}
	if maximumAttemptsBudget != 20*time.Second+34*time.Nanosecond {
		t.Fatalf("maximum-attempt delivery lease budget = %s", maximumAttemptsBudget)
	}
}

func TestDeliveryRetryJitterUsesInclusivePositiveWindow(t *testing.T) {
	const delay = 100 * time.Millisecond
	const maximum = time.Second

	if got := deliveryRetryJitter(delay, maximum, func(limit int64) int64 {
		if want := int64(delay/2) + 1; limit != want {
			t.Fatalf("random limit = %d, want %d", limit, want)
		}
		return 0
	}); got != delay {
		t.Fatalf("lower-bound deliveryRetryJitter() = %s, want %s", got, delay)
	}

	want := delay + delay/2
	if got := deliveryRetryJitter(delay, maximum, func(limit int64) int64 {
		return limit - 1
	}); got != want {
		t.Fatalf("upper-bound deliveryRetryJitter() = %s, want %s", got, want)
	}
}

func TestDeliveryRetryJitterTruncatesWindowAtMaximumBackoff(t *testing.T) {
	const delay = 90 * time.Millisecond
	const maximum = 100 * time.Millisecond
	wantLimit := int64(maximum-delay) + 1

	got := deliveryRetryJitter(delay, maximum, func(limit int64) int64 {
		if limit != wantLimit {
			t.Fatalf("random limit = %d, want %d", limit, wantLimit)
		}
		return limit - 1
	})
	if got != maximum {
		t.Fatalf("deliveryRetryJitter() = %s, want %s", got, maximum)
	}
}

func TestDeliveryRetryJitterSkipsSamplingWithoutWindow(t *testing.T) {
	sample := func(int64) int64 {
		t.Fatal("random source called without an available jitter window")
		return 0
	}
	for _, test := range []struct {
		name    string
		delay   time.Duration
		maximum time.Duration
	}{
		{name: "at maximum", delay: time.Second, maximum: time.Second},
		{name: "sub-nanosecond half window", delay: time.Nanosecond, maximum: time.Second},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := deliveryRetryJitter(test.delay, test.maximum, sample); got != test.delay {
				t.Fatalf("deliveryRetryJitter() = %s, want %s", got, test.delay)
			}
		})
	}
}

func TestWorkerGroupUsesInjectedDeliveryRetryJitter(t *testing.T) {
	client, err := New(Config{System: SystemNATS, ProcessTimeout: time.Second})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	observer := &deliveryObserverRecorder{}
	var attempts atomic.Int32
	var acknowledged atomic.Int32
	var deadLettered atomic.Int32
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(context.Context) (Delivery, error) { return Delivery{}, nil },
		Handle: func(context.Context, Message) error {
			if attempts.Add(1) == 1 {
				return errors.New("retry")
			}
			return nil
		},
		DeliveryObserver: observer,
		Retry: DeliveryRetryConfig{
			MaxAttempts:       2,
			InitialBackoff:    2 * time.Nanosecond,
			MaxBackoff:        10 * time.Nanosecond,
			SettlementTimeout: time.Second,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	var samples atomic.Int32
	group.randomInt64N = func(limit int64) int64 {
		if limit != 2 {
			t.Fatalf("random limit = %d, want 2", limit)
		}
		samples.Add(1)
		return limit - 1
	}

	err = group.processDelivery(context.Background(), Delivery{
		Message:     Message{Body: []byte("jitter")},
		Acknowledge: func(context.Context) error { acknowledged.Add(1); return nil },
		DeadLetter:  func(context.Context) error { deadLettered.Add(1); return nil },
	})
	if err != nil {
		t.Fatalf("processDelivery() error = %v", err)
	}
	if attempts.Load() != 2 || samples.Load() != 1 || acknowledged.Load() != 1 || deadLettered.Load() != 0 {
		t.Fatalf("attempts/samples/ack/dead-letter = %d/%d/%d/%d", attempts.Load(), samples.Load(), acknowledged.Load(), deadLettered.Load())
	}
	if events := observer.snapshot(); events["retried"] != 1 || events["acknowledged"] != 1 ||
		events["dead_lettered"] != 0 || events["settlement_failed"] != 0 {
		t.Fatalf("delivery events = %+v", events)
	}
}

func TestMinimumDeliveryLeaseRejectsInvalidAndOverflowingBudgets(t *testing.T) {
	client, err := New(Config{System: SystemNATS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	var nilClient *Client
	for name, calculate := range map[string]func() (time.Duration, error){
		"nil client": func() (time.Duration, error) {
			return nilClient.MinimumDeliveryLease(DeliveryRetryConfig{}, time.Second)
		},
		"zero margin":     func() (time.Duration, error) { return client.MinimumDeliveryLease(DeliveryRetryConfig{}, 0) },
		"negative margin": func() (time.Duration, error) { return client.MinimumDeliveryLease(DeliveryRetryConfig{}, -time.Second) },
		"invalid attempts": func() (time.Duration, error) {
			return client.MinimumDeliveryLease(DeliveryRetryConfig{MaxAttempts: 11}, time.Second)
		},
		"invalid backoff": func() (time.Duration, error) {
			return client.MinimumDeliveryLease(DeliveryRetryConfig{InitialBackoff: -time.Second}, time.Second)
		},
		"invalid settlement": func() (time.Duration, error) {
			return client.MinimumDeliveryLease(DeliveryRetryConfig{SettlementTimeout: -time.Second}, time.Second)
		},
		"partial lease extension": func() (time.Duration, error) {
			return client.MinimumDeliveryLease(DeliveryRetryConfig{LeaseExtensionInterval: time.Second}, time.Second)
		},
	} {
		t.Run(name, func(t *testing.T) {
			if budget, err := calculate(); err == nil || budget != 0 {
				t.Fatalf("MinimumDeliveryLease() = %s, %v", budget, err)
			}
		})
	}

	overflowClient, err := New(Config{System: SystemNATS, ProcessTimeout: time.Duration(1 << 62)})
	if err != nil {
		t.Fatalf("New(overflow client) error = %v", err)
	}
	if budget, err := overflowClient.MinimumDeliveryLease(DeliveryRetryConfig{}, time.Nanosecond); err == nil || budget != 0 {
		t.Fatalf("MinimumDeliveryLease(overflow) = %s, %v", budget, err)
	}
}

func TestWorkerGroupCancellationStopsAndWaits(t *testing.T) {
	client, err := New(Config{System: SystemNATS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	started := make(chan struct{})
	canceled := make(chan struct{})
	var startOnce sync.Once
	var cancelOnce sync.Once
	group, err := NewWorkerGroup(client, WorkerConfig{
		Receive: func(ctx context.Context) (Message, error) {
			startOnce.Do(func() { close(started) })
			<-ctx.Done()
			cancelOnce.Do(func() { close(canceled) })
			return Message{}, ctx.Err()
		},
		Handle: func(context.Context, Message) error { t.Fatal("handler was called"); return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start receiving")
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := group.Shutdown(shutdownContext); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
	if err := group.Wait(); err != nil {
		t.Fatalf("Wait() error = %v", err)
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("receive callback did not observe cancellation")
	}
	if err := group.Start(context.Background()); !errors.Is(err, ErrWorkerClosed) {
		t.Fatalf("second Start() error = %v", err)
	}
}

func TestWorkerGroupKeepsHandlerConcurrencyBounded(t *testing.T) {
	const workers = 3
	client, err := New(Config{System: SystemRabbitMQ})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	started := make(chan struct{}, workers)
	var active atomic.Int32
	var highWater atomic.Int32
	group, err := NewWorkerGroup(client, WorkerConfig{
		Workers: workers,
		Receive: func(context.Context) (Message, error) {
			return Message{Body: []byte("bounded")}, nil
		},
		Handle: func(ctx context.Context, _ Message) error {
			current := active.Add(1)
			for {
				previous := highWater.Load()
				if current <= previous || highWater.CompareAndSwap(previous, current) {
					break
				}
			}
			started <- struct{}{}
			<-ctx.Done()
			active.Add(-1)
			return ctx.Err()
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	for index := 0; index < workers; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatalf("handler %d did not start", index)
		}
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := group.Shutdown(shutdownContext); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
	if got := highWater.Load(); got != workers {
		t.Fatalf("handler high-water = %d, want %d", got, workers)
	}
	if got := active.Load(); got != 0 {
		t.Fatalf("active handlers after shutdown = %d", got)
	}
}

func TestWorkerGroupRetriesAndAcknowledgesReliableDelivery(t *testing.T) {
	client, err := New(Config{System: SystemNATS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	observer := &deliveryObserverRecorder{}
	acknowledged := make(chan struct{})
	var receiveCalls atomic.Int32
	var attempts atomic.Int32
	groupContext, cancelGroup := context.WithCancel(context.Background())
	defer cancelGroup()
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(ctx context.Context) (Delivery, error) {
			if receiveCalls.Add(1) > 1 {
				<-ctx.Done()
				return Delivery{}, ctx.Err()
			}
			return Delivery{
				Message: Message{Body: []byte("fresh"), Headers: map[string]string{"X-Safe": "original"}},
				Acknowledge: func(ctx context.Context) error {
					if _, ok := ctx.Deadline(); !ok {
						t.Error("acknowledgement context has no deadline")
					}
					close(acknowledged)
					return nil
				},
				DeadLetter: func(context.Context) error {
					t.Error("successful retry was dead-lettered")
					return nil
				},
			}, nil
		},
		Handle: func(_ context.Context, message Message) error {
			attempt := attempts.Add(1)
			if string(message.Body) != "fresh" || message.Headers["X-Safe"] != "original" {
				t.Errorf("retry received mutated message: %#v", message)
			}
			message.Body[0] = 'X'
			message.Headers["X-Safe"] = "mutated"
			if attempt < 3 {
				return errors.New("private handler failure")
			}
			return nil
		},
		DeliveryObserver: observer,
		Retry: DeliveryRetryConfig{
			MaxAttempts:       3,
			InitialBackoff:    time.Millisecond,
			MaxBackoff:        2 * time.Millisecond,
			SettlementTimeout: time.Second,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(groupContext); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-acknowledged:
	case <-time.After(time.Second):
		t.Fatal("delivery was not acknowledged")
	}
	waitForAtomicInt32(t, &observer.acknowledged, 1, "acknowledged observation")
	cancelGroup()
	if err := group.Wait(); err != nil {
		t.Fatalf("Wait() error = %v", err)
	}
	if attempts.Load() != 3 || observer.acknowledged.Load() != 1 || observer.retried.Load() != 2 ||
		observer.deadLettered.Load() != 0 || observer.settlementFailed.Load() != 0 {
		t.Fatalf("attempts/events = %d/%+v", attempts.Load(), observer.snapshot())
	}
}

func TestWorkerGroupExtendsLeaseUntilSettlement(t *testing.T) {
	client, err := New(Config{System: SystemNATS, ProcessTimeout: time.Second})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	leaseObserver := &deliveryLeaseObserverRecorder{}
	acknowledged := make(chan struct{})
	var receiveCalls atomic.Int32
	var extensionCalls atomic.Int32
	var callsAtSettlement atomic.Int32
	groupContext, cancelGroup := context.WithCancel(context.Background())
	defer cancelGroup()
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(ctx context.Context) (Delivery, error) {
			if receiveCalls.Add(1) > 1 {
				<-ctx.Done()
				return Delivery{}, ctx.Err()
			}
			return Delivery{
				Message: Message{Body: []byte("long-running")},
				ExtendLease: func(ctx context.Context) error {
					if _, ok := ctx.Deadline(); !ok {
						t.Error("lease extension context has no deadline")
					}
					extensionCalls.Add(1)
					return nil
				},
				Acknowledge: func(context.Context) error {
					callsAtSettlement.Store(extensionCalls.Load())
					close(acknowledged)
					return nil
				},
				DeadLetter: func(context.Context) error {
					t.Error("successful extended delivery was dead-lettered")
					return nil
				},
			}, nil
		},
		Handle: func(ctx context.Context, _ Message) error {
			timer := time.NewTimer(85 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
		LeaseObserver: leaseObserver,
		Retry: DeliveryRetryConfig{
			MaxAttempts:            1,
			InitialBackoff:         time.Millisecond,
			MaxBackoff:             time.Millisecond,
			SettlementTimeout:      50 * time.Millisecond,
			LeaseExtensionInterval: 20 * time.Millisecond,
			LeaseExtensionTimeout:  10 * time.Millisecond,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(groupContext); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-acknowledged:
	case <-time.After(time.Second):
		t.Fatal("extended delivery was not acknowledged")
	}
	if calls := callsAtSettlement.Load(); calls < 3 || leaseObserver.extended.Load() != calls {
		t.Fatalf("lease extension calls/events = %d/%d, want at least 3", calls, leaseObserver.extended.Load())
	}
	time.Sleep(50 * time.Millisecond)
	if calls := extensionCalls.Load(); calls != callsAtSettlement.Load() {
		t.Fatalf("lease extension continued during or after settlement: %d -> %d", callsAtSettlement.Load(), calls)
	}
	if leaseObserver.failed.Load() != 0 {
		t.Fatalf("lease extension failures = %d", leaseObserver.failed.Load())
	}
	cancelGroup()
	if err := group.Wait(); err != nil {
		t.Fatalf("Wait() error = %v", err)
	}
}

func TestWorkerGroupBoundsAndRedactsLeaseExtensionFailure(t *testing.T) {
	for _, test := range []struct {
		name    string
		extend  func(context.Context) error
		release func()
	}{
		{name: "error", extend: func(context.Context) error { return errors.New("private lease credential") }},
		{name: "panic", extend: func(context.Context) error { panic("private lease panic") }},
		func() struct {
			name    string
			extend  func(context.Context) error
			release func()
		} {
			blocked := make(chan struct{})
			return struct {
				name    string
				extend  func(context.Context) error
				release func()
			}{
				name:    "timeout",
				extend:  func(context.Context) error { <-blocked; return nil },
				release: func() { close(blocked) },
			}
		}(),
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.release != nil {
				defer test.release()
			}
			client, err := New(Config{System: SystemNATS, ProcessTimeout: time.Second})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			leaseObserver := &deliveryLeaseObserverRecorder{}
			workerObserver := &workerObserverRecorder{}
			var settlements atomic.Int32
			group, err := NewWorkerGroup(client, WorkerConfig{
				ReceiveDelivery: func(context.Context) (Delivery, error) {
					return Delivery{
						Message:     Message{Body: []byte("extend")},
						ExtendLease: test.extend,
						Acknowledge: func(context.Context) error { settlements.Add(1); return nil },
						DeadLetter:  func(context.Context) error { settlements.Add(1); return nil },
					}, nil
				},
				Handle: func(ctx context.Context, _ Message) error {
					<-ctx.Done()
					return ctx.Err()
				},
				Observer:      workerObserver,
				LeaseObserver: leaseObserver,
				Retry: DeliveryRetryConfig{
					MaxAttempts:            1,
					InitialBackoff:         time.Millisecond,
					MaxBackoff:             time.Millisecond,
					SettlementTimeout:      20 * time.Millisecond,
					LeaseExtensionInterval: 10 * time.Millisecond,
					LeaseExtensionTimeout:  5 * time.Millisecond,
				},
			})
			if err != nil {
				t.Fatalf("NewWorkerGroup() error = %v", err)
			}
			if err := group.Start(context.Background()); err != nil {
				t.Fatalf("Start() error = %v", err)
			}
			err = group.Wait()
			if !errors.Is(err, ErrDeliveryLeaseExtension) || strings.Contains(err.Error(), "private") {
				t.Fatalf("Wait() error = %v", err)
			}
			if leaseObserver.extended.Load() != 0 || leaseObserver.failed.Load() != 1 || workerObserver.failed.Load() != 1 {
				t.Fatalf("lease/worker events = extended:%d failed:%d worker:%d", leaseObserver.extended.Load(), leaseObserver.failed.Load(), workerObserver.failed.Load())
			}
			if settlements.Load() != 0 {
				t.Fatalf("settlements after lease extension failure = %d", settlements.Load())
			}
		})
	}
}

func TestWorkerGroupDeadLettersExhaustedAndPermanentDeliveries(t *testing.T) {
	for _, test := range []struct {
		name            string
		handlerError    error
		wantAttempts    int32
		wantRetryEvents int32
	}{
		{name: "exhausted", handlerError: errors.New("private transient failure"), wantAttempts: 3, wantRetryEvents: 2},
		{name: "permanent", handlerError: errors.Join(ErrDeliveryNotRetryable, errors.New("private permanent failure")), wantAttempts: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, err := New(Config{System: SystemKafka})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			observer := &deliveryObserverRecorder{}
			deadLettered := make(chan struct{})
			var receiveCalls atomic.Int32
			var attempts atomic.Int32
			groupContext, cancelGroup := context.WithCancel(context.Background())
			defer cancelGroup()
			group, err := NewWorkerGroup(client, WorkerConfig{
				ReceiveDelivery: func(ctx context.Context) (Delivery, error) {
					if receiveCalls.Add(1) > 1 {
						<-ctx.Done()
						return Delivery{}, ctx.Err()
					}
					return Delivery{
						Message:     Message{Body: []byte("bounded")},
						Acknowledge: func(context.Context) error { t.Error("failed delivery was acknowledged"); return nil },
						DeadLetter:  func(context.Context) error { close(deadLettered); return nil },
					}, nil
				},
				Handle: func(context.Context, Message) error {
					attempts.Add(1)
					return test.handlerError
				},
				DeliveryObserver: observer,
				Retry: DeliveryRetryConfig{
					MaxAttempts:       3,
					InitialBackoff:    time.Millisecond,
					MaxBackoff:        2 * time.Millisecond,
					SettlementTimeout: time.Second,
				},
			})
			if err != nil {
				t.Fatalf("NewWorkerGroup() error = %v", err)
			}
			if err := group.Start(groupContext); err != nil {
				t.Fatalf("Start() error = %v", err)
			}
			select {
			case <-deadLettered:
			case <-time.After(time.Second):
				t.Fatal("delivery was not dead-lettered")
			}
			waitForAtomicInt32(t, &observer.deadLettered, 1, "dead-letter observation")
			cancelGroup()
			if err := group.Wait(); err != nil {
				t.Fatalf("Wait() error = %v", err)
			}
			if attempts.Load() != test.wantAttempts || observer.retried.Load() != test.wantRetryEvents ||
				observer.deadLettered.Load() != 1 || observer.acknowledged.Load() != 0 {
				t.Fatalf("attempts/events = %d/%+v", attempts.Load(), observer.snapshot())
			}
		})
	}
}

func TestWorkerGroupBoundsAndRedactsDeliverySettlementFailure(t *testing.T) {
	for _, test := range []struct {
		name       string
		settlement func(context.Context) error
		release    func()
	}{
		{name: "error", settlement: func(context.Context) error { return errors.New("private broker credential") }},
		{name: "panic", settlement: func(context.Context) error { panic("private broker panic") }},
		func() struct {
			name       string
			settlement func(context.Context) error
			release    func()
		} {
			blocked := make(chan struct{})
			return struct {
				name       string
				settlement func(context.Context) error
				release    func()
			}{
				name:       "timeout",
				settlement: func(context.Context) error { <-blocked; return nil },
				release:    func() { close(blocked) },
			}
		}(),
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.release != nil {
				defer test.release()
			}
			client, err := New(Config{System: SystemRabbitMQ})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			deliveryObserver := &deliveryObserverRecorder{}
			workerObserver := &workerObserverRecorder{}
			group, err := NewWorkerGroup(client, WorkerConfig{
				ReceiveDelivery: func(context.Context) (Delivery, error) {
					return Delivery{
						Message:     Message{Body: []byte("settle")},
						Acknowledge: test.settlement,
						DeadLetter:  func(context.Context) error { return nil },
					}, nil
				},
				Handle:           func(context.Context, Message) error { return nil },
				Observer:         workerObserver,
				DeliveryObserver: deliveryObserver,
				Retry: DeliveryRetryConfig{
					MaxAttempts:       1,
					InitialBackoff:    time.Millisecond,
					MaxBackoff:        time.Millisecond,
					SettlementTimeout: 20 * time.Millisecond,
				},
			})
			if err != nil {
				t.Fatalf("NewWorkerGroup() error = %v", err)
			}
			if err := group.Start(context.Background()); err != nil {
				t.Fatalf("Start() error = %v", err)
			}
			err = group.Wait()
			if !errors.Is(err, ErrDeliverySettlement) || strings.Contains(err.Error(), "private") {
				t.Fatalf("Wait() error = %v", err)
			}
			if deliveryObserver.settlementFailed.Load() != 1 || workerObserver.failed.Load() != 1 {
				t.Fatalf("settlement/worker failures = %d/%d", deliveryObserver.settlementFailed.Load(), workerObserver.failed.Load())
			}
		})
	}
}

func TestWorkerGroupCancellationDuringRetryDoesNotSettleDelivery(t *testing.T) {
	client, err := New(Config{System: SystemAWSSQS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	retrying := make(chan struct{})
	observer := &signalingDeliveryObserver{retrying: retrying}
	var settlements atomic.Int32
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(context.Context) (Delivery, error) {
			return Delivery{
				Message:     Message{Body: []byte("cancel")},
				Acknowledge: func(context.Context) error { settlements.Add(1); return nil },
				DeadLetter:  func(context.Context) error { settlements.Add(1); return nil },
			}, nil
		},
		Handle:           func(context.Context, Message) error { return errors.New("retry") },
		DeliveryObserver: observer,
		Retry: DeliveryRetryConfig{
			MaxAttempts:       3,
			InitialBackoff:    time.Hour,
			MaxBackoff:        time.Hour,
			SettlementTimeout: time.Second,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-retrying:
	case <-time.After(time.Second):
		t.Fatal("delivery did not enter retry backoff")
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := group.Shutdown(shutdownContext); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
	if settlements.Load() != 0 {
		t.Fatalf("settlement callbacks after cancellation = %d", settlements.Load())
	}
}

func TestWorkerGroupCancellationDuringSettlementIsANormalStop(t *testing.T) {
	client, err := New(Config{System: SystemRabbitMQ})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	settling := make(chan struct{})
	var settlementCanceled atomic.Bool
	workerObserver := &workerObserverRecorder{}
	deliveryObserver := &deliveryObserverRecorder{}
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(context.Context) (Delivery, error) {
			return Delivery{
				Message: Message{Body: []byte("cancel settlement")},
				Acknowledge: func(ctx context.Context) error {
					close(settling)
					<-ctx.Done()
					settlementCanceled.Store(true)
					return ctx.Err()
				},
				DeadLetter: func(context.Context) error {
					t.Error("successful handler was dead-lettered")
					return nil
				},
			}, nil
		},
		Handle:           func(context.Context, Message) error { return nil },
		Observer:         workerObserver,
		DeliveryObserver: deliveryObserver,
		Retry: DeliveryRetryConfig{
			MaxAttempts:       1,
			InitialBackoff:    time.Millisecond,
			MaxBackoff:        time.Millisecond,
			SettlementTimeout: time.Hour,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := group.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	<-settling
	cancel()
	if err := group.Wait(); err != nil {
		t.Fatalf("Wait() error = %v", err)
	}
	if !settlementCanceled.Load() {
		t.Fatal("settlement callback did not observe cancellation")
	}
	if events := deliveryObserver.snapshot(); events["acknowledged"] != 0 || events["retried"] != 0 ||
		events["dead_lettered"] != 0 || events["settlement_failed"] != 0 {
		t.Fatalf("delivery events after cancellation = %+v", events)
	}
	if workerObserver.failed.Load() != 0 {
		t.Fatalf("worker failures after cancellation = %d", workerObserver.failed.Load())
	}
}

func TestWorkerGroupRejectsInvalidDeliveryAndIsolatesDeliveryObserverPanic(t *testing.T) {
	client, err := New(Config{System: SystemGCPPubSub})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	invalidGroup, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(context.Context) (Delivery, error) { return Delivery{}, nil },
		Handle:          func(context.Context, Message) error { return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(invalid delivery) error = %v", err)
	}
	if err := invalidGroup.Start(context.Background()); err != nil {
		t.Fatalf("Start(invalid delivery) error = %v", err)
	}
	if err := invalidGroup.Wait(); !errors.Is(err, ErrInvalidDelivery) {
		t.Fatalf("Wait(invalid delivery) error = %v", err)
	}
	missingExtensionGroup, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(context.Context) (Delivery, error) {
			return Delivery{
				Acknowledge: func(context.Context) error { return nil },
				DeadLetter:  func(context.Context) error { return nil },
			}, nil
		},
		Handle:        func(context.Context, Message) error { return nil },
		LeaseObserver: &deliveryLeaseObserverRecorder{},
		Retry: DeliveryRetryConfig{
			LeaseExtensionInterval: 10 * time.Millisecond,
			LeaseExtensionTimeout:  5 * time.Millisecond,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(missing extension) error = %v", err)
	}
	if err := missingExtensionGroup.Start(context.Background()); err != nil {
		t.Fatalf("Start(missing extension) error = %v", err)
	}
	if err := missingExtensionGroup.Wait(); !errors.Is(err, ErrInvalidDelivery) {
		t.Fatalf("Wait(missing extension) error = %v", err)
	}

	acknowledged := make(chan struct{})
	var receives atomic.Int32
	groupContext, cancelGroup := context.WithCancel(context.Background())
	defer cancelGroup()
	group, err := NewWorkerGroup(client, WorkerConfig{
		ReceiveDelivery: func(ctx context.Context) (Delivery, error) {
			if receives.Add(1) > 1 {
				<-ctx.Done()
				return Delivery{}, ctx.Err()
			}
			return Delivery{
				ExtendLease: func(context.Context) error { return nil },
				Acknowledge: func(context.Context) error { close(acknowledged); return nil },
				DeadLetter:  func(context.Context) error { return nil },
			}, nil
		},
		Handle: func(ctx context.Context, _ Message) error {
			timer := time.NewTimer(25 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
		DeliveryObserver: panicDeliveryObserver{},
		LeaseObserver:    panicDeliveryLeaseObserver{},
		Retry: DeliveryRetryConfig{
			LeaseExtensionInterval: 10 * time.Millisecond,
			LeaseExtensionTimeout:  5 * time.Millisecond,
		},
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(panic observer) error = %v", err)
	}
	if err := group.Start(groupContext); err != nil {
		t.Fatalf("Start(panic observer) error = %v", err)
	}
	select {
	case <-acknowledged:
	case <-time.After(time.Second):
		t.Fatal("observer panic changed acknowledgement")
	}
	cancelGroup()
	if err := group.Wait(); err != nil {
		t.Fatalf("Wait(panic observer) error = %v", err)
	}
}

func TestWorkerGroupStopsOnReceiveOrHandlerFailure(t *testing.T) {
	client, err := New(Config{System: SystemAWSSQS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	backendErr := errors.New("backend failure")
	var receiveCalls atomic.Int32
	receiveCanceled := make(chan struct{})
	secondReceive := make(chan struct{})
	firstReceiveReady := make(chan struct{})
	var cancelOnce sync.Once
	group, err := NewWorkerGroup(client, WorkerConfig{
		Workers: 2,
		Receive: func(ctx context.Context) (Message, error) {
			if receiveCalls.Add(1) == 1 {
				<-firstReceiveReady
				return Message{Body: []byte("one")}, nil
			}
			close(secondReceive)
			close(firstReceiveReady)
			<-ctx.Done()
			cancelOnce.Do(func() { close(receiveCanceled) })
			return Message{}, ctx.Err()
		},
		Handle: func(context.Context, Message) error { return backendErr },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-secondReceive:
	case <-time.After(time.Second):
		t.Fatal("second worker did not enter receive")
	}
	if err := group.Wait(); !errors.Is(err, backendErr) {
		t.Fatalf("Wait() error = %v, want backend failure", err)
	}
	select {
	case <-receiveCanceled:
	case <-time.After(time.Second):
		t.Fatal("other worker did not stop after failure")
	}
}

func TestWorkerGroupConvertsCallbackPanicsToPrivateError(t *testing.T) {
	client, err := New(Config{System: SystemGCPPubSub})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Run("receive", func(t *testing.T) {
		group, err := NewWorkerGroup(client, WorkerConfig{
			Receive: func(context.Context) (Message, error) { panic("credential-secret") },
			Handle:  func(context.Context, Message) error { return nil },
		})
		if err != nil {
			t.Fatalf("NewWorkerGroup() error = %v", err)
		}
		if err := group.Start(context.Background()); err != nil {
			t.Fatalf("Start() error = %v", err)
		}
		if err := group.Wait(); !errors.Is(err, ErrWorkerPanic) {
			t.Fatalf("Wait() error = %v, want ErrWorkerPanic", err)
		}
	})
	t.Run("handler", func(t *testing.T) {
		group, err := NewWorkerGroup(client, WorkerConfig{
			Receive: func(context.Context) (Message, error) { return Message{}, nil },
			Handle:  func(context.Context, Message) error { panic("body-secret") },
		})
		if err != nil {
			t.Fatalf("NewWorkerGroup() error = %v", err)
		}
		if err := group.Start(context.Background()); err != nil {
			t.Fatalf("Start() error = %v", err)
		}
		if err := group.Wait(); !errors.Is(err, ErrWorkerPanic) {
			t.Fatalf("Wait() error = %v, want ErrWorkerPanic", err)
		}
	})
}

func TestWorkerGroupDoesNotTreatStandaloneCancellationAsSuccess(t *testing.T) {
	client, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	group, err := NewWorkerGroup(client, WorkerConfig{
		Receive: func(context.Context) (Message, error) { return Message{}, context.Canceled },
		Handle:  func(context.Context, Message) error { return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := group.Wait(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait() error = %v, want context.Canceled", err)
	}
}

type workerObserverRecorder struct {
	started atomic.Int32
	stopped atomic.Int32
	failed  atomic.Int32
}

func (observer *workerObserverRecorder) WorkerStarted() { observer.started.Add(1) }
func (observer *workerObserverRecorder) WorkerStopped() { observer.stopped.Add(1) }
func (observer *workerObserverRecorder) WorkerFailed()  { observer.failed.Add(1) }

type deliveryObserverRecorder struct {
	acknowledged     atomic.Int32
	retried          atomic.Int32
	deadLettered     atomic.Int32
	settlementFailed atomic.Int32
}

type deliveryLeaseObserverRecorder struct {
	extended atomic.Int32
	failed   atomic.Int32
}

func (observer *deliveryLeaseObserverRecorder) DeliveryLeaseExtended() {
	observer.extended.Add(1)
}

func (observer *deliveryLeaseObserverRecorder) DeliveryLeaseExtensionFailed() {
	observer.failed.Add(1)
}

func waitForAtomicInt32(t *testing.T, value *atomic.Int32, want int32, description string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if value.Load() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("%s = %d, want %d", description, value.Load(), want)
}

func (observer *deliveryObserverRecorder) DeliveryAcknowledged() {
	observer.acknowledged.Add(1)
}

func (observer *deliveryObserverRecorder) DeliveryRetried() {
	observer.retried.Add(1)
}

func (observer *deliveryObserverRecorder) DeliveryDeadLettered() {
	observer.deadLettered.Add(1)
}

func (observer *deliveryObserverRecorder) DeliverySettlementFailed() {
	observer.settlementFailed.Add(1)
}

func (observer *deliveryObserverRecorder) snapshot() map[string]int32 {
	return map[string]int32{
		"acknowledged":      observer.acknowledged.Load(),
		"retried":           observer.retried.Load(),
		"dead_lettered":     observer.deadLettered.Load(),
		"settlement_failed": observer.settlementFailed.Load(),
	}
}

type signalingDeliveryObserver struct {
	retrying chan struct{}
	once     sync.Once
}

func (*signalingDeliveryObserver) DeliveryAcknowledged()     {}
func (*signalingDeliveryObserver) DeliveryDeadLettered()     {}
func (*signalingDeliveryObserver) DeliverySettlementFailed() {}
func (observer *signalingDeliveryObserver) DeliveryRetried() {
	observer.once.Do(func() { close(observer.retrying) })
}

func TestWorkerGroupReportsFixedLifecycleEventsAndIsolatesObserverPanic(t *testing.T) {
	client, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	observer := &workerObserverRecorder{}
	group, err := NewWorkerGroup(client, WorkerConfig{
		Observer: observer,
		Receive:  func(context.Context) (Message, error) { return Message{}, errors.New("backend-secret") },
		Handle:   func(context.Context, Message) error { return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := group.Wait(); err == nil || !strings.Contains(err.Error(), "backend-secret") {
		t.Fatalf("Wait() error = %v, want backend error", err)
	}
	if observer.started.Load() != 1 || observer.stopped.Load() != 1 || observer.failed.Load() != 1 {
		t.Fatalf("observer events = started:%d stopped:%d failed:%d", observer.started.Load(), observer.stopped.Load(), observer.failed.Load())
	}

	panicObserver := panicWorkerObserver{}
	group, err = NewWorkerGroup(client, WorkerConfig{
		Observer: panicObserver,
		Receive:  func(context.Context) (Message, error) { return Message{}, context.Canceled },
		Handle:   func(context.Context, Message) error { return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(panic observer) error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start(panic observer) error = %v", err)
	}
	if err := group.Wait(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait(panic observer) error = %v", err)
	}
}

type blockingStopObserver struct {
	stopping chan struct{}
	release  chan struct{}
}

func (observer *blockingStopObserver) WorkerStarted() {}
func (observer *blockingStopObserver) WorkerFailed()  {}
func (observer *blockingStopObserver) WorkerStopped() {
	close(observer.stopping)
	<-observer.release
}

func TestWorkerGroupWaitIncludesStoppedObservation(t *testing.T) {
	client, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	observer := &blockingStopObserver{
		stopping: make(chan struct{}),
		release:  make(chan struct{}),
	}
	group, err := NewWorkerGroup(client, WorkerConfig{
		Observer: observer,
		Receive:  func(context.Context) (Message, error) { return Message{}, context.Canceled },
		Handle:   func(context.Context, Message) error { return nil },
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := group.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	<-observer.stopping
	waited := make(chan error, 1)
	go func() { waited <- group.Wait() }()
	select {
	case err := <-waited:
		t.Fatalf("Wait() returned before WorkerStopped completed: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(observer.release)
	if err := <-waited; !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait() error = %v", err)
	}
}

type panicWorkerObserver struct{}

func (panicWorkerObserver) WorkerStarted() { panic("observer-secret") }
func (panicWorkerObserver) WorkerStopped() { panic("observer-secret") }
func (panicWorkerObserver) WorkerFailed()  { panic("observer-secret") }

type panicDeliveryObserver struct{}

func (panicDeliveryObserver) DeliveryAcknowledged()     { panic("observer-secret") }
func (panicDeliveryObserver) DeliveryRetried()          { panic("observer-secret") }
func (panicDeliveryObserver) DeliveryDeadLettered()     { panic("observer-secret") }
func (panicDeliveryObserver) DeliverySettlementFailed() { panic("observer-secret") }

type panicDeliveryLeaseObserver struct{}

func (panicDeliveryLeaseObserver) DeliveryLeaseExtended()        { panic("observer-secret") }
func (panicDeliveryLeaseObserver) DeliveryLeaseExtensionFailed() { panic("observer-secret") }
