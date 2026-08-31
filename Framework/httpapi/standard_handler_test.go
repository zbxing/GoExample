package httpapi

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

type unwrappingResponseWriter struct {
	http.ResponseWriter
}

func (response unwrappingResponseWriter) Unwrap() http.ResponseWriter {
	return response.ResponseWriter
}

type opaqueResponseWriter struct {
	header http.Header
}

func (response *opaqueResponseWriter) Header() http.Header {
	return response.header
}

func (*opaqueResponseWriter) Write(body []byte) (int, error) {
	return len(body), nil
}

func (*opaqueResponseWriter) WriteHeader(int) {}

type cyclicResponseWriter struct {
	*opaqueResponseWriter
}

func (response *cyclicResponseWriter) Unwrap() http.ResponseWriter {
	return response
}

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

func TestStandardStreamingResponseWriterPreservesUnsupportedWriters(t *testing.T) {
	opaque := &opaqueResponseWriter{header: make(http.Header)}
	cyclic := &cyclicResponseWriter{opaqueResponseWriter: &opaqueResponseWriter{header: make(http.Header)}}
	for name, writer := range map[string]http.ResponseWriter{
		"opaque": opaque,
		"cyclic": cyclic,
	} {
		t.Run(name, func(t *testing.T) {
			adapted := standardStreamingResponseWriter(writer)
			if adapted != writer {
				t.Fatalf("adapted writer = %T, want original %T", adapted, writer)
			}
			if _, ok := adapted.(http.Flusher); ok {
				t.Fatal("writer without a bounded flush path unexpectedly implements http.Flusher")
			}
		})
	}

	recorder := httptest.NewRecorder()
	if adapted := standardStreamingResponseWriter(recorder); adapted != recorder {
		t.Fatalf("direct flusher = %T, want original %T", adapted, recorder)
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

func TestNewHTTPHandlerStreamsThroughUnwrappingStandardMiddleware(t *testing.T) {
	releaseSecondChunk := make(chan struct{})
	app := newStandardStreamingTestApp(releaseSecondChunk)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	wrapped := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		handler.ServeHTTP(unwrappingResponseWriter{ResponseWriter: response}, request)
	})
	server := httptest.NewServer(wrapped)
	defer server.Close()
	assertIncrementalStandardStream(t, &http.Client{Timeout: 3 * time.Second}, server.URL, releaseSecondChunk, 1, "HTTP/1.1")
}

func TestNewHTTPHandlerStreamsIncrementallyOverHTTP2(t *testing.T) {
	releaseSecondChunk := make(chan struct{})
	app := newStandardStreamingTestApp(releaseSecondChunk)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	client := server.Client()
	client.Timeout = 3 * time.Second
	assertIncrementalStandardStream(t, client, server.URL, releaseSecondChunk, 2, "HTTP/2")
}

func newStandardStreamingTestApp(releaseSecondChunk <-chan struct{}) *fiber.App {
	options := testOptions()
	options.RegisterRoutes = func(router fiber.Router) {
		router.Get("/standard-stream", func(c fiber.Ctx) error {
			c.Set(fiber.HeaderContentType, fiber.MIMETextPlain)
			c.Set("X-GoExample-Protocol", c.Protocol())
			return c.SendStreamWriter(func(writer *bufio.Writer) {
				if _, err := writer.WriteString("first\n"); err != nil {
					return
				}
				if err := writer.Flush(); err != nil {
					return
				}
				<-releaseSecondChunk
				_, _ = writer.WriteString("second\n")
			})
		})
	}
	return New(options)
}

func assertIncrementalStandardStream(
	t *testing.T,
	client *http.Client,
	serverURL string,
	releaseSecondChunk chan struct{},
	expectedProtocolMajor int,
	expectedApplicationProtocol string,
) {
	t.Helper()
	type firstChunkResult struct {
		status              int
		protocolMajor       int
		applicationProtocol string
		contentType         string
		chunk               string
		err                 error
	}
	firstChunk := make(chan firstChunkResult, 1)
	remainder := make(chan struct {
		body string
		err  error
	}, 1)
	go func() {
		response, err := client.Get(serverURL + "/api/v1/standard-stream")
		if err != nil {
			firstChunk <- firstChunkResult{err: err}
			return
		}
		defer response.Body.Close()
		reader := bufio.NewReader(response.Body)
		chunk, readErr := reader.ReadString('\n')
		firstChunk <- firstChunkResult{
			status:              response.StatusCode,
			protocolMajor:       response.ProtoMajor,
			applicationProtocol: response.Header.Get("X-GoExample-Protocol"),
			contentType:         response.Header.Get(fiber.HeaderContentType),
			chunk:               chunk,
			err:                 readErr,
		}
		body, readErr := io.ReadAll(reader)
		remainder <- struct {
			body string
			err  error
		}{body: string(body), err: readErr}
	}()

	select {
	case result := <-firstChunk:
		if result.err != nil {
			close(releaseSecondChunk)
			t.Fatalf("read first streaming chunk: %v", result.err)
		}
		if result.status != http.StatusOK ||
			result.protocolMajor != expectedProtocolMajor ||
			result.applicationProtocol != expectedApplicationProtocol ||
			result.contentType != fiber.MIMETextPlain ||
			result.chunk != "first\n" {
			close(releaseSecondChunk)
			t.Fatalf(
				"first streaming response = %d/HTTP%d/%q/%q/%q, want %d/HTTP%d/%q/%q/%q",
				result.status,
				result.protocolMajor,
				result.applicationProtocol,
				result.contentType,
				result.chunk,
				http.StatusOK,
				expectedProtocolMajor,
				expectedApplicationProtocol,
				fiber.MIMETextPlain,
				"first\n",
			)
		}
	case <-time.After(time.Second):
		close(releaseSecondChunk)
		t.Fatal("first streaming chunk was buffered behind the second chunk")
	}

	close(releaseSecondChunk)
	select {
	case result := <-remainder:
		if result.err != nil || result.body != "second\n" {
			t.Fatalf("streaming remainder = %q/%v, want %q/nil", result.body, result.err, "second\n")
		}
	case <-time.After(time.Second):
		t.Fatal("streaming response did not finish after releasing the second chunk")
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
