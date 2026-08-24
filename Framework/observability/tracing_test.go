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
	if !span.Parent().IsRemote() || span.Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Fatalf("span parent = %s remote=%t", span.Parent().SpanID(), span.Parent().IsRemote())
	}
	attributes := make(map[string]attribute.Value)
	for _, item := range span.Attributes() {
		attributes[string(item.Key)] = item.Value
	}
	if attributes["http.route"].AsString() != "/work/:id" || attributes["http.response.status_code"].AsInt64() != fiber.StatusNoContent {
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
