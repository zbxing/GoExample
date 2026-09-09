package httpclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel/propagation"
)

func TestCircuitBreakerOpensFastAndSuccessfulProbeCloses(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	var calls atomic.Int32
	transport := newCircuitBreakerTransport(
		roundTripFunc(func(*http.Request) (*http.Response, error) {
			if calls.Add(1) <= 2 {
				return circuitTestResponse(http.StatusServiceUnavailable), nil
			}
			return circuitTestResponse(http.StatusNoContent), nil
		}),
		CircuitBreakerConfig{FailureThreshold: 2, OpenTimeout: time.Second},
	)
	transport.breaker.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody)

	for attempt := 0; attempt < 2; attempt++ {
		response, err := transport.RoundTrip(request)
		if err != nil || response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("failure %d response/error = %#v/%v", attempt+1, response, err)
		}
		response.Body.Close()
	}
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("open circuit transport calls = %d, want 2", calls.Load())
	}

	now = now.Add(time.Second)
	response, err := transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusNoContent {
		t.Fatalf("probe response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	response, err = transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusNoContent {
		t.Fatalf("closed response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	if calls.Load() != 4 {
		t.Fatalf("closed circuit transport calls = %d, want 4", calls.Load())
	}
}

func TestCircuitBreakerAllowsOnlyOneHalfOpenProbe(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	probeStarted := make(chan struct{})
	releaseProbe := make(chan struct{})
	var calls atomic.Int32
	var observedProbeStarts atomic.Int32
	transport := newCircuitBreakerTransport(
		roundTripFunc(func(*http.Request) (*http.Response, error) {
			switch calls.Add(1) {
			case 1:
				return circuitTestResponse(http.StatusServiceUnavailable), nil
			case 2:
				close(probeStarted)
				<-releaseProbe
			}
			return circuitTestResponse(http.StatusNoContent), nil
		}),
		CircuitBreakerConfig{
			FailureThreshold: 1,
			OpenTimeout:      time.Second,
			Observer: func(observation CircuitBreakerObservation) {
				if observation.Event == circuitBreakerEventProbeStarted {
					observedProbeStarts.Add(1)
				}
			},
		},
	)
	transport.breaker.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("initial RoundTrip() error = %v", err)
	}
	response.Body.Close()
	now = now.Add(time.Second)

	probeResult := make(chan error, 1)
	go func() {
		response, err := transport.RoundTrip(request)
		if response != nil {
			_ = response.Body.Close()
		}
		probeResult <- err
	}()
	select {
	case <-probeStarted:
	case <-time.After(time.Second):
		t.Fatal("half-open probe did not start")
	}
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("concurrent probe response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}
	close(releaseProbe)
	if err := <-probeResult; err != nil {
		t.Fatalf("half-open probe error = %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("transport calls = %d, want 2", calls.Load())
	}
	if observedProbeStarts.Load() != 1 {
		t.Fatalf("probe_started observations = %d, want 1", observedProbeStarts.Load())
	}
}

func TestCircuitBreakerIgnoresStaleInFlightSuccessAfterOpening(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	slowStarted := make(chan struct{})
	releaseSlow := make(chan struct{})
	var calls atomic.Int32
	observer := &recordingCircuitBreakerObserver{}
	transport := newCircuitBreakerTransport(
		roundTripFunc(func(request *http.Request) (*http.Response, error) {
			calls.Add(1)
			if request.Header.Get("X-Test-Slow") == "true" {
				close(slowStarted)
				<-releaseSlow
				return circuitTestResponse(http.StatusNoContent), nil
			}
			return circuitTestResponse(http.StatusServiceUnavailable), nil
		}),
		CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Minute, Observer: observer.observe},
	)
	transport.breaker.now = func() time.Time { return now }
	slowRequest := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)
	slowRequest.Header.Set("X-Test-Slow", "true")
	slowResult := make(chan error, 1)
	go func() {
		response, err := transport.RoundTrip(slowRequest)
		if response != nil {
			_ = response.Body.Close()
		}
		slowResult <- err
	}()
	<-slowStarted

	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("opening RoundTrip() error = %v", err)
	}
	response.Body.Close()
	close(releaseSlow)
	if err := <-slowResult; err != nil {
		t.Fatalf("stale RoundTrip() error = %v", err)
	}
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("post-stale response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("transport calls = %d, want 2", calls.Load())
	}
	want := []CircuitBreakerObservation{
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventOpened},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventRejected},
	}
	if got := observer.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("observations = %#v, want %#v", got, want)
	}
}

func TestCircuitBreakerObserverReportsFixedSequence(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	var calls atomic.Int32
	observer := &recordingCircuitBreakerObserver{}
	transport := newCircuitBreakerTransport(
		roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if err := request.Context().Err(); err != nil {
				return nil, err
			}
			switch calls.Add(1) {
			case 1, 2:
				return circuitTestResponse(http.StatusServiceUnavailable), nil
			default:
				return circuitTestResponse(http.StatusNoContent), nil
			}
		}),
		CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Second, Observer: observer.observe},
	)
	transport.breaker.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodGet, "https://example.test/private?token=secret", http.NoBody)

	response, err := transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("opening response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}

	now = now.Add(time.Second)
	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()
	canceledRequest := request.WithContext(canceledContext)
	if response, err := transport.RoundTrip(canceledRequest); response != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled probe response/error = %#v/%v", response, err)
	}

	response, err = transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("failed probe response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("reopened response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}

	now = now.Add(time.Second)
	response, err = transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusNoContent {
		t.Fatalf("successful probe response/error = %#v/%v", response, err)
	}
	response.Body.Close()

	want := []CircuitBreakerObservation{
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventOpened},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventRejected},
		{State: circuitBreakerStateHalfOpen, Event: circuitBreakerEventProbeStarted},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventProbeFailed},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventRejected},
		{State: circuitBreakerStateHalfOpen, Event: circuitBreakerEventProbeStarted},
		{State: circuitBreakerStateClosed, Event: circuitBreakerEventProbeSucceeded},
	}
	if got := observer.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("observations = %#v, want %#v", got, want)
	}
	observationType := reflect.TypeOf(CircuitBreakerObservation{})
	if observationType.NumField() != 2 || observationType.Field(0).Name != "State" || observationType.Field(1).Name != "Event" {
		t.Fatalf("CircuitBreakerObservation fields = %#v, want only State and Event", observationType)
	}
	for _, observation := range observer.snapshot() {
		if !validCircuitBreakerObservation(observation) {
			t.Fatalf("observation contains a non-fixed state/event = %#v", observation)
		}
	}
}

func TestCircuitBreakerObserverPanicIsIsolatedAndRunsOutsideStateLock(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	var calls atomic.Int32
	var transport *circuitBreakerTransport
	transport = newCircuitBreakerTransport(
		roundTripFunc(func(*http.Request) (*http.Response, error) {
			if calls.Add(1) == 1 {
				return circuitTestResponse(http.StatusServiceUnavailable), nil
			}
			return circuitTestResponse(http.StatusNoContent), nil
		}),
		CircuitBreakerConfig{
			FailureThreshold: 1,
			OpenTimeout:      time.Second,
			Observer: func(CircuitBreakerObservation) {
				transport.breaker.mu.Lock()
				transport.breaker.mu.Unlock()
				panic("private observer detail")
			},
		},
	)
	transport.breaker.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)

	response, err := transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("opening response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	now = now.Add(time.Second)
	for attempt := 0; attempt < 2; attempt++ {
		response, err = transport.RoundTrip(request)
		if err != nil || response.StatusCode != http.StatusNoContent {
			t.Fatalf("success %d response/error = %#v/%v", attempt+1, response, err)
		}
		response.Body.Close()
	}
	if calls.Load() != 3 {
		t.Fatalf("transport calls = %d, want 3", calls.Load())
	}
}

func TestCircuitBreakerCountsLogicalRetryResultAndIgnoresCallerCancellation(t *testing.T) {
	var calls atomic.Int32
	base := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		call := calls.Add(1)
		if err := request.Context().Err(); err != nil {
			return nil, err
		}
		switch call {
		case 2:
			return circuitTestResponse(http.StatusNotFound), nil
		case 1, 3, 4:
			return circuitTestResponse(http.StatusServiceUnavailable), nil
		default:
			return circuitTestResponse(http.StatusNoContent), nil
		}
	})
	retry := retryTransport{
		base: base,
		config: RetryConfig{
			MaxAttempts:    2,
			InitialBackoff: time.Nanosecond,
			MaxBackoff:     time.Nanosecond,
		},
	}
	transport := newCircuitBreakerTransport(retry, CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Minute})

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	canceledRequest := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody).WithContext(canceled)
	if response, err := transport.RoundTrip(canceledRequest); response != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled response/error = %#v/%v", response, err)
	}

	request := httptest.NewRequest(http.MethodGet, "https://example.test", http.NoBody)
	response, err := transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusNotFound {
		t.Fatalf("non-failure response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	response, err = transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("logical failure response/error = %#v/%v", response, err)
	}
	response.Body.Close()
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}
	if calls.Load() != 4 {
		t.Fatalf("underlying attempts = %d, want 4", calls.Load())
	}
}

func TestCircuitBreakerRejectsCompletedRequestsWithoutPollutingState(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	var calls atomic.Int32
	observer := &recordingCircuitBreakerObserver{}
	lateBody := &countingHTTPBody{}
	deadlineContext := &mutableHTTPDeadlineContext{Context: context.Background(), deadline: time.Now().Add(time.Hour)}
	transport := newCircuitBreakerTransport(
		roundTripFunc(func(*http.Request) (*http.Response, error) {
			switch calls.Add(1) {
			case 1:
				return circuitTestResponse(http.StatusServiceUnavailable), nil
			case 2:
				deadlineContext.deadline = time.Now().Add(-time.Second)
				return &http.Response{StatusCode: http.StatusNoContent, Body: lateBody}, nil
			default:
				return circuitTestResponse(http.StatusNoContent), nil
			}
		}),
		CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Second, Observer: observer.observe},
	)
	transport.breaker.now = func() time.Time { return now }

	request := httptest.NewRequest(http.MethodGet, "https://example.test/private", http.NoBody)
	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("opening response/error = %#v/%v", response, err)
	}
	response.Body.Close()

	requestBody := &countingHTTPBody{}
	rejected := httptest.NewRequest(http.MethodPost, "https://example.test/private", requestBody)
	if response, err := transport.RoundTrip(rejected); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}
	if requestBody.closes.Load() != 1 {
		t.Fatalf("open rejection request closes = %d, want 1", requestBody.closes.Load())
	}

	now = now.Add(time.Second)
	probe := request.WithContext(deadlineContext)
	if response, err := transport.RoundTrip(probe); response != nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed probe response/error = %#v/%v, want context.DeadlineExceeded", response, err)
	}
	if lateBody.closes.Load() != 1 {
		t.Fatalf("elapsed probe response closes = %d, want 1", lateBody.closes.Load())
	}
	if transport.breaker.openedAt.IsZero() || transport.breaker.failures != transport.breaker.config.FailureThreshold {
		t.Fatalf("elapsed probe changed open state: openedAt=%s failures=%d", transport.breaker.openedAt, transport.breaker.failures)
	}
	want := []CircuitBreakerObservation{
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventOpened},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventRejected},
		{State: circuitBreakerStateHalfOpen, Event: circuitBreakerEventProbeStarted},
		{State: circuitBreakerStateOpen, Event: circuitBreakerEventProbeCanceled},
	}
	if got := observer.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("observations = %#v, want %#v", got, want)
	}
}

func TestCircuitBreakerTracingUsesFixedOpenClassification(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	breaker := newCircuitBreakerTransport(
		roundTripFunc(func(*http.Request) (*http.Response, error) {
			return circuitTestResponse(http.StatusServiceUnavailable), nil
		}),
		CircuitBreakerConfig{FailureThreshold: 1, OpenTimeout: time.Minute},
	)
	transport := tracingTransport{
		base:       breaker,
		tracer:     provider.Tracer(instrumentationName),
		propagator: propagation.TraceContext{},
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.test/private?token=secret", http.NoBody)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("initial RoundTrip() error = %v", err)
	}
	response.Body.Close()
	if response, err := transport.RoundTrip(request); response != nil || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open response/error = %#v/%v, want ErrCircuitOpen", response, err)
	}

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans = %d, want 2", len(spans))
	}
	attributes := spanAttributes(spans[1])
	if got := attributes["error.type"].AsString(); got != "circuit_open" {
		t.Fatalf("open error.type = %q, want circuit_open", got)
	}
}

func TestNewValidatesAndDefaultsCircuitBreakerConfiguration(t *testing.T) {
	client, err := New(Config{CircuitBreaker: CircuitBreakerConfig{FailureThreshold: 3}})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	tracing := client.Transport.(tracingTransport)
	transport := tracing.base.(*circuitBreakerTransport)
	if transport.breaker.config.OpenTimeout != defaultCircuitOpenTimeout {
		t.Fatalf("default open timeout = %s, want %s", transport.breaker.config.OpenTimeout, defaultCircuitOpenTimeout)
	}
	client.CloseIdleConnections()

	for _, config := range []CircuitBreakerConfig{
		{FailureThreshold: -1},
		{FailureThreshold: maximumFailureThreshold + 1},
		{OpenTimeout: time.Second},
		{Observer: func(CircuitBreakerObservation) {}},
		{FailureThreshold: 1, OpenTimeout: -time.Second},
		{FailureThreshold: 1, OpenTimeout: maximumCircuitOpenTimeout + time.Nanosecond},
	} {
		if client, err := New(Config{CircuitBreaker: config}); err == nil {
			client.CloseIdleConnections()
			t.Fatalf("New(%#v) error = nil", config)
		}
	}
}

func circuitTestResponse(status int) *http.Response {
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

type recordingCircuitBreakerObserver struct {
	mu           sync.Mutex
	observations []CircuitBreakerObservation
}

func (observer *recordingCircuitBreakerObserver) observe(observation CircuitBreakerObservation) {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.observations = append(observer.observations, observation)
}

func (observer *recordingCircuitBreakerObserver) snapshot() []CircuitBreakerObservation {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	return append([]CircuitBreakerObservation(nil), observer.observations...)
}

func validCircuitBreakerObservation(observation CircuitBreakerObservation) bool {
	switch observation {
	case CircuitBreakerObservation{State: circuitBreakerStateOpen, Event: circuitBreakerEventOpened},
		CircuitBreakerObservation{State: circuitBreakerStateOpen, Event: circuitBreakerEventRejected},
		CircuitBreakerObservation{State: circuitBreakerStateHalfOpen, Event: circuitBreakerEventProbeStarted},
		CircuitBreakerObservation{State: circuitBreakerStateClosed, Event: circuitBreakerEventProbeSucceeded},
		CircuitBreakerObservation{State: circuitBreakerStateOpen, Event: circuitBreakerEventProbeFailed},
		CircuitBreakerObservation{State: circuitBreakerStateOpen, Event: circuitBreakerEventProbeCanceled}:
		return true
	default:
		return false
	}
}
