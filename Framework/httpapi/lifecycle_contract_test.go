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
	if string(body) != "first\nsecond\n" {
		t.Fatalf("streaming body = %q", body)
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
