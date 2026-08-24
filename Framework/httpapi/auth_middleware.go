package httpapi

import (
	"context"
	"crypto/subtle"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
)

type authClaimsKey struct{}

func requireAuth(options Options) fiber.Handler {
	return func(c fiber.Ctx) error {
		setNoStoreHeaders(c)
		header := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
		if header == "" && options.OIDCBrowser != nil && options.OIDCBrowser.SessionsEnabled() {
			return requireBrowserSession(c, options)
		}
		scheme, rawToken, found := strings.Cut(header, " ")
		if !found || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(rawToken) == "" {
			recordSecurityAudit(c, options, securityEventBearer, securityOutcomeFailure, "token_missing", "api", "")
			c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="goexample"`)
			return failure(c, fiber.StatusUnauthorized, "a Bearer access token is required")
		}

		verificationContext := c.Context()
		if verificationContext == nil {
			verificationContext = context.Background()
		}
		claims, err := options.TokenVerifier.VerifyToken(verificationContext, strings.TrimSpace(rawToken))
		if err != nil {
			recordSecurityAudit(c, options, securityEventBearer, securityOutcomeFailure, "token_invalid", "api", "")
			c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="goexample", error="invalid_token"`)
			return failure(c, fiber.StatusUnauthorized, "access token is invalid or expired")
		}
		c.Locals(authClaimsKey{}, claims)
		return c.Next()
	}
}

func requireBrowserSession(c fiber.Ctx, options Options) error {
	sessionToken := c.Cookies(browserSessionCookieName)
	if sessionToken == "" {
		recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_missing", "api", "")
		return failure(c, fiber.StatusUnauthorized, "a Bearer access token or browser session is required")
	}
	verificationContext := c.Context()
	if verificationContext == nil {
		verificationContext = context.Background()
	}
	requireCSRF := browserSessionRequiresCSRF(c.Method())
	csrfToken := ""
	if requireCSRF {
		csrfToken = strings.TrimSpace(c.Get(browserCSRFHeaderName))
		csrfCookie := c.Cookies(browserCSRFCookieName)
		if len(csrfToken) == 0 || len(csrfToken) != len(csrfCookie) || len(csrfToken) > maxOIDCCookieBytes ||
			subtle.ConstantTimeCompare([]byte(csrfToken), []byte(csrfCookie)) != 1 {
			recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_invalid", "api", "")
			return failure(c, fiber.StatusUnauthorized, "browser session is invalid or expired")
		}
	}
	claims, err := options.OIDCBrowser.sessions.Verify(verificationContext, sessionToken, csrfToken, requireCSRF)
	if err != nil {
		recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_invalid", "api", "")
		return failure(c, fiber.StatusUnauthorized, "browser session is invalid or expired")
	}
	c.Locals(authClaimsKey{}, claims)
	return c.Next()
}

func browserSessionRequiresCSRF(method string) bool {
	switch method {
	case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
		return false
	default:
		return true
	}
}

func currentClaims(c fiber.Ctx) (auth.Claims, bool) {
	claims, ok := c.Locals(authClaimsKey{}).(auth.Claims)
	return claims, ok
}
