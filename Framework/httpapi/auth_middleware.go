package httpapi

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
)

type authClaimsKey struct{}

func requireAuth(service *auth.Service) fiber.Handler {
	return func(c fiber.Ctx) error {
		header := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
		scheme, rawToken, found := strings.Cut(header, " ")
		if !found || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(rawToken) == "" {
			c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="goexample"`)
			return failure(c, fiber.StatusUnauthorized, "a Bearer access token is required")
		}

		claims, err := service.Verify(strings.TrimSpace(rawToken))
		if err != nil {
			c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="goexample", error="invalid_token"`)
			return failure(c, fiber.StatusUnauthorized, "access token is invalid or expired")
		}
		c.Locals(authClaimsKey{}, claims)
		return c.Next()
	}
}

func currentClaims(c fiber.Ctx) (auth.Claims, bool) {
	claims, ok := c.Locals(authClaimsKey{}).(auth.Claims)
	return claims, ok
}
