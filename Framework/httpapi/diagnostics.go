package httpapi

import (
	"crypto/subtle"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/pprof"
)

func registerDiagnostics(app *fiber.App, options Options) {
	if !options.PprofEnabled {
		return
	}
	app.Use("/debug/pprof", noStore, requireInternalToken(options.PprofToken, "pprof"), pprof.New())
}

func noStore(c fiber.Ctx) error {
	setNoStoreHeaders(c)
	return c.Next()
}

func requireInternalToken(token, realm string) fiber.Handler {
	return func(c fiber.Ctx) error {
		if token == "" {
			return c.Next()
		}

		provided := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
		expected := "Bearer " + token
		if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1 {
			return c.Next()
		}

		c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="`+realm+`"`)
		return failure(c, fiber.StatusUnauthorized, "internal endpoint authentication required")
	}
}
