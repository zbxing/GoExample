package httpapi

import (
	"time"

	"github.com/gofiber/fiber/v3"
)

type loginRequest struct {
	Username string `json:"username" validate:"required,min=3,max=64"`
	Password string `json:"password" validate:"required,min=6,max=128"`
}

func registerAuthRoutes(v1 fiber.Router, options Options) {
	if !options.Auth.Enabled() {
		return
	}

	authGroup := v1.Group("/auth")
	authLimiter := rateLimiter(
		options.AuthRateLimitMax,
		options.RateLimitWindow,
		"authentication rate limit exceeded",
		nil,
	)
	authGroup.Post("/login", authLimiter, requireJSON, func(c fiber.Ctx) error {
		var request loginRequest
		if err := bindBody(c, &request); err != nil {
			return err
		}
		user, ok := options.Auth.Authenticate(request.Username, request.Password)
		if !ok {
			return failure(c, fiber.StatusUnauthorized, "username or password is incorrect")
		}
		rawToken, expiresAt, err := options.Auth.Issue(user)
		if err != nil {
			return err
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return success(c, fiber.Map{
			"accessToken": rawToken,
			"tokenType":   "Bearer",
			"expiresIn":   int(expiresAt.Sub(options.Now().UTC()).Seconds()),
			"expiresAt":   expiresAt.Format(time.RFC3339),
			"user":        user,
		})
	})
	authGroup.Get("/me", requireAuth(options.Auth), func(c fiber.Ctx) error {
		claims, ok := currentClaims(c)
		if !ok {
			return fiber.ErrUnauthorized
		}
		return success(c, claims.User())
	})
}
