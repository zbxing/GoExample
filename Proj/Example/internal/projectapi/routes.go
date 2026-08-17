package projectapi

import (
	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/httpapi"
)

func Endpoints(authEnabled bool) []string {
	endpoints := append([]string{}, httpapi.DefaultEndpoints(authEnabled)...)
	return append(endpoints, "GET /api/v1/project")
}

func Register(v1 fiber.Router, options httpapi.Options) {
	httpapi.RegisterDefaultRoutes(v1, options)
	v1.Get("/project", func(c fiber.Ctx) error {
		return httpapi.Success(c, fiber.Map{
			"name":        options.Name,
			"environment": options.Environment,
			"version":     options.Version,
		})
	})
}
