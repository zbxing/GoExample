package httpapi

import (
	"context"

	"github.com/gofiber/fiber/v3"
)

func registerRoutes(
	app *fiber.App,
	options Options,
	applicationContext context.Context,
	requestCancellations *requestCancellationRegistry,
) {
	app.Get("/", func(c fiber.Ctx) error {
		return success(c, fiber.Map{
			"name":        options.Name,
			"version":     options.Version,
			"environment": options.Environment,
			"framework":   "Fiber " + fiber.Version,
			"endpoints":   options.Endpoints,
		})
	})
	app.Get("/metrics", requireInternalToken(options, options.MetricsToken, "metrics"), options.Metrics.Handler)

	api := app.Group("/api")
	registerHealthRoutes(app, api, options)
	registerSystemRoutes(api, options)
	api.Use(requestDeadline(applicationContext, requestCancellations, options.RequestTimeout))
	api.Use(rateLimiter(
		"api",
		options.RateLimitMax,
		options.RateLimitWindow,
		"request rate limit exceeded",
		func(c fiber.Ctx) bool {
			path := c.Path()
			return path == "/api/v1/auth/login" || path == "/api/v1/auth/oidc/start" || path == "/api/v1/auth/oidc/callback"
		},
		options.SharedStorage,
		nil,
	))

	v1 := api.Group("/v1")
	v1.Use(rejectWhenDraining(options.Health, options.Metrics))
	v1.Use(boundedConcurrency(options.MaxInFlight, options.Metrics))
	hasApplicationRoutes := len(options.ApplicationQueries) > 0 ||
		len(options.ApplicationCommands) > 0 ||
		len(options.ApplicationEventStreams) > 0 ||
		len(options.ApplicationRoutes) > 0
	if hasApplicationRoutes && options.RegisterRoutes != nil {
		panic("application route descriptors and RegisterRoutes cannot be configured together")
	}
	if hasApplicationRoutes {
		validateApplicationQueries(options.ApplicationQueries, AuthenticationEnabled(options), options.OIDCBrowser != nil)
		validateApplicationCommands(options.ApplicationCommands, AuthenticationEnabled(options), options.OIDCBrowser != nil && options.OIDCBrowser.SessionsEnabled())
		validateApplicationEventStreams(options.ApplicationEventStreams, options.ApplicationQueries, AuthenticationEnabled(options), options.OIDCBrowser != nil)
		validateApplicationRoutes(options.ApplicationRoutes, options.ApplicationQueries, options.ApplicationCommands, options.ApplicationEventStreams, AuthenticationEnabled(options), options.OIDCBrowser != nil)
		RegisterDefaultRoutes(v1, options)
		registerApplicationQueries(v1, options.ApplicationQueries, options)
		registerApplicationCommands(v1, options.ApplicationCommands, options)
		registerApplicationEventStreams(v1, options.ApplicationEventStreams, options)
		registerApplicationRoutes(v1, options.ApplicationRoutes)
		return
	}
	if options.RegisterRoutes != nil {
		options.RegisterRoutes(v1)
		return
	}
	RegisterDefaultRoutes(v1, options)
}

func RegisterDefaultRoutes(v1 fiber.Router, options Options) {
	registerAuthRoutes(v1, options)
	registerExampleRoutes(v1, options)
}

func DefaultEndpoints(authEnabled bool) []string {
	return DefaultEndpointsForAuth(authEnabled, authEnabled)
}

// DefaultEndpointsForAuth distinguishes bearer verification from the local
// demo login endpoint used to issue HS256 tokens.
func DefaultEndpointsForAuth(authEnabled, demoLoginEnabled bool) []string {
	endpoints := []string{
		"GET /api/health",
		"GET /api/health/ready",
		"GET /api/health/startup",
		"GET /api/system/info",
		"GET /livez",
		"GET /readyz",
		"GET /metrics",
		"GET /startupz",
		"GET /api/v1/example/hello",
		"POST /api/v1/example/echo",
		"POST /api/v1/example/validate",
		"GET /api/v1/example/delay",
	}
	if authEnabled {
		endpoints = append(endpoints, "GET /api/v1/auth/me", "GET /api/v1/example/private")
	}
	if demoLoginEnabled {
		endpoints = append(endpoints, "POST /api/v1/auth/login")
	}
	return endpoints
}
