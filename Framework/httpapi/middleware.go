package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"hash/crc32"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/sharedstate"
)

const (
	maxRequestIDLength       = 128
	maxWeakETagLength        = 25
	weakETagCRC32QPolynomial = 0xD5828281
)

var weakETagCRC32Q = crc32.MakeTable(weakETagCRC32QPolynomial)

var (
	varyOriginBytes               = []byte(fiber.HeaderOrigin)
	varyOriginAcceptEncodingBytes = []byte(fiber.HeaderOrigin + ", " + fiber.HeaderAcceptEncoding)
)

func corsRequiresOriginVary(allowedOrigins []string) bool {
	for _, origin := range allowedOrigins {
		if origin == "*" {
			return false
		}
	}
	return true
}

func seedAPIOriginVary() fiber.Handler {
	return func(c fiber.Ctx) error {
		if c.Method() != fiber.MethodOptions && len(c.Response().Header.Peek(fiber.HeaderVary)) == 0 {
			c.Response().Header.SetBytesV(fiber.HeaderVary, varyOriginBytes)
		}
		return c.Next()
	}
}

func skipPreseededAPICORS(c fiber.Ctx) bool {
	if c.Method() == fiber.MethodOptions || len(c.Request().Header.Peek(fiber.HeaderOrigin)) != 0 {
		return false
	}
	path := c.Path()
	return path == "/api/v1" || strings.HasPrefix(path, "/api/v1/")
}

func coalesceCompressionVary() fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := c.Next(); err != nil {
			return err
		}
		header := &c.Response().Header
		if bytes.Equal(header.Peek(fiber.HeaderVary), varyOriginBytes) {
			header.SetBytesV(fiber.HeaderVary, varyOriginAcceptEncodingBytes)
		}
		return nil
	}
}

func streamSafeETag() fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := c.Next(); err != nil {
			return err
		}

		response := c.Response()
		if hasCacheControlDirective(c.GetRespHeader(fiber.HeaderCacheControl), "no-store") {
			if _, err := parseApplicationPrecondition(c.GetRespHeader(fiber.HeaderETag)); err == nil {
				return nil
			}
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
		var tagStorage [maxWeakETagLength]byte
		tag := generateWeakETag(body, &tagStorage)
		if len(tag) == 0 {
			return nil
		}
		response.Header.SetBytesV(fiber.HeaderETag, tag)
		if header := c.Get(fiber.HeaderIfNoneMatch); header != "" && weakETagMatches(header, string(tag)) {
			c.RequestCtx().ResetBody()
			return c.SendStatus(fiber.StatusNotModified)
		}
		return nil
	}
}

func generateWeakETag(body []byte, storage *[maxWeakETagLength]byte) []byte {
	if uint64(len(body)) > uint64(math.MaxUint32) {
		return nil
	}
	tag := storage[:0]
	tag = append(tag, 'W', '/', '"')
	tag = strconv.AppendUint(tag, uint64(len(body)), 10)
	tag = append(tag, '-')
	tag = strconv.AppendUint(tag, uint64(crc32.Checksum(body, weakETagCRC32Q)), 10)
	return append(tag, '"')
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

func requestDeadline(
	applicationContext context.Context,
	requestCancellations *requestCancellationRegistry,
	timeout time.Duration,
) fiber.Handler {
	return func(c fiber.Ctx) error {
		previous := c.Context()
		if previous == nil {
			previous = context.Background()
		}
		ctx, cancel := context.WithTimeout(previous, timeout)
		setWriteDeadline, _ := previous.Value(standardResponseWriteDeadlineContextKey{}).(standardResponseWriteDeadline)
		lifetime := newRequestStreamLifetime(
			ctx,
			cancel,
			previous,
			applicationContext,
			requestCancellations,
			setWriteDeadline,
		)
		c.SetContext(lifetime)
		defer func() {
			if !lifetime.claimed || !c.Response().IsBodyStream() {
				lifetime.complete()
			}
			c.SetContext(previous)
		}()
		return c.Next()
	}
}

func idempotencyMiddleware(route string, lifetime time.Duration, storage fiber.Storage, lock idempotency.Locker, fingerprintHeaders ...string) fiber.Handler {
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
			fiber.HeaderETag,
			fiber.HeaderPragma,
		},
	})

	return func(c fiber.Ctx) error {
		key := strings.Clone(c.Get("X-Idempotency-Key"))
		if key != "" && !fiber.IsMethodSafe(c.Method()) {
			if err := idempotency.ConfigDefault.KeyHeaderValidate(key); err != nil {
				return err
			}
			if err := cacheLock.Lock(key); err != nil {
				return fmt.Errorf("lock idempotency fingerprint: %w", err)
			}
			bindErr := fingerprints.bind(c, key, idempotencyRequestFingerprint(c, fingerprintHeaders...), lifetime)
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
	onLimitReached func(fiber.Ctx),
) fiber.Handler {
	if atomicLimiter, ok := storage.(sharedstate.AtomicRateLimiter); ok {
		return atomicRateLimiter(scope, maxRequests, window, message, next, atomicLimiter, onLimitReached)
	}
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
			if onLimitReached != nil {
				onLimitReached(c)
			}
			return failure(c, fiber.StatusTooManyRequests, message)
		},
	})
}

func atomicRateLimiter(
	scope string,
	maxRequests int,
	window time.Duration,
	message string,
	next func(fiber.Ctx) bool,
	limiter sharedstate.AtomicRateLimiter,
	onLimitReached func(fiber.Ctx),
) fiber.Handler {
	return func(c fiber.Ctx) error {
		if next != nil && next(c) {
			return c.Next()
		}
		result, err := limiter.Take(c.Context(), sharedStateKey("limiter:"+scope, c.IP()), maxRequests, window)
		if err != nil {
			// A dependency timeout is an internal availability failure, not a
			// client request timeout.
			return fmt.Errorf("rate limiter shared state: %v", err)
		}
		resetSeconds := int64(result.ResetAfter / time.Second)
		if result.ResetAfter%time.Second != 0 {
			resetSeconds++
		}
		if resetSeconds < 1 {
			resetSeconds = 1
		}
		reset := strconv.FormatInt(resetSeconds, 10)
		c.Set("X-RateLimit-Limit", strconv.Itoa(maxRequests))
		c.Set("X-RateLimit-Remaining", strconv.Itoa(result.Remaining))
		c.Set("X-RateLimit-Reset", reset)
		if result.Allowed {
			return c.Next()
		}
		c.Set(fiber.HeaderRetryAfter, reset)
		if onLimitReached != nil {
			onLimitReached(c)
		}
		return failure(c, fiber.StatusTooManyRequests, message)
	}
}
