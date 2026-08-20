package observability

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const tracerInstrumentationName = "github.com/zbxing/goexample/Framework/observability"

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
}

func DefaultTracerProvider() trace.TracerProvider {
	return defaultTracerProvider
}

func NewTracerProvider(ctx context.Context, config TracingConfig) (*sdktrace.TracerProvider, error) {
	config = withTracingDefaults(config)
	if err := validateTracingConfig(config); err != nil {
		return nil, err
	}

	var exporter sdktrace.SpanExporter
	if config.Exporter == "otlp" {
		parsedEndpoint, _ := url.Parse(config.Endpoint)
		options := []otlptracehttp.Option{
			otlptracehttp.WithEndpoint(parsedEndpoint.Host),
			otlptracehttp.WithTimeout(config.ExportTimeout),
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
	}

	provider := newTracerProvider(config, exporter)
	return provider, nil
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
		options = append(options, sdktrace.WithSpanProcessor(sdktrace.NewBatchSpanProcessor(
			exporter,
			sdktrace.WithMaxQueueSize(config.MaxQueueSize),
			sdktrace.WithMaxExportBatchSize(config.MaxExportBatchSize),
			sdktrace.WithBatchTimeout(config.BatchTimeout),
			sdktrace.WithExportTimeout(config.ExportTimeout),
		)))
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
