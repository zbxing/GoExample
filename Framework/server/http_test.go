package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zbxing/goexample/Framework/health"
)

func TestRunHTTPServesDrainsAndStops(t *testing.T) {
	address := reserveHTTPAddress(t)
	checker := health.New(time.Second)
	observer := &recordingHTTPConnectionObserver{}
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	var shutdownCalled atomic.Bool
	var shutdownDeadline atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(http.StatusNoContent)
			}),
			ApplicationShutdown: func(ctx context.Context) error {
				shutdownCalled.Store(true)
				_, hasDeadline := ctx.Deadline()
				shutdownDeadline.Store(hasDeadline)
				return nil
			},
			ConnectionObserver: observer,
			Health:             checker,
			Logger:             logger,
			Name:               "test",
			Version:            "test",
			Environment:        "test",
			Address:            address,
			ShutdownTimeout:    2 * time.Second,
		})
	}()

	waitForHTTPStatus(t, address, http.StatusNoContent)
	cancel()
	select {
	case err := <-errorsCh:
		if err != nil {
			t.Fatalf("RunHTTP() error = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("standard HTTP server did not stop")
	}
	if checker.Readiness(context.Background()).Ready {
		t.Fatal("health checker is ready after draining")
	}
	if !shutdownCalled.Load() || !shutdownDeadline.Load() {
		t.Fatalf("application shutdown called/deadline = %t/%t", shutdownCalled.Load(), shutdownDeadline.Load())
	}
	capacity, states := observer.snapshot()
	if capacity != defaultHTTPMaxConnections || !containsHTTPConnectionState(states, http.StateNew) ||
		!containsHTTPConnectionState(states, http.StateActive) || !containsHTTPConnectionState(states, http.StateClosed) {
		t.Fatalf("connection observer capacity/states = %d/%v", capacity, states)
	}
	logs := output.String()
	if !strings.Contains(logs, "server_started") || !strings.Contains(logs, "server_stopped") || !strings.Contains(logs, `"transport":"net_http"`) {
		t.Fatalf("lifecycle logs = %s", logs)
	}
}

func TestRunHTTPIsolatesConnectionObserverPanic(t *testing.T) {
	address := reserveHTTPAddress(t)
	ctx, cancel := context.WithCancel(context.Background())
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler:            http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusNoContent) }),
			ConnectionObserver: panicHTTPConnectionObserver{},
			Address:            address,
			ShutdownTimeout:    time.Second,
			ReadHeaderTimeout:  time.Second,
			MaxConnections:     1,
		})
	}()
	waitForHTTPStatus(t, address, http.StatusNoContent)
	cancel()
	if err := <-errorsCh; err != nil {
		t.Fatalf("RunHTTP() error = %v", err)
	}
}

func TestRunHTTPBoundsSlowRequestHeaders(t *testing.T) {
	address := reserveHTTPAddress(t)
	var handled atomic.Int64
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				handled.Add(1)
				response.WriteHeader(http.StatusNoContent)
			}),
			Address:           address,
			ReadHeaderTimeout: 50 * time.Millisecond,
			ShutdownTimeout:   time.Second,
		})
	}()
	waitForHTTPStatus(t, address, http.StatusNoContent)
	baseline := handled.Load()

	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("dial standard HTTP server: %v", err)
	}
	defer connection.Close()
	if _, err := io.WriteString(connection, "GET / HTTP/1.1\r\nHost: example.test\r\nX-Slow:"); err != nil {
		t.Fatalf("write partial request: %v", err)
	}
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	buffer := make([]byte, 1)
	if _, err := connection.Read(buffer); err == nil {
		t.Fatal("slow request header connection remained open")
	}
	if handled.Load() != baseline {
		t.Fatalf("partial request reached handler: calls = %d, want %d", handled.Load(), baseline)
	}

	cancel()
	if err := <-errorsCh; err != nil {
		t.Fatalf("RunHTTP() error = %v", err)
	}
}

func TestRunHTTPBoundsAcceptedConnections(t *testing.T) {
	address := reserveHTTPAddress(t)
	started := make(chan struct{})
	release := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/hold" {
					close(started)
					<-release
				}
				response.WriteHeader(http.StatusNoContent)
			}),
			Address:         address,
			MaxConnections:  1,
			ShutdownTimeout: time.Second,
		})
	}()
	waitForHTTPStatus(t, address, http.StatusNoContent)

	firstClient := &http.Client{
		Timeout:   time.Second,
		Transport: &http.Transport{DisableKeepAlives: true},
	}
	firstErr := make(chan error, 1)
	go func() {
		response, err := firstClient.Get("http://" + address + "/hold")
		if response != nil {
			response.Body.Close()
		}
		firstErr <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first connection did not reach the blocking handler")
	}

	blockedClient := &http.Client{Timeout: 100 * time.Millisecond}
	response, err := blockedClient.Get("http://" + address + "/blocked")
	if response != nil {
		response.Body.Close()
	}
	if err == nil {
		t.Fatal("request crossed the accepted-connection bound")
	}
	close(release)
	if err := <-firstErr; err != nil {
		t.Fatalf("release first connection: %v", err)
	}
	waitForHTTPStatus(t, address, http.StatusNoContent)

	cancel()
	if err := <-errorsCh; err != nil {
		t.Fatalf("RunHTTP() error = %v", err)
	}
}

func TestRunHTTPForcesBoundedShutdown(t *testing.T) {
	address := reserveHTTPAddress(t)
	started := make(chan struct{})
	canceled := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
				close(started)
				<-request.Context().Done()
				close(canceled)
			}),
			Address:         address,
			ShutdownTimeout: 50 * time.Millisecond,
		})
	}()

	clientErr := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		deadline := time.Now().Add(2 * time.Second)
		for {
			response, err := client.Get("http://" + address)
			if response != nil {
				response.Body.Close()
			}
			select {
			case <-started:
				clientErr <- err
				return
			default:
			}
			if err == nil || time.Now().After(deadline) {
				clientErr <- err
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("blocking handler did not start")
	}
	cancel()
	select {
	case err := <-errorsCh:
		if err == nil || !strings.Contains(err.Error(), "shutdown") || !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("RunHTTP() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("standard HTTP shutdown exceeded its budget")
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("forced close did not cancel request context")
	}
	<-clientErr
}

func TestRunHTTPClosesHijackedConnectionsDuringShutdown(t *testing.T) {
	testRunHTTPClosesHijackedConnectionsDuringShutdown(t, nil, func(address string) (net.Conn, error) {
		return net.DialTimeout("tcp", address, 100*time.Millisecond)
	})
}

func TestRunHTTPClosesTLSHijackedConnectionsDuringShutdown(t *testing.T) {
	serverTLS, clientTLS := testHTTPServerTLS(t)
	serverTLS.NextProtos = []string{"http/1.1"}
	clientTLS.NextProtos = []string{"http/1.1"}
	testRunHTTPClosesHijackedConnectionsDuringShutdown(t, serverTLS, func(address string) (net.Conn, error) {
		dialer := &net.Dialer{Timeout: 100 * time.Millisecond}
		return tls.DialWithDialer(dialer, "tcp", address, clientTLS)
	})
}

func testRunHTTPClosesHijackedConnectionsDuringShutdown(
	t *testing.T,
	serverTLS *tls.Config,
	dial func(string) (net.Conn, error),
) {
	t.Helper()
	address := reserveHTTPAddress(t)
	hijackedConnection := make(chan net.Conn, 1)
	handlerError := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				hijacker, ok := response.(http.Hijacker)
				if !ok {
					handlerError <- errors.New("response writer does not support hijacking")
					return
				}
				connection, buffer, err := hijacker.Hijack()
				if err != nil {
					handlerError <- err
					return
				}
				if _, err := buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n"); err != nil {
					_ = connection.Close()
					handlerError <- err
					return
				}
				if err := buffer.Flush(); err != nil {
					_ = connection.Close()
					handlerError <- err
					return
				}
				hijackedConnection <- connection
			}),
			Address:         address,
			ShutdownTimeout: time.Second,
			TLSConfig:       serverTLS,
		})
	}()

	var clientConnection net.Conn
	deadline := time.Now().Add(3 * time.Second)
	for {
		connection, err := dial(address)
		if err == nil {
			clientConnection = connection
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("dial standard HTTP server: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	defer clientConnection.Close()
	if _, err := io.WriteString(clientConnection, "GET /upgrade HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n"); err != nil {
		cancel()
		t.Fatalf("write upgrade request: %v", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(clientConnection), &http.Request{Method: http.MethodGet})
	if err != nil {
		cancel()
		t.Fatalf("read upgrade response: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusSwitchingProtocols {
		cancel()
		t.Fatalf("upgrade status = %d, want %d", response.StatusCode, http.StatusSwitchingProtocols)
	}

	var serverConnection net.Conn
	select {
	case serverConnection = <-hijackedConnection:
		defer serverConnection.Close()
	case err := <-handlerError:
		cancel()
		t.Fatalf("hijack request: %v", err)
	case <-time.After(time.Second):
		cancel()
		t.Fatal("connection was not hijacked")
	}

	cancel()
	select {
	case err := <-errorsCh:
		if err != nil {
			t.Fatalf("RunHTTP() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("standard HTTP shutdown exceeded its budget")
	}
	if err := clientConnection.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
		t.Fatalf("set client read deadline: %v", err)
	}
	buffer := make([]byte, 1)
	if _, err := clientConnection.Read(buffer); err == nil {
		t.Fatal("hijacked connection remained readable after shutdown")
	} else if netError, ok := err.(net.Error); ok && netError.Timeout() {
		t.Fatal("hijacked connection remained open after shutdown")
	}
}

func TestRunHTTPServesTLS12AndHTTP2(t *testing.T) {
	address := reserveHTTPAddress(t)
	serverTLS, clientTLS := testHTTPServerTLS(t)
	serverTLS.MinVersion = 0
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(http.StatusNoContent)
			}),
			Address:         address,
			ShutdownTimeout: 2 * time.Second,
			TLSConfig:       serverTLS,
		})
	}()

	transport := &http.Transport{
		ForceAttemptHTTP2: true,
		TLSClientConfig:   clientTLS,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: 500 * time.Millisecond, Transport: transport}
	deadline := time.Now().Add(3 * time.Second)
	var response *http.Response
	for {
		var err error
		response, err = client.Get("https://" + address)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("TLS server did not become ready: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if response.StatusCode != http.StatusNoContent || response.ProtoMajor != 2 {
		response.Body.Close()
		t.Fatalf("TLS response status/protocol = %d/%q, want %d/HTTP/2", response.StatusCode, response.Proto, http.StatusNoContent)
	}
	if response.TLS == nil || response.TLS.Version < tls.VersionTLS12 {
		response.Body.Close()
		t.Fatalf("TLS connection state = %#v, want TLS 1.2 or newer", response.TLS)
	}
	if serverTLS.MinVersion != 0 || len(serverTLS.NextProtos) != 0 {
		response.Body.Close()
		t.Fatalf("caller TLS config was mutated: MinVersion/NextProtos = %d/%v", serverTLS.MinVersion, serverTLS.NextProtos)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("close TLS response body: %v", err)
	}

	cancel()
	select {
	case err := <-errorsCh:
		if err != nil {
			t.Fatalf("RunHTTP() error = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("TLS HTTP shutdown exceeded its budget")
	}
}

func TestRunHTTPRejectsUnsafeTLSConfiguration(t *testing.T) {
	certificate, _ := testHTTPServerTLS(t)
	tests := []struct {
		name      string
		tlsConfig *tls.Config
	}{
		{
			name: "obsolete minimum",
			tlsConfig: &tls.Config{
				MinVersion:   tls.VersionTLS11,
				Certificates: certificate.Certificates,
			},
		},
		{
			name: "maximum below minimum",
			tlsConfig: &tls.Config{
				MinVersion:   tls.VersionTLS13,
				MaxVersion:   tls.VersionTLS12,
				Certificates: certificate.Certificates,
			},
		},
		{
			name:      "missing certificate",
			tlsConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := RunHTTP(context.Background(), HTTPOptions{
				Handler:   http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}),
				Address:   "127.0.0.1:0",
				TLSConfig: test.tlsConfig,
			})
			if err == nil || !strings.Contains(err.Error(), "TLS") {
				t.Fatalf("RunHTTP() error = %v, want fixed TLS validation error", err)
			}
		})
	}
}

func TestPrepareHTTPServerTLSConfigValidatesDynamicSelection(t *testing.T) {
	certificate, _ := testHTTPServerTLS(t)
	t.Run("rejects obsolete minimum", func(t *testing.T) {
		prepared, err := prepareHTTPServerTLSConfig(&tls.Config{
			GetConfigForClient: func(*tls.ClientHelloInfo) (*tls.Config, error) {
				selected := certificate.Clone()
				selected.MinVersion = tls.VersionTLS11
				return selected, nil
			},
		})
		if err != nil {
			t.Fatalf("prepare top-level TLS config: %v", err)
		}
		if _, err := prepared.GetConfigForClient(&tls.ClientHelloInfo{}); err == nil {
			t.Fatal("dynamic TLS config with obsolete minimum was accepted")
		}
	})

	t.Run("defaults clone without mutating selection", func(t *testing.T) {
		selected := certificate.Clone()
		selected.MinVersion = 0
		prepared, err := prepareHTTPServerTLSConfig(&tls.Config{
			GetConfigForClient: func(*tls.ClientHelloInfo) (*tls.Config, error) {
				return selected, nil
			},
		})
		if err != nil {
			t.Fatalf("prepare top-level TLS config: %v", err)
		}
		dynamic, err := prepared.GetConfigForClient(&tls.ClientHelloInfo{})
		if err != nil {
			t.Fatalf("prepare dynamic TLS config: %v", err)
		}
		if dynamic.MinVersion != tls.VersionTLS12 {
			t.Fatalf("dynamic TLS minimum version = %d, want TLS 1.2", dynamic.MinVersion)
		}
		if selected.MinVersion != 0 {
			t.Fatalf("caller dynamic TLS config was mutated: MinVersion = %d", selected.MinVersion)
		}
	})
}

func TestRunHTTPBoundsApplicationShutdownHook(t *testing.T) {
	address := reserveHTTPAddress(t)
	ctx, cancel := context.WithCancel(context.Background())
	releaseShutdown := make(chan struct{})
	defer close(releaseShutdown)
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(http.StatusNoContent)
			}),
			ApplicationShutdown: func(context.Context) error {
				<-releaseShutdown
				return nil
			},
			Address:         address,
			ShutdownTimeout: 50 * time.Millisecond,
		})
	}()
	waitForHTTPStatus(t, address, http.StatusNoContent)
	cancel()

	select {
	case err := <-errorsCh:
		if err == nil || !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("RunHTTP() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("application shutdown hook escaped the server budget")
	}
}

func TestRunHTTPIsolatesApplicationShutdownPanic(t *testing.T) {
	address := reserveHTTPAddress(t)
	ctx, cancel := context.WithCancel(context.Background())
	errorsCh := make(chan error, 1)
	go func() {
		errorsCh <- RunHTTP(ctx, HTTPOptions{
			Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(http.StatusNoContent)
			}),
			ApplicationShutdown: func(context.Context) error {
				panic("private shutdown detail")
			},
			Address:         address,
			ShutdownTimeout: time.Second,
		})
	}()
	waitForHTTPStatus(t, address, http.StatusNoContent)
	cancel()

	err := <-errorsCh
	if err == nil || !strings.Contains(err.Error(), "application shutdown panic") || strings.Contains(err.Error(), "private shutdown detail") {
		t.Fatalf("RunHTTP() error = %v", err)
	}
}

func TestRunHTTPValidatesOptions(t *testing.T) {
	tests := []struct {
		name    string
		options HTTPOptions
	}{
		{name: "missing handler", options: HTTPOptions{Address: "127.0.0.1:0"}},
		{name: "missing address", options: HTTPOptions{Handler: http.NotFoundHandler()}},
		{name: "negative drain", options: HTTPOptions{Handler: http.NotFoundHandler(), Address: "127.0.0.1:0", DrainDelay: -time.Second}},
		{name: "drain exceeds shutdown", options: HTTPOptions{Handler: http.NotFoundHandler(), Address: "127.0.0.1:0", DrainDelay: time.Second, ShutdownTimeout: time.Second}},
		{name: "header bound too large", options: HTTPOptions{Handler: http.NotFoundHandler(), Address: "127.0.0.1:0", MaxHeaderBytes: maximumHTTPMaxHeaderBytes + 1}},
		{name: "connection bound too large", options: HTTPOptions{Handler: http.NotFoundHandler(), Address: "127.0.0.1:0", MaxConnections: maximumHTTPMaxConnections + 1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := RunHTTP(context.Background(), test.options); err == nil {
				t.Fatal("RunHTTP() error = nil")
			}
		})
	}
}

func TestRunHTTPReturnsListenErrorBeforeStartedLog(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy address: %v", err)
	}
	defer listener.Close()

	var output bytes.Buffer
	err = RunHTTP(context.Background(), HTTPOptions{
		Handler: http.NotFoundHandler(),
		Address: listener.Addr().String(),
		Logger:  slog.New(slog.NewJSONHandler(&output, nil)),
	})
	if err == nil || !strings.Contains(err.Error(), "listen:") {
		t.Fatalf("RunHTTP() error = %v", err)
	}
	if strings.Contains(output.String(), "server_started") {
		t.Fatalf("unexpected startup log = %s", output.String())
	}
}

func reserveHTTPAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release port: %v", err)
	}
	return address
}

func waitForHTTPStatus(t *testing.T, address string, status int) {
	t.Helper()
	client := &http.Client{
		Timeout:   200 * time.Millisecond,
		Transport: &http.Transport{DisableKeepAlives: true},
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		response, err := client.Get("http://" + address)
		if err == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != status {
				t.Fatalf("status = %d, want %d", response.StatusCode, status)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not become ready: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type recordingHTTPConnectionObserver struct {
	mu       sync.Mutex
	capacity int
	states   []http.ConnState
}

func (observer *recordingHTTPConnectionObserver) SetHTTPConnectionCapacity(capacity int) {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.capacity = capacity
}

func (observer *recordingHTTPConnectionObserver) ObserveHTTPConnectionState(state http.ConnState) {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.states = append(observer.states, state)
}

func (observer *recordingHTTPConnectionObserver) snapshot() (int, []http.ConnState) {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	return observer.capacity, append([]http.ConnState(nil), observer.states...)
}

type panicHTTPConnectionObserver struct{}

func (panicHTTPConnectionObserver) SetHTTPConnectionCapacity(int) {
	panic("private observer capacity detail")
}

func (panicHTTPConnectionObserver) ObserveHTTPConnectionState(http.ConnState) {
	panic("private observer state detail")
}

func containsHTTPConnectionState(states []http.ConnState, expected http.ConnState) bool {
	for _, state := range states {
		if state == expected {
			return true
		}
	}
	return false
}

func testHTTPServerTLS(t *testing.T) (*tls.Config, *tls.Config) {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate TLS private key: %v", err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("create TLS certificate: %v", err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse TLS certificate: %v", err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(certificate)
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		Certificates: []tls.Certificate{{
			Certificate: [][]byte{der},
			PrivateKey:  privateKey,
		}},
	}, &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    roots,
		ServerName: "localhost",
	}
}
