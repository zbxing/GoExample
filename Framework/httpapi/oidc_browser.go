package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
)

const (
	oidcStateCookieName      = "__Host-goexample-oidc-state"
	browserSessionCookieName = "__Host-goexample-session"
	browserCSRFCookieName    = "__Host-goexample-csrf"
	browserCSRFHeaderName    = "X-CSRF-Token"
	oidcStartPath            = "/oidc/start"
	oidcCallbackPath         = "/oidc/callback"
	oidcLogoutPath           = "/oidc/logout"
	oidcSessionsPath         = "/oidc/sessions"
	maxOIDCCookieBytes       = 128
)

// OIDCBrowser composes the browser-facing Authorization Code + PKCE boundary.
// It validates a state-bound cookie, ID-token nonce, and access-token subject,
// and can establish a bounded opaque application session.
type OIDCBrowser struct {
	requests        *auth.AuthorizationRequestManager
	client          *auth.OIDCClient
	idTokenVerifier *auth.JWKSVerifier
	sessions        *auth.BrowserSessionManager
}

type browserSessionResponse struct {
	SessionID  string    `json:"sessionId"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	DeviceName string    `json:"deviceName,omitempty"`
}

type browserSessionDeviceNameRequest struct {
	DeviceName *string `json:"deviceName"`
}

// NewOIDCBrowser creates a browser OIDC adapter from validated auth components.
func NewOIDCBrowser(requests *auth.AuthorizationRequestManager, client *auth.OIDCClient, idTokenVerifier *auth.JWKSVerifier) (*OIDCBrowser, error) {
	if requests == nil || client == nil || idTokenVerifier == nil {
		return nil, errors.New("browser OIDC requires authorization, exchange, and ID-token verification components")
	}
	return &OIDCBrowser{
		requests:        requests,
		client:          client,
		idTokenVerifier: idTokenVerifier,
	}, nil
}

// NewOIDCBrowserWithSessions creates the browser adapter and requires a
// server-side opaque session manager for successful callback handoff.
func NewOIDCBrowserWithSessions(requests *auth.AuthorizationRequestManager, client *auth.OIDCClient, idTokenVerifier *auth.JWKSVerifier, sessions *auth.BrowserSessionManager) (*OIDCBrowser, error) {
	browser, err := NewOIDCBrowser(requests, client, idTokenVerifier)
	if err != nil {
		return nil, err
	}
	if sessions == nil || !sessions.Enabled() {
		return nil, errors.New("browser OIDC session handoff requires an enabled session manager")
	}
	browser.sessions = sessions
	return browser, nil
}

// Enabled reports whether all browser OIDC components are present.
func (browser *OIDCBrowser) Enabled() bool {
	return browser != nil && browser.requests != nil && browser.client != nil && browser.idTokenVerifier != nil
}

// SessionsEnabled reports whether successful callbacks establish an application session.
func (browser *OIDCBrowser) SessionsEnabled() bool {
	return browser != nil && browser.sessions != nil && browser.sessions.Enabled()
}

func registerOIDCBrowserRoutes(authGroup fiber.Router, options Options, authLimiter fiber.Handler) {
	browser := options.OIDCBrowser
	if browser == nil {
		return
	}
	if !browser.Enabled() || options.Auth.Enabled() || options.TokenVerifier == nil || !options.TokenVerifier.Enabled() {
		panic("OIDCBrowser requires the active external token verifier and cannot be combined with demo authentication")
	}

	authGroup.Get(oidcStartPath, authLimiter, func(c fiber.Ctx) error {
		requestContext := c.Context()
		if requestContext == nil {
			requestContext = context.Background()
		}
		request, err := browser.requests.StartContext(requestContext)
		if err != nil {
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_start_failed", "oidc_browser", "")
			return failure(c, fiber.StatusServiceUnavailable, "browser authentication is unavailable")
		}
		c.Cookie(&fiber.Cookie{
			Name:     oidcStateCookieName,
			Value:    oidcStateBinding(request.State),
			Path:     "/",
			Expires:  request.ExpiresAt,
			Secure:   true,
			HTTPOnly: true,
			SameSite: fiber.CookieSameSiteLaxMode,
		})
		recordSecurityAudit(c, options, securityEventLogin, securityOutcomeSuccess, "oidc_started", "oidc_browser", "")
		c.Set(fiber.HeaderLocation, request.URL)
		return c.SendStatus(fiber.StatusFound)
	})

	authGroup.Get(oidcCallbackPath, authLimiter, func(c fiber.Ctx) error {
		state := c.Query("state")
		code := c.Query("code")
		cookieBinding := c.Cookies(oidcStateCookieName)
		clearOIDCStateCookie(c)

		requestContext := c.Context()
		if requestContext == nil {
			requestContext = context.Background()
		}
		authorization, completeErr := browser.requests.CompleteContext(requestContext, state, code)
		if completeErr != nil || c.Query("error") != "" || !validOIDCStateBinding(state, cookieBinding) {
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_callback_invalid", "oidc_browser", "")
			return failure(c, fiber.StatusBadRequest, "browser authentication callback is invalid")
		}

		tokens, err := browser.client.ExchangeCode(requestContext, authorization)
		if err != nil {
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_exchange_failed", "oidc_browser", "")
			return failure(c, fiber.StatusBadGateway, "browser authentication is unavailable")
		}
		idClaims, err := browser.idTokenVerifier.VerifyIDToken(requestContext, tokens.IDToken, authorization.Nonce)
		if err != nil {
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_callback_invalid", "oidc_browser", "")
			return failure(c, fiber.StatusBadRequest, "browser authentication callback is invalid")
		}
		accessClaims, err := options.TokenVerifier.VerifyToken(requestContext, tokens.AccessToken)
		if err != nil || !sameOIDCSubject(idClaims.Subject, accessClaims.Subject) {
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_callback_invalid", "oidc_browser", "")
			return failure(c, fiber.StatusBadRequest, "browser authentication callback is invalid")
		}
		if browser.SessionsEnabled() {
			credentials, sessionErr := browser.sessions.Start(requestContext, accessClaims)
			if sessionErr != nil {
				recordSecurityAudit(c, options, securityEventLogin, securityOutcomeFailure, "oidc_session_failed", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser authentication is unavailable")
			}
			setBrowserSessionCookies(c, credentials)
			recordSecurityAudit(c, options, securityEventLogin, securityOutcomeSuccess, "oidc_session_started", "oidc_browser", "")
			return c.SendStatus(fiber.StatusNoContent)
		}
		recordSecurityAudit(c, options, securityEventLogin, securityOutcomeSuccess, "oidc_callback_valid", "oidc_browser", "")
		return c.SendStatus(fiber.StatusNoContent)
	})

	if browser.SessionsEnabled() {
		authGroup.Post(oidcLogoutPath, authLimiter, requireAuth(options), func(c fiber.Ctx) error {
			requestContext := c.Context()
			if requestContext == nil {
				requestContext = context.Background()
			}
			sessionToken := c.Cookies(browserSessionCookieName)
			if sessionToken == "" || browser.sessions.End(requestContext, sessionToken) != nil {
				clearBrowserSessionCookies(c)
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_revoke_failed", "oidc_browser", "")
				return failure(c, fiber.StatusUnauthorized, "browser session is invalid or expired")
			}
			clearBrowserSessionCookies(c)
			recordSecurityAudit(c, options, securityEventSession, securityOutcomeSuccess, "session_revoked", "oidc_browser", "")
			return c.SendStatus(fiber.StatusNoContent)
		})

		authGroup.Get(oidcSessionsPath, authLimiter, requireAuth(options), func(c fiber.Ctx) error {
			claims, ok := currentClaims(c)
			if !ok {
				return fiber.ErrUnauthorized
			}
			sessions, err := browser.sessions.ListForSubject(browserRequestContext(c), claims.Subject)
			if err != nil {
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_inventory_failed", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser session inventory is unavailable")
			}
			recordSecurityAudit(c, options, securityEventSession, securityOutcomeSuccess, "session_inventory_listed", "oidc_browser", "")
			response := make([]browserSessionResponse, len(sessions))
			for index, session := range sessions {
				response[index] = browserSessionResponse{
					SessionID:  session.SessionID,
					CreatedAt:  session.CreatedAt.UTC(),
					ExpiresAt:  session.ExpiresAt.UTC(),
					DeviceName: session.DeviceName,
				}
			}
			return success(c, response)
		})

		authGroup.Patch(oidcSessionsPath+"/:sessionId", authLimiter, requireAuth(options), requireJSON, func(c fiber.Ctx) error {
			claims, ok := currentClaims(c)
			if !ok {
				return fiber.ErrUnauthorized
			}
			var request browserSessionDeviceNameRequest
			if err := bindBody(c, &request); err != nil {
				return err
			}
			if request.DeviceName == nil {
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_device_name_invalid", "oidc_browser", "")
				return fiber.NewError(fiber.StatusBadRequest, "deviceName is required")
			}
			err := browser.sessions.SetDeviceNameForSubject(browserRequestContext(c), claims.Subject, c.Params("sessionId"), *request.DeviceName)
			switch {
			case errors.Is(err, auth.ErrBrowserSessionInvalid):
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_metadata_not_found", "oidc_browser", "")
				return failure(c, fiber.StatusNotFound, "browser session was not found")
			case errors.Is(err, auth.ErrBrowserSessionDeviceNameInvalid):
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_device_name_invalid", "oidc_browser", "")
				return fiber.NewError(fiber.StatusBadRequest, "deviceName is invalid")
			case errors.Is(err, auth.ErrBrowserSessionInventoryUnavailable):
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_metadata_unavailable", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser session inventory is unavailable")
			case err != nil:
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_metadata_failed", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser session inventory is unavailable")
			default:
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeSuccess, "session_metadata_updated", "oidc_browser", "")
				return c.SendStatus(fiber.StatusNoContent)
			}
		})

		authGroup.Delete(oidcSessionsPath+"/:sessionId", authLimiter, requireAuth(options), func(c fiber.Ctx) error {
			claims, ok := currentClaims(c)
			if !ok {
				return fiber.ErrUnauthorized
			}
			err := browser.sessions.RevokeForSubject(browserRequestContext(c), claims.Subject, c.Params("sessionId"))
			if errors.Is(err, auth.ErrBrowserSessionInvalid) {
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_revoke_not_found", "oidc_browser", "")
				return failure(c, fiber.StatusNotFound, "browser session was not found")
			}
			if err != nil {
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_revoke_failed", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser session inventory is unavailable")
			}
			recordSecurityAudit(c, options, securityEventSession, securityOutcomeSuccess, "session_revoked", "oidc_browser", "")
			return c.SendStatus(fiber.StatusNoContent)
		})

		authGroup.Delete(oidcSessionsPath, authLimiter, requireAuth(options), func(c fiber.Ctx) error {
			claims, ok := currentClaims(c)
			if !ok {
				return fiber.ErrUnauthorized
			}
			if _, err := browser.sessions.RevokeAllForSubject(browserRequestContext(c), claims.Subject); err != nil {
				recordSecurityAudit(c, options, securityEventSession, securityOutcomeFailure, "session_revoke_all_failed", "oidc_browser", "")
				return failure(c, fiber.StatusServiceUnavailable, "browser session inventory is unavailable")
			}
			clearBrowserSessionCookies(c)
			recordSecurityAudit(c, options, securityEventSession, securityOutcomeSuccess, "sessions_revoked", "oidc_browser", "")
			return c.SendStatus(fiber.StatusNoContent)
		})
	}
}

func browserRequestContext(c fiber.Ctx) context.Context {
	requestContext := c.Context()
	if requestContext == nil {
		return context.Background()
	}
	return requestContext
}

func oidcStateBinding(state string) string {
	digest := sha256.Sum256([]byte(state))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func validOIDCStateBinding(state, candidate string) bool {
	if state == "" || candidate == "" || len(candidate) > maxOIDCCookieBytes {
		return false
	}
	expected := oidcStateBinding(state)
	return len(expected) == len(candidate) && subtle.ConstantTimeCompare([]byte(expected), []byte(candidate)) == 1
}

func sameOIDCSubject(idTokenSubject, accessTokenSubject string) bool {
	if idTokenSubject == "" || accessTokenSubject == "" || len(idTokenSubject) != len(accessTokenSubject) ||
		strings.TrimSpace(idTokenSubject) != idTokenSubject || strings.TrimSpace(accessTokenSubject) != accessTokenSubject {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(idTokenSubject), []byte(accessTokenSubject)) == 1
}

func clearOIDCStateCookie(c fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     oidcStateCookieName,
		Path:     "/",
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		Secure:   true,
		HTTPOnly: true,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func setBrowserSessionCookies(c fiber.Ctx, credentials auth.BrowserSessionCredentials) {
	c.Cookie(&fiber.Cookie{
		Name: browserSessionCookieName, Value: credentials.SessionToken, Path: "/", Expires: credentials.ExpiresAt,
		Secure: true, HTTPOnly: true, SameSite: fiber.CookieSameSiteLaxMode,
	})
	c.Cookie(&fiber.Cookie{
		Name: browserCSRFCookieName, Value: credentials.CSRFToken, Path: "/", Expires: credentials.ExpiresAt,
		Secure: true, HTTPOnly: false, SameSite: fiber.CookieSameSiteStrictMode,
	})
}

func clearBrowserSessionCookies(c fiber.Ctx) {
	expires := time.Unix(1, 0).UTC()
	c.Cookie(&fiber.Cookie{
		Name: browserSessionCookieName, Path: "/", Expires: expires, MaxAge: -1,
		Secure: true, HTTPOnly: true, SameSite: fiber.CookieSameSiteLaxMode,
	})
	c.Cookie(&fiber.Cookie{
		Name: browserCSRFCookieName, Path: "/", Expires: expires, MaxAge: -1,
		Secure: true, HTTPOnly: false, SameSite: fiber.CookieSameSiteStrictMode,
	})
}
