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
	if options.OIDCBrowser != nil && (!options.OIDCBrowser.Enabled() || !AuthenticationEnabled(options) || options.Auth.Enabled()) {
		panic("OIDCBrowser requires the active external token verifier and cannot be combined with demo authentication")
	}
	if !AuthenticationEnabled(options) {
		return
	}

	authGroup := v1.Group("/auth")
	authGroup.Use(func(c fiber.Ctx) error {
		setNoStoreHeaders(c)
		return c.Next()
	})
	authLimiter := rateLimiter(
		"auth",
		options.AuthRateLimitMax,
		options.RateLimitWindow,
		"authentication rate limit exceeded",
		nil,
		options.SharedStorage,
		func(c fiber.Ctx) {
			target := "oidc_browser"
			if c.Path() == "/api/v1/auth/login" {
				target = "demo_auth"
			}
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeLimited, "rate_limited", target, "")
		},
	)
	if options.Auth.Enabled() {
		authGroup.Post("/login", authLimiter, requireJSON, func(c fiber.Ctx) error {
			var request loginRequest
			if err := bindBody(c, &request); err != nil {
				return err
			}
			user, ok := options.Auth.Authenticate(request.Username, request.Password)
			if !ok {
				recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "invalid_credentials", "demo_auth", "")
				return failure(c, fiber.StatusUnauthorized, "username or password is incorrect")
			}
			rawToken, expiresAt, err := options.Auth.Issue(user)
			if err != nil {
				recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "token_issue_failed", "demo_auth", user.ID)
				return err
			}
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeSuccess, "credentials_valid", "demo_auth", user.ID)
			return success(c, fiber.Map{
				"accessToken": rawToken,
				"tokenType":   "Bearer",
				"expiresIn":   int(expiresAt.Sub(options.Now().UTC()).Seconds()),
				"expiresAt":   expiresAt.Format(time.RFC3339),
				"user":        user,
			})
		})
	}
	registerOIDCBrowserRoutes(authGroup, options, authLimiter)
	authGroup.Get("/me", requireAuth(options), func(c fiber.Ctx) error {
		claims, ok := currentClaims(c)
		if !ok {
			return fiber.ErrUnauthorized
		}
		return success(c, claims.User())
	})
}
