package observability

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/gofiber/fiber/v3"
)

// TraceparentHeader is the W3C Trace Context header used for propagation.
const TraceparentHeader = "traceparent"

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
	trace, ok := ctx.Value(traceContextKey{}).(TraceContext)
	return trace, ok
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

// TraceMiddleware creates a server span and puts it in the request context.
// Missing or invalid incoming headers start a new trace; no client-provided ID
// is used unless it passes the complete W3C validation above.
func TraceMiddleware(c fiber.Ctx) error {
	previous := c.Context()
	base := previous
	if base == nil {
		base = context.Background()
	}

	parentTraceID, parentSpanID, flags, validParent := ParseTraceparent(c.Get(TraceparentHeader))
	traceID := parentTraceID
	if !validParent {
		var err error
		traceID, err = randomHex(16)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "trace context unavailable")
		}
		parentSpanID = ""
		flags = 0
	}
	spanID, err := randomHex(8)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "trace context unavailable")
	}
	trace := TraceContext{
		TraceID:      traceID,
		SpanID:       spanID,
		ParentSpanID: parentSpanID,
		Flags:        flags,
		RemoteParent: validParent,
	}
	ctx := context.WithValue(base, traceContextKey{}, trace)
	c.SetContext(ctx)
	c.Set(TraceparentHeader, trace.Traceparent())
	defer c.SetContext(previous)
	return c.Next()
}

func randomHex(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := cryptorand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
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
