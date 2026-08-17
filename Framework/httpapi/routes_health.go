package httpapi

import (
	"time"

	"github.com/gofiber/fiber/v3"
)

func registerHealthRoutes(app *fiber.App, api fiber.Router, options Options) {
	healthHandler := func(status string) fiber.Handler {
		return func(c fiber.Ctx) error {
			c.Set(fiber.HeaderCacheControl, "no-store")
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
		c.Set(fiber.HeaderCacheControl, "no-store")
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
	api.Get("/health", healthHandler("ok"))
	api.Get("/health/ready", readinessHandler)
	api.Get("/health/startup", healthHandler("started"))
}
