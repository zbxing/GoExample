// Package queueclient provides broker-neutral publish and process boundaries
// with finite budgets and low-sensitivity OpenTelemetry spans. It never records
// destinations, message bodies, headers, message IDs, or raw backend errors.
package queueclient

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const (
	instrumentationName    = "github.com/zbxing/goexample/Framework/queueclient"
	traceparentHeader      = "traceparent"
	tracestateHeader       = "tracestate"
	defaultPublishTimeout  = 3 * time.Second
	defaultProcessTimeout  = 30 * time.Second
	defaultMaxMessageBytes = 1 << 20
	defaultMaxHeaderBytes  = 16 << 10
	defaultMaxHeaders      = 64
)

var (
	errNilClient     = errors.New("queue client is nil")
	errNilContext    = errors.New("queue operation context cannot be nil")
	errNilCallback   = errors.New("queue operation callback cannot be nil")
	errCallbackPanic = errors.New("queue operation callback panicked")
)

var (
	// ErrMessageTooLarge indicates that a body exceeded MaxMessageBytes.
	ErrMessageTooLarge = errors.New("queue message exceeds the configured body limit")
	// ErrHeadersTooLarge indicates that header count or bytes exceeded the
	// configured limit, including W3C headers added during Publish.
	ErrHeadersTooLarge = errors.New("queue message headers exceed the configured limit")
	// ErrInvalidHeader indicates an empty, non-ASCII, control-containing, or
	// case-insensitively duplicated header.
	ErrInvalidHeader = errors.New("queue message contains an invalid header")
)

// System is a bounded messaging-system identifier used for trace attributes.
type System string

const (
	SystemKafka     System = "kafka"
	SystemNATS      System = "nats"
	SystemRabbitMQ  System = "rabbitmq"
	SystemAWSSQS    System = "aws_sqs"
	SystemGCPPubSub System = "gcp_pubsub"
)

// Message is the transport-neutral payload passed to an injected broker
// operation. Queue-specific metadata and acknowledgement handles remain owned
// by the concrete adapter.
type Message struct {
	Body    []byte
	Headers map[string]string
}

// Config defines finite publish, process, body, and header budgets. System is
// required. Other zero values select conservative defaults; negative values
// are rejected.
type Config struct {
	System          System
	PublishTimeout  time.Duration
	ProcessTimeout  time.Duration
	MaxMessageBytes int
	MaxHeaderBytes  int
	MaxHeaders      int
	TracerProvider  trace.TracerProvider
}

// Client instruments broker-specific callbacks without taking ownership of a
// broker connection or imposing acknowledgement and retry semantics.
type Client struct {
	system          System
	publishTimeout  time.Duration
	processTimeout  time.Duration
	maxMessageBytes int
	maxHeaderBytes  int
	maxHeaders      int
	tracer          trace.Tracer
}

// New constructs a broker-neutral queue instrumentation boundary.
func New(config Config) (*Client, error) {
	config = withDefaults(config)
	if err := validateConfig(config); err != nil {
		return nil, err
	}
	provider := config.TracerProvider
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	return &Client{
		system:          config.System,
		publishTimeout:  config.PublishTimeout,
		processTimeout:  config.ProcessTimeout,
		maxMessageBytes: config.MaxMessageBytes,
		maxHeaderBytes:  config.MaxHeaderBytes,
		maxHeaders:      config.MaxHeaders,
		tracer:          provider.Tracer(instrumentationName),
	}, nil
}

// Publish clones the message, replaces any caller-supplied W3C trace headers,
// injects the current publish span, and invokes the broker-specific callback.
func (client *Client) Publish(ctx context.Context, message Message, publish func(context.Context, Message) error) error {
	if err := client.validate(ctx, publish); err != nil {
		return err
	}
	return client.run(ctx, client.publishTimeout, "send", trace.SpanKindProducer, func(operationContext context.Context) error {
		prepared, err := client.cloneMessage(message)
		if err != nil {
			return err
		}
		removeTraceHeaders(prepared.Headers)
		propagation.TraceContext{}.Inject(operationContext, propagation.MapCarrier(prepared.Headers))
		if err := validateHeaders(prepared.Headers, client.maxHeaders, client.maxHeaderBytes); err != nil {
			return err
		}
		return publish(operationContext, prepared)
	})
}

// Process clones and validates a received message, extracts only W3C Trace
// Context, and invokes the application handler inside a bounded consumer span.
func (client *Client) Process(ctx context.Context, message Message, handler func(context.Context, Message) error) error {
	if err := client.validate(ctx, handler); err != nil {
		return err
	}
	prepared, preparationErr := client.cloneMessage(message)
	parentContext := ctx
	if preparationErr == nil {
		parentContext = propagation.TraceContext{}.Extract(ctx, traceCarrier(prepared.Headers))
	}
	return client.run(parentContext, client.processTimeout, "process", trace.SpanKindConsumer, func(operationContext context.Context) error {
		if preparationErr != nil {
			return preparationErr
		}
		return handler(operationContext, prepared)
	})
}

func (client *Client) run(
	ctx context.Context,
	timeout time.Duration,
	operation string,
	kind trace.SpanKind,
	callback func(context.Context) error,
) (err error) {
	operationContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	operationContext, span := client.tracer.Start(
		operationContext,
		"messaging."+operation,
		trace.WithSpanKind(kind),
		trace.WithAttributes(
			attribute.String("messaging.system.name", string(client.system)),
			attribute.String("messaging.operation.type", operation),
		),
	)
	defer func() {
		if recovered := recover(); recovered != nil {
			finishSpan(operationContext, span, errCallbackPanic)
			panic(recovered)
		}
		finishSpan(operationContext, span, err)
	}()
	if contextErr := completedContextError(operationContext); contextErr != nil {
		err = contextErr
		return err
	}
	err = callback(operationContext)
	if err == nil {
		// A callback may return nil concurrently with its timeout. The
		// operation budget is authoritative, so a late nil cannot become
		// success (or an acknowledgement in reliable delivery mode).
		if contextErr := completedContextError(operationContext); contextErr != nil {
			err = contextErr
		}
	}
	return err
}

func (client *Client) cloneMessage(message Message) (Message, error) {
	if len(message.Body) > client.maxMessageBytes {
		return Message{}, ErrMessageTooLarge
	}
	if err := validateHeaders(message.Headers, client.maxHeaders, client.maxHeaderBytes); err != nil {
		return Message{}, err
	}
	cloned := Message{
		Body: bytes.Clone(message.Body),
	}
	if message.Headers != nil {
		cloned.Headers = make(map[string]string, len(message.Headers)+2)
		for name, value := range message.Headers {
			cloned.Headers[name] = value
		}
	} else {
		cloned.Headers = make(map[string]string, 2)
	}
	return cloned, nil
}

func validateHeaders(headers map[string]string, maxHeaders, maxBytes int) error {
	if len(headers) > maxHeaders {
		return ErrHeadersTooLarge
	}
	if len(headers) == 2 {
		var firstName string
		totalBytes := 0
		for name, value := range headers {
			if !validHeaderName(name) || strings.ContainsAny(value, "\r\n\x00") {
				return ErrInvalidHeader
			}
			if len(name) > maxBytes-totalBytes {
				return ErrHeadersTooLarge
			}
			totalBytes += len(name)
			if len(value) > maxBytes-totalBytes {
				return ErrHeadersTooLarge
			}
			totalBytes += len(value)
			if firstName == "" {
				firstName = name
			} else if strings.EqualFold(firstName, name) {
				return ErrInvalidHeader
			}
		}
		return nil
	}
	// A duplicate header is impossible with zero or one entries. Keep those
	// common paths allocation-free. Small sets use a stack-backed pairwise
	// check; larger sets build one normalized-name map.
	if len(headers) > 2 && len(headers) <= 4 {
		var names [4]string
		index := 0
		totalBytes := 0
		for name, value := range headers {
			if !validHeaderName(name) || strings.ContainsAny(value, "\r\n\x00") {
				return ErrInvalidHeader
			}
			for _, previous := range names[:index] {
				if strings.EqualFold(previous, name) {
					return ErrInvalidHeader
				}
			}
			if len(name) > maxBytes-totalBytes {
				return ErrHeadersTooLarge
			}
			totalBytes += len(name)
			if len(value) > maxBytes-totalBytes {
				return ErrHeadersTooLarge
			}
			totalBytes += len(value)
			names[index] = name
			index++
		}
		return nil
	}
	// For larger sets, build the normalized-name set once to detect
	// case-insensitive duplicates.
	var seen map[string]struct{}
	if len(headers) > 2 {
		seen = make(map[string]struct{}, len(headers))
	}
	totalBytes := 0
	for name, value := range headers {
		if !validHeaderName(name) || strings.ContainsAny(value, "\r\n\x00") {
			return ErrInvalidHeader
		}
		if seen != nil {
			normalizedName := strings.ToLower(name)
			if _, exists := seen[normalizedName]; exists {
				return ErrInvalidHeader
			}
			seen[normalizedName] = struct{}{}
		}
		if len(name) > maxBytes-totalBytes {
			return ErrHeadersTooLarge
		}
		totalBytes += len(name)
		if len(value) > maxBytes-totalBytes {
			return ErrHeadersTooLarge
		}
		totalBytes += len(value)
	}
	return nil
}

func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	// Header names are restricted to visible ASCII. Byte scanning avoids the
	// UTF-8 decoding overhead of range on this per-message validation path.
	for index := 0; index < len(name); index++ {
		character := name[index]
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}

func removeTraceHeaders(headers map[string]string) {
	for name := range headers {
		if isTraceHeader(name) {
			delete(headers, name)
		}
	}
}

func traceCarrier(headers map[string]string) propagation.MapCarrier {
	var carrier propagation.MapCarrier
	for name, value := range headers {
		if canonical := canonicalTraceHeader(name); canonical != "" {
			if carrier == nil {
				carrier = make(propagation.MapCarrier, 2)
			}
			// Use immutable canonical keys instead of strings.ToLower(name),
			// which allocates when callers use mixed-case header names.
			carrier[canonical] = value
		}
	}
	return carrier
}

func isTraceHeader(name string) bool {
	return canonicalTraceHeader(name) != ""
}

func canonicalTraceHeader(name string) string {
	// Header names are ASCII tokens. Reject other lengths before invoking the
	// case-insensitive comparison so ordinary application headers take the
	// constant-time fast path through this helper.
	switch len(name) {
	case len(traceparentHeader):
		if strings.EqualFold(name, traceparentHeader) {
			return traceparentHeader
		}
	case len(tracestateHeader):
		if strings.EqualFold(name, tracestateHeader) {
			return tracestateHeader
		}
	default:
		return ""
	}
	return ""
}

func finishSpan(ctx context.Context, span trace.Span, err error) {
	result, description := classifyResult(ctx, err)
	span.SetAttributes(attribute.String("goexample.messaging.result", result))
	if description != "" {
		span.SetStatus(codes.Error, description)
	}
	span.End()
}

func classifyResult(ctx context.Context, err error) (string, string) {
	switch {
	case err == nil:
		return "success", ""
	case errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled):
		return "canceled", "messaging operation canceled"
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return "timeout", "messaging operation timed out"
	default:
		return "failure", "messaging operation failed"
	}
}

// completedContextError also observes a deadline whose timer has elapsed but
// whose Done channel has not been scheduled yet. This closes the narrow select
// race at callback boundaries without changing normal context cancellation.
func completedContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

func withDefaults(config Config) Config {
	if config.PublishTimeout == 0 {
		config.PublishTimeout = defaultPublishTimeout
	}
	if config.ProcessTimeout == 0 {
		config.ProcessTimeout = defaultProcessTimeout
	}
	if config.MaxMessageBytes == 0 {
		config.MaxMessageBytes = defaultMaxMessageBytes
	}
	if config.MaxHeaderBytes == 0 {
		config.MaxHeaderBytes = defaultMaxHeaderBytes
	}
	if config.MaxHeaders == 0 {
		config.MaxHeaders = defaultMaxHeaders
	}
	return config
}

func validateConfig(config Config) error {
	if !validSystem(config.System) {
		return errors.New("queue system must be one of kafka, nats, rabbitmq, aws_sqs, or gcp_pubsub")
	}
	if config.PublishTimeout <= 0 || config.ProcessTimeout <= 0 {
		return errors.New("queue publish and process timeouts must be greater than zero")
	}
	if config.MaxMessageBytes <= 0 || config.MaxHeaderBytes <= 0 || config.MaxHeaders <= 0 {
		return errors.New("queue message and header limits must be greater than zero")
	}
	return nil
}

func validSystem(system System) bool {
	switch system {
	case SystemKafka, SystemNATS, SystemRabbitMQ, SystemAWSSQS, SystemGCPPubSub:
		return true
	default:
		return false
	}
}

func (client *Client) validate(ctx context.Context, callback func(context.Context, Message) error) error {
	if client == nil || client.tracer == nil {
		return errNilClient
	}
	if ctx == nil {
		return errNilContext
	}
	if callback == nil {
		return errNilCallback
	}
	return nil
}
