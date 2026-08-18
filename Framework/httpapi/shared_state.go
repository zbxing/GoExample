package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
)

// Shared state can remain in memory for a single process, but production
// deployments that use more than one instance must inject an external store.
const (
	SharedStateModeMemory   = "memory"
	SharedStateModeExternal = "external"
)

// ValidateSharedState checks the deployment contract before the server starts.
// Fiber's default storage and idempotency lock are intentionally not accepted
// for an external/shared deployment because both are process-local.
func ValidateSharedState(environment, mode string, allowInMemory, idempotencyEnabled bool, storage fiber.Storage, lock idempotency.Locker) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = SharedStateModeMemory
	}
	if mode != SharedStateModeMemory && mode != SharedStateModeExternal {
		return fmt.Errorf("shared state mode must be %q or %q", SharedStateModeMemory, SharedStateModeExternal)
	}
	if strings.EqualFold(strings.TrimSpace(environment), "production") && mode == SharedStateModeMemory && !allowInMemory {
		return fmt.Errorf("production shared state cannot use process memory without an explicit downgrade")
	}
	if mode == SharedStateModeExternal {
		if storage == nil {
			return fmt.Errorf("external shared state requires a shared storage implementation")
		}
		if idempotencyEnabled && lock == nil {
			return fmt.Errorf("external shared state requires a distributed idempotency lock")
		}
	}
	return nil
}

// namespacedStorage prevents limiter, auth-limiter, and per-route idempotency
// records from colliding when they share one external backend.
type namespacedStorage struct {
	storage fiber.Storage
	prefix  string
}

func newNamespacedStorage(storage fiber.Storage, namespace string) fiber.Storage {
	if storage == nil {
		return nil
	}
	return namespacedStorage{storage: storage, prefix: "goexample:" + namespace + ":"}
}

func (s namespacedStorage) key(key string) string { return s.prefix + key }

func (s namespacedStorage) GetWithContext(ctx context.Context, key string) ([]byte, error) {
	return s.storage.GetWithContext(ctx, s.key(key))
}

func (s namespacedStorage) Get(key string) ([]byte, error) { return s.storage.Get(s.key(key)) }

func (s namespacedStorage) SetWithContext(ctx context.Context, key string, value []byte, exp time.Duration) error {
	return s.storage.SetWithContext(ctx, s.key(key), value, exp)
}

func (s namespacedStorage) Set(key string, value []byte, exp time.Duration) error {
	return s.storage.Set(s.key(key), value, exp)
}

func (s namespacedStorage) DeleteWithContext(ctx context.Context, key string) error {
	return s.storage.DeleteWithContext(ctx, s.key(key))
}

func (s namespacedStorage) Delete(key string) error { return s.storage.Delete(s.key(key)) }

func (s namespacedStorage) ResetWithContext(ctx context.Context) error {
	// A backend-wide reset would erase unrelated application state. External
	// adapters should provide namespace deletion if reset is required.
	return fmt.Errorf("namespaced storage reset is not supported")
}

func (s namespacedStorage) Reset() error {
	return fmt.Errorf("namespaced storage reset is not supported")
}

func (s namespacedStorage) Close() error { return s.storage.Close() }

type namespacedLocker struct {
	locker idempotency.Locker
	prefix string
}

func newNamespacedLocker(locker idempotency.Locker, namespace string) idempotency.Locker {
	if locker == nil {
		return nil
	}
	return namespacedLocker{locker: locker, prefix: "goexample:" + namespace + ":"}
}

func (l namespacedLocker) Lock(key string) error   { return l.locker.Lock(l.prefix + key) }
func (l namespacedLocker) Unlock(key string) error { return l.locker.Unlock(l.prefix + key) }
