package httpapi

import (
	"context"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
	"github.com/gofiber/fiber/v3/middleware/limiter"
)

func requestDeadline(timeout time.Duration) fiber.Handler {
	return func(c fiber.Ctx) error {
		parent := c.Context()
		ctx, cancel := context.WithTimeout(parent, timeout)
		c.SetContext(ctx)
		defer func() {
			cancel()
			c.SetContext(parent)
		}()
		return c.Next()
	}
}

func idempotencyMiddleware(lifetime time.Duration) fiber.Handler {
	middleware := idempotency.New(idempotency.Config{
		Lifetime: lifetime,
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
	maxRequests int,
	window time.Duration,
	message string,
	next func(fiber.Ctx) bool,
) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        maxRequests,
		Expiration: window,
		Next:       next,
		LimitReached: func(c fiber.Ctx) error {
			reset := c.GetRespHeader(fiber.HeaderRetryAfter, "1")
			c.Set("X-RateLimit-Limit", strconv.Itoa(maxRequests))
			c.Set("X-RateLimit-Remaining", "0")
			c.Set("X-RateLimit-Reset", reset)
			return failure(c, fiber.StatusTooManyRequests, message)
		},
	})
}
