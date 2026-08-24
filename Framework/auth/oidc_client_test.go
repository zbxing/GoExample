package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestOIDCClientDiscoversAndExchangesAuthorizationCode(t *testing.T) {
	var tokenRequest http.Request
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			issuer := serverIssuer(request)
			writeOIDCTestJSON(t, response, OIDCProviderMetadata{
				Issuer:                        issuer,
				AuthorizationEndpoint:         issuer + "/authorize",
				TokenEndpoint:                 issuer + "/token",
				JWKSURI:                       issuer + "/jwks",
				ResponseTypesSupported:        []string{"code"},
				CodeChallengeMethodsSupported: []string{"S256"},
			})
		case "/token":
			tokenRequest = *request
			if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Fatalf("token request = %s %s", request.Method, request.Header.Get("Content-Type"))
			}
			username, password, ok := request.BasicAuth()
			if !ok || username != "web-client" || password != "client-secret" {
				t.Fatalf("token basic auth = %q/%q/%t", username, password, ok)
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("read token request: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parse token request: %v", err)
			}
			for key, want := range map[string]string{
				"grant_type": "authorization_code", "code": "code-123", "redirect_uri": "https://app.example/callback",
				"client_id": "web-client", "code_verifier": strings.Repeat("a", 43),
			} {
				if form.Get(key) != want {
					t.Fatalf("token form %s = %q, want %q", key, form.Get(key), want)
				}
			}
			writeOIDCTestJSON(t, response, OIDCTokenResponse{
				AccessToken: "access-token", TokenType: "Bearer", ExpiresIn: 3600,
				RefreshToken: "refresh-token", IDToken: "id-token", Scope: "openid profile",
			})
		default:
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client, err := NewOIDCClient(context.Background(), OIDCClientConfig{
		Issuer: server.URL, ClientID: "web-client", ClientSecret: "client-secret",
		RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("NewOIDCClient() error = %v", err)
	}
	metadata := client.Metadata()
	if metadata.Issuer != server.URL || !containsString(metadata.ResponseTypesSupported, "code") {
		t.Fatalf("metadata = %#v", metadata)
	}
	metadata.ResponseTypesSupported[0] = "changed"
	if client.Metadata().ResponseTypesSupported[0] != "code" {
		t.Fatal("Metadata() returned mutable provider state")
	}
	tokens, err := client.ExchangeCode(context.Background(), AuthorizationCode{
		Code: "code-123", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce-123",
	})
	if err != nil {
		t.Fatalf("ExchangeCode() error = %v", err)
	}
	if tokens.AccessToken != "access-token" || tokens.IDToken != "id-token" || tokens.ExpiresIn != 3600 {
		t.Fatalf("tokens = %#v", tokens)
	}
	if tokenRequest.URL.Path != "/token" {
		t.Fatal("token endpoint was not called")
	}
}

func TestNewOIDCClientRejectsUnsafeOrIncompleteDiscovery(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*OIDCProviderMetadata)
	}{
		{name: "issuer mismatch", mutate: func(metadata *OIDCProviderMetadata) { metadata.Issuer = "http://127.0.0.1/other" }},
		{name: "missing code", mutate: func(metadata *OIDCProviderMetadata) { metadata.ResponseTypesSupported = nil }},
		{name: "missing S256", mutate: func(metadata *OIDCProviderMetadata) { metadata.CodeChallengeMethodsSupported = []string{"plain"} }},
		{name: "credential endpoint", mutate: func(metadata *OIDCProviderMetadata) { metadata.TokenEndpoint = "http://user:secret@127.0.0.1/token" }},
		{name: "query endpoint", mutate: func(metadata *OIDCProviderMetadata) { metadata.TokenEndpoint += "?x=1" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newOIDCMetadataServer(t, func(issuer string) OIDCProviderMetadata {
				metadata := validOIDCMetadata(issuer)
				test.mutate(&metadata)
				return metadata
			})
			defer server.Close()
			if _, err := NewOIDCClient(context.Background(), OIDCClientConfig{
				Issuer: server.URL, ClientID: "client", RedirectURL: "https://app.example/callback",
			}); !errors.Is(err, ErrOIDCProviderUnavailable) {
				t.Fatalf("NewOIDCClient() error = %v", err)
			}
		})
	}
	if _, err := NewOIDCClient(context.Background(), OIDCClientConfig{
		Issuer: "http://issuer.example", ClientID: "client", RedirectURL: "https://app.example/callback",
	}); err == nil {
		t.Fatal("non-loopback HTTP issuer unexpectedly accepted")
	}
}

func TestOIDCClientBoundsTokenExchangeAndStopsRedirects(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		content    string
		body       string
		wantErr    error
	}{
		{name: "status", statusCode: http.StatusBadRequest, content: "application/json", body: `{}`, wantErr: ErrOIDCTokenExchange},
		{name: "content type", statusCode: http.StatusOK, content: "text/plain", body: `{}`, wantErr: ErrOIDCTokenExchange},
		{name: "malformed", statusCode: http.StatusOK, content: "application/json", body: `{`, wantErr: ErrOIDCTokenExchange},
		{name: "missing id token", statusCode: http.StatusOK, content: "application/json", body: `{"access_token":"a","token_type":"Bearer","expires_in":60}`, wantErr: ErrOIDCTokenExchange},
		{name: "oversized", statusCode: http.StatusOK, content: "application/json", body: strings.Repeat("x", maxOIDCTokenResponseBytes+1), wantErr: ErrOIDCTokenExchange},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newOIDCMetadataServer(t, func(issuer string) OIDCProviderMetadata { return validOIDCMetadata(issuer) })
			originalHandler := server.Config.Handler
			server.Config.Handler = http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/token" {
					response.Header().Set("Content-Type", test.content)
					response.WriteHeader(test.statusCode)
					_, _ = response.Write([]byte(test.body))
					return
				}
				originalHandler.ServeHTTP(response, request)
			})
			client, err := NewOIDCClient(context.Background(), OIDCClientConfig{
				Issuer: server.URL, ClientID: "client", RedirectURL: "https://app.example/callback",
			})
			if err != nil {
				t.Fatalf("NewOIDCClient() error = %v", err)
			}
			if _, err := client.ExchangeCode(context.Background(), AuthorizationCode{
				Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce",
			}); !errors.Is(err, test.wantErr) {
				t.Fatalf("ExchangeCode() error = %v", err)
			}
		})
	}

	redirectServer := newOIDCMetadataServer(t, func(issuer string) OIDCProviderMetadata { return validOIDCMetadata(issuer) })
	originalHandler := redirectServer.Config.Handler
	redirectServer.Config.Handler = http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/token" {
			response.Header().Set("Location", "https://evil.example/token")
			response.WriteHeader(http.StatusFound)
			return
		}
		originalHandler.ServeHTTP(response, request)
	})
	defer redirectServer.Close()
	client, err := NewOIDCClient(context.Background(), OIDCClientConfig{
		Issuer: redirectServer.URL, ClientID: "client", RedirectURL: "https://app.example/callback",
	})
	if err != nil {
		t.Fatalf("redirect NewOIDCClient() error = %v", err)
	}
	if _, err := client.ExchangeCode(context.Background(), AuthorizationCode{
		Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce",
	}); !errors.Is(err, ErrOIDCTokenExchange) {
		t.Fatalf("redirect ExchangeCode() error = %v", err)
	}

	invalidCodes := []AuthorizationCode{
		{Code: "code", CodeVerifier: "short", Nonce: "nonce"},
		{Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: ""},
	}
	for _, authorization := range invalidCodes {
		if _, err := client.ExchangeCode(context.Background(), authorization); !errors.Is(err, ErrOIDCTokenExchange) {
			t.Fatalf("invalid authorization code error = %v", err)
		}
	}
}

func validOIDCMetadata(issuer string) OIDCProviderMetadata {
	return OIDCProviderMetadata{
		Issuer: issuer, AuthorizationEndpoint: issuer + "/authorize", TokenEndpoint: issuer + "/token", JWKSURI: issuer + "/jwks",
		ResponseTypesSupported: []string{"code"}, CodeChallengeMethodsSupported: []string{"S256"},
	}
}

func newOIDCMetadataServer(t *testing.T, metadata func(string) OIDCProviderMetadata) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		writeOIDCTestJSON(t, response, metadata(serverIssuer(request)))
	}))
}

func serverIssuer(request *http.Request) string {
	return "http://" + request.Host
}

func writeOIDCTestJSON(t *testing.T, response http.ResponseWriter, value any) {
	t.Helper()
	response.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response).Encode(value); err != nil {
		t.Fatalf("encode OIDC response: %v", err)
	}
}
