package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestCompleteOIDCCallbackConsumesStateAndBindsIDTokenNonce(t *testing.T) {
	now := time.Date(2026, time.August, 23, 6, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	var nonce string
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			issuer = serverIssuer(request)
			writeOIDCTestJSON(t, response, validOIDCMetadata(issuer))
		case "/jwks":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write(jwksJSON(t, "callback", &key.PublicKey))
		case "/token":
			response.Header().Set("Content-Type", "application/json")
			idToken := signIDToken(t, key, "callback", IDTokenClaims{
				Nonce: nonce,
				RegisteredClaims: jwt.RegisteredClaims{
					Issuer:    issuer,
					Subject:   "oidc-subject",
					Audience:  jwt.ClaimStrings{"callback-client"},
					ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
					IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
				},
			})
			writeOIDCTestJSON(t, response, OIDCTokenResponse{AccessToken: "opaque-access", TokenType: "Bearer", ExpiresIn: 300, IDToken: idToken})
		default:
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	manager, err := NewAuthorizationRequestManager(AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize",
		ClientID:         "callback-client",
		RedirectURL:      "https://app.example/callback",
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
	}
	client, err := NewOIDCClient(context.Background(), OIDCClientConfig{Issuer: server.URL, ClientID: "callback-client", RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second})
	if err != nil {
		t.Fatalf("NewOIDCClient() error = %v", err)
	}
	verifier, err := NewJWKSVerifier(context.Background(), JWKSConfig{Issuer: server.URL, Audience: "callback-client", JWKSURL: server.URL + "/jwks", MaxTokenAge: 10 * time.Minute, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}
	request, err := manager.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	nonce = request.Nonce
	result, err := CompleteOIDCCallback(context.Background(), manager, client, verifier, request.State, "callback-code")
	if err != nil {
		t.Fatalf("CompleteOIDCCallback() error = %v", err)
	}
	if result.Claims.Subject != "oidc-subject" || result.Claims.Nonce != request.Nonce || result.Tokens.AccessToken != "opaque-access" {
		t.Fatalf("callback result = %#v", result)
	}
	if _, err := CompleteOIDCCallback(context.Background(), manager, client, verifier, request.State, "replay"); !errors.Is(err, ErrOIDCCallbackInvalid) {
		t.Fatalf("replayed callback error = %v", err)
	}
}

func TestCompleteOIDCCallbackFailsClosedAndDoesNotLeakProviderErrors(t *testing.T) {
	key := generateRSAKey(t, 2048)
	now := time.Date(2026, time.August, 23, 6, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			writeOIDCTestJSON(t, response, validOIDCMetadata(serverIssuer(request)))
		case "/jwks":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write(jwksJSON(t, "callback", &key.PublicKey))
		case "/token":
			response.Header().Set("Content-Type", "text/plain")
			response.WriteHeader(http.StatusBadGateway)
			_, _ = response.Write([]byte("provider-secret-description"))
		default:
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	manager, err := NewAuthorizationRequestManager(AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize", ClientID: "callback-client", RedirectURL: "https://app.example/callback", Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	client, err := NewOIDCClient(context.Background(), OIDCClientConfig{Issuer: server.URL, ClientID: "callback-client", RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	verifier, err := NewJWKSVerifier(context.Background(), JWKSConfig{Issuer: server.URL, Audience: "callback-client", JWKSURL: server.URL + "/jwks", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	request, err := manager.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	_, err = CompleteOIDCCallback(context.Background(), manager, client, verifier, request.State, "callback-code")
	if !errors.Is(err, ErrOIDCCallbackExchange) || strings.Contains(err.Error(), "provider-secret-description") {
		t.Fatalf("provider failure = %v", err)
	}
	if _, err := CompleteOIDCCallback(context.Background(), manager, client, verifier, request.State, "replay"); !errors.Is(err, ErrOIDCCallbackInvalid) {
		t.Fatalf("post-failure replay error = %v", err)
	}
	if _, err := CompleteOIDCCallback(context.Background(), nil, client, verifier, "state", "code"); !errors.Is(err, ErrOIDCCallbackInvalid) {
		t.Fatalf("nil manager error = %v", err)
	}
}
