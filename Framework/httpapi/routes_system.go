package httpapi

import (
	"runtime"

	"github.com/gofiber/fiber/v3"
)

func registerSystemRoutes(api fiber.Router, options Options) {
	api.Get("/system/info", noStore, func(c fiber.Ctx) error {
		info := fiber.Map{
			"application": options.Name,
			"version":     options.Version,
			"commit":      options.Commit,
			"buildTime":   options.BuildTime,
			"environment": options.Environment,
		}
		if options.SystemInfoDetailed {
			info["fiberVersion"] = fiber.Version
			info["goVersion"] = runtime.Version()
			info["goos"] = runtime.GOOS
			info["goarch"] = runtime.GOARCH
		}
		return success(c, info)
	})
}
