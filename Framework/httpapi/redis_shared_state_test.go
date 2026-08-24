package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/sharedstate"
)

func TestRedisRateLimitIsAtomicAcrossApplications(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newHTTPTestRedis(t, server, "goexample:http-rate:")
	secondState := newHTTPTestRedis(t, server, "goexample:http-rate:")
	defer firstState.Close()
	defer secondState.Close()

	newApp := func(state *sharedstate.Redis) *fiber.App {
		options := testOptions()
		options.RateLimitMax = 1
		options.RateLimitWindow = time.Minute
		options.SharedStorage = state
		options.IdempotencyLock = state
		options.Endpoints = []string{"GET /api/v1/probe"}
		options.RegisterRoutes = func(v1 fiber.Router) {
			v1.Get("/probe", func(c fiber.Ctx) error { return success(c, fiber.Map{"ok": true}) })
		}
		return New(options)
	}
	apps := []*fiber.App{newApp(firstState), newApp(secondState)}
	start := make(chan struct{})
	statuses := make(chan int, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for _, app := range apps {
		wait.Add(1)
		go func(app *fiber.App) {
			defer wait.Done()
			<-start
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil))
			if err == nil {
				statuses <- response.StatusCode
				response.Body.Close()
			}
			errorsChannel <- err
		}(app)
	}
	close(start)
	wait.Wait()
	close(statuses)
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("request error = %v", err)
		}
	}
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusTooManyRequests] != 1 {
		t.Fatalf("statuses = %#v", counts)
	}

	server.Close()
	response, err := apps[0].Test(httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil))
	if err != nil {
		t.Fatalf("fail-closed request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status after Redis stopped = %d", response.StatusCode)
	}
}

func TestRedisIdempotencyIsCoordinatedAcrossApplications(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newHTTPTestRedis(t, server, "goexample:http-idempotency:")
	secondState := newHTTPTestRedis(t, server, "goexample:http-idempotency:")
	defer firstState.Close()
	defer secondState.Close()

	var executions atomic.Int32
	newApp := func(state *sharedstate.Redis) *fiber.App {
		options := testOptions()
		options.RateLimitMax = 1000
		options.SharedStorage = state
		options.IdempotencyLock = state
		options.Endpoints = []string{"POST /api/v1/mutation"}
		options.RegisterRoutes = func(v1 fiber.Router) {
			v1.Post("/mutation", requireJSON, idempotencyMiddleware("/mutation", time.Minute, state, state), func(c fiber.Ctx) error {
				executions.Add(1)
				time.Sleep(25 * time.Millisecond)
				return success(c, fiber.Map{"created": true})
			})
		}
		return New(options)
	}
	apps := []*fiber.App{newApp(firstState), newApp(secondState)}

	statuses, replayed := concurrentMutation(t, apps, "12345678-1234-1234-1234-123456789012", []string{`{"value":1}`, `{"value":1}`})
	if statuses[http.StatusOK] != 2 || replayed != 1 || executions.Load() != 1 {
		t.Fatalf("same request statuses/replayed/executions = %#v/%d/%d", statuses, replayed, executions.Load())
	}

	statuses, replayed = concurrentMutation(t, apps, "22345678-1234-1234-1234-123456789012", []string{`{"value":1}`, `{"value":2}`})
	if statuses[http.StatusOK] != 1 || statuses[http.StatusConflict] != 1 || replayed != 0 || executions.Load() != 2 {
		t.Fatalf("conflicting request statuses/replayed/executions = %#v/%d/%d", statuses, replayed, executions.Load())
	}

	foundTTL := false
	for _, key := range server.Keys() {
		if strings.Contains(key, "idempotency") && server.TTL(key) > 0 {
			foundTTL = true
			break
		}
	}
	if !foundTTL {
		t.Fatalf("no finite idempotency TTL in keys %#v", server.Keys())
	}
}

func concurrentMutation(t *testing.T, apps []*fiber.App, key string, bodies []string) (map[int]int, int) {
	t.Helper()
	type result struct {
		status   int
		replayed bool
		err      error
	}
	start := make(chan struct{})
	results := make(chan result, len(apps))
	var wait sync.WaitGroup
	for index, app := range apps {
		wait.Add(1)
		go func(app *fiber.App, body string) {
			defer wait.Done()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/mutation", strings.NewReader(body))
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			request.Header.Set("X-Idempotency-Key", key)
			<-start
			response, err := app.Test(request)
			if err != nil {
				results <- result{err: err}
				return
			}
			results <- result{
				status:   response.StatusCode,
				replayed: response.Header.Get("X-Idempotency-Replayed") == "true",
			}
			response.Body.Close()
		}(app, bodies[index])
	}
	close(start)
	wait.Wait()
	close(results)
	statuses := map[int]int{}
	replayed := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("request error = %v", result.err)
		}
		statuses[result.status]++
		if result.replayed {
			replayed++
		}
	}
	return statuses, replayed
}

func newHTTPTestRedis(t *testing.T, server *miniredis.Miniredis, prefix string) *sharedstate.Redis {
	t.Helper()
	state, err := sharedstate.NewRedis(context.Background(), sharedstate.RedisConfig{
		URL:                "redis://" + server.Addr() + "/0",
		KeyPrefix:          prefix,
		OperationTimeout:   100 * time.Millisecond,
		LockTTL:            time.Second,
		LockWaitTimeout:    500 * time.Millisecond,
		LockRetryInterval:  5 * time.Millisecond,
		PoolSize:           4,
		MinIdleConnections: 0,
	})
	if err != nil {
		t.Fatalf("NewRedis() error = %v", err)
	}
	return state
}
