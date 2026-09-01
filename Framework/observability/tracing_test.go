package observability

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

type blockingSpanExporter struct {
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
	exported  atomic.Int64
}

func newBlockingSpanExporter() *blockingSpanExporter {
	return &blockingSpanExporter{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (exporter *blockingSpanExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	exporter.startOnce.Do(func() { close(exporter.started) })
	select {
	case <-exporter.release:
		exporter.exported.Add(int64(len(spans)))
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (*blockingSpanExporter) Shutdown(context.Context) error { return nil }

func TestParseTraceparentStrictlyValidatesVersionIDsAndFlags(t *testing.T) {
	valid := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	traceID, parentSpanID, flags, ok := ParseTraceparent(valid)
	if !ok || traceID != "4bf92f3577b34da6a3ce929d0e0e4736" || parentSpanID != "00f067aa0ba902b7" || flags != 1 {
		t.Fatalf("parse valid traceparent = %q/%q/%d/%v", traceID, parentSpanID, flags, ok)
	}
	for _, invalid := range []string{
		"",
		"00-00000000000000000000000000000000-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0g",
		"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra",
	} {
		if _, _, _, ok := ParseTraceparent(invalid); ok {
			t.Fatalf("invalid traceparent accepted: %q", invalid)
		}
	}
}

func TestRemoteSpanContextFromHeadersPreservesStrictW3CContract(t *testing.T) {
	const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-03"
	parent, ok := remoteSpanContextFromHeaders(traceparent, "vendor=value")
	if !ok || !parent.IsRemote() || parent.TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" ||
		parent.SpanID().String() != "00f067aa0ba902b7" || parent.TraceFlags() != trace.FlagsSampled|trace.FlagsRandom ||
		parent.TraceState().String() != "vendor=value" {
		t.Fatalf("remote parent = %#v/%t", parent, ok)
	}

	if parent, ok = remoteSpanContextFromHeaders(
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-04",
		"vendor=value",
	); ok || parent.IsValid() {
		t.Fatalf("reserved trace flags accepted: %#v/%t", parent, ok)
	}

	parent, ok = remoteSpanContextFromHeaders(traceparent, "invalid tracestate")
	if !ok || parent.TraceState().String() != "" {
		t.Fatalf("invalid tracestate changed traceparent acceptance: %#v/%t", parent, ok)
	}

	allocations := testing.AllocsPerRun(1000, func() {
		remoteSpanResult, _ = remoteSpanContextFromHeaders(traceparent, "")
	})
	if allocations != 0 {
		t.Fatalf("remote span context parsing allocations = %.1f, want 0", allocations)
	}
}

var (
	traceparentResult     string
	traceContextResult    TraceContext
	requestContextResult  context.Context
	serverSpanStartResult serverSpanStartConfiguration
	serverSpanEndResult   serverSpanEndConfiguration
	remoteSpanResult      trace.SpanContext
)

func TestTraceContextFormatsTraceparentWithOneAllocation(t *testing.T) {
	current := TraceContext{
		TraceID: "4bf92f3577b34da6a3ce929d0e0e4736",
		SpanID:  "00f067aa0ba902b7",
		Flags:   0xab,
	}
	const want = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-ab"
	if got := current.Traceparent(); got != want {
		t.Fatalf("Traceparent() = %q, want %q", got, want)
	}
	allocations := testing.AllocsPerRun(1000, func() {
		traceparentResult = current.Traceparent()
	})
	if allocations > 1 {
		t.Fatalf("Traceparent() allocations = %.1f, want at most 1", allocations)
	}
}

func TestTraceRequestContextLazilyPreservesTheServerSpan(t *testing.T) {
	type contextKey struct{}
	traceID, err := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("parse trace ID: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("00f067aa0ba902b7")
	if err != nil {
		t.Fatalf("parse span ID: %v", err)
	}
	parentSpanID, err := trace.SpanIDFromHex("b7ad6b7169203331")
	if err != nil {
		t.Fatalf("parse parent span ID: %v", err)
	}
	current := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     parentSpanID,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	base := context.WithValue(context.Background(), contextKey{}, "preserved")
	requestContext := newTraceRequestContext(base, current, parent)
	childSpanID, err := trace.SpanIDFromHex("7a085853722dc6d2")
	if err != nil {
		t.Fatalf("parse child span ID: %v", err)
	}
	child := trace.ContextWithSpanContext(requestContext, trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  childSpanID,
	}))

	observed, ok := FromContext(child)
	if !ok || observed.TraceID != traceID.String() || observed.SpanID != spanID.String() ||
		observed.ParentSpanID != parentSpanID.String() || !observed.RemoteParent || observed.Flags != byte(trace.FlagsSampled) {
		t.Fatalf("request trace = %#v/%t", observed, ok)
	}
	if value := child.Value(contextKey{}); value != "preserved" {
		t.Fatalf("preserved context value = %#v", value)
	}
	rawTraceparent := traceparentBytesFromSpanContext(current)
	if got := string(rawTraceparent[:]); got != observed.Traceparent() {
		t.Fatalf("raw traceparent = %q, want %q", got, observed.Traceparent())
	}

	allocations := testing.AllocsPerRun(1000, func() {
		requestContextResult = newTraceRequestContext(base, current, parent)
	})
	if allocations > 1 {
		t.Fatalf("request trace attachment allocations = %.1f, want at most 1", allocations)
	}
	allocations = testing.AllocsPerRun(1000, func() {
		traceContextResult, _ = FromContext(requestContext)
	})
	if allocations != 0 {
		t.Fatalf("cached request trace lookup allocations = %.1f, want 0", allocations)
	}
}

func TestTraceRequestContextWithoutParentReusesSpanContext(t *testing.T) {
	traceID, err := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("parse trace ID: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("00f067aa0ba902b7")
	if err != nil {
		t.Fatalf("parse span ID: %v", err)
	}
	current := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	base := trace.ContextWithSpanContext(context.Background(), current)

	requestContext := newTraceRequestContext(base, current, trace.SpanContext{})
	if requestContext != base {
		t.Fatal("request context without a parent must reuse the span context")
	}
	observed, ok := FromContext(requestContext)
	if !ok || observed.TraceID != traceID.String() || observed.SpanID != spanID.String() ||
		observed.ParentSpanID != "" || observed.RemoteParent {
		t.Fatalf("request trace = %#v/%t", observed, ok)
	}

	allocations := testing.AllocsPerRun(1000, func() {
		requestContextResult = newTraceRequestContext(base, current, trace.SpanContext{})
	})
	if allocations != 0 {
		t.Fatalf("parentless request trace attachment allocations = %.1f, want 0", allocations)
	}
}

func TestStandardServerSpanStartConfigurationIsReusable(t *testing.T) {
	serverSpanKind := trace.WithSpanKind(trace.SpanKindServer)
	standard := newStandardServerSpanStartConfigurations(serverSpanKind)
	configuration := serverSpanStartConfigurationForMethod(standard, fiber.MethodGet, serverSpanKind)
	if configuration.name != "GET request" {
		t.Fatalf("span start name = %q", configuration.name)
	}
	spanConfig := trace.NewSpanStartConfig(configuration.options...)
	if spanConfig.SpanKind() != trace.SpanKindServer {
		t.Fatalf("span start kind = %s", spanConfig.SpanKind())
	}
	attributes := spanConfig.Attributes()
	if len(attributes) != 1 || attributes[0].Key != "http.request.method" || attributes[0].Value.AsString() != fiber.MethodGet {
		t.Fatalf("span start attributes = %#v", attributes)
	}

	allocations := testing.AllocsPerRun(1000, func() {
		serverSpanStartResult = serverSpanStartConfigurationForMethod(standard, fiber.MethodGet, serverSpanKind)
	})
	if allocations != 0 {
		t.Fatalf("cached span start configuration allocations = %.1f, want 0", allocations)
	}

	custom := serverSpanStartConfigurationForMethod(standard, "PURGE", serverSpanKind)
	customSpanConfig := trace.NewSpanStartConfig(custom.options...)
	customAttributes := customSpanConfig.Attributes()
	if custom.name != "PURGE request" || len(customAttributes) != 1 || customAttributes[0].Value.AsString() != "PURGE" {
		t.Fatalf("custom span start configuration = %q/%#v", custom.name, customAttributes)
	}
}

func TestServerSpanEndConfigurationCachesBoundedStandardMetadata(t *testing.T) {
	cache := newServerSpanEndConfigurationCache()
	configuration := cache.configuration(fiber.MethodGet, "/work/:id", fiber.StatusNoContent)
	if configuration.name != "GET /work/:id" || len(configuration.attributes) != 2 ||
		configuration.attributes[0].Key != "http.route" || configuration.attributes[0].Value.AsString() != "/work/:id" ||
		configuration.attributes[1].Key != "http.response.status_code" || configuration.attributes[1].Value.AsInt64() != fiber.StatusNoContent {
		t.Fatalf("route configuration = %#v", configuration)
	}
	configurationCount := len(cache.configurations)
	custom := cache.configurationForMethod("PURGE", "unmatched", fiber.StatusNoContent, false)
	if custom.name != "PURGE unmatched" || len(custom.attributes) != 2 ||
		custom.attributes[0].Value.AsString() != "unmatched" ||
		custom.attributes[1].Value.AsInt64() != fiber.StatusNoContent || len(cache.configurations) != configurationCount {
		t.Fatalf("custom route configuration = %#v, cached configurations = %d", custom, len(cache.configurations))
	}
	outOfRange := cache.configurationForMethod(fiber.MethodGet, "/work/:id", 99, true)
	if len(outOfRange.attributes) != 2 || outOfRange.attributes[1].Value.AsInt64() != 99 ||
		len(cache.configurations) != configurationCount {
		t.Fatalf("out-of-range status configuration = %#v, cached configurations = %d", outOfRange, len(cache.configurations))
	}

	allocations := testing.AllocsPerRun(1000, func() {
		serverSpanEndResult = cache.configuration(fiber.MethodGet, "/work/:id", fiber.StatusNoContent)
	})
	if allocations != 0 {
		t.Fatalf("cached span end metadata allocations = %.1f, want 0", allocations)
	}

	var group sync.WaitGroup
	for _, status := range []int{fiber.StatusOK, fiber.StatusNoContent, fiber.StatusInternalServerError} {
		for range 8 {
			group.Add(1)
			go func() {
				defer group.Done()
				_ = cache.configuration(fiber.MethodGet, "/work/:id", status)
			}()
		}
	}
	group.Wait()
	if got := len(cache.configurations); got != 3 {
		t.Fatalf("cached configurations after concurrent access = %d, want 3", got)
	}
}

func TestTraceMiddlewareRecordsOpenTelemetryServerSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	app := fiber.New()
	app.Use(TraceMiddlewareWithProvider(provider))
	app.Get("/work/:id", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/work/42", http.NoBody)
	request.Header.Set(TraceparentHeader, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	request.Header.Set(TracestateHeader, "vendor=value")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("trace request error = %v", err)
	}
	response.Body.Close()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if span.Name() != "GET /work/:id" || span.SpanKind() != trace.SpanKindServer {
		t.Fatalf("span name/kind = %q/%s", span.Name(), span.SpanKind())
	}
	if !span.Parent().IsRemote() || span.Parent().SpanID().String() != "00f067aa0ba902b7" ||
		span.Parent().TraceState().String() != "vendor=value" {
		t.Fatalf("span parent = %s remote=%t", span.Parent().SpanID(), span.Parent().IsRemote())
	}
	attributes := make(map[string]attribute.Value)
	for _, item := range span.Attributes() {
		attributes[string(item.Key)] = item.Value
	}
	if attributes["http.request.method"].AsString() != fiber.MethodGet || attributes["http.route"].AsString() != "/work/:id" || attributes["http.response.status_code"].AsInt64() != fiber.StatusNoContent {
		t.Fatalf("span HTTP attributes = %#v", attributes)
	}
	if _, exists := attributes["url.full"]; exists {
		t.Fatalf("span records raw URL: %#v", attributes)
	}
}
func TestOTLPHTTPBatchExporterDoesNotBlockRequestAndFlushesOnShutdown(t *testing.T) {
	collectorStarted := make(chan struct{})
	releaseCollector := make(chan struct{})
	var startOnce, releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCollector) }) }
	var receivedPath, receivedContentType string
	collector := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		startOnce.Do(func() { close(collectorStarted) })
		receivedPath = request.URL.Path
		receivedContentType = request.Header.Get("Content-Type")
		_, _ = io.Copy(io.Discard, request.Body)
		<-releaseCollector
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)

	provider, err := NewTracerProvider(context.Background(), TracingConfig{
		ServiceName:        "trace-test",
		ServiceVersion:     "1.0.0",
		Environment:        "test",
		Exporter:           "otlp",
		Endpoint:           collector.URL + "/tenant",
		SampleRatio:        1,
		ExportTimeout:      time.Second,
		BatchTimeout:       10 * time.Millisecond,
		MaxQueueSize:       8,
		MaxExportBatchSize: 1,
	})
	if err != nil {
		t.Fatalf("NewTracerProvider() error = %v", err)
	}
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = provider.Shutdown(shutdownCtx)
	})
	t.Cleanup(release)
	app := fiber.New()
	app.Use(TraceMiddlewareWithProvider(provider))
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	requestCompleted := make(chan error, 1)
	go func() {
		response, requestErr := app.Test(httptest.NewRequest(http.MethodGet, "/work", http.NoBody))
		if response != nil {
			response.Body.Close()
		}
		requestCompleted <- requestErr
	}()
	select {
	case requestErr := <-requestCompleted:
		if requestErr != nil {
			t.Fatalf("request error = %v", requestErr)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("request waited for the OTLP collector")
	}
	select {
	case <-collectorStarted:
	case <-time.After(time.Second):
		t.Fatal("OTLP collector did not receive the span")
	}
	release()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := provider.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("tracer provider shutdown error = %v", err)
	}
	if receivedPath != "/tenant/v1/traces" || receivedContentType != "application/x-protobuf" {
		t.Fatalf("OTLP request path/content-type = %q/%q", receivedPath, receivedContentType)
	}
}

func TestBatchSpanProcessorDropsBurstWithoutBlockingWhenExporterIsStalled(t *testing.T) {
	const (
		maxQueueSize = 4
		burstSize    = 100
	)
	exporter := newBlockingSpanExporter()
	metrics := NewMetrics()
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(exporter.release) }) }
	provider := newTracerProvider(TracingConfig{
		ServiceName:        "trace-burst-test",
		ServiceVersion:     "1.0.0",
		Environment:        "test",
		SampleRatio:        1,
		ExportTimeout:      time.Second,
		BatchTimeout:       time.Hour,
		MaxQueueSize:       maxQueueSize,
		MaxExportBatchSize: 1,
		Metrics:            metrics,
	}, exporter)
	t.Cleanup(func() {
		release()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = provider.Shutdown(shutdownCtx)
	})

	tracer := provider.Tracer("burst-test")
	_, firstSpan := tracer.Start(context.Background(), "collector outage starts")
	firstSpan.End()
	select {
	case <-exporter.started:
	case <-time.After(time.Second):
		t.Fatal("span exporter did not start")
	}

	burstCompleted := make(chan struct{})
	go func() {
		for index := 0; index < burstSize; index++ {
			_, span := tracer.Start(context.Background(), "burst")
			span.End()
		}
		close(burstCompleted)
	}()
	select {
	case <-burstCompleted:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("ending spans blocked on the stalled exporter")
	}
	output := metrics.Render()
	for _, expected := range []string{
		"goexample_otel_trace_queue_dropped_spans_total 96",
		"goexample_otel_trace_processor_capacity_spans 5",
		"goexample_otel_trace_processor_pending_spans 5",
		"goexample_otel_trace_processor_high_watermark_spans 5",
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("bounded processor metric %q missing from output = %s", expected, output)
		}
	}

	release()
	flushCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := provider.ForceFlush(flushCtx); err != nil {
		t.Fatalf("ForceFlush() after exporter recovery error = %v", err)
	}
	if got, want := exporter.exported.Load(), int64(1+maxQueueSize); got != want {
		t.Fatalf("exported spans after bounded queue recovery = %d, want %d", got, want)
	}
	if output := metrics.Render(); !strings.Contains(output, "goexample_otel_trace_processor_pending_spans 0") {
		t.Fatalf("processor pending metric after recovery = %s", output)
	}
}

func TestOTLPHTTPExporterMetricsRecordCollectorFailureAndRecovery(t *testing.T) {
	var collectorFailing atomic.Bool
	collectorFailing.Store(true)
	collectorSecret := "private collector failure response"
	collector := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		if collectorFailing.Load() {
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte(collectorSecret))
			return
		}
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)

	metrics := NewMetrics()
	provider, err := NewTracerProvider(context.Background(), TracingConfig{
		ServiceName:        "trace-recovery-test",
		ServiceVersion:     "1.0.0",
		Environment:        "test",
		Exporter:           "otlp",
		Endpoint:           collector.URL,
		SampleRatio:        1,
		ExportTimeout:      100 * time.Millisecond,
		BatchTimeout:       time.Hour,
		MaxQueueSize:       8,
		MaxExportBatchSize: 8,
		Metrics:            metrics,
	})
	if err != nil {
		t.Fatalf("NewTracerProvider() error = %v", err)
	}
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	_, failedSpan := provider.Tracer("test").Start(context.Background(), "collector unavailable")
	failedSpan.End()
	flushCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	err = provider.ForceFlush(flushCtx)
	cancel()
	if err == nil {
		t.Fatal("ForceFlush() succeeded while collector returned 503")
	}
	if strings.Contains(err.Error(), collectorSecret) || strings.Contains(err.Error(), collector.URL) {
		t.Fatalf("ForceFlush() exposed collector details: %v", err)
	}
	if output := metrics.Render(); !strings.Contains(output, `goexample_otel_trace_export_batches_total{outcome="failure"} 1`) ||
		!strings.Contains(output, `goexample_otel_trace_export_spans_total{outcome="failure"} 1`) {
		t.Fatalf("collector failure metrics = %s", output)
	} else if strings.Contains(output, collectorSecret) || strings.Contains(output, collector.URL) {
		t.Fatalf("collector failure metrics exposed details: %s", output)
	}

	collectorFailing.Store(false)
	_, recoveredSpan := provider.Tracer("test").Start(context.Background(), "collector recovered")
	recoveredSpan.End()
	flushCtx, cancel = context.WithTimeout(context.Background(), time.Second)
	err = provider.ForceFlush(flushCtx)
	cancel()
	if err != nil {
		t.Fatalf("ForceFlush() after collector recovery error = %v", err)
	}
	output := metrics.Render()
	if !strings.Contains(output, `goexample_otel_trace_exporter_enabled 1`) ||
		!strings.Contains(output, `goexample_otel_trace_export_batches_total{outcome="success"} 1`) ||
		!strings.Contains(output, `goexample_otel_trace_export_spans_total{outcome="success"} 1`) {
		t.Fatalf("collector recovery metrics = %s", output)
	}
}

func TestOTLPHTTPExporterRecordsEachAttemptAndRecoversWithinOneBatch(t *testing.T) {
	var attempts atomic.Int64
	collectorSecret := "private collector response must not become a metric"
	collector := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		if attempts.Add(1) == 1 {
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte(collectorSecret))
			return
		}
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)

	metrics := NewMetrics()
	provider, err := NewTracerProvider(context.Background(), TracingConfig{
		ServiceName:        "trace-attempt-test",
		ServiceVersion:     "1.0.0",
		Environment:        "test",
		Exporter:           "otlp",
		Endpoint:           collector.URL,
		SampleRatio:        1,
		ExportTimeout:      500 * time.Millisecond,
		BatchTimeout:       time.Hour,
		MaxQueueSize:       8,
		MaxExportBatchSize: 8,
		Metrics:            metrics,
	})
	if err != nil {
		t.Fatalf("NewTracerProvider() error = %v", err)
	}
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	_, span := provider.Tracer("test").Start(context.Background(), "retry then recover")
	span.End()
	flushCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err = provider.ForceFlush(flushCtx)
	cancel()
	if err != nil {
		t.Fatalf("ForceFlush() error = %v", err)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("collector attempts = %d, want one failure and one retry success", got)
	}
	output := metrics.Render()
	for _, expected := range []string{
		`goexample_otel_trace_export_attempts_total{outcome="failure"} 1`,
		`goexample_otel_trace_export_attempts_total{outcome="success"} 1`,
		`goexample_otel_trace_export_batches_total{outcome="success"} 1`,
		`goexample_otel_trace_export_batches_total{outcome="failure"} 0`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("retry metric %q missing from output = %s", expected, output)
		}
	}
	if strings.Contains(output, collectorSecret) || strings.Contains(output, collector.URL) {
		t.Fatalf("retry metrics leaked collector details: %s", output)
	}
}

func TestTraceExporterHTTPClientAndRetryBudgetsAreFinite(t *testing.T) {
	exportTimeout := 3 * time.Second
	client := newTraceExporterHTTPClient(exportTimeout, NewMetrics())
	if client.Timeout <= 0 || client.Timeout >= exportTimeout {
		t.Fatalf("OTLP HTTP attempt timeout = %s", client.Timeout)
	}
	observed, ok := client.Transport.(traceAttemptTransport)
	if !ok {
		t.Fatalf("OTLP transport type = %T", client.Transport)
	}
	transport, ok := observed.base.(*http.Transport)
	if !ok {
		t.Fatalf("OTLP base transport type = %T", observed.base)
	}
	if transport.DialContext == nil || !transport.ForceAttemptHTTP2 || transport.MaxIdleConns <= 0 ||
		transport.MaxIdleConnsPerHost <= 0 || transport.MaxConnsPerHost <= 0 ||
		transport.IdleConnTimeout <= 0 || transport.TLSHandshakeTimeout <= 0 ||
		transport.ResponseHeaderTimeout <= 0 || transport.MaxResponseHeaderBytes <= 0 ||
		transport.TLSClientConfig == nil || transport.TLSClientConfig.MinVersion != tls.VersionTLS12 {
		t.Fatalf("OTLP HTTP transport has an unbounded or weak budget: %#v", transport)
	}
	retry := traceExporterRetryConfig(exportTimeout)
	if !retry.Enabled || retry.InitialInterval <= 0 || retry.MaxInterval < retry.InitialInterval ||
		retry.MaxElapsedTime != exportTimeout || retry.InitialInterval >= exportTimeout {
		t.Fatalf("OTLP retry configuration = %#v", retry)
	}
}

func TestNewTracerProviderRejectsInvalidConfiguration(t *testing.T) {
	for _, config := range []TracingConfig{
		{Exporter: "stdout"},
		{Exporter: "otlp", Endpoint: "collector:4318"},
		{Exporter: "otlp", Endpoint: "https://user:secret@collector.example"},
		{Exporter: "none", MaxQueueSize: 1, MaxExportBatchSize: 2},
		{Exporter: "none", MaxQueueSize: 1000001, MaxExportBatchSize: 1},
	} {
		if provider, err := NewTracerProvider(context.Background(), config); err == nil {
			_ = provider.Shutdown(context.Background())
			t.Fatalf("NewTracerProvider(%#v) error = nil", config)
		}
	}
}

func TestTraceMiddlewareCreatesServerSpanAndPropagatesContext(t *testing.T) {
	app := fiber.New()
	app.Use(TraceMiddleware)
	app.Get("/work", func(c fiber.Ctx) error {
		trace, ok := FromContext(c.Context())
		if !ok || trace.ParentSpanID != "00f067aa0ba902b7" || trace.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
			t.Fatalf("request trace = %#v/%v", trace, ok)
		}
		return c.JSON(trace)
	})

	request := httptest.NewRequest(http.MethodGet, "/work", http.NoBody)
	request.Header.Set(TraceparentHeader, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("trace request error = %v", err)
	}
	defer response.Body.Close()
	if response.Header.Get(TraceparentHeader) == request.Header.Get(TraceparentHeader) {
		t.Fatalf("server must create a new span: %q", response.Header.Get(TraceparentHeader))
	}
	traceID, parentSpanID, flags, ok := ParseTraceparent(response.Header.Get(TraceparentHeader))
	if !ok || traceID != "4bf92f3577b34da6a3ce929d0e0e4736" || parentSpanID == "00f067aa0ba902b7" || flags != 1 {
		t.Fatalf("response traceparent = %q parsed as %q/%q/%d/%v", response.Header.Get(TraceparentHeader), traceID, parentSpanID, flags, ok)
	}
}

func TestTraceMiddlewareRegeneratesInvalidParentAndRequestLoggerCorrelates(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("json", "info", &output)
	app := fiber.New()
	app.Use(TraceMiddleware)
	app.Use(RequestLogger(logger))
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/work", http.NoBody)
	request.Header.Set(TraceparentHeader, "not-a-traceparent")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("trace request error = %v", err)
	}
	response.Body.Close()
	if response.Header.Get(TraceparentHeader) == "" {
		t.Fatal("generated traceparent response header is empty")
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode request log: %v; output=%s", err, output.String())
	}
	for _, field := range []string{"trace_id", "span_id", "route"} {
		if value, ok := record[field].(string); !ok || strings.TrimSpace(value) == "" {
			t.Fatalf("log field %q = %#v; output=%s", field, record[field], output.String())
		}
	}
}
