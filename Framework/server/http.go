package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
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
	Attributes          []any
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

	listener, err := net.Listen("tcp", options.Address)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	notifyHTTPConnectionCapacity(options.ConnectionObserver, options.MaxConnections)
	listener = netutil.LimitListener(listener, options.MaxConnections)

	httpServer := &http.Server{
		Handler:           options.Handler,
		ReadHeaderTimeout: options.ReadHeaderTimeout,
		ReadTimeout:       options.ReadTimeout,
		WriteTimeout:      options.WriteTimeout,
		IdleTimeout:       options.IdleTimeout,
		MaxHeaderBytes:    options.MaxHeaderBytes,
		ConnState: func(_ net.Conn, state http.ConnState) {
			notifyHTTPConnectionState(options.ConnectionObserver, state)
		},
	}
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- httpServer.Serve(listener)
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
	if err := <-serverErr; !isExpectedHTTPServerClose(err) {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("listen after shutdown: %w", err))
	}
	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}

	options.Logger.Info("server_stopped")
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
