// Package httpclient builds bounded net/http clients with OpenTelemetry trace
// propagation. It deliberately records no raw URL, query, body, or header data.
package httpclient

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const instrumentationName = "github.com/zbxing/goexample/Framework/httpclient"

var errInvalidTransportResponse = errors.New("outbound HTTP transport returned no response")

// Config defines finite request, connection, pooling, and response-header
// budgets for an outbound HTTP client. Zero values select conservative
// defaults; negative values are rejected.
type Config struct {
	RequestTimeout            time.Duration
	ConnectTimeout            time.Duration
	KeepAlive                 time.Duration
	TLSHandshakeTimeout       time.Duration
	ResponseHeaderTimeout     time.Duration
	ExpectContinueTimeout     time.Duration
	IdleConnectionTimeout     time.Duration
	MaxIdleConnections        int
	MaxIdleConnectionsPerHost int
	MaxConnectionsPerHost     int
	MaxResponseHeaderBytes    int64
	// MaxResponseBodyBytes applies an opt-in streaming limit to every
	// response body returned by this client. Zero leaves bodies unlimited.
	MaxResponseBodyBytes int64
	TLSConfig            *tls.Config
	Proxy                func(*http.Request) (*url.URL, error)
	TracerProvider       trace.TracerProvider
	Retry                RetryConfig
	CircuitBreaker       CircuitBreakerConfig
}

// New returns an HTTP/1.1 and HTTP/2 client with finite resource budgets and
// W3C Trace Context propagation. Callers remain responsible for closing every
// non-nil response body.
func New(config Config) (*http.Client, error) {
	config = withDefaults(config)
	if err := validate(config); err != nil {
		return nil, err
	}
	tlsConfig := cloneTLSConfig(config.TLSConfig)
	proxy := config.Proxy
	if proxy == nil {
		proxy = http.ProxyFromEnvironment
	}

	provider := config.TracerProvider
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	transport := &http.Transport{
		Proxy: proxy,
		DialContext: (&net.Dialer{
			Timeout:   config.ConnectTimeout,
			KeepAlive: config.KeepAlive,
		}).DialContext,
		ForceAttemptHTTP2:      true,
		MaxIdleConns:           config.MaxIdleConnections,
		MaxIdleConnsPerHost:    config.MaxIdleConnectionsPerHost,
		MaxConnsPerHost:        config.MaxConnectionsPerHost,
		IdleConnTimeout:        config.IdleConnectionTimeout,
		TLSHandshakeTimeout:    config.TLSHandshakeTimeout,
		ExpectContinueTimeout:  config.ExpectContinueTimeout,
		ResponseHeaderTimeout:  config.ResponseHeaderTimeout,
		MaxResponseHeaderBytes: config.MaxResponseHeaderBytes,
		TLSClientConfig:        tlsConfig,
	}
	var base http.RoundTripper = transport
	if config.Retry.MaxAttempts > 0 {
		base = retryTransport{base: transport, config: config.Retry}
	}
	if config.CircuitBreaker.FailureThreshold > 0 {
		base = newCircuitBreakerTransport(base, config.CircuitBreaker)
	}
	return &http.Client{
		Timeout: config.RequestTimeout,
		Transport: tracingTransport{
			base:                 base,
			tracer:               provider.Tracer(instrumentationName),
			propagator:           propagation.TraceContext{},
			maxResponseBodyBytes: config.MaxResponseBodyBytes,
		},
	}, nil
}

type tracingTransport struct {
	base                 http.RoundTripper
	tracer               trace.Tracer
	propagator           propagation.TextMapPropagator
	maxResponseBodyBytes int64
}

func (transport tracingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil {
		return nil, errors.New("outbound HTTP request is nil")
	}
	method := spanMethod(request.Method)
	ctx, span := transport.tracer.Start(
		request.Context(),
		method+" outbound request",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.String("http.request.method", method)),
	)
	if contextErr := completedHTTPContextError(ctx); contextErr != nil {
		closeHTTPRequestBody(request)
		errorType, description := classifyError(ctx, contextErr)
		span.SetAttributes(attribute.String("error.type", errorType))
		span.SetStatus(codes.Error, description)
		span.End()
		return nil, contextErr
	}

	outbound := cloneRequestForPropagation(request, ctx)
	transport.propagator.Inject(ctx, propagation.HeaderCarrier(outbound.Header))

	response, err := transport.base.RoundTrip(outbound)
	response, err = authoritativeHTTPResult(ctx, response, err)
	if err != nil {
		errorType, description := classifyError(ctx, err)
		span.SetAttributes(attribute.String("error.type", errorType))
		span.SetStatus(codes.Error, description)
		span.End()
		return nil, err
	}
	if response == nil {
		span.SetAttributes(attribute.String("error.type", "invalid_response"))
		span.SetStatus(codes.Error, "outbound request returned no response")
		span.End()
		return nil, errInvalidTransportResponse
	}

	span.SetAttributes(attribute.Int("http.response.status_code", response.StatusCode))
	if response.StatusCode >= http.StatusBadRequest {
		span.SetAttributes(attribute.String("error.type", strconv.Itoa(response.StatusCode)))
		span.SetStatus(codes.Error, http.StatusText(response.StatusCode))
	}
	response.Body = &spanBody{
		ReadCloser: response.Body,
		ctx:        ctx,
		span:       span,
	}
	if transport.maxResponseBodyBytes > 0 {
		if err := LimitResponseBody(response, transport.maxResponseBodyBytes); err != nil {
			return nil, err
		}
	}
	return response, nil
}

// completedHTTPContextError also observes a deadline whose timer has elapsed
// but whose Done channel has not been scheduled yet.
func completedHTTPContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

// authoritativeHTTPResult is used only at RoundTripper boundaries. Explicit
// transport errors remain authoritative; responses that cannot be returned are
// closed by the first layer that rejects them.
func authoritativeHTTPResult(ctx context.Context, response *http.Response, err error) (*http.Response, error) {
	if err != nil {
		closeHTTPResponseBody(response)
		return nil, err
	}
	if contextErr := completedHTTPContextError(ctx); contextErr != nil {
		closeHTTPResponseBody(response)
		return nil, contextErr
	}
	return response, nil
}

func closeHTTPRequestBody(request *http.Request) {
	if request != nil && request.Body != nil {
		_ = request.Body.Close()
	}
}

func closeHTTPResponseBody(response *http.Response) {
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
}

func cloneRequestForPropagation(request *http.Request, ctx context.Context) *http.Request {
	// WithContext copies the request value without deep-copying read-only URL,
	// trailer, transfer-encoding, and form state. Only Header must be isolated
	// because trace propagation mutates it.
	outbound := request.WithContext(ctx)
	outbound.Header = request.Header.Clone()
	if outbound.Header == nil {
		outbound.Header = make(http.Header)
	}
	return outbound
}

type spanBody struct {
	io.ReadCloser
	ctx  context.Context
	span trace.Span
	once sync.Once
}

func (body *spanBody) Read(buffer []byte) (int, error) {
	read, err := body.ReadCloser.Read(buffer)
	if err == nil {
		return read, nil
	}
	if !errors.Is(err, io.EOF) {
		errorType, description := classifyError(body.ctx, err)
		body.span.SetAttributes(attribute.String("error.type", errorType))
		body.span.SetStatus(codes.Error, description)
	}
	body.end()
	return read, err
}

func (body *spanBody) Close() error {
	err := body.ReadCloser.Close()
	if err != nil {
		errorType, description := classifyError(body.ctx, err)
		body.span.SetAttributes(attribute.String("error.type", errorType))
		body.span.SetStatus(codes.Error, description)
	}
	body.end()
	return err
}

func (body *spanBody) responseBodyTooLarge() {
	body.span.SetAttributes(attribute.String("error.type", "response_body_too_large"))
	body.span.SetStatus(codes.Error, "outbound response body exceeded configured limit")
}

func (body *spanBody) end() {
	body.once.Do(func() { body.span.End() })
}

func spanMethod(method string) string {
	if method == "" {
		return http.MethodGet
	}
	switch method {
	case http.MethodConnect, http.MethodDelete, http.MethodGet, http.MethodHead,
		http.MethodOptions, http.MethodPatch, http.MethodPost, http.MethodPut, http.MethodTrace:
		return method
	default:
		return "_OTHER"
	}
}

func classifyError(ctx context.Context, err error) (string, string) {
	switch {
	case errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled):
		return "canceled", "outbound request canceled"
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return "timeout", "outbound request timed out"
	case errors.Is(err, ErrCircuitOpen):
		return "circuit_open", "outbound request circuit is open"
	}
	// http.Client.Timeout cancels a custom RoundTripper through the legacy
	// Request.Cancel channel and exposes no public sentinel to the transport.
	if err.Error() == "net/http: request canceled" || err.Error() == "net/http: request canceled while waiting for connection" {
		return "timeout", "outbound request timed out"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "timeout", "outbound request timed out"
	}
	return "network", "outbound request failed"
}

func withDefaults(config Config) Config {
	if config.RequestTimeout == 0 {
		config.RequestTimeout = 30 * time.Second
	}
	if config.ConnectTimeout == 0 {
		config.ConnectTimeout = 5 * time.Second
	}
	if config.KeepAlive == 0 {
		config.KeepAlive = 30 * time.Second
	}
	if config.TLSHandshakeTimeout == 0 {
		config.TLSHandshakeTimeout = 5 * time.Second
	}
	if config.ResponseHeaderTimeout == 0 {
		config.ResponseHeaderTimeout = 10 * time.Second
	}
	if config.ExpectContinueTimeout == 0 {
		config.ExpectContinueTimeout = time.Second
	}
	if config.IdleConnectionTimeout == 0 {
		config.IdleConnectionTimeout = 90 * time.Second
	}
	if config.MaxIdleConnections == 0 {
		config.MaxIdleConnections = 100
	}
	if config.MaxIdleConnectionsPerHost == 0 {
		config.MaxIdleConnectionsPerHost = min(10, config.MaxIdleConnections)
	}
	if config.MaxConnectionsPerHost == 0 {
		config.MaxConnectionsPerHost = max(100, config.MaxIdleConnectionsPerHost)
	}
	if config.MaxResponseHeaderBytes == 0 {
		config.MaxResponseHeaderBytes = 1 << 20
	}
	config.Retry = withRetryDefaults(config.Retry)
	config.CircuitBreaker = withCircuitBreakerDefaults(config.CircuitBreaker)
	return config
}

func validate(config Config) error {
	durations := []struct {
		name  string
		value time.Duration
	}{
		{"request timeout", config.RequestTimeout},
		{"connect timeout", config.ConnectTimeout},
		{"keep-alive interval", config.KeepAlive},
		{"TLS handshake timeout", config.TLSHandshakeTimeout},
		{"response header timeout", config.ResponseHeaderTimeout},
		{"expect-continue timeout", config.ExpectContinueTimeout},
		{"idle connection timeout", config.IdleConnectionTimeout},
	}
	for _, duration := range durations {
		if duration.value <= 0 {
			return fmt.Errorf("outbound HTTP %s must be greater than zero", duration.name)
		}
	}
	if config.MaxIdleConnections <= 0 || config.MaxIdleConnectionsPerHost <= 0 || config.MaxConnectionsPerHost <= 0 {
		return errors.New("outbound HTTP connection limits must be greater than zero")
	}
	if config.MaxIdleConnectionsPerHost > config.MaxIdleConnections {
		return errors.New("outbound HTTP idle connections per host must not exceed the global idle connection limit")
	}
	if config.MaxIdleConnectionsPerHost > config.MaxConnectionsPerHost {
		return errors.New("outbound HTTP idle connections per host must not exceed the per-host connection limit")
	}
	if config.MaxResponseHeaderBytes <= 0 {
		return errors.New("outbound HTTP response header limit must be greater than zero")
	}
	if config.MaxResponseBodyBytes < 0 {
		return errors.New("outbound HTTP response body limit must not be negative")
	}
	if err := validateRetryConfig(config.Retry); err != nil {
		return err
	}
	if err := validateCircuitBreakerConfig(config.CircuitBreaker); err != nil {
		return err
	}
	if config.TLSConfig != nil {
		if config.TLSConfig.MinVersion != 0 && config.TLSConfig.MinVersion < tls.VersionTLS12 {
			return errors.New("outbound HTTP TLS minimum version must be TLS 1.2 or newer")
		}
		if config.TLSConfig.MaxVersion != 0 && config.TLSConfig.MaxVersion < tls.VersionTLS12 {
			return errors.New("outbound HTTP TLS maximum version must allow TLS 1.2 or newer")
		}
	}
	return nil
}

func cloneTLSConfig(config *tls.Config) *tls.Config {
	if config == nil {
		return &tls.Config{MinVersion: tls.VersionTLS12}
	}
	result := config.Clone()
	if result.MinVersion == 0 {
		result.MinVersion = tls.VersionTLS12
	}
	return result
}
