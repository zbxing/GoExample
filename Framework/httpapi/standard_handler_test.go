package httpapi

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
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

func TestNewHTTPHandlerPropagatesRequestCancellation(t *testing.T) {
	options := testOptions()
	options.RequestTimeout = time.Minute
	started := make(chan struct{})
	canceled := make(chan error, 1)
	options.ApplicationQueries = []ApplicationQuery{{
		Path: "/standard-context",
		Handler: func(ctx context.Context) (any, error) {
			close(started)
			<-ctx.Done()
			canceled <- ctx.Err()
			return map[string]bool{"canceled": true}, nil
		},
	}}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	requestContext, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/api/v1/standard-context", http.NoBody).WithContext(requestContext)
	response := httptest.NewRecorder()
	served := make(chan struct{})
	go func() {
		defer close(served)
		handler.ServeHTTP(response, request)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("standard handler did not start application work")
	}
	cancel()
	select {
	case err := <-canceled:
		if err != context.Canceled {
			t.Fatalf("application cancellation = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("request cancellation did not reach application work")
	}
	select {
	case <-served:
	case <-time.After(time.Second):
		t.Fatal("standard handler did not return after request cancellation")
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestNewHTTPHandlerPropagatesStandardClientDisconnect(t *testing.T) {
	options := testOptions()
	options.RequestTimeout = time.Minute
	started := make(chan struct{})
	canceled := make(chan error, 1)
	options.ApplicationQueries = []ApplicationQuery{{
		Path: "/standard-disconnect",
		Handler: func(ctx context.Context) (any, error) {
			close(started)
			<-ctx.Done()
			canceled <- ctx.Err()
			return map[string]bool{"canceled": true}, nil
		},
	}}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	connection, err := net.DialTimeout("tcp", server.Listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("dial standard server: %v", err)
	}
	if _, err := fmt.Fprintf(connection, "GET /api/v1/standard-disconnect HTTP/1.1\r\nHost: standard.test\r\n\r\n"); err != nil {
		connection.Close()
		t.Fatalf("write standard request: %v", err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		connection.Close()
		t.Fatal("standard server did not start application work")
	}
	if err := connection.Close(); err != nil {
		t.Fatalf("close standard client connection: %v", err)
	}
	select {
	case err := <-canceled:
		if err != context.Canceled {
			t.Fatalf("application disconnect cancellation = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("standard client disconnect did not cancel application work")
	}
}

func TestNewHTTPHandlerPreservesCallerDeadlineAndContextValue(t *testing.T) {
	type contextKey struct{}
	options := testOptions()
	options.RequestTimeout = time.Minute
	observed := make(chan struct {
		deadline time.Time
		value    string
	}, 1)
	options.ApplicationQueries = []ApplicationQuery{{
		Path: "/standard-context",
		Handler: func(ctx context.Context) (any, error) {
			deadline, _ := ctx.Deadline()
			value, _ := ctx.Value(contextKey{}).(string)
			observed <- struct {
				deadline time.Time
				value    string
			}{deadline: deadline, value: value}
			return map[string]bool{"bounded": !deadline.IsZero()}, nil
		},
	}}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	callerDeadline := time.Now().Add(10 * time.Second)
	requestContext, cancel := context.WithDeadline(context.WithValue(context.Background(), contextKey{}, "standard-middleware"), callerDeadline)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/standard-context", http.NoBody).WithContext(requestContext)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	result := <-observed
	if response.Code != http.StatusOK || !result.deadline.Equal(callerDeadline) || result.value != "standard-middleware" {
		t.Fatalf("status/deadline/value = %d/%s/%q, want %d/%s/%q", response.Code, result.deadline, result.value, http.StatusOK, callerDeadline, "standard-middleware")
	}
}

func TestNewHTTPHandlerRemovesInternalContextHeader(t *testing.T) {
	options := testOptions()
	observed := make(chan string, 1)
	options.RegisterRoutes = func(router fiber.Router) {
		router.Get("/standard-header", func(c fiber.Ctx) error {
			observed <- c.Get(standardRequestContextHeader)
			return c.SendStatus(http.StatusNoContent)
		})
	}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/standard-header", http.NoBody)
	request.Header.Set(standardRequestContextHeader, "attacker-controlled")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	internalHeader := <-observed
	if response.Code != http.StatusNoContent || internalHeader != "" {
		t.Fatalf("status/internal header = %d/%q, want %d/empty", response.Code, internalHeader, http.StatusNoContent)
	}

	nativeRequest := httptest.NewRequest(http.MethodGet, "/api/v1/standard-header", http.NoBody)
	nativeRequest.Header.Set(standardRequestContextHeader, "attacker-controlled")
	nativeResponse, err := app.Test(nativeRequest)
	if err != nil {
		t.Fatalf("app.Test(native request) error = %v", err)
	}
	defer nativeResponse.Body.Close()
	if nativeResponse.StatusCode != http.StatusNoContent || <-observed != "" {
		t.Fatalf("native status/internal header = %d/non-empty, want %d/empty", nativeResponse.StatusCode, http.StatusNoContent)
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
