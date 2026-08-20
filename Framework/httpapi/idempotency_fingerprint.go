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

func idempotencyRequestFingerprint(c fiber.Ctx) [sha256.Size]byte {
	digest := sha256.New()
	writeFingerprintPart(digest, []byte(c.Method()))
	writeFingerprintPart(digest, []byte(c.OriginalURL()))
	writeFingerprintPart(digest, []byte(idempotencyPrincipal(c)))
	writeFingerprintPart(digest, []byte(normalizedMediaType(c.Get(fiber.HeaderContentType))))
	writeFingerprintPart(digest, c.Body())

	var result [sha256.Size]byte
	copy(result[:], digest.Sum(nil))
	return result
}

func idempotencyPrincipal(c fiber.Ctx) string {
	if claims, ok := currentClaims(c); ok && strings.TrimSpace(claims.Subject) != "" {
		return claims.Subject
	}
	return "anonymous"
}

func normalizedMediaType(value string) string {
	mediaType, parameters, err := mime.ParseMediaType(value)
	if err != nil {
		return strings.TrimSpace(value)
	}
	return mime.FormatMediaType(strings.ToLower(mediaType), parameters)
}

func writeFingerprintPart(target hash.Hash, value []byte) {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	_, _ = target.Write(length[:])
	_, _ = target.Write(value)
}
