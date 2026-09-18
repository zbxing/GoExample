package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"hash"
	"mime"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
)

var errIdempotencyFingerprintConflict = errors.New("idempotency key is already bound to a different request")

type idempotencyFingerprintEntry struct {
	digest    [sha256.Size]byte
	expiresAt time.Time
}

type idempotencyFingerprintRegistry struct {
	storage fiber.Storage
	mu      sync.Mutex
	entries map[string]idempotencyFingerprintEntry
}

func newIdempotencyFingerprintRegistry(storage fiber.Storage) *idempotencyFingerprintRegistry {
	return &idempotencyFingerprintRegistry{storage: storage}
}

func (registry *idempotencyFingerprintRegistry) bind(
	c fiber.Ctx,
	key string,
	digest [sha256.Size]byte,
	lifetime time.Duration,
) error {
	if registry.storage != nil {
		stored, err := registry.storage.GetWithContext(c, key)
		if err != nil {
			return err
		}
		if stored != nil {
			if len(stored) != sha256.Size || subtle.ConstantTimeCompare(stored, digest[:]) != 1 {
				return errIdempotencyFingerprintConflict
			}
			return nil
		}
		return registry.storage.SetWithContext(c, key, digest[:], fingerprintLifetime(lifetime))
	}

	now := time.Now()
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if entry, exists := registry.entries[key]; exists && now.Before(entry.expiresAt) {
		if subtle.ConstantTimeCompare(entry.digest[:], digest[:]) != 1 {
			return errIdempotencyFingerprintConflict
		}
		return nil
	}
	if registry.entries == nil {
		registry.entries = make(map[string]idempotencyFingerprintEntry)
	}
	registry.entries[key] = idempotencyFingerprintEntry{
		digest:    digest,
		expiresAt: now.Add(fingerprintLifetime(lifetime)),
	}
	return nil
}

// The fingerprint must not expire before the response cache written later in
// the request. The small overlap favors a safe conflict over stale replay.
func fingerprintLifetime(responseLifetime time.Duration) time.Duration {
	const overlap = time.Minute
	if responseLifetime > time.Duration(1<<63-1)-overlap {
		return responseLifetime
	}
	return responseLifetime + overlap
}

func idempotencyRequestFingerprint(c fiber.Ctx, fingerprintHeaders ...string) [sha256.Size]byte {
	method := c.Method()
	originalURL := c.OriginalURL()
	principal := idempotencyPrincipal(c)
	mediaType := normalizedMediaType(c.Get(fiber.HeaderContentType))
	body := c.Body()
	var headerNames [4]string
	var headerValues [4]string
	if len(fingerprintHeaders) <= len(headerNames) {
		for index, header := range fingerprintHeaders {
			headerNames[index] = normalizedFingerprintHeaderName(header)
			headerValues[index] = c.Get(header)
		}
		total := fingerprintPartSize(method) + fingerprintPartSize(originalURL) +
			fingerprintPartSize(principal) + fingerprintPartSize(mediaType) + fingerprintPartSizeBytes(body)
		for index := range fingerprintHeaders {
			total += fingerprintPartSize(headerNames[index]) + fingerprintPartSize(headerValues[index])
		}
		if total <= inlineFingerprintCapacity {
			var encoded [inlineFingerprintCapacity]byte
			offset := 0
			appendFingerprintString(encoded[:], &offset, method)
			appendFingerprintString(encoded[:], &offset, originalURL)
			appendFingerprintString(encoded[:], &offset, principal)
			appendFingerprintString(encoded[:], &offset, mediaType)
			for index := range fingerprintHeaders {
				appendFingerprintString(encoded[:], &offset, headerNames[index])
				appendFingerprintString(encoded[:], &offset, headerValues[index])
			}
			appendFingerprintBytes(encoded[:], &offset, body)
			return sha256.Sum256(encoded[:offset])
		}
	}

	digest := sha256.New()
	var length [8]byte
	writeFingerprintPart(digest, &length, []byte(method))
	writeFingerprintPart(digest, &length, []byte(originalURL))
	writeFingerprintPart(digest, &length, []byte(principal))
	writeFingerprintPart(digest, &length, []byte(mediaType))
	for _, header := range fingerprintHeaders {
		writeFingerprintPart(digest, &length, []byte(normalizedFingerprintHeaderName(header)))
		writeFingerprintPart(digest, &length, []byte(c.Get(header)))
	}
	writeFingerprintPart(digest, &length, body)

	var result [sha256.Size]byte
	digest.Sum(result[:0])
	return result
}

const inlineFingerprintCapacity = 4096

func fingerprintPartSize(value string) int {
	return 8 + len(value)
}

func fingerprintPartSizeBytes(value []byte) int {
	return 8 + len(value)
}

func appendFingerprintString(target []byte, offset *int, value string) {
	binary.BigEndian.PutUint64(target[*offset:], uint64(len(value)))
	*offset += 8
	*offset += copy(target[*offset:], value)
}

func appendFingerprintBytes(target []byte, offset *int, value []byte) {
	binary.BigEndian.PutUint64(target[*offset:], uint64(len(value)))
	*offset += 8
	*offset += copy(target[*offset:], value)
}

func normalizedFingerprintHeaderName(value string) string {
	// If-Match is the only production fingerprint header and its canonical form
	// is stable; avoid allocating a lower-case copy on that hot path.
	if value == fiber.HeaderIfMatch {
		return "if-match"
	}
	return strings.ToLower(value)
}

func idempotencyPrincipal(c fiber.Ctx) string {
	if claims, ok := currentClaims(c); ok && strings.TrimSpace(claims.Subject) != "" {
		return claims.Subject
	}
	return "anonymous"
}

func normalizedMediaType(value string) string {
	// JSON is the common API request media type. These exact values are already
	// in the canonical form emitted by mime.FormatMediaType, so avoid parsing
	// and rebuilding them on every idempotency fingerprint.
	switch value {
	case fiber.MIMEApplicationJSON, fiber.MIMEApplicationJSONCharsetUTF8:
		return value
	}
	mediaType, parameters, err := mime.ParseMediaType(value)
	if err != nil {
		return strings.TrimSpace(value)
	}
	return mime.FormatMediaType(strings.ToLower(mediaType), parameters)
}

func writeFingerprintPart(target hash.Hash, length *[8]byte, value []byte) {
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	_, _ = target.Write(length[:])
	_, _ = target.Write(value)
}
