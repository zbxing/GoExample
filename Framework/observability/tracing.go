package observability

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// TraceparentHeader is the W3C Trace Context header used for propagation.
const (
	TraceparentHeader = "traceparent"
	TracestateHeader  = "tracestate"
)

type traceContextKey struct{}

// TraceContext identifies the server span attached to a request.
// TraceID and SpanID are lowercase hexadecimal values as required by W3C Trace Context.
type TraceContext struct {
	TraceID      string
	SpanID       string
	ParentSpanID string
	Flags        byte
	RemoteParent bool
}

// Traceparent returns the canonical W3C traceparent value for this server span.
func (trace TraceContext) Traceparent() string {
	return fmt.Sprintf("00-%s-%s-%02x", trace.TraceID, trace.SpanID, trace.Flags)
}

// FromContext retrieves the trace context attached by TraceMiddleware.
func FromContext(ctx context.Context) (TraceContext, bool) {
	if ctx == nil {
		return TraceContext{}, false
	}
	if current, ok := ctx.Value(traceContextKey{}).(TraceContext); ok {
		return current, true
	}
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return TraceContext{}, false
	}
	return traceContextFromSpan(spanContext, trace.SpanContext{}), true
}

// ParseTraceparent strictly parses the W3C version 00 format. Invalid or
// unsupported values are rejected so an untrusted header cannot influence IDs.
func ParseTraceparent(value string) (traceID, parentSpanID string, flags byte, ok bool) {
	if len(value) != 55 || value[2] != '-' || value[35] != '-' || value[52] != '-' {
		return "", "", 0, false
	}
	if value[:2] != "00" || !allLowerHex(value[3:35]) || !allLowerHex(value[36:52]) || !allLowerHex(value[53:55]) {
		return "", "", 0, false
	}
	var traceBytes [16]byte
	var spanBytes [8]byte
	if _, err := hex.Decode(traceBytes[:], []byte(value[3:35])); err != nil || isZero(traceBytes[:]) {
		return "", "", 0, false
	}
	if _, err := hex.Decode(spanBytes[:], []byte(value[36:52])); err != nil || isZero(spanBytes[:]) {
		return "", "", 0, false
	}
	flagBytes, err := hex.DecodeString(value[53:55])
	if err != nil || len(flagBytes) != 1 {
		return "", "", 0, false
	}
	return value[3:35], value[36:52], flagBytes[0], true
}

// TraceMiddleware creates a local OpenTelemetry server span without exporting
// it. Applications that configure OTLP should use TraceMiddlewareWithProvider.
func TraceMiddleware(c fiber.Ctx) error {
	return TraceMiddlewareWithProvider(DefaultTracerProvider())(c)
}

// TraceMiddlewareWithProvider creates an OpenTelemetry server span. It records
// only bounded HTTP attributes and never stores raw URLs, bodies, tokens, or
// arbitrary error text in span attributes.
func TraceMiddlewareWithProvider(provider trace.TracerProvider) fiber.Handler {
	if provider == nil {
		provider = DefaultTracerProvider()
	}
	tracer := provider.Tracer(tracerInstrumentationName)
	propagator := propagation.TraceContext{}
	return func(c fiber.Ctx) error {
		previous := c.Context()
		base := previous
		if base == nil {
			base = context.Background()
		}

		if _, _, _, valid := ParseTraceparent(c.Get(TraceparentHeader)); valid {
			base = propagator.Extract(base, propagation.MapCarrier{
				TraceparentHeader: c.Get(TraceparentHeader),
				TracestateHeader:  c.Get(TracestateHeader),
			})
		}
		parent := trace.SpanContextFromContext(base)
		ctx, span := tracer.Start(
			base,
			c.Method()+" request",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("http.request.method", c.Method())),
		)
		spanContext := span.SpanContext()
		if !spanContext.IsValid() {
			span.End()
			return fiber.NewError(fiber.StatusInternalServerError, "trace context unavailable")
		}
		current := traceContextFromSpan(spanContext, parent)
		ctx = context.WithValue(ctx, traceContextKey{}, current)
		c.SetContext(ctx)
		c.Set(TraceparentHeader, current.Traceparent())
		defer func() {
			span.End()
			c.SetContext(previous)
		}()

		err := c.Next()
		status := responseStatus(c, err)
		route := routePath(c)
		span.SetName(c.Method() + " " + route)
		span.SetAttributes(
			attribute.String("http.route", route),
			attribute.Int("http.response.status_code", status),
		)
		if status >= fiber.StatusInternalServerError {
			span.SetStatus(codes.Error, http.StatusText(status))
		}
		return err
	}
}

func traceContextFromSpan(current, parent trace.SpanContext) TraceContext {
	result := TraceContext{
		TraceID:      current.TraceID().String(),
		SpanID:       current.SpanID().String(),
		Flags:        byte(current.TraceFlags()),
		RemoteParent: parent.IsRemote(),
	}
	if parent.IsValid() {
		result.ParentSpanID = parent.SpanID().String()
	}
	return result
}

func isZero(value []byte) bool {
	for _, current := range value {
		if current != 0 {
			return false
		}
	}
	return true
}

func allLowerHex(value string) bool {
	for index := 0; index < len(value); index++ {
		current := value[index]
		if !(current >= '0' && current <= '9' || current >= 'a' && current <= 'f') {
			return false
		}
	}
	return true
}
