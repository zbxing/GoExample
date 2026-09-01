package httpapi

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"

	"github.com/zbxing/goexample/Framework/sharedstate"
)

func TestAtomicRateLimiterFormatsSuccessAndRejectionHeaders(t *testing.T) {
	tests := []struct {
		name       string
		result     sharedstate.RateLimitResult
		wantStatus int
		wantRetry  string
	}{
		{
			name: "allowed",
			result: sharedstate.RateLimitResult{
				Allowed:    true,
				Remaining:  math.MaxInt - 1,
				ResetAfter: 1500 * time.Millisecond,
			},
			wantStatus: http.StatusNoContent,
		},
		{
			name: "rejected",
			result: sharedstate.RateLimitResult{
				Remaining:  0,
				ResetAfter: 1500 * time.Millisecond,
			},
			wantStatus: http.StatusTooManyRequests,
			wantRetry:  "2",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			app := fiber.New()
			storage := &fixedAtomicRateLimiter{result: test.result}
			app.Use(rateLimiter("test", math.MaxInt, time.Minute, "limited", nil, storage, nil))
			app.Get("/", func(c fiber.Ctx) error { return c.SendStatus(http.StatusNoContent) })

			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/", http.NoBody))
			if err != nil {
				t.Fatalf("request error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.wantStatus)
			}
			if value := response.Header.Get("X-RateLimit-Limit"); value != strconv.Itoa(math.MaxInt) {
				t.Fatalf("X-RateLimit-Limit = %q", value)
			}
			if value := response.Header.Get("X-RateLimit-Remaining"); value != strconv.Itoa(test.result.Remaining) {
				t.Fatalf("X-RateLimit-Remaining = %q", value)
			}
			if value := response.Header.Get("X-RateLimit-Reset"); value != "2" {
				t.Fatalf("X-RateLimit-Reset = %q", value)
			}
			if value := response.Header.Get(fiber.HeaderRetryAfter); value != test.wantRetry {
				t.Fatalf("Retry-After = %q, want %q", value, test.wantRetry)
			}
		})
	}
}

func TestSetRateLimitHeaderDoesNotAllocate(t *testing.T) {
	app := fiber.New()
	requestContext := &fasthttp.RequestCtx{}
	c := app.AcquireCtx(requestContext)
	defer app.ReleaseCtx(c)

	setRateLimitHeader(c, "X-RateLimit-Limit", math.MaxInt64)
	if value := c.GetRespHeader("X-RateLimit-Limit"); value != "9223372036854775807" {
		t.Fatalf("X-RateLimit-Limit = %q", value)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		setRateLimitHeader(c, "X-RateLimit-Limit", math.MaxInt64)
	}); allocations != 0 {
		t.Fatalf("setRateLimitHeader allocations = %f, want 0", allocations)
	}
}

type fixedAtomicRateLimiter struct {
	contractStorage
	result sharedstate.RateLimitResult
}

func (limiter *fixedAtomicRateLimiter) Take(context.Context, string, int, time.Duration) (sharedstate.RateLimitResult, error) {
	return limiter.result, nil
}
