package observability

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const (
	tracerInstrumentationName = "github.com/zbxing/goexample/Framework/observability"
	maxTraceQueueSize         = 1_000_000
)

var defaultTracerProvider trace.TracerProvider = sdktrace.NewTracerProvider(
	sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.NeverSample())),
)

type TracingConfig struct {
	ServiceName        string
	ServiceVersion     string
	Environment        string
	Exporter           string
	Endpoint           string
	SampleRatio        float64
	ExportTimeout      time.Duration
	BatchTimeout       time.Duration
	MaxQueueSize       int
	MaxExportBatchSize int
	Metrics            *Metrics
}

func DefaultTracerProvider() trace.TracerProvider {
	return defaultTracerProvider
}

func NewTracerProvider(ctx context.Context, config TracingConfig) (*sdktrace.TracerProvider, error) {
	config = withTracingDefaults(config)
	if err := validateTracingConfig(config); err != nil {
		return nil, err
	}
	config.Metrics.configureTraceExporter(false)

	var exporter sdktrace.SpanExporter
	if config.Exporter == "otlp" {
		parsedEndpoint, _ := url.Parse(config.Endpoint)
		httpClient := newTraceExporterHTTPClient(config.ExportTimeout, config.Metrics)
		options := []otlptracehttp.Option{
			otlptracehttp.WithEndpoint(parsedEndpoint.Host),
			otlptracehttp.WithHTTPClient(httpClient),
			otlptracehttp.WithRetry(traceExporterRetryConfig(config.ExportTimeout)),
		}
		if parsedEndpoint.Scheme == "http" {
			options = append(options, otlptracehttp.WithInsecure())
		}
		basePath := strings.TrimSuffix(parsedEndpoint.EscapedPath(), "/")
		if basePath != "" {
			options = append(options, otlptracehttp.WithURLPath(basePath+"/v1/traces"))
		}
		var err error
		exporter, err = otlptracehttp.New(ctx, options...)
		if err != nil {
			return nil, fmt.Errorf("create OTLP HTTP trace exporter: %w", err)
		}
		config.Metrics.configureTraceExporter(true)
		exporter = traceMetricsExporter{exporter: exporter, metrics: config.Metrics, httpClient: httpClient}
	}

	provider := newTracerProvider(config, exporter)
	return provider, nil
}

type traceMetricsExporter struct {
	exporter   sdktrace.SpanExporter
	metrics    *Metrics
	httpClient *http.Client
}

func (exporter traceMetricsExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	err := exporter.exporter.ExportSpans(ctx, spans)
	exporter.metrics.recordTraceExport(len(spans), err)
	if err != nil {
		return errors.New("OTLP trace export failed")
	}
	return nil
}

func (exporter traceMetricsExporter) Shutdown(ctx context.Context) error {
	err := exporter.exporter.Shutdown(ctx)
	if exporter.httpClient != nil {
		exporter.httpClient.CloseIdleConnections()
	}
	if err != nil {
		return errors.New("OTLP trace exporter shutdown failed")
	}
	return nil
}

type traceAttemptTransport struct {
	base    http.RoundTripper
	metrics *Metrics
}

func (transport traceAttemptTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := transport.base.RoundTrip(request)
	success := err == nil && response != nil && response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices
	transport.metrics.recordTraceExportAttempt(success)
	return response, err
}

func (transport traceAttemptTransport) CloseIdleConnections() {
	if closer, ok := transport.base.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

func newTraceExporterHTTPClient(exportTimeout time.Duration, metrics *Metrics) *http.Client {
	attemptTimeout := traceBudgetFraction(exportTimeout, 4, 2*time.Second)
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   attemptTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:      true,
		MaxIdleConns:           16,
		MaxIdleConnsPerHost:    4,
		MaxConnsPerHost:        4,
		IdleConnTimeout:        90 * time.Second,
		TLSHandshakeTimeout:    attemptTimeout,
		ExpectContinueTimeout:  min(time.Second, attemptTimeout),
		ResponseHeaderTimeout:  attemptTimeout,
		MaxResponseHeaderBytes: 1 << 20,
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
	}
	return &http.Client{
		Transport: traceAttemptTransport{base: transport, metrics: metrics},
		Timeout:   attemptTimeout,
	}
}

func traceExporterRetryConfig(exportTimeout time.Duration) otlptracehttp.RetryConfig {
	return otlptracehttp.RetryConfig{
		Enabled:         true,
		InitialInterval: traceBudgetFraction(exportTimeout, 20, 250*time.Millisecond),
		MaxInterval:     traceBudgetFraction(exportTimeout, 5, time.Second),
		MaxElapsedTime:  exportTimeout,
	}
}

func traceBudgetFraction(total time.Duration, divisor int, ceiling time.Duration) time.Duration {
	duration := total / time.Duration(divisor)
	if duration < time.Millisecond {
		duration = time.Millisecond
	}
	return min(duration, ceiling)
}

// traceQueueBudget accounts for both the SDK channel and the batch currently
// held by the exporter, so every admitted span has one final release callback.
type traceQueueBudget struct {
	slots   chan struct{}
	metrics *Metrics
}

func newTraceQueueBudget(capacity int, metrics *Metrics) *traceQueueBudget {
	metrics.configureTraceProcessorCapacity(capacity)
	return &traceQueueBudget{slots: make(chan struct{}, capacity), metrics: metrics}
}

func (budget *traceQueueBudget) acquire() bool {
	select {
	case budget.slots <- struct{}{}:
		budget.metrics.recordTraceProcessorAcquire()
		return true
	default:
		budget.metrics.recordTraceQueueDrop(1)
		return false
	}
}

func (budget *traceQueueBudget) release(spanCount int) {
	for range spanCount {
		<-budget.slots
	}
	budget.metrics.recordTraceProcessorRelease(spanCount)
}

type traceQueueExporter struct {
	exporter sdktrace.SpanExporter
	budget   *traceQueueBudget
}

func (exporter traceQueueExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	defer exporter.budget.release(len(spans))
	return exporter.exporter.ExportSpans(ctx, spans)
}

func (exporter traceQueueExporter) Shutdown(ctx context.Context) error {
	return exporter.exporter.Shutdown(ctx)
}

type boundedBatchSpanProcessor struct {
	processor sdktrace.SpanProcessor
	budget    *traceQueueBudget
	mutex     sync.RWMutex
	stopped   bool
}

func (processor *boundedBatchSpanProcessor) OnStart(ctx context.Context, span sdktrace.ReadWriteSpan) {
	processor.processor.OnStart(ctx, span)
}

func (processor *boundedBatchSpanProcessor) OnEnd(span sdktrace.ReadOnlySpan) {
	if !span.SpanContext().IsSampled() {
		return
	}
	processor.mutex.RLock()
	defer processor.mutex.RUnlock()
	if processor.stopped || !processor.budget.acquire() {
		return
	}
	processor.processor.OnEnd(span)
}

func (processor *boundedBatchSpanProcessor) Shutdown(ctx context.Context) error {
	processor.mutex.Lock()
	processor.stopped = true
	processor.mutex.Unlock()
	return processor.processor.Shutdown(ctx)
}

func (processor *boundedBatchSpanProcessor) ForceFlush(ctx context.Context) error {
	return processor.processor.ForceFlush(ctx)
}

func newTracerProvider(config TracingConfig, exporter sdktrace.SpanExporter) *sdktrace.TracerProvider {
	rootSampler := sdktrace.NeverSample()
	if exporter != nil {
		rootSampler = sdktrace.TraceIDRatioBased(config.SampleRatio)
	}
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithSampler(sdktrace.ParentBased(rootSampler)),
		sdktrace.WithResource(resource.NewSchemaless(
			attribute.String("service.name", config.ServiceName),
			attribute.String("service.version", config.ServiceVersion),
			attribute.String("deployment.environment.name", config.Environment),
		)),
	}
	if exporter != nil {
		capacity := config.MaxQueueSize + config.MaxExportBatchSize
		budget := newTraceQueueBudget(capacity, config.Metrics)
		processor := sdktrace.NewBatchSpanProcessor(
			traceQueueExporter{exporter: exporter, budget: budget},
			sdktrace.WithMaxQueueSize(capacity),
			sdktrace.WithMaxExportBatchSize(config.MaxExportBatchSize),
			sdktrace.WithBatchTimeout(config.BatchTimeout),
			sdktrace.WithExportTimeout(config.ExportTimeout),
		)
		options = append(options, sdktrace.WithSpanProcessor(&boundedBatchSpanProcessor{
			processor: processor,
			budget:    budget,
		}))
	}
	return sdktrace.NewTracerProvider(options...)
}

func withTracingDefaults(config TracingConfig) TracingConfig {
	if strings.TrimSpace(config.ServiceName) == "" {
		config.ServiceName = "goexample"
	}
	if strings.TrimSpace(config.ServiceVersion) == "" {
		config.ServiceVersion = "unknown"
	}
	if strings.TrimSpace(config.Environment) == "" {
		config.Environment = "development"
	}
	config.Exporter = strings.ToLower(strings.TrimSpace(config.Exporter))
	if config.Exporter == "" {
		config.Exporter = "none"
	}
	if config.ExportTimeout <= 0 {
		config.ExportTimeout = 3 * time.Second
	}
	if config.BatchTimeout <= 0 {
		config.BatchTimeout = 5 * time.Second
	}
	if config.MaxQueueSize <= 0 {
		config.MaxQueueSize = 2048
	}
	if config.MaxExportBatchSize <= 0 {
		config.MaxExportBatchSize = 512
	}
	return config
}

func validateTracingConfig(config TracingConfig) error {
	if config.Exporter != "none" && config.Exporter != "otlp" {
		return errors.New("trace exporter must be either none or otlp")
	}
	if math.IsNaN(config.SampleRatio) || math.IsInf(config.SampleRatio, 0) || config.SampleRatio < 0 || config.SampleRatio > 1 {
		return errors.New("trace sample ratio must be between 0 and 1")
	}
	if config.MaxQueueSize > maxTraceQueueSize {
		return errors.New("trace max queue size must not exceed 1000000")
	}
	if config.MaxExportBatchSize > config.MaxQueueSize {
		return errors.New("trace max export batch size must not exceed max queue size")
	}
	if config.Exporter != "otlp" {
		return nil
	}
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Host == "" {
		return errors.New("OTLP endpoint must be an absolute http or https URL")
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return errors.New("OTLP endpoint must not contain credentials, query, or fragment")
	}
	return nil
}
