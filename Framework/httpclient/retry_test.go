package httpclient

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientRetriesReplayableSafeRequestWithinOneSpan(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	var attempts atomic.Int32
	var bodiesMu sync.Mutex
	var bodies []string
	var traceparents []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		bodiesMu.Lock()
		bodies = append(bodies, string(body))
		traceparents = append(traceparents, request.Header.Get("traceparent"))
		bodiesMu.Unlock()
		if attempts.Add(1) < 3 {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	client, err := New(Config{
		TracerProvider: provider,
		Retry: RetryConfig{
			MaxAttempts:    3,
			InitialBackoff: time.Millisecond,
			MaxBackoff:     2 * time.Millisecond,
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request, err := http.NewRequest(http.MethodGet, server.URL+"/private?token=secret", strings.NewReader("replayable"))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	if response.StatusCode != http.StatusNoContent {
		response.Body.Close()
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("attempts = %d, want 3", attempts.Load())
	}
	bodiesMu.Lock()
	defer bodiesMu.Unlock()
	if len(bodies) != 3 || bodies[0] != "replayable" || bodies[1] != "replayable" || bodies[2] != "replayable" {
		t.Fatalf("request bodies = %#v", bodies)
	}
	if len(traceparents) != 3 || traceparents[0] == "" || traceparents[1] != traceparents[0] || traceparents[2] != traceparents[0] {
		t.Fatalf("attempt traceparents = %#v", traceparents)
	}
	if request.Header.Get("traceparent") != "" {
		t.Fatalf("client mutated caller traceparent: %q", request.Header.Get("traceparent"))
	}
	span := onlyEndedSpan(t, recorder)
	if strings.Contains(span.Name(), "private") || strings.Contains(span.Name(), "secret") {
		t.Fatalf("retry span leaked request data: %q", span.Name())
	}
}

func TestClientDoesNotRetryUnsafeMethod(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		response.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	client := newRetryTestClient(t, RetryConfig{MaxAttempts: 3})

	response, err := client.Post(server.URL, "text/plain", strings.NewReader("write-once"))
	if err != nil {
		t.Fatalf("Post() error = %v", err)
	}
	response.Body.Close()
	if attempts.Load() != 1 {
		t.Fatalf("POST attempts = %d, want 1", attempts.Load())
	}
}

func TestClientDoesNotRetrySafeRequestWithNonReplayableBody(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		response.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	client := newRetryTestClient(t, RetryConfig{MaxAttempts: 3})
	request, err := http.NewRequest(http.MethodGet, server.URL, io.NopCloser(strings.NewReader("single-use")))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}

	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	response.Body.Close()
	if attempts.Load() != 1 {
		t.Fatalf("non-replayable GET attempts = %d, want 1", attempts.Load())
	}
}

func TestRetryTransportClosesIntermediateResponseAndStopsAtMaximum(t *testing.T) {
	var attempts int
	intermediate := &trackingReadCloser{Reader: strings.NewReader("do-not-drain")}
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts++
			if attempts == 1 {
				return &http.Response{StatusCode: http.StatusBadGateway, Body: intermediate}, nil
			}
			return nil, errors.New("private transport failure")
		}),
		config: withRetryDefaults(RetryConfig{MaxAttempts: 3}),
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody)

	response, err := transport.RoundTrip(request)
	if response != nil || err == nil {
		t.Fatalf("RoundTrip() response/error = %#v/%v, want final error", response, err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
	if !intermediate.closed || intermediate.reads != 0 {
		t.Fatalf("intermediate body closed/reads = %t/%d, want true/0", intermediate.closed, intermediate.reads)
	}
}

func TestRetryTransportCancellationInterruptsBackoff(t *testing.T) {
	started := make(chan struct{})
	var attempts atomic.Int32
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			if attempts.Add(1) == 1 {
				close(started)
			}
			return nil, errors.New("temporary private failure")
		}),
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: time.Second},
	}
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://example.test", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}
	result := make(chan error, 1)
	go func() {
		_, requestErr := transport.RoundTrip(request)
		result <- requestErr
	}()
	<-started
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("RoundTrip() error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not interrupt retry backoff")
	}
	if attempts.Load() != 1 {
		t.Fatalf("attempts = %d, want 1", attempts.Load())
	}
}

func TestRetryTransportKeepsResponseWhenBackoffCannotFitDeadline(t *testing.T) {
	body := &trackingReadCloser{Reader: strings.NewReader("busy")}
	var attempts int
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: body}, nil
		}),
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://example.test", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}

	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("RoundTrip() response/error = %#v/%v", response, err)
	}
	if attempts != 1 || body.closed {
		t.Fatalf("attempts/body closed = %d/%t, want 1/false", attempts, body.closed)
	}
	response.Body.Close()
}

func TestRetryBreakerCompositionHonorsCallerDeadlineAndFailureOwnership(t *testing.T) {
	var attempts atomic.Int32
	intermediate := &trackingReadCloser{Reader: strings.NewReader("busy")}
	base := roundTripFunc(func(*http.Request) (*http.Response, error) {
		if attempts.Add(1) == 1 {
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: intermediate}, nil
		}
		return nil, errors.New("unexpected second attempt")
	})
	retry := retryTransport{
		base: base,
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: time.Second},
	}
	breaker := newCircuitBreakerTransport(
		retry,
		CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Minute},
	)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody).WithContext(ctx)

	response, err := breaker.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("first response/error = %#v/%v, want final 503 response", response, err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("attempts = %d, want one attempt because caller deadline cannot fit backoff", attempts.Load())
	}
	if intermediate.closed {
		t.Fatal("final response body was closed by retry layer")
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("final response Close() error = %v", err)
	}

	response, err = breaker.RoundTrip(request)
	if response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("post-failure response/error = %#v/%v, want circuit-open rejection", response, err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("attempts after circuit rejection = %d, want one", attempts.Load())
	}
}

func TestRetryTransportReturnsBoundedBodyReplayError(t *testing.T) {
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("retryable failure")
		}),
		config: withRetryDefaults(RetryConfig{MaxAttempts: 2}),
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.test", strings.NewReader("secret-body"))
	request.GetBody = func() (io.ReadCloser, error) {
		return nil, errors.New("secret-body")
	}

	_, err := transport.RoundTrip(request)
	if !errors.Is(err, errRequestBodyReplay) || strings.Contains(err.Error(), "secret-body") {
		t.Fatalf("RoundTrip() replay error = %v", err)
	}
}

func TestRetryBackoffIsExponentialAndBounded(t *testing.T) {
	config := RetryConfig{InitialBackoff: 10 * time.Millisecond, MaxBackoff: 25 * time.Millisecond}
	for retry, want := range []time.Duration{10 * time.Millisecond, 20 * time.Millisecond, 25 * time.Millisecond, 25 * time.Millisecond} {
		if got := retryBackoff(config, retry+1); got != want {
			t.Fatalf("retryBackoff(%d) = %s, want %s", retry+1, got, want)
		}
	}
}

func TestRetryPolicyUsesOnlySafeMethodsAndTransientStatuses(t *testing.T) {
	for method, want := range map[string]bool{
		"": true, http.MethodGet: true, http.MethodHead: true,
		http.MethodOptions: true, http.MethodTrace: true,
		http.MethodPost: false, http.MethodPut: false, http.MethodPatch: false,
		http.MethodDelete: false, http.MethodConnect: false,
	} {
		if got := safeRetryMethod(method); got != want {
			t.Fatalf("safeRetryMethod(%q) = %t, want %t", method, got, want)
		}
	}
	for status, want := range map[int]bool{
		http.StatusRequestTimeout:      true,
		http.StatusTooEarly:            true,
		http.StatusTooManyRequests:     true,
		http.StatusBadGateway:          true,
		http.StatusServiceUnavailable:  true,
		http.StatusGatewayTimeout:      true,
		http.StatusInternalServerError: false,
		http.StatusNotImplemented:      false,
		http.StatusOK:                  false,
	} {
		response := &http.Response{StatusCode: status, Body: http.NoBody}
		if got := retryableResult(context.Background(), response, nil); got != want {
			t.Fatalf("retryableResult(status=%d) = %t, want %t", status, got, want)
		}
	}
}

func TestNewRejectsInvalidRetryConfiguration(t *testing.T) {
	for _, retry := range []RetryConfig{
		{InitialBackoff: time.Millisecond},
		{MaxAttempts: -1},
		{MaxAttempts: 1},
		{MaxAttempts: 6},
		{MaxAttempts: 2, InitialBackoff: -time.Second},
		{MaxAttempts: 2, InitialBackoff: time.Second, MaxBackoff: time.Millisecond},
		{MaxAttempts: 2, MaxBackoff: maximumRetryBackoff + time.Nanosecond},
	} {
		if client, err := New(Config{Retry: retry}); err == nil {
			client.CloseIdleConnections()
			t.Fatalf("New(Retry=%#v) error = nil", retry)
		}
	}
}

func newRetryTestClient(t *testing.T, retry RetryConfig) *http.Client {
	t.Helper()
	if retry.InitialBackoff == 0 {
		retry.InitialBackoff = time.Millisecond
	}
	if retry.MaxBackoff == 0 {
		retry.MaxBackoff = 2 * time.Millisecond
	}
	client, err := New(Config{Retry: retry})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(client.CloseIdleConnections)
	return client
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}
