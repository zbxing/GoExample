package httpapi

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/etag"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
)

const maxRequestIDLength = 128

func streamSafeETag() fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := c.Next(); err != nil {
			return err
		}

		response := c.Response()
		if hasCacheControlDirective(c.GetRespHeader(fiber.HeaderCacheControl), "no-store") {
			response.Header.Del(fiber.HeaderETag)
			return nil
		}
		if response.IsBodyStream() || response.StatusCode() != fiber.StatusOK ||
			response.Header.Peek(fiber.HeaderETag) != nil {
			return nil
		}
		body := response.Body()
		if len(body) == 0 {
			return nil
		}
		tag := etag.GenerateWeak(body)
		if len(tag) == 0 {
			return nil
		}
		response.Header.SetBytesV(fiber.HeaderETag, tag)
		if weakETagMatches(c.Get(fiber.HeaderIfNoneMatch), string(tag)) {
			c.RequestCtx().ResetBody()
			return c.SendStatus(fiber.StatusNotModified)
		}
		return nil
	}
}

func weakETagMatches(header, expected string) bool {
	expected = strings.TrimPrefix(expected, "W/")
	for value := range strings.SplitSeq(header, ",") {
		value = strings.TrimSpace(value)
		if value == "*" || strings.TrimPrefix(value, "W/") == expected {
			return true
		}
	}
	return false
}

// requestIDBoundary discards untrusted correlation IDs outside the project's
// documented token format. The requestid middleware that follows generates a
// cryptographically random replacement.
func requestIDBoundary(metrics *observability.Metrics) fiber.Handler {
	return func(c fiber.Ctx) error {
		value := c.Get(fiber.HeaderXRequestID)
		if value != "" && !validRequestID(value) {
			c.Request().Header.Del(fiber.HeaderXRequestID)
			metrics.RecordRequestIDReplaced()
		}
		return c.Next()
	}
}

func validRequestID(value string) bool {
	if len(value) == 0 || len(value) > maxRequestIDLength {
		return false
	}
	for index := 0; index < len(value); index++ {
		current := value[index]
		if current >= 'a' && current <= 'z' || current >= 'A' && current <= 'Z' ||
			current >= '0' && current <= '9' || current == '-' || current == '_' || current == '.' {
			continue
		}
		return false
	}
	return true
}

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
	if lock == nil {
		lock = idempotency.NewMemoryLock()
	}
	cacheLock := newNamespacedLocker(lock, "idempotency:"+route)
	fingerprints := newIdempotencyFingerprintRegistry(
		newNamespacedStorage(storage, "idempotency-fingerprint:"+route),
	)
	middleware := idempotency.New(idempotency.Config{
		Lifetime: lifetime,
		Storage:  newNamespacedStorage(storage, "idempotency:"+route),
		Lock:     cacheLock,
		Next: func(c fiber.Ctx) bool {
			return fiber.IsMethodSafe(c.Method())
		},
		KeepResponseHeaders: []string{
			fiber.HeaderCacheControl,
			fiber.HeaderContentType,
		},
	})

	return func(c fiber.Ctx) error {
		key := c.Get("X-Idempotency-Key")
		if key != "" && !fiber.IsMethodSafe(c.Method()) {
			if err := idempotency.ConfigDefault.KeyHeaderValidate(key); err != nil {
				return err
			}
			if err := cacheLock.Lock(key); err != nil {
				return fmt.Errorf("lock idempotency fingerprint: %w", err)
			}
			bindErr := fingerprints.bind(c, key, idempotencyRequestFingerprint(c), lifetime)
			unlockErr := cacheLock.Unlock(key)
			if bindErr != nil {
				return fmt.Errorf("bind idempotency fingerprint: %w", bindErr)
			}
			if unlockErr != nil {
				return fmt.Errorf("unlock idempotency fingerprint: %w", unlockErr)
			}
		}
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
