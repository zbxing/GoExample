package httpapi

import (
	"bufio"
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v3"
)

const (
	defaultServerSentEventHeartbeatInterval  = 15 * time.Second
	minimumServerSentEventHeartbeatInterval  = 10 * time.Millisecond
	maximumServerSentEventHeartbeatInterval  = 5 * time.Minute
	defaultMaximumServerSentEventBytes       = 64 * 1024
	maximumServerSentEventBytes              = 1024 * 1024
	maximumServerSentEventLastEventIDBytes   = 1024
	maximumServerSentEventStreamTimeout      = 24 * time.Hour
	serverSentEventWriteDeadlineCleanupGrace = time.Second
)

type requestStreamLifetimeContextKey struct{}

const serverSentEventLastEventIDHeader = "Last-Event-ID"

// ServerSentEvent is one bounded UTF-8 event written using the EventSource
// wire format. ID and Event must be single-line values. A positive Retry value
// is encoded as whole milliseconds.
type ServerSentEvent struct {
	ID    string
	Event string
	Data  string
	Retry time.Duration
}

// ServerSentEventSource opens one event stream. lastEventID contains the
// bounded Last-Event-ID request header so the application can resume after a
// client reconnect. The source must stop producing when ctx is canceled.
type ServerSentEventSource func(
	ctx context.Context,
	lastEventID string,
) (<-chan ServerSentEvent, error)

// ServerSentEventOptions configures a server-sent event response. Events is
// consumed without an internal queue, so each receive follows the prior flush.
// A positive StreamTimeout replaces the ordinary request timeout after the
// stream is claimed, while retaining any shorter caller deadline, client
// cancellation and application shutdown. On the standard HTTP adapter it also
// replaces the server write deadline with the bounded stream deadline plus a
// one-second protocol cleanup allowance. Zero preserves both request and server
// write timeouts.
type ServerSentEventOptions struct {
	Events            <-chan ServerSentEvent
	HeartbeatInterval time.Duration
	MaxEventBytes     int
	StreamTimeout     time.Duration
}

// SendServerSentEvents starts a bounded server-sent event response. The stream
// stops when Events closes, the request deadline or client connection is
// canceled, or the Framework application begins shutdown.
func SendServerSentEvents(c fiber.Ctx, options ServerSentEventOptions) error {
	if c == nil {
		return errors.New("server-sent event context is required")
	}
	if options.Events == nil {
		return errors.New("server-sent event channel is required")
	}
	prepared, err := prepareServerSentEventOptions(options)
	if err != nil {
		return err
	}
	lifetime, err := serverSentEventRequestLifetime(c)
	if err != nil {
		return err
	}
	if err := lifetime.claim(prepared.StreamTimeout); err != nil {
		return err
	}
	return sendServerSentEventStream(c, prepared, lifetime)
}

// SendServerSentEventsFromSource opens a bounded server-sent event response
// using the validated Last-Event-ID request header for application-owned
// replay. Existing ServerSentEventOptions remains source compatible.
func SendServerSentEventsFromSource(
	c fiber.Ctx,
	source ServerSentEventSource,
	options ServerSentEventOptions,
) error {
	if c == nil {
		return errors.New("server-sent event context is required")
	}
	if source == nil {
		return errors.New("server-sent event source is required")
	}
	if options.Events != nil {
		return errors.New("server-sent event source options must not include a channel")
	}
	prepared, err := prepareServerSentEventOptions(options)
	if err != nil {
		return err
	}
	lastEventID, err := validateServerSentEventLastEventID(c.Get(serverSentEventLastEventIDHeader))
	if err != nil {
		return err
	}
	lifetime, err := serverSentEventRequestLifetime(c)
	if err != nil {
		return err
	}
	if err := lifetime.claim(prepared.StreamTimeout); err != nil {
		return err
	}
	prepared.Events, err = source(lifetime.ctx, lastEventID)
	if err != nil {
		lifetime.complete()
		return errors.New("server-sent event source failed")
	}
	if prepared.Events == nil {
		lifetime.complete()
		return errors.New("server-sent event source returned no channel")
	}
	return sendServerSentEventStream(c, prepared, lifetime)
}

func prepareServerSentEventOptions(options ServerSentEventOptions) (ServerSentEventOptions, error) {
	if options.HeartbeatInterval == 0 {
		options.HeartbeatInterval = defaultServerSentEventHeartbeatInterval
	}
	if options.HeartbeatInterval < minimumServerSentEventHeartbeatInterval ||
		options.HeartbeatInterval > maximumServerSentEventHeartbeatInterval {
		return ServerSentEventOptions{}, errors.New("server-sent event heartbeat interval must be between 10ms and 5m")
	}
	if options.MaxEventBytes < 0 || options.MaxEventBytes > maximumServerSentEventBytes {
		return ServerSentEventOptions{}, errors.New("server-sent event byte limit must be zero or between 1 and 1048576")
	}
	if options.MaxEventBytes == 0 {
		options.MaxEventBytes = defaultMaximumServerSentEventBytes
	}
	if options.StreamTimeout < 0 || options.StreamTimeout > maximumServerSentEventStreamTimeout {
		return ServerSentEventOptions{}, errors.New("server-sent event stream timeout must be zero or at most 24h")
	}
	if options.StreamTimeout > 0 && options.StreamTimeout <= options.HeartbeatInterval {
		return ServerSentEventOptions{}, errors.New("server-sent event stream timeout must exceed the heartbeat interval")
	}
	return options, nil
}

func serverSentEventRequestLifetime(c fiber.Ctx) (*requestStreamLifetime, error) {
	ctx := c.Context()
	if ctx == nil {
		return nil, errors.New("server-sent events require the Framework request lifecycle")
	}
	lifetime, ok := ctx.Value(requestStreamLifetimeContextKey{}).(*requestStreamLifetime)
	if !ok || lifetime == nil {
		return nil, errors.New("server-sent events require the Framework request lifecycle")
	}
	return lifetime, nil
}

func sendServerSentEventStream(
	c fiber.Ctx,
	options ServerSentEventOptions,
	lifetime *requestStreamLifetime,
) error {
	c.Set(fiber.HeaderContentType, fiber.MIMETextEventStream)
	c.Set(fiber.HeaderCacheControl, "no-cache, no-transform")
	if err := c.SendStreamWriter(func(writer *bufio.Writer) {
		defer lifetime.complete()
		runServerSentEventStream(lifetime.ctx, writer, options)
	}); err != nil {
		lifetime.complete()
		return err
	}
	return nil
}

func validateServerSentEventLastEventID(value string) (string, error) {
	if len(value) > maximumServerSentEventLastEventIDBytes {
		return "", errors.New("server-sent event Last-Event-ID exceeds 1024 bytes")
	}
	if strings.ContainsAny(value, "\x00\r\n") {
		return "", errors.New("server-sent event Last-Event-ID must be a single line without NUL")
	}
	if !utf8.ValidString(value) {
		return "", errors.New("server-sent event Last-Event-ID must contain valid UTF-8")
	}
	return value, nil
}

type requestStreamLifetime struct {
	ctx                       context.Context
	requestContext            context.Context
	cancel                    context.CancelFunc
	streamBaseContext         context.Context
	applicationContext        context.Context
	requestCancellations      *requestCancellationRegistry
	applicationCancellationMu sync.Mutex
	applicationCancel         context.CancelFunc
	applicationCancelActive   bool
	setWriteDeadline          standardResponseWriteDeadline
	writeDeadlineSet          bool
	claimed                   bool
	completeOnce              sync.Once
}

func newRequestStreamLifetime(
	ctx context.Context,
	cancel context.CancelFunc,
	streamBaseContext context.Context,
	applicationContext context.Context,
	requestCancellations *requestCancellationRegistry,
	setWriteDeadline standardResponseWriteDeadline,
) *requestStreamLifetime {
	lifetime := &requestStreamLifetime{
		ctx:                  ctx,
		requestContext:       ctx,
		cancel:               cancel,
		streamBaseContext:    streamBaseContext,
		applicationContext:   applicationContext,
		requestCancellations: requestCancellations,
		setWriteDeadline:     setWriteDeadline,
	}
	requestCancellations.register(lifetime, cancel)
	return lifetime
}

type requestCancellationRegistry struct {
	mutex     sync.Mutex
	lifetimes map[*requestStreamLifetime]struct{}
	stopped   bool
}

func newRequestCancellationRegistry() *requestCancellationRegistry {
	return &requestCancellationRegistry{
		lifetimes: make(map[*requestStreamLifetime]struct{}),
	}
}

func (registry *requestCancellationRegistry) register(
	lifetime *requestStreamLifetime,
	cancel context.CancelFunc,
) {
	registry.mutex.Lock()
	stopped := registry.stopped
	lifetime.applicationCancellationMu.Lock()
	lifetime.applicationCancel = cancel
	lifetime.applicationCancelActive = !stopped
	if lifetime.applicationCancelActive {
		registry.lifetimes[lifetime] = struct{}{}
	}
	lifetime.applicationCancellationMu.Unlock()
	registry.mutex.Unlock()
	if stopped {
		cancel()
	}
}

func (registry *requestCancellationRegistry) replace(
	lifetime *requestStreamLifetime,
	cancel context.CancelFunc,
) {
	lifetime.applicationCancellationMu.Lock()
	active := lifetime.applicationCancelActive
	if active {
		lifetime.applicationCancel = cancel
	}
	lifetime.applicationCancellationMu.Unlock()
	if !active {
		cancel()
	}
}

func (registry *requestCancellationRegistry) unregister(lifetime *requestStreamLifetime) {
	registry.mutex.Lock()
	delete(registry.lifetimes, lifetime)
	lifetime.applicationCancellationMu.Lock()
	lifetime.applicationCancelActive = false
	lifetime.applicationCancel = nil
	lifetime.applicationCancellationMu.Unlock()
	registry.mutex.Unlock()
}

func (registry *requestCancellationRegistry) cancelAll() {
	registry.mutex.Lock()
	if registry.stopped {
		registry.mutex.Unlock()
		return
	}
	registry.stopped = true
	for lifetime := range registry.lifetimes {
		lifetime.applicationCancellationMu.Lock()
		cancel := lifetime.applicationCancel
		lifetime.applicationCancelActive = false
		lifetime.applicationCancel = nil
		lifetime.applicationCancellationMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	clear(registry.lifetimes)
	registry.mutex.Unlock()
}

func (lifetime *requestStreamLifetime) Deadline() (time.Time, bool) {
	return lifetime.requestContext.Deadline()
}

func (lifetime *requestStreamLifetime) Done() <-chan struct{} {
	return lifetime.requestContext.Done()
}

func (lifetime *requestStreamLifetime) Err() error {
	return lifetime.requestContext.Err()
}

func (lifetime *requestStreamLifetime) Value(key any) any {
	if _, ok := key.(requestStreamLifetimeContextKey); ok {
		return lifetime
	}
	return lifetime.requestContext.Value(key)
}

func (lifetime *requestStreamLifetime) claim(streamTimeout time.Duration) error {
	if lifetime.claimed {
		return errors.New("server-sent event request lifetime is already claimed")
	}
	if lifetime.ctx.Err() != nil || lifetime.applicationContext.Err() != nil {
		return errors.New("server-sent event request lifetime ended before streaming")
	}
	if streamTimeout > 0 {
		streamContext, cancelStream := context.WithTimeout(lifetime.streamBaseContext, streamTimeout)
		streamDeadline, ok := streamContext.Deadline()
		if !ok {
			cancelStream()
			return errors.New("server-sent event stream deadline is unavailable")
		}
		if lifetime.setWriteDeadline != nil {
			transportDeadline := streamDeadline.Add(serverSentEventWriteDeadlineCleanupGrace)
			if err := lifetime.setWriteDeadline(transportDeadline); err != nil && !errors.Is(err, errors.ErrUnsupported) {
				cancelStream()
				return errors.New("server-sent event write deadline is unavailable")
			} else if err == nil {
				lifetime.writeDeadlineSet = true
			}
		}
		lifetime.requestCancellations.replace(lifetime, cancelStream)
		lifetime.cancel()
		lifetime.ctx = streamContext
		lifetime.cancel = cancelStream
		if lifetime.ctx.Err() != nil {
			return errors.New("server-sent event request lifetime ended before streaming")
		}
	}
	lifetime.claimed = true
	return nil
}

func (lifetime *requestStreamLifetime) complete() {
	lifetime.completeOnce.Do(func() {
		if lifetime.writeDeadlineSet {
			_ = lifetime.setWriteDeadline(time.Now().Add(serverSentEventWriteDeadlineCleanupGrace))
		}
		lifetime.requestCancellations.unregister(lifetime)
		lifetime.cancel()
	})
}

func runServerSentEventStream(
	ctx context.Context,
	writer *bufio.Writer,
	options ServerSentEventOptions,
) {
	heartbeat := time.NewTicker(options.HeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-options.Events:
			if !ok {
				return
			}
			if err := writeServerSentEvent(writer, event, options.MaxEventBytes); err != nil {
				return
			}
		case <-heartbeat.C:
			if _, err := writer.WriteString(": heartbeat\n\n"); err != nil {
				return
			}
			if err := writer.Flush(); err != nil {
				return
			}
		}
	}
}

func writeServerSentEvent(writer *bufio.Writer, event ServerSentEvent, maxBytes int) error {
	if writer == nil {
		return errors.New("server-sent event writer is required")
	}
	if maxBytes <= 0 || maxBytes > maximumServerSentEventBytes {
		return errors.New("server-sent event byte limit is invalid")
	}
	if strings.ContainsAny(event.ID, "\x00\r\n") {
		return errors.New("server-sent event ID must be a single line without NUL")
	}
	if strings.ContainsAny(event.Event, "\r\n") {
		return errors.New("server-sent event name must be a single line")
	}
	if !utf8.ValidString(event.ID) || !utf8.ValidString(event.Event) || !utf8.ValidString(event.Data) {
		return errors.New("server-sent event fields must contain valid UTF-8")
	}
	if event.Retry < 0 || (event.Retry > 0 && event.Retry < time.Millisecond) {
		return errors.New("server-sent event retry must be zero or at least one millisecond")
	}
	if event.Retry%time.Millisecond != 0 {
		return errors.New("server-sent event retry must use whole milliseconds")
	}

	if len(event.ID) > maxBytes || len(event.Event) > maxBytes || len(event.Data) > maxBytes {
		return errors.New("server-sent event exceeds its byte limit")
	}
	retryMilliseconds := ""
	if event.Retry > 0 {
		retryMilliseconds = strconv.FormatInt(int64(event.Retry/time.Millisecond), 10)
	}
	encodedLength := 1
	if event.ID != "" {
		encodedLength += len("id: \n") + len(event.ID)
	}
	if event.Event != "" {
		encodedLength += len("event: \n") + len(event.Event)
	}
	if retryMilliseconds != "" {
		encodedLength += len("retry: \n") + len(retryMilliseconds)
	}
	encodedLength += serverSentEventDataEncodedLength(event.Data)
	if encodedLength > maxBytes {
		return errors.New("server-sent event exceeds its byte limit")
	}
	if event.ID != "" {
		if err := writeServerSentEventField(writer, "id: ", event.ID); err != nil {
			return err
		}
	}
	if event.Event != "" {
		if err := writeServerSentEventField(writer, "event: ", event.Event); err != nil {
			return err
		}
	}
	if retryMilliseconds != "" {
		if err := writeServerSentEventField(writer, "retry: ", retryMilliseconds); err != nil {
			return err
		}
	}
	if err := writeServerSentEventData(writer, event.Data); err != nil {
		return err
	}
	if err := writer.WriteByte('\n'); err != nil {
		return err
	}
	return writer.Flush()
}

func serverSentEventDataEncodedLength(data string) int {
	length := 0
	start := 0
	for index := 0; index < len(data); index++ {
		if data[index] != '\r' && data[index] != '\n' {
			continue
		}
		length += len("data: \n") + index - start
		if data[index] == '\r' && index+1 < len(data) && data[index+1] == '\n' {
			index++
		}
		start = index + 1
	}
	return length + len("data: \n") + len(data) - start
}

func writeServerSentEventData(writer *bufio.Writer, data string) error {
	start := 0
	for index := 0; index < len(data); index++ {
		if data[index] != '\r' && data[index] != '\n' {
			continue
		}
		if err := writeServerSentEventField(writer, "data: ", data[start:index]); err != nil {
			return err
		}
		if data[index] == '\r' && index+1 < len(data) && data[index+1] == '\n' {
			index++
		}
		start = index + 1
	}
	return writeServerSentEventField(writer, "data: ", data[start:])
}

func writeServerSentEventField(writer *bufio.Writer, prefix string, value string) error {
	if _, err := writer.WriteString(prefix); err != nil {
		return err
	}
	if _, err := writer.WriteString(value); err != nil {
		return err
	}
	return writer.WriteByte('\n')
}
