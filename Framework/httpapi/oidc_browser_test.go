package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/observability"
)

const (
	oidcBrowserTestAudience    = "browser-api"
	oidcBrowserTestClientID    = "browser-client"
	oidcBrowserTestRedirectURL = "https://app.example/api/v1/auth/oidc/callback"
	oidcBrowserTestKeyID       = "browser-key"
)

type oidcBrowserTestProvider struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	now    time.Time

	mu                 sync.Mutex
	nonce              string
	exchangeCount      int
	exchangeStatus     int
	exchangeErrorBody  string
	accessTokenSubject string
}

func newOIDCBrowserTestProvider(t *testing.T) *oidcBrowserTestProvider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate OIDC test key: %v", err)
	}
	provider := &oidcBrowserTestProvider{
		key:                key,
		now:                time.Date(2026, time.August, 24, 8, 0, 0, 0, time.UTC),
		exchangeStatus:     http.StatusOK,
		accessTokenSubject: "browser-user-1",
	}
	provider.server = httptest.NewServer(http.HandlerFunc(provider.serveHTTP))
	t.Cleanup(provider.server.Close)
	return provider
}

func (provider *oidcBrowserTestProvider) serveHTTP(response http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/.well-known/openid-configuration":
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(auth.OIDCProviderMetadata{
			Issuer:                        provider.server.URL,
			AuthorizationEndpoint:         "https://identity.example/authorize",
			TokenEndpoint:                 provider.server.URL + "/token",
			JWKSURI:                       provider.server.URL + "/jwks",
			ResponseTypesSupported:        []string{"code"},
			CodeChallengeMethodsSupported: []string{"S256"},
		})
	case "/jwks":
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"keys": []any{map[string]any{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": oidcBrowserTestKeyID,
			"n": base64.RawURLEncoding.EncodeToString(provider.key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(provider.key.E)).Bytes()),
		}}})
	case "/token":
		provider.serveToken(response, request)
	default:
		http.NotFound(response, request)
	}
}

func (provider *oidcBrowserTestProvider) serveToken(response http.ResponseWriter, request *http.Request) {
	provider.mu.Lock()
	provider.exchangeCount++
	nonce := provider.nonce
	status := provider.exchangeStatus
	errorBody := provider.exchangeErrorBody
	accessTokenSubject := provider.accessTokenSubject
	provider.mu.Unlock()
	if status != http.StatusOK {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(status)
		_, _ = response.Write([]byte(errorBody))
		return
	}
	if err := request.ParseForm(); err != nil || request.Form.Get("grant_type") != "authorization_code" ||
		request.Form.Get("code") == "" || request.Form.Get("redirect_uri") != oidcBrowserTestRedirectURL ||
		request.Form.Get("client_id") != oidcBrowserTestClientID || len(request.Form.Get("code_verifier")) < 43 {
		response.WriteHeader(http.StatusBadRequest)
		return
	}
	accessToken := provider.sign(tClaims(provider.server.URL, accessTokenSubject, provider.now))
	idToken := provider.sign(auth.IDTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    provider.server.URL,
			Subject:   "browser-user-1",
			Audience:  jwt.ClaimStrings{oidcBrowserTestAudience},
			IssuedAt:  jwt.NewNumericDate(provider.now),
			ExpiresAt: jwt.NewNumericDate(provider.now.Add(5 * time.Minute)),
		},
		Nonce: nonce,
	})
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(auth.OIDCTokenResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   300,
		IDToken:     idToken,
	})
}

func tClaims(issuer, subject string, now time.Time) auth.Claims {
	return auth.Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"demo"}, RoleNames: []string{"Demo"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: issuer, Subject: subject, Audience: jwt.ClaimStrings{oidcBrowserTestAudience}, ID: "access-token-id",
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now.Add(-time.Second)), ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		},
	}
}

func (provider *oidcBrowserTestProvider) sign(claims jwt.Claims) string {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = oidcBrowserTestKeyID
	rawToken, err := token.SignedString(provider.key)
	if err != nil {
		panic(err)
	}
	return rawToken
}

func (provider *oidcBrowserTestProvider) setNonce(nonce string) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.nonce = nonce
}

func (provider *oidcBrowserTestProvider) failExchange(status int, body string) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.exchangeStatus = status
	provider.exchangeErrorBody = body
}

func (provider *oidcBrowserTestProvider) exchanges() int {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	return provider.exchangeCount
}

func newOIDCBrowserTestApp(t *testing.T, provider *oidcBrowserTestProvider, logs *bytes.Buffer, tracerProviders ...*sdktrace.TracerProvider) *fiber.App {
	return newOIDCBrowserTestAppWithSessionStore(t, provider, logs, nil, tracerProviders...)
}

func newOIDCBrowserTestAppWithSessionStore(t *testing.T, provider *oidcBrowserTestProvider, logs *bytes.Buffer, sessionStore auth.BrowserSessionStore, tracerProviders ...*sdktrace.TracerProvider) *fiber.App {
	t.Helper()
	client, err := auth.NewOIDCClient(context.Background(), auth.OIDCClientConfig{
		Issuer: provider.server.URL, ClientID: oidcBrowserTestClientID, RedirectURL: oidcBrowserTestRedirectURL,
		HTTPClient: provider.server.Client(),
	})
	if err != nil {
		t.Fatalf("NewOIDCClient() error = %v", err)
	}
	verifier, err := auth.NewJWKSVerifier(context.Background(), auth.JWKSConfig{
		Issuer: provider.server.URL, Audience: oidcBrowserTestAudience, JWKSURL: provider.server.URL + "/jwks",
		HTTPClient: provider.server.Client(), Now: func() time.Time { return provider.now }, MaxTokenAge: 10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}
	requests, err := auth.NewAuthorizationRequestManager(auth.AuthorizationRequestConfig{
		AuthorizationURL: client.Metadata().AuthorizationEndpoint,
		ClientID:         oidcBrowserTestClientID,
		RedirectURL:      oidcBrowserTestRedirectURL,
		Scopes:           []string{"openid"},
		Now:              func() time.Time { return provider.now },
	})
	if err != nil {
		t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
	}
	sessions, err := auth.NewBrowserSessionManager(auth.BrowserSessionConfig{
		TTL: 10 * time.Minute, MaxSessions: 100, Now: func() time.Time { return provider.now }, Store: sessionStore,
	})
	if err != nil {
		t.Fatalf("NewBrowserSessionManager() error = %v", err)
	}
	browser, err := NewOIDCBrowserWithSessions(requests, client, verifier, sessions)
	if err != nil {
		t.Fatalf("NewOIDCBrowserWithSessions() error = %v", err)
	}
	options := testOptions()
	options.Auth = auth.NewService(auth.Config{})
	options.TokenVerifier = verifier
	options.OIDCBrowser = browser
	options.AuthRateLimitMax = 100
	options.Logger = observability.NewLogger("json", "info", logs)
	if len(tracerProviders) > 0 {
		options.TracerProvider = tracerProviders[0]
	}
	return New(options)
}

type oidcBrowserTestSession struct {
	sessionCookie *http.Cookie
	csrfCookie    *http.Cookie
}

func completeOIDCBrowserSession(t *testing.T, app *fiber.App, provider *oidcBrowserTestProvider, code string) oidcBrowserTestSession {
	t.Helper()
	start := startOIDCBrowser(t, app)
	provider.setNonce(start.nonce)
	response := oidcBrowserCallback(t, app, start.state, code, start.cookie, "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("OIDC callback status = %d", response.StatusCode)
	}
	sessionCookie := responseCookie(response, browserSessionCookieName)
	csrfCookie := responseCookie(response, browserCSRFCookieName)
	if sessionCookie == nil || csrfCookie == nil {
		t.Fatalf("OIDC callback session cookies = %#v", response.Cookies())
	}
	return oidcBrowserTestSession{sessionCookie: sessionCookie, csrfCookie: csrfCookie}
}

type oidcBrowserStart struct {
	state  string
	nonce  string
	cookie *http.Cookie
}

func startOIDCBrowser(t *testing.T, app *fiber.App) oidcBrowserStart {
	t.Helper()
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/start", http.NoBody))
	if err != nil {
		t.Fatalf("OIDC start request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("OIDC start status = %d", response.StatusCode)
	}
	location, err := url.Parse(response.Header.Get(fiber.HeaderLocation))
	if err != nil {
		t.Fatalf("parse OIDC start location: %v", err)
	}
	state := location.Query().Get("state")
	nonce := location.Query().Get("nonce")
	if state == "" || nonce == "" || location.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("OIDC start location is incomplete: %s", location.Redacted())
	}
	var stateCookie *http.Cookie
	for _, cookie := range response.Cookies() {
		if cookie.Name == oidcStateCookieName {
			stateCookie = cookie
			break
		}
	}
	if stateCookie == nil || stateCookie.Value == "" || stateCookie.Value == state || stateCookie.Value == nonce ||
		stateCookie.Path != "/" || !stateCookie.Secure || !stateCookie.HttpOnly || stateCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("OIDC state cookie = %#v", stateCookie)
	}
	return oidcBrowserStart{state: state, nonce: nonce, cookie: stateCookie}
}

func oidcBrowserCallback(t *testing.T, app *fiber.App, state, code string, cookie *http.Cookie, providerError string) *http.Response {
	t.Helper()
	query := make(url.Values)
	query.Set("state", state)
	if code != "" {
		query.Set("code", code)
	}
	if providerError != "" {
		query.Set("error", providerError)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/callback?"+query.Encode(), http.NoBody)
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("OIDC callback request error = %v", err)
	}
	return response
}

func TestOIDCBrowserCompletesStateCookieBoundCallbackOnce(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	recorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	t.Cleanup(func() { _ = tracerProvider.Shutdown(context.Background()) })
	app := newOIDCBrowserTestApp(t, provider, &logs, tracerProvider)
	start := startOIDCBrowser(t, app)
	provider.setNonce(start.nonce)

	const authorizationCode = "authorization-code-private"
	response := oidcBrowserCallback(t, app, start.state, authorizationCode, start.cookie, "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent || response.ContentLength > 0 || provider.exchanges() != 1 {
		t.Fatalf("OIDC callback status/body/exchanges = %d/%d/%d", response.StatusCode, response.ContentLength, provider.exchanges())
	}
	assertNoStoreResponse(t, response)
	stateCookie := responseCookie(response, oidcStateCookieName)
	sessionCookie := responseCookie(response, browserSessionCookieName)
	csrfCookie := responseCookie(response, browserCSRFCookieName)
	if stateCookie == nil || stateCookie.MaxAge >= 0 {
		t.Fatalf("OIDC callback state clear cookie = %#v", stateCookie)
	}
	if sessionCookie == nil || sessionCookie.Value == "" || sessionCookie.Path != "/" || !sessionCookie.Secure || !sessionCookie.HttpOnly || sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("OIDC application session cookie = %#v", sessionCookie)
	}
	if csrfCookie == nil || csrfCookie.Value == "" || csrfCookie.Value == sessionCookie.Value || csrfCookie.Path != "/" || !csrfCookie.Secure || csrfCookie.HttpOnly || csrfCookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("OIDC CSRF cookie = %#v", csrfCookie)
	}
	if sessionCookie.Expires != provider.now.Add(5*time.Minute) || csrfCookie.Expires != sessionCookie.Expires {
		t.Fatalf("OIDC session expiry = %s/%s", sessionCookie.Expires, csrfCookie.Expires)
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody)
	meRequest.AddCookie(sessionCookie)
	me, err := app.Test(meRequest)
	if err != nil {
		t.Fatalf("session /me request error = %v", err)
	}
	if me.StatusCode != http.StatusOK {
		t.Fatalf("session /me status = %d", me.StatusCode)
	}
	me.Body.Close()

	missingCSRF := httptest.NewRequest(http.MethodPost, "/api/v1/auth/oidc/logout", http.NoBody)
	missingCSRF.AddCookie(sessionCookie)
	missingCSRFResponse, err := app.Test(missingCSRF)
	if err != nil {
		t.Fatalf("missing CSRF logout request error = %v", err)
	}
	if missingCSRFResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing CSRF logout status = %d", missingCSRFResponse.StatusCode)
	}
	missingCSRFResponse.Body.Close()

	logoutRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/oidc/logout", http.NoBody)
	logoutRequest.AddCookie(sessionCookie)
	logoutRequest.AddCookie(csrfCookie)
	logoutRequest.Header.Set(browserCSRFHeaderName, csrfCookie.Value)
	logout, err := app.Test(logoutRequest)
	if err != nil {
		t.Fatalf("logout request error = %v", err)
	}
	if logout.StatusCode != http.StatusNoContent || responseCookie(logout, browserSessionCookieName) == nil || responseCookie(logout, browserCSRFCookieName) == nil {
		t.Fatalf("logout status/cookies = %d/%#v", logout.StatusCode, logout.Cookies())
	}
	logout.Body.Close()

	revokedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody)
	revokedRequest.AddCookie(sessionCookie)
	revoked, err := app.Test(revokedRequest)
	if err != nil {
		t.Fatalf("revoked session request error = %v", err)
	}
	if revoked.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked session status = %d", revoked.StatusCode)
	}
	revoked.Body.Close()

	replay := oidcBrowserCallback(t, app, start.state, authorizationCode, start.cookie, "")
	defer replay.Body.Close()
	if replay.StatusCode != http.StatusBadRequest || provider.exchanges() != 1 {
		t.Fatalf("OIDC replay status/exchanges = %d/%d", replay.StatusCode, provider.exchanges())
	}
	assertNoStoreResponse(t, replay)

	privateValues := []string{start.state, start.nonce, start.cookie.Value, authorizationCode, sessionCookie.Value, csrfCookie.Value}
	var spanText strings.Builder
	for _, span := range recorder.Ended() {
		spanText.WriteString(span.Name())
		for _, attribute := range span.Attributes() {
			spanText.WriteString(string(attribute.Key))
			spanText.WriteString(fmt.Sprint(attribute.Value.AsInterface()))
		}
	}
	for _, value := range privateValues {
		if strings.Contains(logs.String(), value) || strings.Contains(spanText.String(), value) {
			t.Fatalf("OIDC telemetry contains private callback material %q: logs=%s spans=%s", value, logs.String(), spanText.String())
		}
	}
}

func TestOIDCBrowserSessionInventoryAndSubjectBoundRevocation(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	app := newOIDCBrowserTestApp(t, provider, &logs)
	first := completeOIDCBrowserSession(t, app, provider, "first-session-code")
	initialListRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
	initialListRequest.AddCookie(first.sessionCookie)
	initialListResponse, err := app.Test(initialListRequest)
	if err != nil {
		t.Fatalf("initial session inventory request error = %v", err)
	}
	initialEnvelope := decodeEnvelope(t, initialListResponse)
	initialListResponse.Body.Close()
	var initialSessions []auth.BrowserSessionInfo
	if err := json.Unmarshal(initialEnvelope.Data, &initialSessions); err != nil || len(initialSessions) != 1 {
		t.Fatalf("initial session inventory = %#v, %v", initialSessions, err)
	}
	firstSessionID := initialSessions[0].SessionID
	second := completeOIDCBrowserSession(t, app, provider, "second-session-code")

	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
	listRequest.AddCookie(first.sessionCookie)
	listResponse, err := app.Test(listRequest)
	if err != nil {
		t.Fatalf("session inventory request error = %v", err)
	}
	assertNoStoreResponse(t, listResponse)
	listEnvelope := decodeEnvelope(t, listResponse)
	listResponse.Body.Close()
	if !bytes.Contains(listEnvelope.Data, []byte(`"sessionId"`)) || bytes.Contains(listEnvelope.Data, []byte(`"SessionID"`)) {
		t.Fatalf("session inventory JSON fields = %s", listEnvelope.Data)
	}
	var sessions []auth.BrowserSessionInfo
	if err := json.Unmarshal(listEnvelope.Data, &sessions); err != nil || len(sessions) != 2 {
		t.Fatalf("session inventory = %#v, %v", sessions, err)
	}
	for _, item := range sessions {
		if item.SessionID == "" || item.CreatedAt != provider.now || item.ExpiresAt != provider.now.Add(5*time.Minute) {
			t.Fatalf("session inventory item = %#v", item)
		}
	}
	secondSessionID := sessions[0].SessionID
	if secondSessionID == firstSessionID {
		secondSessionID = sessions[1].SessionID
	}

	missingCSRF := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/oidc/sessions/"+firstSessionID, http.NoBody)
	missingCSRF.AddCookie(first.sessionCookie)
	missingCSRFResponse, err := app.Test(missingCSRF)
	if err != nil {
		t.Fatalf("missing CSRF revoke request error = %v", err)
	}
	if missingCSRFResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing CSRF revoke status = %d", missingCSRFResponse.StatusCode)
	}
	assertNoStoreResponse(t, missingCSRFResponse)
	missingCSRFResponse.Body.Close()

	foreignToken := provider.sign(tClaims(provider.server.URL, "browser-user-2", provider.now))
	foreignRevoke := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/oidc/sessions/"+firstSessionID, http.NoBody)
	foreignRevoke.Header.Set(fiber.HeaderAuthorization, "Bearer "+foreignToken)
	foreignResponse, err := app.Test(foreignRevoke)
	if err != nil {
		t.Fatalf("foreign revoke request error = %v", err)
	}
	foreignEnvelope := decodeEnvelope(t, foreignResponse)
	foreignResponse.Body.Close()
	if foreignResponse.StatusCode != http.StatusNotFound || foreignEnvelope.Msg != "browser session was not found" {
		t.Fatalf("foreign revoke response = %d/%#v", foreignResponse.StatusCode, foreignEnvelope)
	}
	if strings.Contains(foreignEnvelope.Msg, firstSessionID) {
		t.Fatal("foreign revoke response exposed the target session ID")
	}

	ownerToken := provider.sign(tClaims(provider.server.URL, "browser-user-1", provider.now))
	bearerList := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
	bearerList.Header.Set(fiber.HeaderAuthorization, "Bearer "+ownerToken)
	bearerListResponse, err := app.Test(bearerList)
	if err != nil {
		t.Fatalf("Bearer session inventory request error = %v", err)
	}
	if bearerListResponse.StatusCode != http.StatusOK {
		t.Fatalf("Bearer session inventory status = %d", bearerListResponse.StatusCode)
	}
	assertNoStoreResponse(t, bearerListResponse)
	bearerListResponse.Body.Close()

	bearerRevoke := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/oidc/sessions/"+secondSessionID, http.NoBody)
	bearerRevoke.Header.Set(fiber.HeaderAuthorization, "Bearer "+ownerToken)
	bearerRevokeResponse, err := app.Test(bearerRevoke)
	if err != nil {
		t.Fatalf("Bearer revoke request error = %v", err)
	}
	if bearerRevokeResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("Bearer revoke status = %d", bearerRevokeResponse.StatusCode)
	}
	assertNoStoreResponse(t, bearerRevokeResponse)
	bearerRevokeResponse.Body.Close()

	revokedMe := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody)
	revokedMe.AddCookie(second.sessionCookie)
	revokedMeResponse, err := app.Test(revokedMe)
	if err != nil {
		t.Fatalf("revoked session request error = %v", err)
	}
	if revokedMeResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked session status = %d", revokedMeResponse.StatusCode)
	}
	revokedMeResponse.Body.Close()

	revokeAll := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/oidc/sessions", http.NoBody)
	revokeAll.AddCookie(first.sessionCookie)
	revokeAll.AddCookie(first.csrfCookie)
	revokeAll.Header.Set(browserCSRFHeaderName, first.csrfCookie.Value)
	revokeAllResponse, err := app.Test(revokeAll)
	if err != nil {
		t.Fatalf("revoke-all request error = %v", err)
	}
	if revokeAllResponse.StatusCode != http.StatusNoContent || responseCookie(revokeAllResponse, browserSessionCookieName) == nil || responseCookie(revokeAllResponse, browserCSRFCookieName) == nil {
		t.Fatalf("revoke-all response = %d/%#v", revokeAllResponse.StatusCode, revokeAllResponse.Cookies())
	}
	assertNoStoreResponse(t, revokeAllResponse)
	revokeAllResponse.Body.Close()

	remainingMe := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody)
	remainingMe.AddCookie(first.sessionCookie)
	remainingMeResponse, err := app.Test(remainingMe)
	if err != nil {
		t.Fatalf("revoke-all verification request error = %v", err)
	}
	if remainingMeResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoke-all verification status = %d", remainingMeResponse.StatusCode)
	}
	remainingMeResponse.Body.Close()

	for _, privateValue := range []string{first.sessionCookie.Value, first.csrfCookie.Value, second.sessionCookie.Value, second.csrfCookie.Value} {
		if strings.Contains(logs.String(), privateValue) {
			t.Fatalf("session inventory telemetry contains private credential %q", privateValue)
		}
	}
}

func TestOIDCBrowserSessionDeviceNameRequiresCSRFAndScopesUpdates(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	app := newOIDCBrowserTestApp(t, provider, &logs)
	first := completeOIDCBrowserSession(t, app, provider, "device-name-first")
	_ = completeOIDCBrowserSession(t, app, provider, "device-name-second")

	list := func() ([]auth.BrowserSessionInfo, []byte) {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
		request.AddCookie(first.sessionCookie)
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("device inventory request error = %v", err)
		}
		envelope := decodeEnvelope(t, response)
		response.Body.Close()
		var sessions []auth.BrowserSessionInfo
		if err := json.Unmarshal(envelope.Data, &sessions); err != nil {
			t.Fatalf("device inventory decode error = %v", err)
		}
		return sessions, envelope.Data
	}

	sessions, _ := list()
	if len(sessions) != 2 || sessions[0].SessionID == "" {
		t.Fatalf("initial device inventory = %#v", sessions)
	}
	sessionID := sessions[0].SessionID
	newPatch := func(method, id, body, contentType string, cookie *http.Cookie, csrf string, bearer string) *http.Response {
		t.Helper()
		request := httptest.NewRequest(method, "/api/v1/auth/oidc/sessions/"+id, strings.NewReader(body))
		if contentType != "" {
			request.Header.Set(fiber.HeaderContentType, contentType)
		}
		if cookie != nil {
			request.AddCookie(cookie)
		}
		if csrf != "" {
			request.AddCookie(first.csrfCookie)
			request.Header.Set(browserCSRFHeaderName, csrf)
		}
		if bearer != "" {
			request.Header.Set(fiber.HeaderAuthorization, "Bearer "+bearer)
		}
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("device PATCH request error = %v", err)
		}
		return response
	}

	missingCSRF := newPatch(http.MethodPatch, sessionID, `{"deviceName":"My laptop"}`, fiber.MIMEApplicationJSON, first.sessionCookie, "", "")
	if missingCSRF.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing CSRF device PATCH status = %d", missingCSRF.StatusCode)
	}
	assertNoStoreResponse(t, missingCSRF)
	missingCSRF.Body.Close()

	updated := newPatch(http.MethodPatch, sessionID, `{"deviceName":"My laptop"}`, fiber.MIMEApplicationJSON, first.sessionCookie, first.csrfCookie.Value, "")
	if updated.StatusCode != http.StatusNoContent {
		t.Fatalf("cookie device PATCH status = %d", updated.StatusCode)
	}
	assertNoStoreResponse(t, updated)
	updated.Body.Close()
	sessions, _ = list()
	var named bool
	for _, session := range sessions {
		if session.SessionID == sessionID {
			named = session.DeviceName == "My laptop"
		}
	}
	if !named {
		t.Fatalf("device name was not listed: %#v", sessions)
	}

	ownerToken := provider.sign(tClaims(provider.server.URL, "browser-user-1", provider.now))
	bearerUpdated := newPatch(http.MethodPatch, sessionID, `{"deviceName":"API client"}`, fiber.MIMEApplicationJSON, nil, "", ownerToken)
	if bearerUpdated.StatusCode != http.StatusNoContent {
		t.Fatalf("Bearer device PATCH status = %d", bearerUpdated.StatusCode)
	}
	assertNoStoreResponse(t, bearerUpdated)
	bearerUpdated.Body.Close()

	foreignToken := provider.sign(tClaims(provider.server.URL, "browser-user-2", provider.now))
	foreign := newPatch(http.MethodPatch, sessionID, `{"deviceName":"foreign"}`, fiber.MIMEApplicationJSON, nil, "", foreignToken)
	foreignEnvelope := decodeEnvelope(t, foreign)
	foreign.Body.Close()
	if foreign.StatusCode != http.StatusNotFound || foreignEnvelope.Msg != "browser session was not found" {
		t.Fatalf("foreign device PATCH response = %d/%#v", foreign.StatusCode, foreignEnvelope)
	}

	invalid := newPatch(http.MethodPatch, sessionID, `{"deviceName":" leading"}`, fiber.MIMEApplicationJSON, nil, "", ownerToken)
	invalidEnvelope := decodeEnvelope(t, invalid)
	invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest || invalidEnvelope.Msg != "deviceName is invalid" {
		t.Fatalf("invalid device PATCH response = %d/%#v", invalid.StatusCode, invalidEnvelope)
	}

	missingField := newPatch(http.MethodPatch, sessionID, `{}`, fiber.MIMEApplicationJSON, nil, "", ownerToken)
	missingField.Body.Close()
	if missingField.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing deviceName PATCH status = %d", missingField.StatusCode)
	}

	cleared := newPatch(http.MethodPatch, sessionID, `{"deviceName":""}`, fiber.MIMEApplicationJSON, first.sessionCookie, first.csrfCookie.Value, "")
	if cleared.StatusCode != http.StatusNoContent {
		t.Fatalf("clear device PATCH status = %d", cleared.StatusCode)
	}
	cleared.Body.Close()
	_, raw := list()
	if bytes.Contains(raw, []byte(`"deviceName"`)) {
		t.Fatalf("cleared device name appeared in inventory: %s", raw)
	}
	for _, privateValue := range []string{"My laptop", "API client", "foreign"} {
		if strings.Contains(logs.String(), privateValue) {
			t.Fatalf("device name appeared in audit logs: %q", privateValue)
		}
	}
}

func TestOIDCBrowserSessionInventoryFailsClosedForLegacyStore(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	store := &oidcBrowserLegacySessionStore{records: make(map[[sha256.Size]byte]auth.BrowserSessionRecord)}
	app := newOIDCBrowserTestAppWithSessionStore(t, provider, &bytes.Buffer{}, store)
	session := completeOIDCBrowserSession(t, app, provider, "legacy-store-code")

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
	request.AddCookie(session.sessionCookie)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("legacy inventory request error = %v", err)
	}
	envelope := decodeEnvelope(t, response)
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || envelope.Msg != "browser session inventory is unavailable" {
		t.Fatalf("legacy inventory response = %d/%#v", response.StatusCode, envelope)
	}
	assertNoStoreResponse(t, response)
	response.Body.Close()
	patchRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/auth/oidc/sessions/"+strings.Repeat("a", 43), strings.NewReader(`{"deviceName":"legacy"}`))
	patchRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	patchRequest.AddCookie(session.sessionCookie)
	patchRequest.AddCookie(session.csrfCookie)
	patchRequest.Header.Set(browserCSRFHeaderName, session.csrfCookie.Value)
	patchResponse, err := app.Test(patchRequest)
	if err != nil {
		t.Fatalf("legacy device metadata request error = %v", err)
	}
	patchEnvelope := decodeEnvelope(t, patchResponse)
	patchResponse.Body.Close()
	if patchResponse.StatusCode != http.StatusServiceUnavailable || patchEnvelope.Msg != "browser session inventory is unavailable" {
		t.Fatalf("legacy device metadata response = %d/%#v", patchResponse.StatusCode, patchEnvelope)
	}
	assertNoStoreResponse(t, patchResponse)
}

func TestOIDCBrowserSessionInventoryCollapsesBackendOutage(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	store := &oidcBrowserUnavailableInventoryStore{oidcBrowserLegacySessionStore: oidcBrowserLegacySessionStore{
		records: make(map[[sha256.Size]byte]auth.BrowserSessionRecord),
	}}
	app := newOIDCBrowserTestAppWithSessionStore(t, provider, &logs, store)
	session := completeOIDCBrowserSession(t, app, provider, "outage-store-code")

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/sessions", http.NoBody)
	request.AddCookie(session.sessionCookie)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("outage inventory request error = %v", err)
	}
	envelope := decodeEnvelope(t, response)
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || envelope.Msg != "browser session inventory is unavailable" {
		t.Fatalf("outage inventory response = %d/%#v", response.StatusCode, envelope)
	}
	assertNoStoreResponse(t, response)
	if strings.Contains(logs.String(), "private inventory backend detail") {
		t.Fatalf("outage inventory logs leaked backend detail: %s", logs.String())
	}
}

func TestOIDCBrowserRejectsMissingOrMismatchedCookieAndConsumesState(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	app := newOIDCBrowserTestApp(t, provider, &bytes.Buffer{})

	tests := []struct {
		name   string
		cookie func(*http.Cookie) *http.Cookie
	}{
		{name: "missing", cookie: func(*http.Cookie) *http.Cookie { return nil }},
		{name: "mismatch", cookie: func(cookie *http.Cookie) *http.Cookie {
			clone := *cookie
			clone.Value = strings.Repeat("x", 43)
			return &clone
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			start := startOIDCBrowser(t, app)
			provider.setNonce(start.nonce)
			response := oidcBrowserCallback(t, app, start.state, "one-time-code", test.cookie(start.cookie), "")
			response.Body.Close()
			if response.StatusCode != http.StatusBadRequest {
				t.Fatalf("OIDC cookie rejection status = %d", response.StatusCode)
			}
			replay := oidcBrowserCallback(t, app, start.state, "one-time-code", start.cookie, "")
			replay.Body.Close()
			if replay.StatusCode != http.StatusBadRequest {
				t.Fatalf("OIDC consumed-state replay status = %d", replay.StatusCode)
			}
		})
	}
	if provider.exchanges() != 0 {
		t.Fatalf("OIDC cookie failures exchanged %d codes", provider.exchanges())
	}
}

func TestOIDCBrowserCollapsesProviderFailuresAndPrivateQueryValues(t *testing.T) {
	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	app := newOIDCBrowserTestApp(t, provider, &logs)

	providerErrorStart := startOIDCBrowser(t, app)
	const providerError = "provider-private-error"
	response := oidcBrowserCallback(t, app, providerErrorStart.state, "", providerErrorStart.cookie, providerError)
	providerErrorEnvelope := decodeEnvelope(t, response)
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || providerErrorEnvelope.Msg != "browser authentication callback is invalid" {
		t.Fatalf("provider callback failure = %d/%#v", response.StatusCode, providerErrorEnvelope)
	}

	exchangeStart := startOIDCBrowser(t, app)
	provider.setNonce(exchangeStart.nonce)
	const providerBody = `{"error":"provider-exchange-secret"}`
	provider.failExchange(http.StatusInternalServerError, providerBody)
	exchange := oidcBrowserCallback(t, app, exchangeStart.state, "exchange-code-private", exchangeStart.cookie, "")
	exchangeEnvelope := decodeEnvelope(t, exchange)
	exchange.Body.Close()
	if exchange.StatusCode != http.StatusBadGateway || exchangeEnvelope.Msg != "browser authentication is unavailable" {
		t.Fatalf("OIDC exchange failure = %d/%#v", exchange.StatusCode, exchangeEnvelope)
	}
	for _, privateValue := range []string{providerError, providerBody, exchangeStart.state, exchangeStart.nonce, exchangeStart.cookie.Value, "exchange-code-private"} {
		if strings.Contains(logs.String(), privateValue) || strings.Contains(providerErrorEnvelope.Msg, privateValue) || strings.Contains(exchangeEnvelope.Msg, privateValue) {
			t.Fatalf("OIDC failure leaked private value %q: logs=%s", privateValue, logs.String())
		}
	}
}

func TestOIDCBrowserRequiresExternalAuthenticationMode(t *testing.T) {
	if _, err := NewOIDCBrowser(nil, nil, nil); err == nil {
		t.Fatal("NewOIDCBrowser() accepted missing components")
	}
	if _, err := NewOIDCBrowserWithSessions(nil, nil, nil, nil); err == nil {
		t.Fatal("NewOIDCBrowserWithSessions() accepted missing components")
	}

	provider := newOIDCBrowserTestProvider(t)
	var logs bytes.Buffer
	app := newOIDCBrowserTestApp(t, provider, &logs)
	_ = app

	options := testOptions()
	client, err := auth.NewOIDCClient(context.Background(), auth.OIDCClientConfig{
		Issuer: provider.server.URL, ClientID: oidcBrowserTestClientID, RedirectURL: oidcBrowserTestRedirectURL, HTTPClient: provider.server.Client(),
	})
	if err != nil {
		t.Fatalf("NewOIDCClient() error = %v", err)
	}
	verifier, err := auth.NewJWKSVerifier(context.Background(), auth.JWKSConfig{
		Issuer: provider.server.URL, Audience: oidcBrowserTestAudience, JWKSURL: provider.server.URL + "/jwks", HTTPClient: provider.server.Client(), Now: func() time.Time { return provider.now },
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}
	requests, err := auth.NewAuthorizationRequestManager(auth.AuthorizationRequestConfig{
		AuthorizationURL: client.Metadata().AuthorizationEndpoint, ClientID: oidcBrowserTestClientID, RedirectURL: oidcBrowserTestRedirectURL,
	})
	if err != nil {
		t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
	}
	options.OIDCBrowser, err = NewOIDCBrowser(requests, client, verifier)
	if err != nil {
		t.Fatalf("NewOIDCBrowser() error = %v", err)
	}
	defer func() {
		if recovered := recover(); recovered == nil || !strings.Contains(fmt.Sprint(recovered), "cannot be combined with demo authentication") {
			t.Fatalf("New() panic = %v", recovered)
		}
	}()
	New(options)
}

func TestOIDCBrowserReservesConditionalRoutesOnlyWhenEnabled(t *testing.T) {
	handler := func(context.Context) (any, error) { return nil, nil }
	queries := []ApplicationQuery{{Path: "/auth/oidc/start", Handler: handler}}
	validateApplicationQueries(queries, true, false)
	if _, reserved := defaultApplicationRoutePaths(fiber.MethodPost, true, true)["/auth/oidc/logout"]; !reserved {
		t.Fatal("session-enabled OIDC logout route was not reserved")
	}
	if _, reserved := defaultApplicationRoutePaths(fiber.MethodGet, true, true)["/auth/oidc/sessions"]; !reserved {
		t.Fatal("session-enabled OIDC inventory route was not reserved")
	}
	if _, reserved := defaultApplicationRoutePaths(fiber.MethodDelete, true, true)["/auth/oidc/sessions/:sessionId"]; !reserved {
		t.Fatal("session-enabled OIDC revoke route was not reserved")
	}
	if _, reserved := defaultApplicationRoutePaths(fiber.MethodPatch, true, true)["/auth/oidc/sessions/:sessionId"]; !reserved {
		t.Fatal("session-enabled OIDC device metadata route was not reserved")
	}

	defer func() {
		if recovered := recover(); recovered == nil {
			t.Fatal("validateApplicationQueries() accepted an enabled OIDC browser route collision")
		}
	}()
	validateApplicationQueries(queries, true, true)
}

type oidcBrowserLegacySessionStore struct {
	mu      sync.Mutex
	records map[[sha256.Size]byte]auth.BrowserSessionRecord
}

type oidcBrowserUnavailableInventoryStore struct {
	oidcBrowserLegacySessionStore
}

func (store *oidcBrowserUnavailableInventoryStore) CreateBrowserSessionWithInventory(ctx context.Context, tokenHash [sha256.Size]byte, record auth.BrowserSessionRecord, now time.Time, max, _ int) error {
	return store.CreateBrowserSession(ctx, tokenHash, record, now, max)
}

func (*oidcBrowserUnavailableInventoryStore) ListBrowserSessions(context.Context, [sha256.Size]byte, time.Time, int) ([]auth.BrowserSessionInfo, error) {
	return nil, fmt.Errorf("private inventory backend detail")
}

func (*oidcBrowserUnavailableInventoryStore) DeleteBrowserSessionByID(context.Context, [sha256.Size]byte, [sha256.Size]byte) error {
	return fmt.Errorf("private inventory backend detail")
}

func (*oidcBrowserUnavailableInventoryStore) DeleteBrowserSessionsForSubject(context.Context, [sha256.Size]byte, time.Time) (int, error) {
	return 0, fmt.Errorf("private inventory backend detail")
}

func (store *oidcBrowserLegacySessionStore) CreateBrowserSession(_ context.Context, tokenHash [sha256.Size]byte, record auth.BrowserSessionRecord, _ time.Time, _ int) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.records[tokenHash] = record
	return nil
}

func (store *oidcBrowserLegacySessionStore) ReadBrowserSession(_ context.Context, tokenHash [sha256.Size]byte, _ time.Time) (auth.BrowserSessionRecord, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	record, exists := store.records[tokenHash]
	if !exists {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	return record, nil
}

func (store *oidcBrowserLegacySessionStore) DeleteBrowserSession(_ context.Context, tokenHash [sha256.Size]byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.records[tokenHash]; !exists {
		return auth.ErrBrowserSessionInvalid
	}
	delete(store.records, tokenHash)
	return nil
}

func responseCookie(response *http.Response, name string) *http.Cookie {
	for _, cookie := range response.Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}
