package httpapi

import (
	"context"
	"errors"
	"net/http"
)

// HTTPApplication owns a Framework application behind standard net/http
// serving and shutdown contracts. Its internal transport remains private so a
// standard server composition does not need to retain a Fiber application.
type HTTPApplication struct {
	handler  http.Handler
	shutdown func(context.Context) error
}

// NewHTTPApplication builds a Framework application for standard net/http
// composition. Existing Fiber-native constructors remain available for callers
// that intentionally own the transport-specific lifecycle.
func NewHTTPApplication(options Options) (*HTTPApplication, error) {
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		return nil, err
	}
	return &HTTPApplication{
		handler:  handler,
		shutdown: app.ShutdownWithContext,
	}, nil
}

// ServeHTTP serves the Framework application through its standard adapter.
func (application *HTTPApplication) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if application == nil || application.handler == nil {
		http.Error(response, "HTTP application is unavailable", http.StatusServiceUnavailable)
		return
	}
	application.handler.ServeHTTP(response, request)
}

// Shutdown cancels Framework application work and releases its internal
// transport resources within the caller's shutdown budget.
func (application *HTTPApplication) Shutdown(ctx context.Context) error {
	if application == nil || application.shutdown == nil {
		return errors.New("HTTP application is unavailable")
	}
	if ctx == nil {
		return errors.New("HTTP application shutdown context is required")
	}
	return application.shutdown(ctx)
}
