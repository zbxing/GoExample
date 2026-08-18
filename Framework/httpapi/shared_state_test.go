package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"

	"github.com/zbxing/goexample/Framework/observability"
)

func TestValidateSharedStateRequiresExternalDependencies(t *testing.T) {
	storage := &contractStorage{}
	lock := &contractLock{}
	tests := []struct {
		name        string
		env         string
		mode        string
		allow       bool
		idempotency bool
		store       fiber.Storage
		locker      idempotency.Locker
		want        string
	}{
		{name: "development memory", env: "development", mode: "memory", idempotency: true},
		{name: "production external", env: "production", mode: "external", idempotency: true, store: storage, locker: lock},
		{name: "external without idempotency", env: "production", mode: "external", store: storage},
		{name: "production explicit memory downgrade", env: "production", mode: "memory", allow: true},
		{name: "external storage required", env: "production", mode: "external", idempotency: true, locker: lock, want: "storage"},
		{name: "external lock required", env: "production", mode: "external", idempotency: true, store: storage, want: "lock"},
		{name: "production memory is rejected", env: "production", mode: "memory", want: "downgrade"},
		{name: "unknown mode", env: "test", mode: "redis", want: "mode"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateSharedState(test.env, test.mode, test.allow, test.idempotency, test.store, test.locker)
			if test.want == "" && err != nil {
				t.Fatalf("ValidateSharedState() error = %v", err)
			}
			if test.want != "" && (err == nil || !contains(err.Error(), test.want)) {
				t.Fatalf("ValidateSharedState() error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestSharedStorageNamespacesLimiterAndIdempotency(t *testing.T) {
	options := testOptions()
	storage := &contractStorage{}
	lock := &contractLock{}
	options.SharedStorage = storage
	options.IdempotencyLock = lock
	app := New(options)
	requests := []*http.Request{
		newJSONRequest("POST", "/api/v1/example/echo", `{"answer":1}`, "12345678-1234-1234-1234-123456789012"),
		newJSONRequest("POST", "/api/v1/example/validate", `{"name":"Ada","email":"ada@example.com","age":36}`, "12345678-1234-1234-1234-123456789012"),
		newJSONRequest("GET", "/api/v1/example/hello", "", ""),
	}
	for _, request := range requests {
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("%s request error = %v", request.URL.Path, err)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s status = %d", request.URL.Path, response.StatusCode)
		}
		response.Body.Close()
	}

	storage.mu.Lock()
	keys := append([]string(nil), storage.keys...)
	ttls := append([]time.Duration(nil), storage.ttls...)
	deadlineObserved := storage.deadlineObserved
	storage.mu.Unlock()
	if !hasPrefix(keys, "goexample:idempotency:/echo:") || !hasPrefix(keys, "goexample:idempotency:/validate:") {
		t.Fatalf("idempotency namespaces = %#v", keys)
	}
	if !hasPrefix(keys, "goexample:limiter:api:") {
		t.Fatalf("limiter namespace = %#v", keys)
	}
	for _, ttl := range ttls {
		if ttl <= 0 {
			t.Fatalf("shared state TTL = %s", ttl)
		}
	}
	if !deadlineObserved {
		t.Fatal("shared storage did not receive the request deadline")
	}
	lock.mu.Lock()
	lockKeys := append([]string(nil), lock.keys...)
	lock.mu.Unlock()
	if !hasPrefix(lockKeys, "goexample:idempotency:/echo:") {
		t.Fatalf("idempotency lock namespace = %#v", lockKeys)
	}
}

func TestSharedStorageFailureIsFailClosed(t *testing.T) {
	options := testOptions()
	options.SharedStorage = &contractStorage{err: errors.New("shared store unavailable")}
	options.IdempotencyLock = &contractLock{}
	app := New(options)

	response, err := app.Test(newJSONRequest("GET", "/api/v1/example/hello", "", ""))
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestRequestDeadlinePreservesTraceContext(t *testing.T) {
	options := testOptions()
	var traceObserved, deadlineObserved bool
	options.Endpoints = []string{"GET /api/v1/context"}
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/context", func(c fiber.Ctx) error {
			_, traceObserved = observability.FromContext(c.Context())
			_, deadlineObserved = c.Context().Deadline()
			return success(c, fiber.Map{"ok": true})
		})
	}
	app := New(options)
	request := newJSONRequest("GET", "/api/v1/context", "", "")
	request.Header.Set(observability.TraceparentHeader, "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	defer response.Body.Close()
	if !traceObserved || !deadlineObserved {
		t.Fatalf("handler context trace/deadline = %t/%t", traceObserved, deadlineObserved)
	}
}

func newJSONRequest(method, path, body, key string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	if key != "" {
		request.Header.Set("X-Idempotency-Key", key)
	}
	return request
}

// contractStorage is a deliberately small in-memory test double. It records
// the calls made by the middleware without pretending to be a distributed
// store or providing atomic operations that Fiber.Storage does not define.
type contractStorage struct {
	mu               sync.Mutex
	items            map[string][]byte
	keys             []string
	ttls             []time.Duration
	deadlineObserved bool
	err              error
}

func (s *contractStorage) GetWithContext(ctx context.Context, key string) ([]byte, error) {
	s.recordContext(ctx)
	return s.get(key)
}
func (s *contractStorage) Get(key string) ([]byte, error) { return s.get(key) }
func (s *contractStorage) SetWithContext(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	s.recordContext(ctx)
	return s.set(key, value, ttl)
}
func (s *contractStorage) Set(key string, value []byte, ttl time.Duration) error {
	return s.set(key, value, ttl)
}
func (s *contractStorage) DeleteWithContext(_ context.Context, key string) error {
	return s.delete(key)
}
func (s *contractStorage) Delete(key string) error                { return s.delete(key) }
func (s *contractStorage) ResetWithContext(context.Context) error { return nil }
func (s *contractStorage) Reset() error                           { return nil }
func (s *contractStorage) Close() error                           { return nil }

func (s *contractStorage) get(key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	value := s.items[key]
	if value == nil {
		return nil, nil
	}
	return append([]byte(nil), value...), nil
}

func (s *contractStorage) set(key string, value []byte, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	if s.items == nil {
		s.items = make(map[string][]byte)
	}
	s.items[key] = append([]byte(nil), value...)
	s.keys = append(s.keys, key)
	s.ttls = append(s.ttls, ttl)
	return nil
}

func (s *contractStorage) recordContext(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := ctx.Deadline(); ok {
		s.deadlineObserved = true
	}
}

func (s *contractStorage) delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, key)
	return nil
}

type contractLock struct {
	mu   sync.Mutex
	keys []string
}

func (l *contractLock) Lock(key string) error {
	l.mu.Lock()
	l.keys = append(l.keys, key)
	l.mu.Unlock()
	return nil
}

func (l *contractLock) Unlock(string) error { return nil }

func contains(value, want string) bool { return strings.Contains(value, want) }

func hasPrefix(values []string, prefix string) bool {
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

var _ fiber.Storage = (*contractStorage)(nil)
var _ idempotency.Locker = (*contractLock)(nil)
