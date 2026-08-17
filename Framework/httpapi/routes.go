package httpapi

import "github.com/gofiber/fiber/v3"

func registerRoutes(app *fiber.App, options Options) {
	app.Get("/", func(c fiber.Ctx) error {
		return success(c, fiber.Map{
			"name":        options.Name,
			"version":     options.Version,
			"environment": options.Environment,
			"framework":   "Fiber " + fiber.Version,
			"endpoints":   options.Endpoints,
		})
	})
	app.Get("/metrics", requireInternalToken(options.MetricsToken, "metrics"), options.Metrics.Handler)

	api := app.Group("/api")
	registerHealthRoutes(app, api, options)
	registerSystemRoutes(api, options)
	api.Use(rateLimiter(
		options.RateLimitMax,
		options.RateLimitWindow,
		"request rate limit exceeded",
		func(c fiber.Ctx) bool {
			return c.Method() == fiber.MethodPost && c.Path() == "/api/v1/auth/login"
		},
	))
	api.Use(requestDeadline(options.RequestTimeout))

	v1 := api.Group("/v1")
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
		endpoints = append(endpoints,
			"POST /api/v1/auth/login",
			"GET /api/v1/auth/me",
			"GET /api/v1/example/private",
		)
	}
	return endpoints
}
