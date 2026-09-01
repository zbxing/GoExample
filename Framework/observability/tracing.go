package observability

import (
	"context"
	"encoding/hex"
	"net/http"
	"sync"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// TraceparentHeader is the W3C Trace Context header used for propagation.
const (
	TraceparentHeader = "traceparent"
	TracestateHeader  = "tracestate"
)

type traceContextKey struct{}

type traceRequestContext struct {
	context.Context
	current trace.SpanContext
	parent  trace.SpanContext
	once    sync.Once
	value   TraceContext
}

func newTraceRequestContext(
	ctx context.Context,
	current trace.SpanContext,
	parent trace.SpanContext,
) context.Context {
	// The span context returned by tracer.Start already supports parentless
	// FromContext lookups. The wrapper is only needed to retain parent metadata
	// and cache its public string representation.
	if !parent.IsValid() {
		return ctx
	}
	return &traceRequestContext{
		Context: ctx,
		current: current,
		parent:  parent,
	}
}

func (ctx *traceRequestContext) Value(key any) any {
	if _, ok := key.(traceContextKey); ok {
		return ctx
	}
	return ctx.Context.Value(key)
}

func (ctx *traceRequestContext) traceContext() TraceContext {
	ctx.once.Do(func() {
		ctx.value = traceContextFromSpan(ctx.current, ctx.parent)
	})
	return ctx.value
}

type serverSpanStartConfiguration struct {
	name    string
	options []trace.SpanStartOption
}

type serverSpanEndKey struct {
	method string
	route  string
	status int
}

type serverSpanEndConfiguration struct {
	name       string
	attributes []attribute.KeyValue
}

type serverSpanEndConfigurationCache struct {
	mutex          sync.RWMutex
	configurations map[serverSpanEndKey]serverSpanEndConfiguration
}

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
	value := trace.traceparentBytes()
	return string(value[:])
}

func (trace TraceContext) traceparentBytes() [55]byte {
	const hexadecimal = "0123456789abcdef"
	var value [55]byte
	copy(value[0:3], "00-")
	copy(value[3:35], trace.TraceID)
	value[35] = '-'
	copy(value[36:52], trace.SpanID)
	value[52] = '-'
	value[53] = hexadecimal[trace.Flags>>4]
	value[54] = hexadecimal[trace.Flags&0x0f]
	return value
}

// FromContext retrieves the trace context attached by TraceMiddleware.
func FromContext(ctx context.Context) (TraceContext, bool) {
	if ctx == nil {
		return TraceContext{}, false
	}
	switch current := ctx.Value(traceContextKey{}).(type) {
	case *traceRequestContext:
		return current.traceContext(), true
	case TraceContext:
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
	var flagBytes [1]byte
	if _, err := hex.Decode(flagBytes[:], []byte(value[53:55])); err != nil {
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
	serverSpanKind := trace.WithSpanKind(trace.SpanKindServer)
	standardSpanStarts := newStandardServerSpanStartConfigurations(serverSpanKind)
	spanEnds := newServerSpanEndConfigurationCache()
	return func(c fiber.Ctx) error {
		previous := c.Context()
		base := previous
		if base == nil {
			base = context.Background()
		}

		if remoteParent, valid := remoteSpanContextFromHeaders(
			c.Get(TraceparentHeader),
			c.Get(TracestateHeader),
		); valid {
			base = trace.ContextWithRemoteSpanContext(base, remoteParent)
		}
		parent := trace.SpanContextFromContext(base)
		method := c.Method()
		spanStart := serverSpanStartConfigurationForMethod(standardSpanStarts, method, serverSpanKind)
		ctx, span := tracer.Start(base, spanStart.name, spanStart.options...)
		spanContext := span.SpanContext()
		if !spanContext.IsValid() {
			span.End()
			return fiber.NewError(fiber.StatusInternalServerError, "trace context unavailable")
		}
		ctx = newTraceRequestContext(ctx, spanContext, parent)
		c.SetContext(ctx)
		traceparent := traceparentBytesFromSpanContext(spanContext)
		c.Response().Header.SetBytesV(TraceparentHeader, traceparent[:])
		defer func() {
			span.End()
			c.SetContext(previous)
		}()

		err := c.Next()
		status := responseStatus(c, err)
		route := routePath(c)
		_, standardMethod := standardSpanStarts[method]
		configuration := spanEnds.configurationForMethod(method, route, status, standardMethod)
		span.SetName(configuration.name)
		span.SetAttributes(configuration.attributes...)
		if status >= fiber.StatusInternalServerError {
			span.SetStatus(codes.Error, http.StatusText(status))
		}
		return err
	}
}

func remoteSpanContextFromHeaders(traceparent, tracestate string) (trace.SpanContext, bool) {
	traceIDText, spanIDText, flags, valid := ParseTraceparent(traceparent)
	if !valid || flags > byte(trace.FlagsSampled|trace.FlagsRandom) {
		return trace.SpanContext{}, false
	}
	traceID, err := trace.TraceIDFromHex(traceIDText)
	if err != nil {
		return trace.SpanContext{}, false
	}
	spanID, err := trace.SpanIDFromHex(spanIDText)
	if err != nil {
		return trace.SpanContext{}, false
	}
	state, _ := trace.ParseTraceState(tracestate)
	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.TraceFlags(flags) & (trace.FlagsSampled | trace.FlagsRandom),
		TraceState: state,
		Remote:     true,
	})
	return parent, parent.IsValid()
}

func newStandardServerSpanStartConfigurations(serverSpanKind trace.SpanStartOption) map[string]serverSpanStartConfiguration {
	standardSpanStarts := make(map[string]serverSpanStartConfiguration, 9)
	for _, method := range []string{
		fiber.MethodConnect,
		fiber.MethodDelete,
		fiber.MethodGet,
		fiber.MethodHead,
		fiber.MethodOptions,
		fiber.MethodPatch,
		fiber.MethodPost,
		fiber.MethodPut,
		fiber.MethodTrace,
	} {
		standardSpanStarts[method] = newServerSpanStartConfiguration(method, serverSpanKind)
	}
	return standardSpanStarts
}

func serverSpanStartConfigurationForMethod(
	standard map[string]serverSpanStartConfiguration,
	method string,
	serverSpanKind trace.SpanStartOption,
) serverSpanStartConfiguration {
	if configuration, ok := standard[method]; ok {
		return configuration
	}
	return newServerSpanStartConfiguration(method, serverSpanKind)
}

func newServerSpanStartConfiguration(method string, serverSpanKind trace.SpanStartOption) serverSpanStartConfiguration {
	return serverSpanStartConfiguration{
		name: method + " request",
		options: []trace.SpanStartOption{
			serverSpanKind,
			trace.WithAttributes(attribute.String("http.request.method", method)),
		},
	}
}

func newServerSpanEndConfigurationCache() *serverSpanEndConfigurationCache {
	return &serverSpanEndConfigurationCache{
		configurations: make(map[serverSpanEndKey]serverSpanEndConfiguration),
	}
}

func (cache *serverSpanEndConfigurationCache) configurationForMethod(
	method string,
	route string,
	status int,
	cacheable bool,
) serverSpanEndConfiguration {
	if !cacheable || status < 100 || status >= 600 {
		return serverSpanEndConfiguration{
			name: method + " " + route,
			attributes: []attribute.KeyValue{
				attribute.String("http.route", route),
				attribute.Int("http.response.status_code", status),
			},
		}
	}
	return cache.configuration(method, route, status)
}

func (cache *serverSpanEndConfigurationCache) configuration(method, route string, status int) serverSpanEndConfiguration {
	key := serverSpanEndKey{method: method, route: route, status: status}
	cache.mutex.RLock()
	configuration, ok := cache.configurations[key]
	cache.mutex.RUnlock()
	if ok {
		return configuration
	}

	configuration = serverSpanEndConfiguration{
		name: method + " " + route,
		attributes: []attribute.KeyValue{
			attribute.String("http.route", route),
			attribute.Int("http.response.status_code", status),
		},
	}
	cache.mutex.Lock()
	if existing, loaded := cache.configurations[key]; loaded {
		configuration = existing
	} else {
		cache.configurations[key] = configuration
	}
	cache.mutex.Unlock()
	return configuration
}

func traceContextFromSpan(current, parent trace.SpanContext) TraceContext {
	traceparent := traceparentBytesFromSpanContext(current)
	encoded := string(traceparent[:])
	result := TraceContext{
		TraceID:      encoded[3:35],
		SpanID:       encoded[36:52],
		Flags:        byte(current.TraceFlags()),
		RemoteParent: parent.IsRemote(),
	}
	if parent.IsValid() {
		result.ParentSpanID = parent.SpanID().String()
	}
	return result
}

func traceparentBytesFromSpanContext(current trace.SpanContext) [55]byte {
	const hexadecimal = "0123456789abcdef"
	var value [55]byte
	copy(value[0:3], "00-")
	traceID := current.TraceID()
	hex.Encode(value[3:35], traceID[:])
	value[35] = '-'
	spanID := current.SpanID()
	hex.Encode(value[36:52], spanID[:])
	value[52] = '-'
	flags := byte(current.TraceFlags())
	value[53] = hexadecimal[flags>>4]
	value[54] = hexadecimal[flags&0x0f]
	return value
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
