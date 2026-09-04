package httpclient

import (
	"context"
	"errors"
	"net/http"
	"time"
)

const (
	defaultRetryInitialBackoff = 50 * time.Millisecond
	defaultRetryMaxBackoff     = 500 * time.Millisecond
	maximumRetryBackoff        = 5 * time.Second
	maximumRetryAttempts       = 5
)

var errRequestBodyReplay = errors.New("outbound HTTP request body could not be replayed")

// RetryConfig defines an explicit, bounded retry policy for safe HTTP methods.
// MaxAttempts includes the initial request; zero disables retries. Requests with
// a body are retried only when Request.GetBody can produce an independent copy.
type RetryConfig struct {
	MaxAttempts    int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

type retryTransport struct {
	base   http.RoundTripper
	config RetryConfig
}

func (transport retryTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil || !retryableRequest(request) {
		return transport.base.RoundTrip(request)
	}

	attemptRequest := request
	for attempt := 1; ; attempt++ {
		response, err := transport.base.RoundTrip(attemptRequest)
		if attempt >= transport.config.MaxAttempts || !retryableResult(request.Context(), response, err) {
			return response, err
		}

		delay := retryBackoff(transport.config, attempt)
		if !retryDelayFits(request.Context(), delay) {
			return response, err
		}
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		if err := waitForRetry(request.Context(), delay); err != nil {
			return nil, err
		}
		attemptRequest, err = replayRequest(request)
		if err != nil {
			return nil, errRequestBodyReplay
		}
	}
}

func retryableRequest(request *http.Request) bool {
	if !safeRetryMethod(request.Method) {
		return false
	}
	return request.Body == nil || request.Body == http.NoBody || request.GetBody != nil
}

func safeRetryMethod(method string) bool {
	switch method {
	case "", http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	default:
		return false
	}
}

func retryableResult(ctx context.Context, response *http.Response, err error) bool {
	if ctx.Err() != nil {
		return false
	}
	if err != nil {
		return true
	}
	if response == nil {
		return false
	}
	switch response.StatusCode {
	case http.StatusRequestTimeout,
		http.StatusTooEarly,
		http.StatusTooManyRequests,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func replayRequest(request *http.Request) (*http.Request, error) {
	replay := request.WithContext(request.Context())
	switch request.Body {
	case nil:
		replay.Body = nil
	case http.NoBody:
		replay.Body = http.NoBody
	default:
		body, err := request.GetBody()
		if err != nil || body == nil {
			return nil, errRequestBodyReplay
		}
		replay.Body = body
	}
	return replay, nil
}

func retryBackoff(config RetryConfig, retryNumber int) time.Duration {
	delay := config.InitialBackoff
	for current := 1; current < retryNumber && delay < config.MaxBackoff; current++ {
		if delay > config.MaxBackoff/2 {
			return config.MaxBackoff
		}
		delay *= 2
	}
	return min(delay, config.MaxBackoff)
}

func retryDelayFits(ctx context.Context, delay time.Duration) bool {
	deadline, ok := ctx.Deadline()
	return !ok || time.Now().Add(delay).Before(deadline)
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func withRetryDefaults(config RetryConfig) RetryConfig {
	if config.MaxAttempts <= 0 {
		return config
	}
	if config.InitialBackoff == 0 {
		config.InitialBackoff = defaultRetryInitialBackoff
	}
	if config.MaxBackoff == 0 {
		config.MaxBackoff = defaultRetryMaxBackoff
	}
	return config
}

func validateRetryConfig(config RetryConfig) error {
	if config.MaxAttempts == 0 {
		if config.InitialBackoff != 0 || config.MaxBackoff != 0 {
			return errors.New("outbound HTTP retry backoff requires retries to be enabled")
		}
		return nil
	}
	if config.MaxAttempts < 2 || config.MaxAttempts > maximumRetryAttempts {
		return errors.New("outbound HTTP retry attempts must be between two and five")
	}
	if config.InitialBackoff <= 0 || config.MaxBackoff <= 0 {
		return errors.New("outbound HTTP retry backoff must be greater than zero")
	}
	if config.InitialBackoff > config.MaxBackoff {
		return errors.New("outbound HTTP initial retry backoff must not exceed the maximum")
	}
	if config.MaxBackoff > maximumRetryBackoff {
		return errors.New("outbound HTTP maximum retry backoff must not exceed five seconds")
	}
	return nil
}
