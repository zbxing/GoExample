package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewHTTPHandlerComposesWithStandardMiddleware(t *testing.T) {
	app := newTestApp()
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	wrapped := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Edge-Middleware", "standard")
		handler.ServeHTTP(response, request)
	})

	request := httptest.NewRequest(http.MethodGet, "/api/health", http.NoBody)
	response := httptest.NewRecorder()
	wrapped.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("X-Edge-Middleware") != "standard" {
		t.Fatalf("standard middleware header = %q", response.Header().Get("X-Edge-Middleware"))
	}
}

func TestNewHTTPHandlerRejectsNilApp(t *testing.T) {
	if _, err := NewHTTPHandler(nil); err == nil {
		t.Fatal("NewHTTPHandler(nil) error = nil")
	}
}

func TestNewHTTPHandlerDocumentsCancellationAndDeadlineBoundary(t *testing.T) {
	options := testOptions()
	options.RequestTimeout = 100 * time.Millisecond
	var executed atomic.Bool
	var callerCancellationObserved atomic.Bool
	var deadlineObserved atomic.Bool
	options.ApplicationQueries = []ApplicationQuery{{
		Path: "/standard-context",
		Handler: func(ctx context.Context) (any, error) {
			executed.Store(true)
			callerCancellationObserved.Store(ctx.Err() != nil)
			_, hasDeadline := ctx.Deadline()
			deadlineObserved.Store(hasDeadline)
			return map[string]bool{"bounded": hasDeadline}, nil
		},
	}}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/standard-context", http.NoBody).WithContext(requestContext)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !executed.Load() || callerCancellationObserved.Load() || !deadlineObserved.Load() {
		t.Fatalf("status/executed/caller-canceled/deadline = %d/%t/%t/%t", response.Code, executed.Load(), callerCancellationObserved.Load(), deadlineObserved.Load())
	}
}

func TestNewHTTPHandlerShutdownCancelsApplicationWork(t *testing.T) {
	options := testOptions()
	options.RequestTimeout = time.Minute
	started := make(chan struct{})
	canceled := make(chan error, 1)
	options.ApplicationQueries = []ApplicationQuery{{
		Path: "/standard-shutdown",
		Handler: func(ctx context.Context) (any, error) {
			close(started)
			<-ctx.Done()
			canceled <- ctx.Err()
			return nil, ctx.Err()
		},
	}}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	served := make(chan struct{})
	go func() {
		defer close(served)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/standard-shutdown", http.NoBody))
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("standard handler did not start application work")
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownContext); err != nil {
		t.Fatalf("ShutdownWithContext() error = %v", err)
	}
	select {
	case err := <-canceled:
		if err != context.Canceled {
			t.Fatalf("application cancellation = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("standard handler application work was not canceled")
	}
	select {
	case <-served:
	case <-time.After(time.Second):
		t.Fatal("standard handler did not return after shutdown")
	}
}
