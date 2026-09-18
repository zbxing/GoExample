package httpclient

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestClientCreatesLowSensitivitySpanAndPropagatesW3CContext(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	receivedContext := make(chan trace.SpanContext, 1)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		ctx := propagation.TraceContext{}.Extract(request.Context(), propagation.HeaderCarrier(request.Header))
		receivedContext <- trace.SpanContextFromContext(ctx)
		response.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)

	client, err := New(Config{TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	parentCtx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	request, err := http.NewRequestWithContext(parentCtx, http.MethodGet, server.URL+"/private?token=do-not-record", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}
	request.Header.Set("Authorization", "Bearer do-not-record")
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	response.Body.Close()
	parent.End()
	if request.Header.Get("traceparent") != "" {
		t.Fatalf("client mutated the caller request traceparent: %q", request.Header.Get("traceparent"))
	}

	var clientSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		if span.SpanKind() == trace.SpanKindClient {
			clientSpan = span
			break
		}
	}
	if clientSpan == nil {
		t.Fatal("client span was not recorded")
	}
	if clientSpan.Name() != "GET outbound request" || clientSpan.Parent().SpanID() != parent.SpanContext().SpanID() {
		t.Fatalf("client span name/parent = %q/%s", clientSpan.Name(), clientSpan.Parent().SpanID())
	}
	remote := <-receivedContext
	if !remote.IsValid() || !remote.IsRemote() || remote.TraceID() != clientSpan.SpanContext().TraceID() || remote.SpanID() != clientSpan.SpanContext().SpanID() {
		t.Fatalf("propagated context = %s/%s remote=%t", remote.TraceID(), remote.SpanID(), remote.IsRemote())
	}
	attributes := spanAttributes(clientSpan)
	if attributes["http.request.method"].AsString() != http.MethodGet ||
		attributes["http.response.status_code"].AsInt64() != http.StatusServiceUnavailable ||
		attributes["error.type"].AsString() != "503" {
		t.Fatalf("client span attributes = %#v", attributes)
	}
	encoded := clientSpan.Name()
	for key, value := range attributes {
		encoded += key + value.Emit()
	}
	for _, secret := range []string{"/private", "token", "do-not-record", "Authorization"} {
		if strings.Contains(encoded, secret) {
			t.Fatalf("client span leaked %q: %s", secret, encoded)
		}
	}
}

func TestCloneRequestForPropagationOnlyIsolatesMutableHeaders(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://example.test/items?tenant=one", strings.NewReader("payload"))
	request.Header["X-Values"] = []string{"one", "two"}
	request.Trailer = http.Header{"X-Trailer": []string{"value"}}
	request.TransferEncoding = []string{"chunked"}
	request.Form = url.Values{"filter": []string{"active"}}
	request.PostForm = url.Values{"name": []string{"Ada"}}

	ctx := context.WithValue(request.Context(), struct{}{}, "outbound")
	outbound := cloneRequestForPropagation(request, ctx)
	outbound.Header.Set("X-Values", "changed")
	outbound.Header.Set("traceparent", "injected")

	if outbound == request || outbound.Context() != ctx {
		t.Fatal("outbound request did not receive an isolated request value and replacement context")
	}
	if outbound.URL != request.URL || &outbound.TransferEncoding[0] != &request.TransferEncoding[0] {
		t.Fatal("outbound request deep-copied read-only URL or transfer-encoding state")
	}
	if request.Header.Get("X-Values") != "one" || request.Header.Get("traceparent") != "" {
		t.Fatalf("caller headers were mutated: %#v", request.Header)
	}
	if request.URL.RawQuery != "tenant=one" || request.Trailer.Get("X-Trailer") != "value" ||
		request.Form.Get("filter") != "active" || request.PostForm.Get("name") != "Ada" {
		t.Fatal("caller read-only request state changed")
	}
}

func TestPrepareRequestForPropagationSkipsNoopTraceContext(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://example.test/items", http.NoBody)
	request.Header.Set("X-Caller", "unchanged")
	ctx := context.Background()

	outbound, inject := prepareRequestForPropagation(request, ctx, propagation.TraceContext{})
	if inject {
		t.Fatal("invalid standard trace context unexpectedly requested injection")
	}
	if outbound == request || outbound.Context() != ctx {
		t.Fatal("request value/context was not copied")
	}
	outbound.Header.Set("X-Shared-Probe", "shared")
	if request.Header.Get("X-Shared-Probe") != "shared" {
		t.Fatal("no-op standard trace path unexpectedly cloned headers")
	}
	delete(request.Header, "X-Shared-Probe")
	if got := outbound.Header.Get("X-Caller"); got != "unchanged" {
		t.Fatalf("shared no-op header value = %q", got)
	}

	tracer := trace.NewNoopTracerProvider().Tracer(instrumentationName)
	var received *http.Request
	transport := tracingTransport{
		base: roundTripFunc(func(outbound *http.Request) (*http.Response, error) {
			received = outbound
			return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody}, nil
		}),
		tracer:     tracer,
		propagator: propagation.TraceContext{},
	}
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
	response.Body.Close()
	if received == nil {
		t.Fatal("base transport did not receive a request")
	}
	if received.Header.Get("traceparent") != "" {
		t.Fatalf("no-op trace request headers = %#v", received.Header)
	}
	if request.Header.Get("X-Caller") != "unchanged" {
		t.Fatalf("caller header changed = %#v", request.Header)
	}
}

func TestPrepareRequestForPropagationKeepsCustomPropagatorIsolation(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://example.test/items", http.NoBody)
	request.Header.Set("X-Caller", "unchanged")
	propagator := testHTTPPropagator{}
	outbound, inject := prepareRequestForPropagation(request, context.Background(), propagator)
	if !inject {
		t.Fatal("custom propagator did not receive an isolated header clone")
	}
	outbound.Header.Set("X-Clone-Probe", "isolated")
	if request.Header.Get("X-Clone-Probe") != "" {
		t.Fatal("custom propagator request headers were not isolated")
	}
	propagator.Inject(context.Background(), propagation.HeaderCarrier(outbound.Header))
	if outbound.Header.Get("x-custom-trace") != "injected" || request.Header.Get("x-custom-trace") != "" {
		t.Fatalf("custom propagation isolation failed: outbound=%#v caller=%#v", outbound.Header, request.Header)
	}
}

func TestPropagationNeedsInjectionDoesNotReadSpanContextForCustomPropagator(t *testing.T) {
	ctx := panicValueContext{Context: context.Background()}
	if !propagationNeedsInjection(testHTTPPropagator{}, ctx) {
		t.Fatal("custom propagator unexpectedly skipped injection")
	}
}

func TestPrepareRequestForPropagationTreatsNilPropagatorAsNoop(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://example.test/items", http.NoBody)
	request.Header.Set("X-Caller", "unchanged")
	var typedNilCustom *typedNilHTTPPropagator

	tests := []struct {
		name       string
		propagator propagation.TextMapPropagator
	}{
		{name: "nil-interface", propagator: nil},
		{name: "typed-nil-trace-context", propagator: (*propagation.TraceContext)(nil)},
		{name: "typed-nil-custom", propagator: typedNilCustom},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			outbound, inject := prepareRequestForPropagation(request, context.Background(), test.propagator)
			if inject {
				t.Fatal("nil propagator unexpectedly requested injection")
			}
			if outbound == request || outbound.Context() != context.Background() {
				t.Fatal("request value/context was not copied")
			}
			outbound.Header.Set("X-Shared-Probe", "shared")
			if request.Header.Get("X-Shared-Probe") != "shared" {
				t.Fatal("nil propagator no-op should preserve the existing no-clone contract")
			}
			delete(request.Header, "X-Shared-Probe")

			transport := tracingTransport{
				base: roundTripFunc(func(outbound *http.Request) (*http.Response, error) {
					if outbound.Header.Get("X-Caller") != "unchanged" {
						t.Fatalf("caller header = %#v", outbound.Header)
					}
					return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody}, nil
				}),
				tracer:     trace.NewNoopTracerProvider().Tracer(instrumentationName),
				propagator: test.propagator,
			}
			response, err := transport.RoundTrip(request)
			if err != nil {
				t.Fatalf("RoundTrip() error = %v", err)
			}
			response.Body.Close()
		})
	}
}

func TestTracingTransportRejectsCompletedContextResultsAndOwnsBodies(t *testing.T) {
	t.Run("pre-canceled request", func(t *testing.T) {
		recorder, provider := testTracerProvider(t)
		var calls atomic.Int32
		requestBody := &countingHTTPBody{Reader: strings.NewReader("private request")}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://example.test/private", requestBody)
		if err != nil {
			t.Fatalf("NewRequestWithContext() error = %v", err)
		}
		transport := tracingTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody}, nil
			}),
			tracer:     provider.Tracer(instrumentationName),
			propagator: propagation.TraceContext{},
		}

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/context.Canceled", response, err)
		}
		if calls.Load() != 0 || requestBody.closes.Load() != 1 {
			t.Fatalf("base calls/request closes = %d/%d, want 0/1", calls.Load(), requestBody.closes.Load())
		}
		span := onlyEndedSpan(t, recorder)
		if got := spanAttributes(span)["error.type"].AsString(); got != "canceled" {
			t.Fatalf("pre-canceled span error.type = %q, want canceled", got)
		}
	})

	t.Run("late canceled response", func(t *testing.T) {
		recorder, provider := testTracerProvider(t)
		responseBody := &countingHTTPBody{Reader: strings.NewReader("private response")}
		ctx, cancel := context.WithCancel(context.Background())
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody).WithContext(ctx)
		transport := tracingTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				cancel()
				return &http.Response{StatusCode: http.StatusOK, Body: responseBody}, nil
			}),
			tracer:     provider.Tracer(instrumentationName),
			propagator: propagation.TraceContext{},
		}

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/context.Canceled", response, err)
		}
		if responseBody.closes.Load() != 1 {
			t.Fatalf("late response closes = %d, want 1", responseBody.closes.Load())
		}
		attributes := spanAttributes(onlyEndedSpan(t, recorder))
		if attributes["error.type"].AsString() != "canceled" {
			t.Fatalf("late response span attributes = %#v, want canceled", attributes)
		}
		if _, exists := attributes["http.response.status_code"]; exists {
			t.Fatalf("rejected late response recorded a status code: %#v", attributes)
		}
	})

	t.Run("elapsed deadline response", func(t *testing.T) {
		recorder, provider := testTracerProvider(t)
		responseBody := &countingHTTPBody{Reader: strings.NewReader("private response")}
		ctx := &mutableHTTPDeadlineContext{Context: context.Background(), deadline: time.Now().Add(time.Hour)}
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody).WithContext(ctx)
		transport := tracingTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				ctx.deadline = time.Now().Add(-time.Second)
				return &http.Response{StatusCode: http.StatusOK, Body: responseBody}, nil
			}),
			tracer:     provider.Tracer(instrumentationName),
			propagator: propagation.TraceContext{},
		}

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/context.DeadlineExceeded", response, err)
		}
		if responseBody.closes.Load() != 1 {
			t.Fatalf("elapsed response closes = %d, want 1", responseBody.closes.Load())
		}
		if got := spanAttributes(onlyEndedSpan(t, recorder))["error.type"].AsString(); got != "timeout" {
			t.Fatalf("elapsed response span error.type = %q, want timeout", got)
		}
	})

	t.Run("explicit error owns invalid response", func(t *testing.T) {
		recorder, provider := testTracerProvider(t)
		backendErr := errors.New("private transport error")
		responseBody := &countingHTTPBody{Reader: strings.NewReader("private response")}
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody)
		transport := tracingTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Body: responseBody}, backendErr
			}),
			tracer:     provider.Tracer(instrumentationName),
			propagator: propagation.TraceContext{},
		}

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, backendErr) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/original error", response, err)
		}
		if responseBody.closes.Load() != 1 {
			t.Fatalf("invalid response closes = %d, want 1", responseBody.closes.Load())
		}
		span := onlyEndedSpan(t, recorder)
		if strings.Contains(span.Status().Description, "private") {
			t.Fatalf("explicit error leaked through span status: %q", span.Status().Description)
		}
	})

	t.Run("nil response and nil error", func(t *testing.T) {
		recorder, provider := testTracerProvider(t)
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody)
		transport := tracingTransport{
			base:       roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, nil }),
			tracer:     provider.Tracer(instrumentationName),
			propagator: propagation.TraceContext{},
		}

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, errInvalidTransportResponse) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/invalid-response error", response, err)
		}
		if got := spanAttributes(onlyEndedSpan(t, recorder))["error.type"].AsString(); got != "invalid_response" {
			t.Fatalf("nil response span error.type = %q, want invalid_response", got)
		}
	})
}

func TestCompletedHTTPContextErrorObservesElapsedDeadlineWithoutAllocations(t *testing.T) {
	if err := completedHTTPContextError(context.Background()); err != nil {
		t.Fatalf("live context error = %v, want nil", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := completedHTTPContextError(canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error = %v, want context.Canceled", err)
	}
	elapsed := &mutableHTTPDeadlineContext{Context: context.Background(), deadline: time.Now().Add(-time.Second)}
	if err := completedHTTPContextError(elapsed); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed context error = %v, want context.DeadlineExceeded", err)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if completedHTTPContextError(context.Background()) != nil {
			t.Fatal("live context unexpectedly completed")
		}
	}); allocations != 0 {
		t.Fatalf("completed context allocations = %v, want 0", allocations)
	}
}

var benchmarkOutboundRequest *http.Request

func BenchmarkCloneRequestForPropagation(b *testing.B) {
	request := httptest.NewRequest(http.MethodPost, "https://example.test/items?tenant=one", strings.NewReader("payload"))
	request.Header["X-Values"] = []string{"one", "two"}
	request.Trailer = http.Header{"X-Trailer": []string{"value"}}
	request.TransferEncoding = []string{"chunked"}
	request.Form = url.Values{"filter": []string{"active"}}
	request.PostForm = url.Values{"name": []string{"Ada"}}
	ctx := context.WithValue(request.Context(), struct{}{}, "outbound")

	b.Run("optimized", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			benchmarkOutboundRequest = cloneRequestForPropagation(request, ctx)
		}
	})
	b.Run("legacy-deep-clone", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			outbound := request.Clone(ctx)
			outbound.Header = request.Header.Clone()
			if outbound.Header == nil {
				outbound.Header = make(http.Header)
			}
			benchmarkOutboundRequest = outbound
		}
	})
}

func BenchmarkPrepareRequestForPropagation(b *testing.B) {
	request := httptest.NewRequest(http.MethodGet, "https://example.test/items", http.NoBody)
	request.Header.Set("X-Caller", "value")
	ctx := context.Background()
	b.Run("standard-noop", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			benchmarkOutboundRequest, _ = prepareRequestForPropagation(request, ctx, propagation.TraceContext{})
		}
	})
	b.Run("custom-isolated", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			benchmarkOutboundRequest, _ = prepareRequestForPropagation(request, ctx, testHTTPPropagator{})
		}
	})
}

func TestNewAppliesFiniteTransportBudgetsAndTLSBaseline(t *testing.T) {
	customTLS := &tls.Config{MinVersion: tls.VersionTLS13}
	client, err := New(Config{TLSConfig: customTLS})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(client.CloseIdleConnections)
	traced, ok := client.Transport.(tracingTransport)
	if !ok {
		t.Fatalf("client transport type = %T", client.Transport)
	}
	transport, ok := traced.base.(*http.Transport)
	if !ok {
		t.Fatalf("base transport type = %T", traced.base)
	}
	if client.Timeout <= 0 || transport.DialContext == nil || transport.TLSHandshakeTimeout <= 0 ||
		transport.ResponseHeaderTimeout <= 0 || transport.ExpectContinueTimeout <= 0 ||
		transport.IdleConnTimeout <= 0 || transport.MaxIdleConns <= 0 ||
		transport.MaxIdleConnsPerHost <= 0 || transport.MaxConnsPerHost <= 0 ||
		transport.MaxResponseHeaderBytes <= 0 {
		t.Fatalf("client has an unbounded budget: timeout=%s transport=%#v", client.Timeout, transport)
	}
	if !transport.ForceAttemptHTTP2 || transport.TLSClientConfig == nil || transport.TLSClientConfig.MinVersion != tls.VersionTLS13 {
		t.Fatalf("client protocol baseline: http2=%t TLS=%#v", transport.ForceAttemptHTTP2, transport.TLSClientConfig)
	}
	if transport.TLSClientConfig == customTLS {
		t.Fatal("client retained the caller's mutable TLS config")
	}
}

func TestClientEnforcesResponseHeaderLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("X-Large", strings.Repeat("a", 4096))
		response.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	client, err := New(Config{MaxResponseHeaderBytes: 1024})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	response, err := client.Get(server.URL)
	if response != nil {
		response.Body.Close()
	}
	if err == nil {
		t.Fatal("client accepted response headers above its configured limit")
	}
}

func TestClientComposesRetryBreakerAndResponseBodyLimit(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		attempt := attempts.Add(1)
		if attempt == 1 {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if attempt == 2 {
			response.Header().Set("Content-Length", "6")
			_, _ = io.WriteString(response, "secret")
			return
		}
		_, _ = io.WriteString(response, "ok")
	}))
	t.Cleanup(server.Close)

	client, err := New(Config{
		TracerProvider:       provider,
		MaxResponseBodyBytes: 3,
		Retry:                RetryConfig{MaxAttempts: 2, InitialBackoff: time.Millisecond, MaxBackoff: time.Millisecond},
		CircuitBreaker:       CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Second},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	response, err := client.Get(server.URL)
	if response != nil {
		response.Body.Close()
	}
	if !errors.Is(err, ErrResponseBodyTooLarge) {
		t.Fatalf("Get() error = %v, want ErrResponseBodyTooLarge", err)
	}
	if attempts.Load() != 2 {
		t.Fatalf("attempts after retry/body limit = %d, want 2", attempts.Load())
	}
	if span := onlyEndedSpan(t, recorder); spanAttributes(span)["error.type"].AsString() != "response_body_too_large" {
		t.Fatalf("oversized response span attributes = %#v", spanAttributes(span))
	}

	// The response-body owner reports the terminal read boundary; a successful
	// logical HTTP response must not trip the client-level circuit breaker.
	response, err = client.Get(server.URL)
	if err != nil {
		t.Fatalf("second logical request error = %v, breaker incorrectly opened", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "ok" {
		t.Fatalf("second logical response = %q/%v, want ok", body, err)
	}
}

func TestClientNormalizesCustomMethodInSpan(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	client, err := New(Config{TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request, err := http.NewRequest("PRIVATE_METHOD", server.URL, http.NoBody)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	response.Body.Close()
	span := onlyEndedSpan(t, recorder)
	if span.Name() != "_OTHER outbound request" || spanAttributes(span)["http.request.method"].AsString() != "_OTHER" {
		t.Fatalf("custom method span = %q/%#v", span.Name(), spanAttributes(span))
	}
}

func TestClientSpanEndsWhenResponseBodyCloses(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
		response.(http.Flusher).Flush()
		close(started)
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	client, err := New(Config{TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	<-started
	if spans := recorder.Ended(); len(spans) != 0 {
		t.Fatalf("span ended before response body close: %d", len(spans))
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("response body close error = %v", err)
	}
	_ = onlyEndedSpan(t, recorder)
}

func TestClientRecordsTimeoutWithoutLeakingTransportError(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)

	client, err := New(Config{RequestTimeout: 40 * time.Millisecond, TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request, err := http.NewRequest(http.MethodGet, server.URL+"/secret-timeout", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	response, err := client.Do(request)
	if response != nil {
		response.Body.Close()
	}
	if err == nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Do() error = %v, want deadline exceeded", err)
	}
	select {
	case <-started:
	default:
		t.Fatal("timeout request never reached the server")
	}
	span := onlyEndedSpan(t, recorder)
	attributes := spanAttributes(span)
	if attributes["error.type"].AsString() != "timeout" || span.Status().Code != codes.Error {
		t.Fatalf("timeout span status/attributes = %#v/%#v", span.Status(), attributes)
	}
	if strings.Contains(span.Status().Description, "secret-timeout") {
		t.Fatalf("timeout span leaked request target: %q", span.Status().Description)
	}
}

func TestClientRecordsCallerCancellation(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)

	client, err := New(Config{TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, http.NoBody)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}
	result := make(chan error, 1)
	go func() {
		response, requestErr := client.Do(request)
		if response != nil {
			response.Body.Close()
		}
		result <- requestErr
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the server")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Do() error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled request did not return")
	}
	span := onlyEndedSpan(t, recorder)
	if attributes := spanAttributes(span); attributes["error.type"].AsString() != "canceled" {
		t.Fatalf("canceled span attributes = %#v", attributes)
	}
}

func TestNewRejectsUnboundedOrInconsistentConfiguration(t *testing.T) {
	for _, config := range []Config{
		{RequestTimeout: -time.Second},
		{ConnectTimeout: -time.Second},
		{MaxConnectionsPerHost: -1},
		{MaxResponseHeaderBytes: -1},
		{MaxResponseBodyBytes: -1},
		{TLSConfig: &tls.Config{MinVersion: tls.VersionTLS11}},
		{TLSConfig: &tls.Config{MaxVersion: tls.VersionTLS11}},
		{MaxIdleConnections: 2, MaxIdleConnectionsPerHost: 3},
		{MaxIdleConnections: 3, MaxIdleConnectionsPerHost: 2, MaxConnectionsPerHost: 1},
	} {
		if client, err := New(config); err == nil {
			client.CloseIdleConnections()
			t.Fatalf("New(%#v) error = nil", config)
		}
	}
}

func testTracerProvider(t *testing.T) (*tracetest.SpanRecorder, *sdktrace.TracerProvider) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	return recorder, provider
}

func onlyEndedSpan(t *testing.T, recorder *tracetest.SpanRecorder) sdktrace.ReadOnlySpan {
	t.Helper()
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	return spans[0]
}

func spanAttributes(span sdktrace.ReadOnlySpan) map[string]attribute.Value {
	result := make(map[string]attribute.Value)
	for _, item := range span.Attributes() {
		result[string(item.Key)] = item.Value
	}
	return result
}

type mutableHTTPDeadlineContext struct {
	context.Context
	deadline time.Time
}

func (ctx *mutableHTTPDeadlineContext) Deadline() (time.Time, bool) { return ctx.deadline, true }
func (*mutableHTTPDeadlineContext) Done() <-chan struct{}           { return nil }
func (*mutableHTTPDeadlineContext) Err() error                      { return nil }

type countingHTTPBody struct {
	io.Reader
	closes   atomic.Int32
	closeErr error
}

type testHTTPPropagator struct{}

type typedNilHTTPPropagator struct{}

type panicValueContext struct {
	context.Context
}

func (panicValueContext) Value(any) any {
	panic("custom propagator must not read span context")
}

func (*typedNilHTTPPropagator) Inject(context.Context, propagation.TextMapCarrier) {
	panic("typed-nil propagator must not be invoked")
}

func (*typedNilHTTPPropagator) Extract(context.Context, propagation.TextMapCarrier) context.Context {
	panic("typed-nil propagator must not be invoked")
}

func (*typedNilHTTPPropagator) Fields() []string {
	panic("typed-nil propagator must not be invoked")
}

func (testHTTPPropagator) Inject(_ context.Context, carrier propagation.TextMapCarrier) {
	carrier.Set("x-custom-trace", "injected")
}

func (testHTTPPropagator) Extract(ctx context.Context, _ propagation.TextMapCarrier) context.Context {
	return ctx
}

func (testHTTPPropagator) Fields() []string { return []string{"x-custom-trace"} }

func (body *countingHTTPBody) Close() error {
	body.closes.Add(1)
	return body.closeErr
}
