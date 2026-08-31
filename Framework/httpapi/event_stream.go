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
	defaultServerSentEventHeartbeatInterval = 15 * time.Second
	minimumServerSentEventHeartbeatInterval = 10 * time.Millisecond
	maximumServerSentEventHeartbeatInterval = 5 * time.Minute
	defaultMaximumServerSentEventBytes      = 64 * 1024
	maximumServerSentEventBytes             = 1024 * 1024
	maximumServerSentEventLastEventIDBytes  = 1024
)

var requestStreamLifetimeLocalKey = struct{ name string }{name: "goexample-request-stream-lifetime"}

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
type ServerSentEventOptions struct {
	Events            <-chan ServerSentEvent
	HeartbeatInterval time.Duration
	MaxEventBytes     int
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
	lifetime, err := serverSentEventRequestLifetime(c)
	if err != nil {
		return err
	}
	lastEventID, err := validateServerSentEventLastEventID(c.Get(serverSentEventLastEventIDHeader))
	if err != nil {
		return err
	}
	prepared.Events, err = source(lifetime.ctx, lastEventID)
	if err != nil {
		return errors.New("server-sent event source failed")
	}
	if prepared.Events == nil {
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
	return options, nil
}

func serverSentEventRequestLifetime(c fiber.Ctx) (*requestStreamLifetime, error) {
	lifetime, ok := c.Locals(requestStreamLifetimeLocalKey).(*requestStreamLifetime)
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
	lifetime.claimed = true

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
	ctx                         context.Context
	cancel                      context.CancelFunc
	stopApplicationCancellation func() bool
	claimed                     bool
	completeOnce                sync.Once
}

func newRequestStreamLifetime(
	ctx context.Context,
	cancel context.CancelFunc,
	stopApplicationCancellation func() bool,
) *requestStreamLifetime {
	return &requestStreamLifetime{
		ctx:                         ctx,
		cancel:                      cancel,
		stopApplicationCancellation: stopApplicationCancellation,
	}
}

func (lifetime *requestStreamLifetime) complete() {
	lifetime.completeOnce.Do(func() {
		if lifetime.stopApplicationCancellation != nil {
			lifetime.stopApplicationCancellation()
		}
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
	dataLines := splitServerSentEventData(event.Data)
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
	for _, line := range dataLines {
		encodedLength += len("data: \n") + len(line)
	}
	if encodedLength > maxBytes {
		return errors.New("server-sent event exceeds its byte limit")
	}
	var encoded strings.Builder
	encoded.Grow(encodedLength)
	if event.ID != "" {
		encoded.WriteString("id: ")
		encoded.WriteString(event.ID)
		encoded.WriteByte('\n')
	}
	if event.Event != "" {
		encoded.WriteString("event: ")
		encoded.WriteString(event.Event)
		encoded.WriteByte('\n')
	}
	if retryMilliseconds != "" {
		encoded.WriteString("retry: ")
		encoded.WriteString(retryMilliseconds)
		encoded.WriteByte('\n')
	}
	for _, line := range dataLines {
		encoded.WriteString("data: ")
		encoded.WriteString(line)
		encoded.WriteByte('\n')
	}
	encoded.WriteByte('\n')
	if encoded.Len() > maxBytes {
		return errors.New("server-sent event exceeds its byte limit")
	}
	if _, err := writer.WriteString(encoded.String()); err != nil {
		return err
	}
	return writer.Flush()
}

func splitServerSentEventData(data string) []string {
	lines := make([]string, 0, 1+strings.Count(data, "\n"))
	start := 0
	for index := 0; index < len(data); index++ {
		if data[index] != '\r' && data[index] != '\n' {
			continue
		}
		lines = append(lines, data[start:index])
		if data[index] == '\r' && index+1 < len(data) && data[index+1] == '\n' {
			index++
		}
		start = index + 1
	}
	return append(lines, data[start:])
}
