package httpapi

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
)

func TestTraceparentContractOverTCP(t *testing.T) {
	app := New(testOptions())
	baseURL, _ := startLifecycleApp(t, app)
	request, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/example/hello", http.NoBody)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set(observability.TraceparentHeader, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	response, err := (&http.Client{Timeout: time.Second}).Do(request)
	if err != nil {
		t.Fatalf("traceparent request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	traceID, spanID, flags, ok := observability.ParseTraceparent(response.Header.Get(observability.TraceparentHeader))
	if !ok || traceID != "4bf92f3577b34da6a3ce929d0e0e4736" || spanID == "00f067aa0ba902b7" || flags != 1 {
		t.Fatalf("response traceparent = %q parsed as %q/%q/%d/%v", response.Header.Get(observability.TraceparentHeader), traceID, spanID, flags, ok)
	}
}

func TestTrustedProxyBoundaryOverTCP(t *testing.T) {
	const forwardedIP = "198.51.100.27"
	tests := []struct {
		name          string
		trusted       []string
		wantForwarded bool
	}{
		{name: "untrusted peer cannot spoof client IP"},
		{name: "allowlisted proxy supplies client IP", trusted: []string{"127.0.0.1"}, wantForwarded: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			options := testOptions()
			options.TrustedProxies = test.trusted
			options.RegisterRoutes = func(v1 fiber.Router) {
				v1.Get("/client-ip", func(c fiber.Ctx) error {
					return c.SendString(c.IP())
				})
			}
			baseURL, _ := startLifecycleApp(t, New(options))
			request, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/client-ip", http.NoBody)
			if err != nil {
				t.Fatalf("create request: %v", err)
			}
			request.Header.Set(fiber.HeaderXForwardedFor, forwardedIP)
			response, err := (&http.Client{Timeout: time.Second}).Do(request)
			if err != nil {
				t.Fatalf("client IP request: %v", err)
			}
			body, readErr := io.ReadAll(response.Body)
			response.Body.Close()
			if readErr != nil {
				t.Fatalf("read response: %v", readErr)
			}
			clientIP := strings.TrimSpace(string(body))
			if net.ParseIP(clientIP) == nil {
				t.Fatalf("client IP = %q", clientIP)
			}
			if gotForwarded := clientIP == forwardedIP; gotForwarded != test.wantForwarded {
				t.Fatalf("client IP = %q, want forwarded = %t", clientIP, test.wantForwarded)
			}
		})
	}
}

func TestTLSContractOverTCP(t *testing.T) {
	certificate, pool := testTLSCertificate(t)
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		t.Fatalf("listen TLS: %v", err)
	}
	app := New(testOptions())
	baseURL, shutdown := startLifecycleAppOnListener(t, app, listener, "https")
	clientTransport := &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS13},
	}
	client := &http.Client{Transport: clientTransport, Timeout: time.Second}
	t.Cleanup(clientTransport.CloseIdleConnections)

	response, err := client.Get(baseURL + "/api/v1/example/hello")
	if err != nil {
		shutdown()
		t.Fatalf("GET over TLS: %v", err)
	}
	defer response.Body.Close()
	if response.TLS == nil {
		t.Fatal("response did not complete a TLS handshake")
	}
	if response.ProtoMajor != 1 || response.StatusCode != http.StatusOK {
		t.Fatalf("response protocol/status = HTTP/%d.%d %d", response.ProtoMajor, response.ProtoMinor, response.StatusCode)
	}
}

func TestReadBufferRejectsOversizedHeaderOverTCP(t *testing.T) {
	options := testOptions()
	options.ReadBufferSize = 4 * 1024
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	request, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/example/hello", http.NoBody)
	if err != nil {
		t.Fatalf("create oversized-header request: %v", err)
	}
	request.Header.Set("X-Oversized", strings.Repeat("x", 8*1024))
	response, err := (&http.Client{Timeout: time.Second}).Do(request)
	if err != nil {
		t.Fatalf("oversized-header request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestHeaderFieldsTooLarge {
		t.Fatalf("oversized-header status = %d, want %d", response.StatusCode, http.StatusRequestHeaderFieldsTooLarge)
	}
}

func TestReadTimeoutRejectsIncompleteHeadersOverTCP(t *testing.T) {
	handlerCalled := make(chan struct{}, 1)
	options := testOptions()
	options.ReadTimeout = 50 * time.Millisecond
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/slow-headers", func(c fiber.Ctx) error {
			handlerCalled <- struct{}{}
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	address := strings.TrimPrefix(baseURL, "http://")

	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	defer connection.Close()
	started := time.Now()
	if err := connection.SetDeadline(started.Add(time.Second)); err != nil {
		t.Fatalf("set connection deadline: %v", err)
	}
	if _, err := fmt.Fprintf(
		connection,
		"GET /api/v1/slow-headers HTTP/1.1\r\nHost: %s\r\n",
		address,
	); err != nil {
		t.Fatalf("write incomplete request headers: %v", err)
	}

	statusLine, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		t.Fatalf("read timeout response: %v", err)
	}
	if !strings.Contains(statusLine, " 408 ") {
		t.Fatalf("timeout response status line = %q, want 408", statusLine)
	}
	if elapsed := time.Since(started); elapsed > 750*time.Millisecond {
		t.Fatalf("read timeout response took %s", elapsed)
	}
	select {
	case <-handlerCalled:
		t.Fatal("incomplete request reached the application handler")
	default:
	}
}

func TestReadTimeoutRejectsIncompleteBodyOverTCP(t *testing.T) {
	handlerCalled := make(chan struct{}, 1)
	options := testOptions()
	options.ReadTimeout = 50 * time.Millisecond
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Post("/slow-body", func(c fiber.Ctx) error {
			handlerCalled <- struct{}{}
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	address := strings.TrimPrefix(baseURL, "http://")

	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	defer connection.Close()
	started := time.Now()
	if err := connection.SetDeadline(started.Add(time.Second)); err != nil {
		t.Fatalf("set connection deadline: %v", err)
	}
	if _, err := fmt.Fprintf(
		connection,
		"POST /api/v1/slow-body HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nContent-Length: 32\r\n\r\n{\"partial\":",
		address,
	); err != nil {
		t.Fatalf("write incomplete request body: %v", err)
	}

	statusLine, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		t.Fatalf("read body timeout response: %v", err)
	}
	if !strings.Contains(statusLine, " 408 ") {
		t.Fatalf("body timeout response status line = %q, want 408", statusLine)
	}
	if elapsed := time.Since(started); elapsed > 750*time.Millisecond {
		t.Fatalf("body timeout response took %s", elapsed)
	}
	select {
	case <-handlerCalled:
		t.Fatal("incomplete request body reached the application handler")
	default:
	}
}

func TestStreamingResponseOverTCP(t *testing.T) {
	options := testOptions()
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/stream", func(c fiber.Ctx) error {
			c.Set(fiber.HeaderContentType, fiber.MIMETextPlain)
			return c.SendStreamWriter(func(writer *bufio.Writer) {
				for _, chunk := range []string{"first\n", "second\n"} {
					if _, err := writer.WriteString(chunk); err != nil {
						return
					}
					if err := writer.Flush(); err != nil {
						return
					}
				}
			})
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)

	response, err := (&http.Client{Timeout: time.Second}).Get(baseURL + "/api/v1/stream")
	if err != nil {
		t.Fatalf("GET streaming response: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read streaming response: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("streaming status = %d", response.StatusCode)
	}
	if response.Header.Get(fiber.HeaderContentType) != fiber.MIMETextPlain {
		t.Fatalf("streaming content type = %q", response.Header.Get(fiber.HeaderContentType))
	}
	if response.Header.Get(fiber.HeaderETag) != "" {
		t.Fatalf("streaming ETag = %q", response.Header.Get(fiber.HeaderETag))
	}
	if response.ContentLength != -1 {
		t.Fatalf("streaming Content-Length = %d, want unknown length", response.ContentLength)
	}
	if string(body) != "first\nsecond\n" {
		t.Fatalf("streaming body = %q", body)
	}
}

func TestWriteTimeoutStopsSlowReaderOverTCP(t *testing.T) {
	type streamResult struct {
		err       error
		completed bool
		written   int64
	}

	const (
		chunkSize  = 32 * 1024
		chunkCount = 32 * 1024
	)
	result := make(chan streamResult, 1)
	options := testOptions()
	options.WriteTimeout = 75 * time.Millisecond
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/slow-reader", func(c fiber.Ctx) error {
			c.Set(fiber.HeaderContentType, fiber.MIMETextEventStream)
			c.Set(fiber.HeaderCacheControl, "no-transform")
			return c.SendStreamWriter(func(writer *bufio.Writer) {
				var written int64
				chunk := make([]byte, chunkSize)
				state := uint64(0x9e3779b97f4a7c15)
				for range chunkCount {
					for index := range chunk {
						state ^= state << 13
						state ^= state >> 7
						state ^= state << 17
						chunk[index] = byte(state)
					}
					n, err := writer.Write(chunk)
					written += int64(n)
					if err != nil {
						result <- streamResult{err: err, written: written}
						return
					}
					if err := writer.Flush(); err != nil {
						result <- streamResult{err: err, written: written}
						return
					}
				}
				result <- streamResult{completed: true, written: written}
			})
		})
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	writeDeadline := make(chan time.Time, 1)
	writeFailure := make(chan error, 1)
	bufferedListener := &writeBufferListener{
		Listener:      listener,
		size:          1024,
		writeDeadline: writeDeadline,
		writeFailure:  writeFailure,
	}
	baseURL, _ := startLifecycleAppOnListener(t, New(options), bufferedListener, "http")
	address := strings.TrimPrefix(baseURL, "http://")
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	defer connection.Close()
	if tcpConnection, ok := connection.(*net.TCPConn); ok {
		if err := tcpConnection.SetReadBuffer(1024); err != nil {
			t.Fatalf("set client read buffer: %v", err)
		}
	}
	if _, err := fmt.Fprintf(
		connection,
		"GET /api/v1/slow-reader HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
		address,
	); err != nil {
		t.Fatalf("write request: %v", err)
	}
	select {
	case deadline := <-writeDeadline:
		if remaining := time.Until(deadline); remaining <= 0 || remaining > time.Second {
			t.Fatalf("server write deadline remaining = %s", remaining)
		}
	case <-time.After(time.Second):
		t.Fatal("server did not install a write deadline")
	}

	started := time.Now()
	select {
	case got := <-result:
		if got.completed {
			t.Fatalf("stream unexpectedly completed after writing %d bytes", got.written)
		}
		if got.err == nil {
			t.Fatal("stream stopped without a write error")
		}
		select {
		case writeErr := <-writeFailure:
			var timeoutError net.Error
			if !errors.As(writeErr, &timeoutError) || !timeoutError.Timeout() {
				t.Fatalf("socket write error = %v, want a timeout", writeErr)
			}
		default:
			t.Fatal("stream stopped without a socket write failure")
		}
		if elapsed := time.Since(started); elapsed > time.Second {
			t.Fatalf("write timeout took %s", elapsed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream remained blocked after the write timeout")
	}
}

func TestKeepAliveReuseAndIdleTimeoutOverTCP(t *testing.T) {
	var handled atomic.Int32
	options := testOptions()
	options.IdleTimeout = 75 * time.Millisecond
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/keep-alive", func(c fiber.Ctx) error {
			return c.SendString(fmt.Sprintf("response-%d", handled.Add(1)))
		})
	}
	baseURL, _ := startLifecycleApp(t, New(options))
	address := strings.TrimPrefix(baseURL, "http://")
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	defer connection.Close()
	reader := bufio.NewReader(connection)
	for requestNumber := 1; requestNumber <= 2; requestNumber++ {
		if _, err := fmt.Fprintf(
			connection,
			"GET /api/v1/keep-alive HTTP/1.1\r\nHost: %s\r\n\r\n",
			address,
		); err != nil {
			t.Fatalf("write keep-alive request %d: %v", requestNumber, err)
		}
		response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
		if err != nil {
			t.Fatalf("read keep-alive response %d: %v", requestNumber, err)
		}
		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatalf("read keep-alive body %d: %v", requestNumber, readErr)
		}
		if response.StatusCode != http.StatusOK || response.Close {
			t.Fatalf("keep-alive response %d status/close = %d/%t", requestNumber, response.StatusCode, response.Close)
		}
		if want := fmt.Sprintf("response-%d", requestNumber); string(body) != want {
			t.Fatalf("keep-alive body %d = %q, want %q", requestNumber, body, want)
		}
	}

	idleStarted := time.Now()
	if err := connection.SetReadDeadline(idleStarted.Add(time.Second)); err != nil {
		t.Fatalf("set idle read deadline: %v", err)
	}
	if _, err := reader.ReadByte(); err == nil {
		t.Fatal("idle keep-alive connection remained readable")
	} else if timeoutErr, ok := err.(net.Error); ok && timeoutErr.Timeout() {
		t.Fatalf("idle keep-alive connection was not closed: %v", err)
	}
	if elapsed := time.Since(idleStarted); elapsed > 750*time.Millisecond {
		t.Fatalf("idle keep-alive close took %s", elapsed)
	}
	if got := handled.Load(); got != 2 {
		t.Fatalf("handled requests = %d, want 2", got)
	}
}

func TestTCPHalfCloseStillReceivesCompleteResponse(t *testing.T) {
	options := testOptions()
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Post("/half-close", func(c fiber.Ctx) error {
			return c.SendString("complete-after-half-close")
		})
	}
	baseURL, _ := startLifecycleApp(t, New(options))
	address := strings.TrimPrefix(baseURL, "http://")
	rawConnection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	connection, ok := rawConnection.(*net.TCPConn)
	if !ok {
		rawConnection.Close()
		t.Fatalf("connection type = %T, want *net.TCPConn", rawConnection)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set connection deadline: %v", err)
	}
	if _, err := fmt.Fprintf(
		connection,
		"POST /api/v1/half-close HTTP/1.1\r\nHost: %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
		address,
	); err != nil {
		t.Fatalf("write half-close request: %v", err)
	}
	if err := connection.CloseWrite(); err != nil {
		t.Fatalf("half-close client write side: %v", err)
	}

	response, err := http.ReadResponse(bufio.NewReader(connection), &http.Request{Method: http.MethodPost})
	if err != nil {
		t.Fatalf("read half-close response: %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatalf("read half-close body: %v", readErr)
	}
	if response.StatusCode != http.StatusOK || string(body) != "complete-after-half-close" {
		t.Fatalf("half-close response status/body = %d/%q", response.StatusCode, body)
	}
}

func TestShutdownClosesIdleKeepAliveConnectionsOverTCP(t *testing.T) {
	options := testOptions()
	options.IdleTimeout = 5 * time.Second
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	tracked := &connectionTrackingListener{
		Listener: listener,
		accepted: make(chan struct{}, 1),
		closed:   make(chan struct{}, 1),
	}
	baseURL, shutdown := startLifecycleAppOnListener(t, New(options), tracked, "http")
	address := strings.TrimPrefix(baseURL, "http://")
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	defer connection.Close()
	if _, err := fmt.Fprintf(connection, "GET /livez HTTP/1.1\r\nHost: %s\r\n\r\n", address); err != nil {
		t.Fatalf("write keep-alive request: %v", err)
	}
	reader := bufio.NewReader(connection)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		t.Fatalf("read keep-alive response: %v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	select {
	case <-tracked.accepted:
	case <-time.After(time.Second):
		t.Fatal("listener did not observe the accepted connection")
	}
	if got := tracked.active.Load(); got != 1 {
		t.Fatalf("active connections before shutdown = %d, want 1", got)
	}

	shutdown()
	select {
	case <-tracked.closed:
	case <-time.After(time.Second):
		t.Fatal("idle keep-alive connection was not closed during shutdown")
	}
	if got := tracked.active.Load(); got != 0 {
		t.Fatalf("active connections after shutdown = %d, want 0", got)
	}
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set post-shutdown read deadline: %v", err)
	}
	if _, err := reader.ReadByte(); err == nil {
		t.Fatal("shutdown connection remained open")
	} else if timeoutErr, ok := err.(net.Error); ok && timeoutErr.Timeout() {
		t.Fatalf("shutdown connection did not close: %v", err)
	}
}

func TestAPIAdmissionRejectsExcessRequestsAndKeepsReadinessAvailable(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	options := testOptions()
	options.MaxInFlight = 1
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/limited", func(c fiber.Ctx) error {
			close(started)
			<-release
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })

	client := &http.Client{Timeout: time.Second}
	firstResult := make(chan error, 1)
	go func() {
		response, err := client.Get(baseURL + "/api/v1/limited")
		if err == nil {
			if response.StatusCode != http.StatusNoContent {
				err = fmt.Errorf("first request status = %d", response.StatusCode)
			}
			_ = response.Body.Close()
		}
		firstResult <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first request did not occupy the admission slot")
	}

	busy, err := client.Get(baseURL + "/api/v1/limited")
	if err != nil {
		t.Fatalf("busy request: %v", err)
	}
	if busy.StatusCode != http.StatusServiceUnavailable {
		busy.Body.Close()
		t.Fatalf("busy request status = %d, want %d", busy.StatusCode, http.StatusServiceUnavailable)
	}
	if busy.Header.Get(fiber.HeaderRetryAfter) != "1" {
		busy.Body.Close()
		t.Fatalf("Retry-After = %q, want 1", busy.Header.Get(fiber.HeaderRetryAfter))
	}
	_ = busy.Body.Close()

	ready, err := client.Get(baseURL + "/readyz")
	if err != nil {
		t.Fatalf("readiness request while busy: %v", err)
	}
	if ready.StatusCode != http.StatusOK {
		ready.Body.Close()
		t.Fatalf("readiness status while busy = %d, want %d", ready.StatusCode, http.StatusOK)
	}
	_ = ready.Body.Close()

	releaseOnce.Do(func() { close(release) })
	if err := <-firstResult; err != nil {
		t.Fatalf("first request: %v", err)
	}
}

func TestConnectionConcurrencyRejectsExcessConnectionsOverTCP(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	options := testOptions()
	options.MaxConnections = 1
	options.MaxInFlight = 8
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/connection-hold", func(c fiber.Ctx) error {
			close(started)
			<-release
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })

	client := &http.Client{Timeout: time.Second}
	firstResult := make(chan error, 1)
	go func() {
		response, err := client.Get(baseURL + "/api/v1/connection-hold")
		if err == nil {
			if response.StatusCode != http.StatusNoContent {
				err = fmt.Errorf("held request status = %d", response.StatusCode)
			}
			_ = response.Body.Close()
		}
		firstResult <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("connection-holding handler did not start")
	}

	startedSecond := time.Now()
	address := strings.TrimPrefix(baseURL, "http://")
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial excess connection: %v", err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set excess connection deadline: %v", err)
	}
	if _, err := fmt.Fprintf(connection, "GET /livez HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", address); err != nil {
		t.Fatalf("write excess connection request: %v", err)
	}
	statusLine, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		t.Fatalf("read excess connection response: %v", err)
	}
	if !strings.Contains(statusLine, " 503 ") {
		t.Fatalf("excess connection status line = %q, want 503", statusLine)
	}
	if elapsed := time.Since(startedSecond); elapsed > 500*time.Millisecond {
		t.Fatalf("excess connection rejection took %s", elapsed)
	}

	releaseOnce.Do(func() { close(release) })
	if err := <-firstResult; err != nil {
		t.Fatalf("held request: %v", err)
	}
}

func TestDrainingRejectsNewAPIRequestsButKeepsExistingWorkAndProbeContract(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	checker := health.New(time.Second)
	options := testOptions()
	options.Health = checker
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/drain-aware", func(c fiber.Ctx) error {
			close(started)
			<-release
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })

	client := &http.Client{Timeout: time.Second}
	firstResult := make(chan error, 1)
	go func() {
		response, err := client.Get(baseURL + "/api/v1/drain-aware")
		if err == nil {
			if response.StatusCode != http.StatusNoContent {
				err = fmt.Errorf("existing request status = %d", response.StatusCode)
			}
			_ = response.Body.Close()
		}
		firstResult <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("existing request did not start")
	}
	checker.SetDraining(true)

	newRequest, err := client.Get(baseURL + "/api/v1/drain-aware")
	if err != nil {
		t.Fatalf("new request while draining: %v", err)
	}
	if newRequest.StatusCode != http.StatusServiceUnavailable {
		newRequest.Body.Close()
		t.Fatalf("draining request status = %d, want %d", newRequest.StatusCode, http.StatusServiceUnavailable)
	}
	if newRequest.Header.Get(fiber.HeaderRetryAfter) != "1" {
		newRequest.Body.Close()
		t.Fatalf("draining Retry-After = %q, want 1", newRequest.Header.Get(fiber.HeaderRetryAfter))
	}
	_ = newRequest.Body.Close()

	ready, err := client.Get(baseURL + "/readyz")
	if err != nil {
		t.Fatalf("readiness while draining: %v", err)
	}
	if ready.StatusCode != http.StatusServiceUnavailable {
		ready.Body.Close()
		t.Fatalf("readiness while draining = %d, want %d", ready.StatusCode, http.StatusServiceUnavailable)
	}
	_ = ready.Body.Close()

	releaseOnce.Do(func() { close(release) })
	if err := <-firstResult; err != nil {
		t.Fatalf("existing request: %v", err)
	}
}

func TestRequestDeadlineCancelsHandlerOverTCP(t *testing.T) {
	observed := make(chan error, 1)
	options := testOptions()
	options.RequestTimeout = 30 * time.Millisecond
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/blocking", func(c fiber.Ctx) error {
			<-c.Context().Done()
			err := c.Context().Err()
			observed <- err
			return err
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)

	client := &http.Client{Timeout: time.Second}
	started := time.Now()
	response, err := client.Get(baseURL + "/api/v1/blocking")
	if err != nil {
		t.Fatalf("GET blocking route: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestTimeout {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusRequestTimeout)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("deadline response took %s", elapsed)
	}
	if err := <-observed; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("handler context error = %v, want context.DeadlineExceeded", err)
	}
}

func TestServerShutdownCancelsHandlerOverTCP(t *testing.T) {
	started := make(chan struct{})
	observed := make(chan error, 1)
	options := testOptions()
	options.RequestTimeout = 5 * time.Second
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/blocking", func(c fiber.Ctx) error {
			close(started)
			<-c.Context().Done()
			err := c.Context().Err()
			observed <- err
			return err
		})
	}
	app := New(options)
	baseURL, shutdown := startLifecycleApp(t, app)

	clientResult := make(chan error, 1)
	go func() {
		response, err := (&http.Client{Timeout: time.Second}).Get(baseURL + "/api/v1/blocking")
		if err == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			err = response.Body.Close()
		}
		clientResult <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("blocking handler did not start")
	}
	shutdownStarted := time.Now()
	shutdown()
	if elapsed := time.Since(shutdownStarted); elapsed > 500*time.Millisecond {
		t.Fatalf("shutdown took %s", elapsed)
	}
	if err := <-observed; !errors.Is(err, context.Canceled) {
		t.Fatalf("handler context error = %v, want context.Canceled", err)
	}
	select {
	case <-clientResult:
	case <-time.After(time.Second):
		t.Fatal("client request remained blocked after shutdown")
	}
}

func TestClientDisconnectIsNotPropagatedToApplicationContext(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	observed := make(chan error, 1)
	options := testOptions()
	options.RequestTimeout = 2 * time.Second
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/blocking", func(c fiber.Ctx) error {
			close(started)
			select {
			case <-c.Context().Done():
				observed <- c.Context().Err()
			case <-release:
				observed <- nil
			}
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
	app := New(options)
	baseURL, _ := startLifecycleApp(t, app)
	address := baseURL[len("http://"):]

	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial app: %v", err)
	}
	if _, err := fmt.Fprintf(
		connection,
		"GET /api/v1/blocking HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
		address,
	); err != nil {
		connection.Close()
		t.Fatalf("write request: %v", err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		connection.Close()
		t.Fatal("blocking handler did not start")
	}
	if tcpConnection, ok := connection.(*net.TCPConn); ok {
		_ = tcpConnection.SetLinger(0)
	}
	if err := connection.Close(); err != nil {
		t.Fatalf("close client connection: %v", err)
	}

	select {
	case err := <-observed:
		t.Fatalf("disconnect unexpectedly completed handler context: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-observed; err != nil {
		t.Fatalf("handler context error after release = %v", err)
	}
}

func startLifecycleApp(t *testing.T, app *fiber.App) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return startLifecycleAppOnListener(t, app, listener, "http")
}

type writeBufferListener struct {
	net.Listener
	size          int
	writeDeadline chan<- time.Time
	writeFailure  chan<- error
}

type connectionTrackingListener struct {
	net.Listener
	active   atomic.Int64
	accepted chan struct{}
	closed   chan struct{}
}

func (listener *connectionTrackingListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	listener.active.Add(1)
	select {
	case listener.accepted <- struct{}{}:
	default:
	}
	return &connectionTrackingConn{
		Conn: connection,
		onClose: func() {
			listener.active.Add(-1)
			select {
			case listener.closed <- struct{}{}:
			default:
			}
		},
	}, nil
}

type connectionTrackingConn struct {
	net.Conn
	closeOnce sync.Once
	onClose   func()
}

func (connection *connectionTrackingConn) Close() error {
	err := connection.Conn.Close()
	connection.closeOnce.Do(connection.onClose)
	return err
}

func (listener *writeBufferListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	tcpConnection, ok := connection.(*net.TCPConn)
	if !ok {
		_ = connection.Close()
		return nil, fmt.Errorf("accepted connection type %T, want *net.TCPConn", connection)
	}
	if err := tcpConnection.SetWriteBuffer(listener.size); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("set server write buffer: %w", err)
	}
	return &writeDeadlineConn{
		Conn:         connection,
		observed:     listener.writeDeadline,
		writeFailure: listener.writeFailure,
	}, nil
}

type writeDeadlineConn struct {
	net.Conn
	observed     chan<- time.Time
	writeFailure chan<- error
}

func (connection *writeDeadlineConn) Write(buffer []byte) (int, error) {
	written, err := connection.Conn.Write(buffer)
	if err != nil {
		select {
		case connection.writeFailure <- err:
		default:
		}
	}
	return written, err
}

func (connection *writeDeadlineConn) SetWriteDeadline(deadline time.Time) error {
	if err := connection.Conn.SetWriteDeadline(deadline); err != nil {
		return err
	}
	if !deadline.IsZero() {
		select {
		case connection.observed <- deadline:
		default:
		}
	}
	return nil
}

func startLifecycleAppOnListener(t *testing.T, app *fiber.App, listener net.Listener, scheme string) (string, func()) {
	t.Helper()
	serveErrors := make(chan error, 1)
	go func() {
		serveErrors <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true})
	}()

	var once sync.Once
	shutdown := func() {
		t.Helper()
		once.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := app.ShutdownWithContext(ctx); err != nil {
				t.Errorf("shutdown app: %v", err)
			}
			select {
			case err := <-serveErrors:
				if err != nil && !errors.Is(err, net.ErrClosed) {
					t.Errorf("serve app: %v", err)
				}
			case <-ctx.Done():
				t.Errorf("app did not stop: %v", ctx.Err())
			}
		})
	}
	t.Cleanup(shutdown)
	return scheme + "://" + listener.Addr().String(), shutdown
}

func testTLSCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate TLS key: %v", err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create TLS certificate: %v", err)
	}
	certificate, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}),
	)
	if err != nil {
		t.Fatalf("encode TLS certificate: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})) {
		t.Fatal("append test certificate to TLS trust pool")
	}
	return certificate, pool
}
