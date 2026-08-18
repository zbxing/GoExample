package httpapi

import (
	"context"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
)

// rejectWhenDraining stops new business requests after readiness has been
// withdrawn. Existing requests are unaffected because the check runs only at
// the start of each request.
func rejectWhenDraining(checker *health.Checker, metrics *observability.Metrics) fiber.Handler {
	return func(c fiber.Ctx) error {
		if checker == nil || !checker.Draining() {
			return c.Next()
		}
		metrics.RecordDrainingRejected()
		c.Set(fiber.HeaderRetryAfter, "1")
		c.Set(fiber.HeaderCacheControl, "no-store")
		return failure(c, fiber.StatusServiceUnavailable, "service is draining")
	}
}

// boundedConcurrency rejects new API work when all admission slots are busy.
// Health endpoints live outside /api/v1, so an overloaded application can
// still report readiness and participate in a graceful drain.
func boundedConcurrency(maxInFlight int, metrics *observability.Metrics) fiber.Handler {
	if maxInFlight <= 0 {
		return func(c fiber.Ctx) error { return c.Next() }
	}

	slots := make(chan struct{}, maxInFlight)
	return func(c fiber.Ctx) error {
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
			return c.Next()
		default:
			metrics.RecordAdmissionRejected()
			c.Set(fiber.HeaderRetryAfter, "1")
			c.Set(fiber.HeaderCacheControl, "no-store")
			return failure(c, fiber.StatusServiceUnavailable, "server is busy")
		}
	}
}

func requestDeadline(applicationContext context.Context, timeout time.Duration) fiber.Handler {
	return func(c fiber.Ctx) error {
		previous := c.Context()
		if previous == nil {
			previous = context.Background()
		}
		ctx, cancel := context.WithTimeout(previous, timeout)
		stopApplicationCancellation := context.AfterFunc(applicationContext, cancel)
		c.SetContext(ctx)
		defer func() {
			stopApplicationCancellation()
			cancel()
			c.SetContext(previous)
		}()
		return c.Next()
	}
}

func idempotencyMiddleware(route string, lifetime time.Duration, storage fiber.Storage, lock idempotency.Locker) fiber.Handler {
	middleware := idempotency.New(idempotency.Config{
		Lifetime: lifetime,
		Storage:  newNamespacedStorage(storage, "idempotency:"+route),
		Lock:     newNamespacedLocker(lock, "idempotency:"+route),
		Next: func(c fiber.Ctx) bool {
			return fiber.IsMethodSafe(c.Method())
		},
		KeepResponseHeaders: []string{
			fiber.HeaderCacheControl,
			fiber.HeaderContentType,
		},
	})

	return func(c fiber.Ctx) error {
		err := middleware(c)
		if idempotency.IsFromCache(c) {
			c.Set("X-Idempotency-Replayed", "true")
		}
		return err
	}
}

func rateLimiter(
	scope string,
	maxRequests int,
	window time.Duration,
	message string,
	next func(fiber.Ctx) bool,
	storage fiber.Storage,
) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        maxRequests,
		Expiration: window,
		Next:       next,
		Storage:    newNamespacedStorage(storage, "limiter:"+scope),
		KeyGenerator: func(c fiber.Ctx) string {
			// The limiter runs before authentication, so IP is the only stable
			// principal here. Trusted proxy configuration controls c.IP().
			return c.IP()
		},
		LimitReached: func(c fiber.Ctx) error {
			reset := c.GetRespHeader(fiber.HeaderRetryAfter, "1")
			c.Set("X-RateLimit-Limit", strconv.Itoa(maxRequests))
			c.Set("X-RateLimit-Remaining", "0")
			c.Set("X-RateLimit-Reset", reset)
			return failure(c, fiber.StatusTooManyRequests, message)
		},
	})
}
