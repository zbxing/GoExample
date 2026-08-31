package server

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/zbxing/goexample/Framework/health"
	"golang.org/x/net/netutil"
)

const (
	defaultHTTPReadHeaderTimeout = 5 * time.Second
	defaultHTTPReadTimeout       = 10 * time.Second
	defaultHTTPWriteTimeout      = 10 * time.Second
	defaultHTTPIdleTimeout       = 60 * time.Second
	defaultHTTPMaxHeaderBytes    = 16 * 1024
	defaultHTTPMaxConnections    = 4096
	maximumHTTPMaxHeaderBytes    = 1 << 20
	maximumHTTPMaxConnections    = 1 << 20
)

// HTTPOptions configures a bounded standard-library HTTP server lifecycle.
// ApplicationShutdown lets adapted handlers release framework-specific work
// after the server stops accepting new connections.
type HTTPOptions struct {
	Handler             http.Handler
	ApplicationShutdown func(context.Context) error
	ConnectionObserver  HTTPConnectionObserver
	Health              *health.Checker
	Logger              *slog.Logger
	Name                string
	Version             string
	Environment         string
	Address             string
	ShutdownTimeout     time.Duration
	DrainDelay          time.Duration
	ReadHeaderTimeout   time.Duration
	ReadTimeout         time.Duration
	WriteTimeout        time.Duration
	IdleTimeout         time.Duration
	MaxHeaderBytes      int
	MaxConnections      int
	// TLSConfig enables direct TLS serving. RunHTTP clones it before use.
	TLSConfig  *tls.Config
	Attributes []any
}

// HTTPConnectionObserver receives only fixed net/http lifecycle states and
// the configured capacity. Implementations must not retain connection data.
type HTTPConnectionObserver interface {
	SetHTTPConnectionCapacity(capacity int)
	ObserveHTTPConnectionState(state http.ConnState)
}

// RunHTTP serves a standard http.Handler with bounded accepted connections
// until ctx is canceled. It marks readiness as draining before the propagation
// delay, then stops accepting connections and invokes the optional application
// shutdown hook within one shared shutdown budget.
func RunHTTP(ctx context.Context, options HTTPOptions) error {
	if options.Handler == nil {
		return errors.New("server HTTP handler is required")
	}
	if strings.TrimSpace(options.Address) == "" {
		return errors.New("server address is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	options = defaultHTTPOptions(options)
	if options.DrainDelay < 0 || options.DrainDelay >= options.ShutdownTimeout {
		return errors.New("server drain delay must be non-negative and less than shutdown timeout")
	}
	if options.MaxHeaderBytes > maximumHTTPMaxHeaderBytes {
		return errors.New("server max header bytes must not exceed 1 MiB")
	}
	if options.MaxConnections > maximumHTTPMaxConnections {
		return errors.New("server max connections must not exceed 1048576")
	}
	tlsConfig, err := prepareHTTPServerTLSConfig(options.TLSConfig)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", options.Address)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	notifyHTTPConnectionCapacity(options.ConnectionObserver, options.MaxConnections)
	listener = netutil.LimitListener(listener, options.MaxConnections)
	connectionTracker := newHTTPConnectionTracker()
	listener = &trackedHTTPListener{Listener: listener, tracker: connectionTracker}

	httpServer := &http.Server{
		Handler:           options.Handler,
		ReadHeaderTimeout: options.ReadHeaderTimeout,
		ReadTimeout:       options.ReadTimeout,
		WriteTimeout:      options.WriteTimeout,
		IdleTimeout:       options.IdleTimeout,
		MaxHeaderBytes:    options.MaxHeaderBytes,
		TLSConfig:         tlsConfig,
		ConnState: func(connection net.Conn, state http.ConnState) {
			connectionTracker.observe(connection, state)
			notifyHTTPConnectionState(options.ConnectionObserver, state)
		},
	}
	serverErr := make(chan error, 1)
	go func() {
		if tlsConfig == nil {
			serverErr <- httpServer.Serve(listener)
			return
		}
		serverErr <- httpServer.ServeTLS(listener, "", "")
	}()

	attributes := []any{
		"name", options.Name,
		"version", options.Version,
		"environment", options.Environment,
		"address", listener.Addr().String(),
		"transport", "net_http",
	}
	attributes = append(attributes, options.Attributes...)
	options.Logger.Info("server_started", attributes...)

	select {
	case err := <-serverErr:
		if !isExpectedHTTPServerClose(err) {
			return fmt.Errorf("listen: %w", err)
		}
		return nil
	case <-ctx.Done():
		if options.Health != nil {
			options.Health.SetDraining(true)
		}
		options.Logger.Info("shutdown_signal_received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), options.ShutdownTimeout)
	defer cancel()
	if options.DrainDelay > 0 {
		options.Logger.Info("shutdown_draining", "delay", options.DrainDelay)
		timer := time.NewTimer(options.DrainDelay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-shutdownCtx.Done():
		}
	}

	shutdownErr := shutdownHTTP(shutdownCtx, httpServer, options.ApplicationShutdown)
	if shutdownErr != nil {
		// Shutdown does not close active connections after its context expires.
		// Close guarantees RunHTTP and request contexts still converge.
		closeErr := httpServer.Close()
		if closeErr != nil && !isExpectedHTTPServerClose(closeErr) {
			shutdownErr = errors.Join(shutdownErr, closeErr)
		}
	}
	shutdownErr = errors.Join(shutdownErr, connectionTracker.closeHijacked())
	if err := <-serverErr; !isExpectedHTTPServerClose(err) {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("listen after shutdown: %w", err))
	}
	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}

	options.Logger.Info("server_stopped")
	return nil
}

type httpConnectionTracker struct {
	mu       sync.Mutex
	closing  bool
	hijacked map[*trackedHTTPConnection]struct{}
}

type trackedHTTPListener struct {
	net.Listener
	tracker *httpConnectionTracker
}

type trackedHTTPConnection struct {
	net.Conn
	tracker   *httpConnectionTracker
	closeOnce sync.Once
}

func newHTTPConnectionTracker() *httpConnectionTracker {
	return &httpConnectionTracker{hijacked: make(map[*trackedHTTPConnection]struct{})}
}

func (listener *trackedHTTPListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &trackedHTTPConnection{Conn: connection, tracker: listener.tracker}, nil
}

func (connection *trackedHTTPConnection) Close() error {
	err := connection.Conn.Close()
	if err == nil || errors.Is(err, net.ErrClosed) {
		connection.closeOnce.Do(func() {
			connection.tracker.remove(connection)
		})
	}
	return err
}

func (tracker *httpConnectionTracker) observe(connection net.Conn, state http.ConnState) {
	if state != http.StateHijacked {
		return
	}
	if tlsConnection, ok := connection.(*tls.Conn); ok {
		connection = tlsConnection.NetConn()
	}
	trackedConnection, ok := connection.(*trackedHTTPConnection)
	if !ok {
		return
	}

	tracker.mu.Lock()
	if !tracker.closing {
		tracker.hijacked[trackedConnection] = struct{}{}
		tracker.mu.Unlock()
		return
	}
	tracker.mu.Unlock()
	_ = trackedConnection.Close()
}

func (tracker *httpConnectionTracker) remove(connection *trackedHTTPConnection) {
	tracker.mu.Lock()
	delete(tracker.hijacked, connection)
	tracker.mu.Unlock()
}

func (tracker *httpConnectionTracker) closeHijacked() error {
	tracker.mu.Lock()
	tracker.closing = true
	connections := make([]*trackedHTTPConnection, 0, len(tracker.hijacked))
	for connection := range tracker.hijacked {
		connections = append(connections, connection)
	}
	tracker.mu.Unlock()

	var closeFailed bool
	for _, connection := range connections {
		if err := connection.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			closeFailed = true
		}
	}
	if closeFailed {
		return errors.New("server hijacked connection close failed")
	}
	return nil
}

func defaultHTTPOptions(options HTTPOptions) HTTPOptions {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.ShutdownTimeout <= 0 {
		options.ShutdownTimeout = defaultShutdownTimeout
	}
	if options.ReadHeaderTimeout <= 0 {
		options.ReadHeaderTimeout = defaultHTTPReadHeaderTimeout
	}
	if options.ReadTimeout <= 0 {
		options.ReadTimeout = defaultHTTPReadTimeout
	}
	if options.WriteTimeout <= 0 {
		options.WriteTimeout = defaultHTTPWriteTimeout
	}
	if options.IdleTimeout <= 0 {
		options.IdleTimeout = defaultHTTPIdleTimeout
	}
	if options.MaxHeaderBytes <= 0 {
		options.MaxHeaderBytes = defaultHTTPMaxHeaderBytes
	}
	if options.MaxConnections <= 0 {
		options.MaxConnections = defaultHTTPMaxConnections
	}
	return options
}

func prepareHTTPServerTLSConfig(config *tls.Config) (*tls.Config, error) {
	if config == nil {
		return nil, nil
	}
	prepared := config.Clone()
	if prepared.MinVersion == 0 {
		prepared.MinVersion = tls.VersionTLS12
	}
	if prepared.MinVersion < tls.VersionTLS12 {
		return nil, errors.New("server TLS minimum version must be TLS 1.2 or newer")
	}
	if prepared.MaxVersion != 0 && prepared.MaxVersion < prepared.MinVersion {
		return nil, errors.New("server TLS maximum version must not be lower than minimum")
	}
	if len(prepared.Certificates) == 0 && prepared.GetCertificate == nil && prepared.GetConfigForClient == nil {
		return nil, errors.New("server TLS certificate source is required")
	}
	if selectConfig := prepared.GetConfigForClient; selectConfig != nil {
		prepared.GetConfigForClient = func(clientHello *tls.ClientHelloInfo) (*tls.Config, error) {
			selected, err := selectConfig(clientHello)
			if err != nil || selected == nil {
				return selected, err
			}
			return prepareHTTPServerTLSConfig(selected)
		}
	}
	return prepared, nil
}

func shutdownHTTP(ctx context.Context, httpServer *http.Server, applicationShutdown func(context.Context) error) error {
	operationCount := 1
	if applicationShutdown != nil {
		operationCount++
	}
	errorsCh := make(chan error, operationCount)
	go func() {
		errorsCh <- httpServer.Shutdown(ctx)
	}()
	if applicationShutdown != nil {
		go func() {
			errorsCh <- callApplicationShutdown(ctx, applicationShutdown)
		}()
	}

	var result error
	for range operationCount {
		select {
		case err := <-errorsCh:
			result = errors.Join(result, err)
		case <-ctx.Done():
			return errors.Join(result, ctx.Err())
		}
	}
	return result
}

func callApplicationShutdown(ctx context.Context, shutdown func(context.Context) error) (err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("application shutdown panic")
		}
	}()
	return shutdown(ctx)
}

func notifyHTTPConnectionCapacity(observer HTTPConnectionObserver, capacity int) {
	if observer == nil {
		return
	}
	defer func() { _ = recover() }()
	observer.SetHTTPConnectionCapacity(capacity)
}

func notifyHTTPConnectionState(observer HTTPConnectionObserver, state http.ConnState) {
	if observer == nil {
		return
	}
	defer func() { _ = recover() }()
	observer.ObserveHTTPConnectionState(state)
}

func isExpectedHTTPServerClose(err error) bool {
	return err == nil || errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed)
}
