package httpapi

import (
	"time"

	"github.com/gofiber/fiber/v3"
)

const (
	deprecationHeader = "Deprecation"
	sunsetHeader      = "Sunset"
	linkHeader        = "Link"

	healthDeprecation = "@1787184000"
	healthSunset      = "Sat, 20 Feb 2027 00:00:00 GMT"
)

func registerHealthRoutes(app *fiber.App, api fiber.Router, options Options) {
	healthHandler := func(status string) fiber.Handler {
		return func(c fiber.Ctx) error {
			setNoStoreHeaders(c)
			return success(c, fiber.Map{
				"status":      status,
				"service":     options.Name,
				"version":     options.Version,
				"environment": options.Environment,
				"timestamp":   options.Now().UTC().Format(time.RFC3339),
			})
		}
	}
	readinessHandler := func(c fiber.Ctx) error {
		setNoStoreHeaders(c)
		report := options.Health.Readiness(c.Context())
		data := fiber.Map{
			"status":      report.Status,
			"service":     options.Name,
			"version":     options.Version,
			"environment": options.Environment,
			"timestamp":   options.Now().UTC().Format(time.RFC3339),
		}
		if len(report.Checks) > 0 {
			data["checks"] = report.Checks
		}
		if !report.Ready {
			return c.Status(fiber.StatusServiceUnavailable).JSON(Envelope{
				Code: fiber.StatusServiceUnavailable,
				Data: data,
				Msg:  "service is not ready",
			})
		}
		return success(c, data)
	}

	app.Get("/livez", healthHandler("ok"))
	app.Get("/readyz", readinessHandler)
	app.Get("/startupz", healthHandler("started"))
	api.Get("/health", deprecatedEndpoint("/livez"), healthHandler("ok"))
	api.Get("/health/ready", deprecatedEndpoint("/readyz"), readinessHandler)
	api.Get("/health/startup", deprecatedEndpoint("/startupz"), healthHandler("started"))
}

func deprecatedEndpoint(successor string) fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set(deprecationHeader, healthDeprecation)
		c.Set(sunsetHeader, healthSunset)
		c.Set(linkHeader, "<"+successor+">; rel=\"successor-version\"")
		return c.Next()
	}
}
