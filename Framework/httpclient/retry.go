package httpclient

import (
	"context"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRetryInitialBackoff           = 50 * time.Millisecond
	defaultRetryMaxBackoff               = 500 * time.Millisecond
	maximumRetryBackoff                  = 5 * time.Second
	maximumRetryAttempts                 = 5
	maximumRetryResponseDrainBytes int64 = 32 * 1024
)

var errRequestBodyReplay = errors.New("outbound HTTP request body could not be replayed")

// RetryConfig defines an explicit, bounded retry policy for safe HTTP methods.
// MaxAttempts includes the initial request; zero disables retries. Requests with
// a body are retried only when Request.GetBody can produce an independent copy.
// Valid Retry-After values are honored without exceeding MaxBackoff or the
// original request deadline. Retry waits receive bounded positive jitter; an
// over-budget value stops automatic retries.
type RetryConfig struct {
	MaxAttempts    int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

type retryTransport struct {
	base         http.RoundTripper
	config       RetryConfig
	randomInt64N func(int64) int64
}

func (transport retryTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil {
		return transport.base.RoundTrip(request)
	}
	if contextErr := completedHTTPContextError(request.Context()); contextErr != nil {
		closeHTTPRequestBody(request)
		return nil, contextErr
	}
	if !retryableRequest(request) {
		response, err := transport.base.RoundTrip(request)
		return authoritativeHTTPResult(request.Context(), response, err)
	}

	attemptRequest := request
	for attempt := 1; ; attempt++ {
		response, err := transport.base.RoundTrip(attemptRequest)
		response, err = authoritativeHTTPResult(request.Context(), response, err)
		if attempt >= transport.config.MaxAttempts || !retryableResult(request.Context(), response, err) {
			return response, err
		}

		delay, withinBudget := retryDelay(transport.config, attempt, response, time.Now())
		if !withinBudget {
			return response, err
		}
		delay = transport.jitteredRetryDelay(delay)
		if !retryDelayFits(request.Context(), delay) {
			return response, err
		}
		closeRetryResponse(response)
		if err := waitForRetry(request.Context(), delay); err != nil {
			return nil, err
		}
		attemptRequest, err = replayRequest(request)
		if err != nil {
			return nil, errRequestBodyReplay
		}
	}
}

func closeRetryResponse(response *http.Response) {
	if response == nil || response.Body == nil {
		return
	}
	if response.ContentLength >= 0 && response.ContentLength <= maximumRetryResponseDrainBytes {
		// The extra byte reaches EOF for a truthful Content-Length while bounding
		// a custom or non-conforming body that returns more than it declared.
		_, _ = io.CopyN(io.Discard, response.Body, response.ContentLength+1)
	}
	_ = response.Body.Close()
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
	if completedHTTPContextError(ctx) != nil {
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

func retryDelay(config RetryConfig, retryNumber int, response *http.Response, now time.Time) (time.Duration, bool) {
	delay := retryBackoff(config, retryNumber)
	if response == nil {
		return delay, true
	}
	retryAfter, ok := parseRetryAfter(response.Header.Get("Retry-After"), now)
	if !ok {
		return delay, true
	}
	if retryAfter > config.MaxBackoff {
		return 0, false
	}
	return max(delay, retryAfter), true
}

func (transport retryTransport) jitteredRetryDelay(delay time.Duration) time.Duration {
	randomInt64N := transport.randomInt64N
	if randomInt64N == nil {
		randomInt64N = rand.Int64N
	}
	return retryJitter(delay, transport.config.MaxBackoff, randomInt64N)
}

func retryJitter(delay, maximum time.Duration, randomInt64N func(int64) int64) time.Duration {
	window := min(delay/2, maximum-delay)
	if window <= 0 {
		return delay
	}
	return delay + time.Duration(randomInt64N(int64(window)+1))
}

func parseRetryAfter(value string, now time.Time) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}

	digitsOnly := true
	for index := 0; index < len(value); index++ {
		if value[index] < '0' || value[index] > '9' {
			digitsOnly = false
			break
		}
	}
	if digitsOnly {
		seconds, err := strconv.ParseUint(value, 10, 64)
		if err != nil || seconds > uint64(maximumRetryBackoff/time.Second) {
			// MaxBackoff cannot exceed maximumRetryBackoff. Keep a syntactically
			// valid but oversized value distinguishable from a malformed header.
			return maximumRetryBackoff + time.Nanosecond, true
		}
		return time.Duration(seconds) * time.Second, true
	}

	retryAt, err := http.ParseTime(value)
	if err != nil {
		return 0, false
	}
	delay := retryAt.Sub(now)
	if delay < 0 {
		return 0, true
	}
	return delay, true
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
