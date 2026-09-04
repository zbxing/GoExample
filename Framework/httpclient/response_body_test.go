package httpclient

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel/codes"
)

func TestLimitResponseBodyRejectsKnownOversizeBeforeRead(t *testing.T) {
	body := &trackingReadCloser{Reader: strings.NewReader("oversized")}
	response := &http.Response{Body: body, ContentLength: int64(len("oversized"))}

	err := LimitResponseBody(response, 4)
	if !errors.Is(err, ErrResponseBodyTooLarge) {
		t.Fatalf("LimitResponseBody() error = %v, want ErrResponseBodyTooLarge", err)
	}
	if !body.closed || body.reads != 0 {
		t.Fatalf("known oversized body close/reads = %t/%d, want true/0", body.closed, body.reads)
	}
}

func TestLimitResponseBodyBoundsChunkedStreamingResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(response, "abc")
		response.(http.Flusher).Flush()
		_, _ = io.WriteString(response, "def")
	}))
	t.Cleanup(server.Close)

	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if response.ContentLength != -1 {
		response.Body.Close()
		t.Fatalf("ContentLength = %d, want unknown chunked response", response.ContentLength)
	}
	if err := LimitResponseBody(response, 5); err != nil {
		response.Body.Close()
		t.Fatalf("LimitResponseBody() error = %v", err)
	}
	body, err := io.ReadAll(response.Body)
	if !errors.Is(err, ErrResponseBodyTooLarge) {
		t.Fatalf("ReadAll() error = %v, want ErrResponseBodyTooLarge", err)
	}
	if string(body) != "abcde" {
		t.Fatalf("bounded body = %q, want %q", body, "abcde")
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() after limit error = %v", err)
	}
}

func TestLimitResponseBodyRecordsBoundedClientSpanError(t *testing.T) {
	recorder, provider := testTracerProvider(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(response, "abc")
		response.(http.Flusher).Flush()
		_, _ = io.WriteString(response, "secret")
	}))
	t.Cleanup(server.Close)
	client, err := New(Config{TracerProvider: provider})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request, err := http.NewRequest(http.MethodGet, server.URL+"/private", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	if err := LimitResponseBody(response, 5); err != nil {
		response.Body.Close()
		t.Fatalf("LimitResponseBody() error = %v", err)
	}
	if _, err := io.ReadAll(response.Body); !errors.Is(err, ErrResponseBodyTooLarge) {
		t.Fatalf("ReadAll() error = %v, want ErrResponseBodyTooLarge", err)
	}
	span := onlyEndedSpan(t, recorder)
	attributes := spanAttributes(span)
	if attributes["error.type"].AsString() != "response_body_too_large" || span.Status().Code != codes.Error {
		t.Fatalf("oversized body span status/attributes = %#v/%#v", span.Status(), attributes)
	}
	if strings.Contains(span.Status().Description, "private") || strings.Contains(span.Status().Description, "secret") {
		t.Fatalf("oversized body span leaked response data: %q", span.Status().Description)
	}
}

func TestLimitResponseBodyPreservesTruncatedContentLengthError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Length", "10")
		_, _ = io.WriteString(response, "short")
	}))
	t.Cleanup(server.Close)

	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	defer response.Body.Close()
	if err := LimitResponseBody(response, 10); err != nil {
		t.Fatalf("LimitResponseBody() error = %v", err)
	}
	body, err := io.ReadAll(response.Body)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("ReadAll() error = %v, want io.ErrUnexpectedEOF", err)
	}
	if string(body) != "short" {
		t.Fatalf("truncated body = %q, want %q", body, "short")
	}
}

func TestLimitResponseBodyAllowsCallerToCloseStreamingResponseEarly(t *testing.T) {
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(response, "start")
		response.(http.Flusher).Flush()
		<-request.Context().Done()
		close(stopped)
	}))
	t.Cleanup(server.Close)

	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if err := LimitResponseBody(response, 1024); err != nil {
		response.Body.Close()
		t.Fatalf("LimitResponseBody() error = %v", err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("server request did not stop after the caller closed the response body")
	}
}

func TestLimitResponseBodyPreservesCallerCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(response, "start")
		response.(http.Flusher).Flush()
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, http.NoBody)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer response.Body.Close()
	if err := LimitResponseBody(response, 1024); err != nil {
		t.Fatalf("LimitResponseBody() error = %v", err)
	}
	buffer := make([]byte, len("start"))
	if _, err := io.ReadFull(response.Body, buffer); err != nil {
		t.Fatalf("ReadFull() error = %v", err)
	}
	cancel()
	if _, err := io.ReadAll(response.Body); !errors.Is(err, context.Canceled) {
		t.Fatalf("ReadAll() error = %v, want context.Canceled", err)
	}
}

func TestLimitResponseBodyPreservesConnectionReuseAfterCompleteRead(t *testing.T) {
	var (
		addressesMu sync.Mutex
		addresses   []string
	)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		addressesMu.Lock()
		addresses = append(addresses, request.RemoteAddr)
		addressesMu.Unlock()
		_, _ = io.WriteString(response, "ok")
	}))
	t.Cleanup(server.Close)

	client := &http.Client{}
	for range 2 {
		response, err := client.Get(server.URL)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if err := LimitResponseBody(response, 2); err != nil {
			response.Body.Close()
			t.Fatalf("LimitResponseBody() error = %v", err)
		}
		body, err := io.ReadAll(response.Body)
		if err != nil {
			response.Body.Close()
			t.Fatalf("ReadAll() error = %v", err)
		}
		if err := response.Body.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		if string(body) != "ok" {
			t.Fatalf("body = %q, want ok", body)
		}
	}
	client.CloseIdleConnections()

	addressesMu.Lock()
	defer addressesMu.Unlock()
	if len(addresses) != 2 || addresses[0] != addresses[1] {
		t.Fatalf("remote addresses = %#v, want one reused connection", addresses)
	}
}

func TestLimitResponseBodyRejectsInvalidArguments(t *testing.T) {
	if err := LimitResponseBody(nil, 1); err == nil {
		t.Fatal("LimitResponseBody(nil) error = nil")
	}
	if err := LimitResponseBody(&http.Response{}, 1); err == nil {
		t.Fatal("LimitResponseBody(response without body) error = nil")
	}
	if err := LimitResponseBody(&http.Response{Body: http.NoBody}, 0); err == nil {
		t.Fatal("LimitResponseBody(zero limit) error = nil")
	}
}

type trackingReadCloser struct {
	io.Reader
	reads  int
	closed bool
}

func (body *trackingReadCloser) Read(buffer []byte) (int, error) {
	body.reads++
	return body.Reader.Read(buffer)
}

func (body *trackingReadCloser) Close() error {
	body.closed = true
	return nil
}
