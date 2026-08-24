package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"

	"github.com/zbxing/goexample/Framework/auth"
)

func TestExternalTokenVerifierProtectsRoutesWithoutDemoLogin(t *testing.T) {
	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	verifier := &fixedTokenVerifier{claims: auth.Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"demo"}, RoleNames: []string{"Demo"},
		RegisteredClaims: jwt.RegisteredClaims{Subject: "oidc-user-1"},
	}}
	options := testOptions()
	options.Now = func() time.Time { return now }
	options.Auth = auth.NewService(auth.Config{})
	options.TokenVerifier = verifier
	options.Endpoints = nil
	options.ApplicationQueries = []ApplicationQuery{
		NewAuthorizedQuery("/oidc-only", []string{"demo"}, func(_ context.Context, _ struct{}, principal ApplicationPrincipal) (string, error) {
			return principal.Subject, nil
		}),
	}
	app := New(options)

	login := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", http.NoBody)
	loginResponse, err := app.Test(login)
	if err != nil {
		t.Fatalf("login request error = %v", err)
	}
	loginResponse.Body.Close()
	if loginResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("external-verifier login status = %d, want 404", loginResponse.StatusCode)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/oidc-only", http.NoBody)
	request.Header.Set(fiber.HeaderAuthorization, "Bearer external-token-secret")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("protected request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("protected request status = %d", response.StatusCode)
	}
	envelope := decodeEnvelope(t, response)
	var subject string
	if err := json.Unmarshal(envelope.Data, &subject); err != nil || subject != "oidc-user-1" {
		t.Fatalf("protected response = %#v, error = %v", envelope, err)
	}
	if verifier.rawToken != "external-token-secret" || !verifier.sawDeadline {
		t.Fatalf("verifier token/deadline = %q/%t", verifier.rawToken, verifier.sawDeadline)
	}

	endpoints := DefaultEndpointsForAuth(true, false)
	if slices.Contains(endpoints, "POST /api/v1/auth/login") || !slices.Contains(endpoints, "GET /api/v1/auth/me") {
		t.Fatalf("external verifier endpoints = %#v", endpoints)
	}
}

func TestExternalTokenVerifierFailureUsesPrivateBearerResponse(t *testing.T) {
	options := testOptions()
	options.Auth = auth.NewService(auth.Config{})
	options.TokenVerifier = &fixedTokenVerifier{err: errors.New("upstream JWKS credential secret")}
	app := New(options)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody)
	request.Header.Set(fiber.HeaderAuthorization, "Bearer external-token-secret")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if challenge := response.Header.Get(fiber.HeaderWWWAuthenticate); challenge != `Bearer realm="goexample", error="invalid_token"` {
		t.Fatalf("WWW-Authenticate = %q", challenge)
	}
	assertNoStoreResponse(t, response)
	envelope := decodeEnvelope(t, response)
	if envelope.Msg != "access token is invalid or expired" {
		t.Fatalf("failure envelope = %#v", envelope)
	}
}

type fixedTokenVerifier struct {
	claims      auth.Claims
	err         error
	rawToken    string
	sawDeadline bool
}

func (verifier *fixedTokenVerifier) Enabled() bool {
	return verifier != nil
}

func (verifier *fixedTokenVerifier) VerifyToken(ctx context.Context, rawToken string) (auth.Claims, error) {
	verifier.rawToken = rawToken
	_, verifier.sawDeadline = ctx.Deadline()
	return verifier.claims, verifier.err
}
