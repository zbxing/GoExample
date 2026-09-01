package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
)

const standardRequestContextHeader = "X-GoExample-Standard-Request-Context"

const maximumStandardResponseWriterUnwrapDepth = 32

var standardRequestContexts sync.Map

type standardResponseWriteDeadlineContextKey struct{}

type standardResponseWriteDeadline func(time.Time) error

type standardRequestBridge struct {
	context          context.Context
	setWriteDeadline standardResponseWriteDeadline
}

// NewHTTPHandler exposes an existing Framework app through the standard
// net/http Handler contract. This lets an edge or middleware stack compose the
// server without converting application handlers back to Fiber types.
//
// Request cancellation, deadlines and context values are bridged into Fiber
// without serializing them into request headers. Standard response write
// deadline control is bridged through http.ResponseController for bounded
// streams. A standard server owner must still call app.ShutdownWithContext
// during shutdown so the Framework pre-shutdown hook cancels all in-flight
// application work.
func NewHTTPHandler(app *fiber.App) (http.Handler, error) {
	if app == nil {
		return nil, errors.New("httpapi app is required")
	}
	adapted := adaptor.FiberApp(app)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		token, err := newStandardRequestContextToken()
		if err != nil {
			http.Error(response, "request context unavailable", http.StatusInternalServerError)
			return
		}
		controller := http.NewResponseController(response)
		standardRequestContexts.Store(token, standardRequestBridge{
			context: request.Context(),
			setWriteDeadline: func(deadline time.Time) error {
				return controller.SetWriteDeadline(deadline)
			},
		})
		defer standardRequestContexts.Delete(token)

		// The adaptor only reads the net/http request. Copy the request value and
		// clone the header map because this bridge injects one private header;
		// http.Request.Clone also deep-copies URL, Trailer, forms and transfer
		// metadata that remain read-only on this path.
		bridgedRequest := new(http.Request)
		*bridgedRequest = *request
		bridgedRequest.Header = request.Header.Clone()
		bridgedRequest.Header.Set(standardRequestContextHeader, token)
		adapted.ServeHTTP(standardStreamingResponseWriter(response), bridgedRequest)
	}), nil
}

// standardStreamingResponseWriter preserves streaming when standard middleware
// exposes its underlying writer through the net/http ResponseController contract
// without forwarding http.Flusher directly.
func standardStreamingResponseWriter(response http.ResponseWriter) http.ResponseWriter {
	if _, ok := response.(http.Flusher); ok {
		return response
	}
	if !supportsStandardResponseFlush(response) {
		return response
	}
	return standardResponseFlusher{ResponseWriter: response}
}

func supportsStandardResponseFlush(response http.ResponseWriter) bool {
	for range maximumStandardResponseWriterUnwrapDepth {
		if response == nil {
			return false
		}
		if _, ok := response.(http.Flusher); ok {
			return true
		}
		if _, ok := response.(interface{ FlushError() error }); ok {
			return true
		}
		unwrapper, ok := response.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		response = unwrapper.Unwrap()
	}
	return false
}

type standardResponseFlusher struct {
	http.ResponseWriter
}

func (response standardResponseFlusher) Flush() {
	_ = http.NewResponseController(response.ResponseWriter).Flush()
}

func (response standardResponseFlusher) Unwrap() http.ResponseWriter {
	return response.ResponseWriter
}

func newStandardRequestContextToken() (string, error) {
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(token[:]), nil
}

// standardRequestContextBridge consumes the unguessable, one-request token
// installed by NewHTTPHandler. Native Fiber requests cannot inject a context:
// their header is removed even when no matching in-process token exists.
func standardRequestContextBridge() fiber.Handler {
	return func(c fiber.Ctx) error {
		token := strings.Clone(c.Get(standardRequestContextHeader))
		c.Request().Header.Del(standardRequestContextHeader)
		if token == "" {
			return c.Next()
		}
		value, ok := standardRequestContexts.LoadAndDelete(token)
		if !ok {
			return c.Next()
		}
		bridge, ok := value.(standardRequestBridge)
		if !ok || bridge.context == nil {
			return c.Next()
		}

		previous := c.Context()
		c.SetContext(context.WithValue(
			bridge.context,
			standardResponseWriteDeadlineContextKey{},
			bridge.setWriteDeadline,
		))
		defer c.SetContext(previous)
		return c.Next()
	}
}
