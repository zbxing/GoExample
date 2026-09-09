package httpclient

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
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
				return &http.Response{StatusCode: http.StatusBadGateway, Body: intermediate, ContentLength: -1}, nil
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

func TestRetryTransportDrainsSmallResponseAndReusesHTTP1Connection(t *testing.T) {
	const retryBody = `{"retry":true}`
	var attempts atomic.Int32
	var connections atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) == 1 {
			response.Header().Set("Content-Length", strconv.Itoa(len(retryBody)))
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(response, retryBody)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	server.Start()
	t.Cleanup(server.Close)

	client := newRetryTestClient(t, RetryConfig{
		MaxAttempts:    2,
		InitialBackoff: time.Millisecond,
		MaxBackoff:     time.Millisecond,
	})
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if response.StatusCode != http.StatusNoContent || response.ProtoMajor != 1 {
		response.Body.Close()
		t.Fatalf("final status/protocol = %d/HTTP/%d, want %d/HTTP/1", response.StatusCode, response.ProtoMajor, http.StatusNoContent)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if attempts.Load() != 2 || connections.Load() != 1 {
		t.Fatalf("attempts/connections = %d/%d, want 2/1", attempts.Load(), connections.Load())
	}
}

func TestCloseRetryResponseBoundsDrainByDeclaredLength(t *testing.T) {
	tests := []struct {
		name          string
		contentLength int64
		body          string
		wantBytes     int
		wantReads     bool
	}{
		{name: "small known", contentLength: 4, body: "data", wantBytes: 4, wantReads: true},
		{name: "unknown", contentLength: -1, body: "data", wantBytes: 0},
		{name: "over budget", contentLength: maximumRetryResponseDrainBytes + 1, body: "data", wantBytes: 0},
		{name: "underreported", contentLength: 4, body: "data-after-bound", wantBytes: 5, wantReads: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := &countingRetryReadCloser{Reader: strings.NewReader(test.body)}
			closeRetryResponse(&http.Response{Body: body, ContentLength: test.contentLength})
			if !body.closed || body.bytes != test.wantBytes || (body.reads > 0) != test.wantReads {
				t.Fatalf("closed/bytes/read = %t/%d/%t, want true/%d/%t", body.closed, body.bytes, body.reads > 0, test.wantBytes, test.wantReads)
			}
		})
	}
	closeRetryResponse(nil)
	closeRetryResponse(&http.Response{})
}

func TestCloseRetryResponseClosesAfterReadFailure(t *testing.T) {
	body := &failingRetryReadCloser{}
	closeRetryResponse(&http.Response{Body: body, ContentLength: 1})
	if body.reads != 1 || !body.closed {
		t.Fatalf("reads/closed = %d/%t, want 1/true", body.reads, body.closed)
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

func TestRetryTransportRejectsLateNilResultsWithoutRetryOrJitter(t *testing.T) {
	t.Run("canceled", func(t *testing.T) {
		var attempts atomic.Int32
		var samples atomic.Int32
		responseBody := &countingHTTPBody{Reader: strings.NewReader("private response")}
		ctx, cancel := context.WithCancel(context.Background())
		transport := retryTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				attempts.Add(1)
				cancel()
				return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: responseBody}, nil
			}),
			config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: time.Second},
			randomInt64N: func(int64) int64 {
				samples.Add(1)
				return 0
			},
		}
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody).WithContext(ctx)

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/context.Canceled", response, err)
		}
		if attempts.Load() != 1 || samples.Load() != 0 || responseBody.closes.Load() != 1 {
			t.Fatalf("attempts/samples/closes = %d/%d/%d, want 1/0/1", attempts.Load(), samples.Load(), responseBody.closes.Load())
		}
	})

	t.Run("elapsed deadline", func(t *testing.T) {
		var attempts atomic.Int32
		var samples atomic.Int32
		responseBody := &countingHTTPBody{Reader: strings.NewReader("private response")}
		ctx := &mutableHTTPDeadlineContext{Context: context.Background(), deadline: time.Now().Add(time.Hour)}
		transport := retryTransport{
			base: roundTripFunc(func(*http.Request) (*http.Response, error) {
				attempts.Add(1)
				ctx.deadline = time.Now().Add(-time.Second)
				return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: responseBody}, nil
			}),
			config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: time.Second},
			randomInt64N: func(int64) int64 {
				samples.Add(1)
				return 0
			},
		}
		request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody).WithContext(ctx)

		response, err := transport.RoundTrip(request)
		if response != nil || !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("RoundTrip() response/error = %#v/%v, want nil/context.DeadlineExceeded", response, err)
		}
		if attempts.Load() != 1 || samples.Load() != 0 || responseBody.closes.Load() != 1 {
			t.Fatalf("attempts/samples/closes = %d/%d/%d, want 1/0/1", attempts.Load(), samples.Load(), responseBody.closes.Load())
		}
	})
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

func TestRetryTransportKeepsResponseWhenRetryAfterExceedsLocalBudget(t *testing.T) {
	body := &trackingReadCloser{Reader: strings.NewReader("busy")}
	var attempts int
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Header:     http.Header{"Retry-After": []string{"6"}},
				Body:       body,
			}, nil
		}),
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Millisecond, MaxBackoff: maximumRetryBackoff},
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)

	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("RoundTrip() response/error = %#v/%v", response, err)
	}
	if attempts != 1 || body.closed {
		t.Fatalf("attempts/body closed = %d/%t, want 1/false", attempts, body.closed)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestRetryTransportKeepsResponseWhenRetryAfterCannotFitDeadline(t *testing.T) {
	body := &trackingReadCloser{Reader: strings.NewReader("busy")}
	var attempts int
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{
				StatusCode: http.StatusTooManyRequests,
				Header:     http.Header{"Retry-After": []string{"1"}},
				Body:       body,
			}, nil
		}),
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Millisecond, MaxBackoff: 2 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody).WithContext(ctx)

	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("RoundTrip() response/error = %#v/%v", response, err)
	}
	if attempts != 1 || body.closed {
		t.Fatalf("attempts/body closed = %d/%t, want 1/false", attempts, body.closed)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestRetryTransportKeepsResponseWhenJitterCannotFitDeadline(t *testing.T) {
	body := &trackingReadCloser{Reader: strings.NewReader("busy")}
	var attempts int
	var samples int
	transport := retryTransport{
		base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: body}, nil
		}),
		config: RetryConfig{MaxAttempts: 3, InitialBackoff: time.Second, MaxBackoff: 2 * time.Second},
		randomInt64N: func(limit int64) int64 {
			samples++
			return limit - 1
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1250*time.Millisecond)
	defer cancel()
	if !retryDelayFits(ctx, transport.config.InitialBackoff) {
		t.Fatal("base retry delay should fit the caller deadline")
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody).WithContext(ctx)

	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("RoundTrip() response/error = %#v/%v", response, err)
	}
	if attempts != 1 || samples != 1 || body.closed {
		t.Fatalf("attempts/samples/body closed = %d/%d/%t, want 1/1/false", attempts, samples, body.closed)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
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
		base:   base,
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

func TestRetryJitterUsesInclusivePositiveWindow(t *testing.T) {
	const delay = 100 * time.Millisecond
	const maximum = time.Second

	if got := retryJitter(delay, maximum, func(limit int64) int64 {
		if want := int64(delay/2) + 1; limit != want {
			t.Fatalf("random limit = %d, want %d", limit, want)
		}
		return 0
	}); got != delay {
		t.Fatalf("lower-bound retryJitter() = %s, want %s", got, delay)
	}

	want := delay + delay/2
	if got := retryJitter(delay, maximum, func(limit int64) int64 {
		return limit - 1
	}); got != want {
		t.Fatalf("upper-bound retryJitter() = %s, want %s", got, want)
	}
}

func TestRetryJitterTruncatesWindowAtMaximumBackoff(t *testing.T) {
	const delay = 90 * time.Millisecond
	const maximum = 100 * time.Millisecond
	wantLimit := int64(maximum-delay) + 1

	got := retryJitter(delay, maximum, func(limit int64) int64 {
		if limit != wantLimit {
			t.Fatalf("random limit = %d, want %d", limit, wantLimit)
		}
		return limit - 1
	})
	if got != maximum {
		t.Fatalf("retryJitter() = %s, want %s", got, maximum)
	}
}

func TestRetryJitterSkipsSamplingWithoutWindow(t *testing.T) {
	sample := func(int64) int64 {
		t.Fatal("random source called without an available jitter window")
		return 0
	}
	for _, test := range []struct {
		name    string
		delay   time.Duration
		maximum time.Duration
	}{
		{name: "at maximum", delay: time.Second, maximum: time.Second},
		{name: "sub-nanosecond half window", delay: time.Nanosecond, maximum: time.Second},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := retryJitter(test.delay, test.maximum, sample); got != test.delay {
				t.Fatalf("retryJitter() = %s, want %s", got, test.delay)
			}
		})
	}
}

func TestRetryDelayHonorsValidRetryAfterWithinLocalBudget(t *testing.T) {
	now := time.Date(2026, time.September, 6, 0, 0, 0, 0, time.UTC)
	config := RetryConfig{InitialBackoff: 100 * time.Millisecond, MaxBackoff: maximumRetryBackoff}
	tests := []struct {
		name    string
		value   string
		want    time.Duration
		allowed bool
	}{
		{name: "missing", want: 100 * time.Millisecond, allowed: true},
		{name: "malformed", value: "private-invalid", want: 100 * time.Millisecond, allowed: true},
		{name: "zero", value: "0", want: 100 * time.Millisecond, allowed: true},
		{name: "seconds", value: "2", want: 2 * time.Second, allowed: true},
		{name: "future date", value: now.Add(3 * time.Second).Format(http.TimeFormat), want: 3 * time.Second, allowed: true},
		{name: "past date", value: now.Add(-time.Minute).Format(http.TimeFormat), want: 100 * time.Millisecond, allowed: true},
		{name: "over local budget", value: "6", allowed: false},
		{name: "overflow", value: strings.Repeat("9", 30), allowed: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := &http.Response{Header: make(http.Header)}
			if test.value != "" {
				response.Header.Set("Retry-After", test.value)
			}
			got, allowed := retryDelay(config, 1, response, now)
			if got != test.want || allowed != test.allowed {
				t.Fatalf("retryDelay() = %s/%t, want %s/%t", got, allowed, test.want, test.allowed)
			}
		})
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

type countingRetryReadCloser struct {
	io.Reader
	reads  int
	bytes  int
	closed bool
}

func (body *countingRetryReadCloser) Read(buffer []byte) (int, error) {
	body.reads++
	read, err := body.Reader.Read(buffer)
	body.bytes += read
	return read, err
}

func (body *countingRetryReadCloser) Close() error {
	body.closed = true
	return nil
}

type failingRetryReadCloser struct {
	reads  int
	closed bool
}

func (body *failingRetryReadCloser) Read([]byte) (int, error) {
	body.reads++
	return 0, errors.New("private retry response read failure")
}

func (body *failingRetryReadCloser) Close() error {
	body.closed = true
	return nil
}
