package httpclient

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

const (
	defaultCircuitOpenTimeout = 30 * time.Second
	maximumCircuitOpenTimeout = 5 * time.Minute
	maximumFailureThreshold   = 100

	circuitBreakerStateClosed   = "closed"
	circuitBreakerStateOpen     = "open"
	circuitBreakerStateHalfOpen = "half_open"

	circuitBreakerEventOpened         = "opened"
	circuitBreakerEventRejected       = "rejected"
	circuitBreakerEventProbeStarted   = "probe_started"
	circuitBreakerEventProbeSucceeded = "probe_succeeded"
	circuitBreakerEventProbeFailed    = "probe_failed"
	circuitBreakerEventProbeCanceled  = "probe_canceled"
)

// ErrCircuitOpen reports that an enabled outbound HTTP circuit breaker
// rejected a logical request without calling its underlying transport.
var ErrCircuitOpen = errors.New("outbound HTTP circuit breaker is open")

// CircuitBreakerObservation reports one fixed, low-cardinality breaker event.
// State is closed, open, or half_open. Event is opened, rejected,
// probe_started, probe_succeeded, probe_failed, or probe_canceled. It never
// contains request, destination, or backend error details.
type CircuitBreakerObservation struct {
	State string
	Event string
}

// CircuitBreakerObserver receives breaker observations synchronously and must
// return promptly. Panics are isolated from request and breaker behavior.
type CircuitBreakerObserver func(CircuitBreakerObservation)

// CircuitBreakerConfig defines a client-wide failure domain. A zero
// FailureThreshold disables the breaker. Callers should create separate
// clients for independent downstream services.
type CircuitBreakerConfig struct {
	FailureThreshold int
	OpenTimeout      time.Duration
	Observer         CircuitBreakerObserver
}

type circuitBreakerTransport struct {
	base    http.RoundTripper
	breaker *circuitBreaker
}

type circuitBreaker struct {
	config CircuitBreakerConfig
	now    func() time.Time

	mu            sync.Mutex
	failures      int
	openedAt      time.Time
	probeInFlight bool
	generation    uint64
}

type circuitPermit struct {
	generation uint64
	probe      bool
}

func newCircuitBreakerTransport(base http.RoundTripper, config CircuitBreakerConfig) *circuitBreakerTransport {
	return &circuitBreakerTransport{
		base: base,
		breaker: &circuitBreaker{
			config: config,
			now:    time.Now,
		},
	}
}

func (transport *circuitBreakerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil {
		return transport.base.RoundTrip(request)
	}
	permit, allowed, observation := transport.breaker.allow()
	transport.breaker.observe(observation)
	if !allowed {
		return nil, ErrCircuitOpen
	}
	response, err := transport.base.RoundTrip(request)
	transport.breaker.observe(transport.breaker.record(permit, request.Context(), response, err))
	return response, err
}

func (breaker *circuitBreaker) allow() (circuitPermit, bool, CircuitBreakerObservation) {
	breaker.mu.Lock()
	defer breaker.mu.Unlock()

	permit := circuitPermit{generation: breaker.generation}
	if breaker.openedAt.IsZero() {
		return permit, true, CircuitBreakerObservation{}
	}
	if breaker.now().Before(breaker.openedAt.Add(breaker.config.OpenTimeout)) || breaker.probeInFlight {
		return circuitPermit{}, false, CircuitBreakerObservation{
			State: circuitBreakerStateOpen,
			Event: circuitBreakerEventRejected,
		}
	}
	breaker.probeInFlight = true
	permit.probe = true
	return permit, true, CircuitBreakerObservation{
		State: circuitBreakerStateHalfOpen,
		Event: circuitBreakerEventProbeStarted,
	}
}

func (breaker *circuitBreaker) record(permit circuitPermit, ctx context.Context, response *http.Response, err error) CircuitBreakerObservation {
	failure, relevant := circuitBreakerResult(ctx, response, err)

	breaker.mu.Lock()
	defer breaker.mu.Unlock()
	if permit.generation != breaker.generation {
		return CircuitBreakerObservation{}
	}
	if permit.probe {
		breaker.probeInFlight = false
		if !relevant {
			if ctx.Err() != nil {
				return CircuitBreakerObservation{
					State: circuitBreakerStateOpen,
					Event: circuitBreakerEventProbeCanceled,
				}
			}
			return CircuitBreakerObservation{}
		}
		breaker.generation++
		if failure {
			breaker.failures = breaker.config.FailureThreshold
			breaker.openedAt = breaker.now()
			return CircuitBreakerObservation{
				State: circuitBreakerStateOpen,
				Event: circuitBreakerEventProbeFailed,
			}
		}
		breaker.failures = 0
		breaker.openedAt = time.Time{}
		return CircuitBreakerObservation{
			State: circuitBreakerStateClosed,
			Event: circuitBreakerEventProbeSucceeded,
		}
	}
	if !relevant {
		return CircuitBreakerObservation{}
	}
	if !failure {
		breaker.failures = 0
		return CircuitBreakerObservation{}
	}
	breaker.failures++
	if breaker.failures < breaker.config.FailureThreshold {
		return CircuitBreakerObservation{}
	}
	breaker.failures = breaker.config.FailureThreshold
	breaker.openedAt = breaker.now()
	breaker.generation++
	return CircuitBreakerObservation{
		State: circuitBreakerStateOpen,
		Event: circuitBreakerEventOpened,
	}
}

func (breaker *circuitBreaker) observe(observation CircuitBreakerObservation) {
	if breaker == nil || breaker.config.Observer == nil || observation.Event == "" {
		return
	}
	defer func() { _ = recover() }()
	breaker.config.Observer(observation)
}

func circuitBreakerResult(ctx context.Context, response *http.Response, err error) (failure bool, relevant bool) {
	if ctx.Err() != nil {
		return false, false
	}
	if err != nil || response == nil {
		return true, true
	}
	switch response.StatusCode {
	case http.StatusRequestTimeout,
		http.StatusTooEarly,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true, true
	default:
		return false, true
	}
}

func withCircuitBreakerDefaults(config CircuitBreakerConfig) CircuitBreakerConfig {
	if config.FailureThreshold > 0 && config.OpenTimeout == 0 {
		config.OpenTimeout = defaultCircuitOpenTimeout
	}
	return config
}

func validateCircuitBreakerConfig(config CircuitBreakerConfig) error {
	if config.FailureThreshold == 0 {
		if config.OpenTimeout != 0 {
			return errors.New("outbound HTTP circuit breaker timeout requires the breaker to be enabled")
		}
		if config.Observer != nil {
			return errors.New("outbound HTTP circuit breaker observer requires the breaker to be enabled")
		}
		return nil
	}
	if config.FailureThreshold < 0 || config.FailureThreshold > maximumFailureThreshold {
		return errors.New("outbound HTTP circuit breaker failure threshold must be between one and one hundred")
	}
	if config.OpenTimeout <= 0 || config.OpenTimeout > maximumCircuitOpenTimeout {
		return errors.New("outbound HTTP circuit breaker open timeout must be greater than zero and at most five minutes")
	}
	return nil
}
