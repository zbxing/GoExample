package httpapi

import (
	"errors"
	"net/http"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
)

// NewHTTPHandler exposes an existing Framework app through the standard
// net/http Handler contract. This lets an edge or middleware stack compose the
// server without converting application handlers back to Fiber types.
//
// The Fiber adaptor does not propagate request.Context cancellation into the
// application context. Framework request deadlines still apply. A standard
// server owner must also call app.ShutdownWithContext during shutdown so the
// Framework pre-shutdown hook cancels in-flight application work.
func NewHTTPHandler(app *fiber.App) (http.Handler, error) {
	if app == nil {
		return nil, errors.New("httpapi app is required")
	}
	return adaptor.FiberApp(app), nil
}
