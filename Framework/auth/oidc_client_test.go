package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
			writeOIDCTestJSON(t, response, oidcTestProviderMetadata{
				OIDCProviderMetadata: OIDCProviderMetadata{
					Issuer:                        issuer,
					AuthorizationEndpoint:         issuer + "/authorize",
					TokenEndpoint:                 issuer + "/token",
					JWKSURI:                       issuer + "/jwks",
					ResponseTypesSupported:        []string{"code"},
					CodeChallengeMethodsSupported: []string{"S256"},
				},
				TokenEndpointAuthMethodsSupported: []string{oidcTokenAuthClientSecretBasic},
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
				"code_verifier": strings.Repeat("a", 43),
			} {
				if form.Get(key) != want {
					t.Fatalf("token form %s = %q, want %q", key, form.Get(key), want)
				}
			}
			if form.Has("client_id") || form.Has("client_secret") || strings.Contains(string(body), "client-secret") {
				t.Fatalf("confidential token form contains client credentials: %q", body)
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
		mutate func(*oidcTestProviderMetadata)
	}{
		{name: "issuer mismatch", mutate: func(metadata *oidcTestProviderMetadata) { metadata.Issuer = "http://127.0.0.1/other" }},
		{name: "missing code", mutate: func(metadata *oidcTestProviderMetadata) { metadata.ResponseTypesSupported = nil }},
		{name: "missing S256", mutate: func(metadata *oidcTestProviderMetadata) { metadata.CodeChallengeMethodsSupported = []string{"plain"} }},
		{name: "credential endpoint", mutate: func(metadata *oidcTestProviderMetadata) {
			metadata.TokenEndpoint = "http://user:secret@127.0.0.1/token"
		}},
		{name: "query endpoint", mutate: func(metadata *oidcTestProviderMetadata) { metadata.TokenEndpoint += "?x=1" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newOIDCMetadataServer(t, func(issuer string) oidcTestProviderMetadata {
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

func TestOIDCClientNegotiatesTokenEndpointAuthentication(t *testing.T) {
	tests := []struct {
		name       string
		secret     string
		methods    any
		wantAccept bool
	}{
		{name: "confidential explicit basic", secret: "secret", methods: []string{oidcTokenAuthClientSecretBasic}, wantAccept: true},
		{name: "confidential discovery default", secret: "secret", methods: nil, wantAccept: true},
		{name: "confidential required among extensions", secret: "secret", methods: []string{"private_key_jwt", oidcTokenAuthClientSecretBasic}, wantAccept: true},
		{name: "public explicit none", methods: []string{oidcTokenAuthNone}, wantAccept: true},
		{name: "public required among extensions", methods: []string{"private_key_jwt", oidcTokenAuthNone}, wantAccept: true},
		{name: "public missing methods", methods: nil},
		{name: "public null methods", methods: json.RawMessage("null")},
		{name: "public empty methods", methods: []string{}},
		{name: "public basic only", methods: []string{oidcTokenAuthClientSecretBasic}},
		{name: "confidential null methods", secret: "secret", methods: json.RawMessage("null")},
		{name: "confidential none only", secret: "secret", methods: []string{oidcTokenAuthNone}},
		{name: "confidential post only", secret: "secret", methods: []string{"private-provider-method"}},
		{name: "wrong methods type", methods: "none"},
		{name: "too many methods", methods: append(make([]string, maxOIDCAuthMethods), oidcTokenAuthNone)},
		{name: "invalid method value", methods: []string{"none\nprivate"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newOIDCMetadataServer(t, func(issuer string) oidcTestProviderMetadata {
				metadata := validOIDCMetadata(issuer)
				metadata.TokenEndpointAuthMethodsSupported = test.methods
				return metadata
			})
			defer server.Close()
			_, err := NewOIDCClient(context.Background(), OIDCClientConfig{
				Issuer: server.URL, ClientID: "client", ClientSecret: test.secret,
				RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second,
			})
			if test.wantAccept && err != nil {
				t.Fatalf("NewOIDCClient() error = %v", err)
			}
			if !test.wantAccept {
				if !errors.Is(err, ErrOIDCProviderUnavailable) {
					t.Fatalf("NewOIDCClient() error = %v", err)
				}
				if err.Error() != ErrOIDCProviderUnavailable.Error() || strings.Contains(err.Error(), "private-provider-method") {
					t.Fatalf("provider method leaked through error = %q", err)
				}
			}
		})
	}

	duplicateServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		issuer := serverIssuer(request)
		response.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(response, `{"issuer":%q,"ISSUER":%q,"authorization_endpoint":%q,"token_endpoint":%q,"jwks_uri":%q,"response_types_supported":["code"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["none"]}`,
			issuer, issuer, issuer+"/authorize", issuer+"/token", issuer+"/jwks")
	}))
	defer duplicateServer.Close()
	if _, err := NewOIDCClient(context.Background(), OIDCClientConfig{
		Issuer: duplicateServer.URL, ClientID: "client", RedirectURL: "https://app.example/callback",
	}); !errors.Is(err, ErrOIDCProviderUnavailable) {
		t.Fatalf("duplicate discovery key error = %v", err)
	}
}

func TestOIDCClientBuildsCompliantTokenAuthenticationRequests(t *testing.T) {
	tests := []struct {
		name               string
		clientID           string
		secret             string
		methods            []string
		duplicateTokenJSON bool
	}{
		{name: "confidential basic", clientID: "client id+/:", secret: "secret value+/:?", methods: []string{oidcTokenAuthClientSecretBasic}},
		{name: "public none", clientID: "public client+/:?", methods: []string{oidcTokenAuthNone}},
		{name: "duplicate token JSON", clientID: "public-client", methods: []string{oidcTokenAuthNone}, duplicateTokenJSON: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/.well-known/openid-configuration":
					metadata := validOIDCMetadata(serverIssuer(request))
					metadata.TokenEndpointAuthMethodsSupported = test.methods
					writeOIDCTestJSON(t, response, metadata)
				case "/token":
					if test.duplicateTokenJSON {
						response.Header().Set("Content-Type", "application/json")
						_, _ = io.WriteString(response, `{"access_token":"first","access_token":"second","token_type":"Bearer","expires_in":60,"id_token":"id-token"}`)
						return
					}
					body, err := io.ReadAll(request.Body)
					if err != nil {
						t.Fatalf("read token request: %v", err)
					}
					form, err := url.ParseQuery(string(body))
					if err != nil {
						t.Fatalf("parse token request: %v", err)
					}
					if form.Has("client_secret") || strings.Contains(string(body), test.secret) && test.secret != "" {
						t.Fatalf("client secret appeared in token form: %q", body)
					}
					username, password, hasBasic := request.BasicAuth()
					if test.secret == "" {
						if hasBasic || request.Header.Get("Authorization") != "" || form.Get("client_id") != test.clientID {
							t.Fatalf("public authentication = basic:%t header:%q client_id:%q", hasBasic, request.Header.Get("Authorization"), form.Get("client_id"))
						}
					} else {
						if !hasBasic || username != url.QueryEscape(test.clientID) || password != url.QueryEscape(test.secret) {
							t.Fatalf("basic authentication = %q/%q/%t", username, password, hasBasic)
						}
						if form.Has("client_id") {
							t.Fatalf("confidential form contains client_id: %q", body)
						}
					}
					writeOIDCTestJSON(t, response, OIDCTokenResponse{
						AccessToken: "access-token", TokenType: "Bearer", ExpiresIn: 60, IDToken: "id-token",
					})
				default:
					http.NotFound(response, request)
				}
			}))
			defer server.Close()
			client, err := NewOIDCClient(context.Background(), OIDCClientConfig{
				Issuer: server.URL, ClientID: test.clientID, ClientSecret: test.secret,
				RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second,
			})
			if err != nil {
				t.Fatalf("NewOIDCClient() error = %v", err)
			}
			if _, err := client.ExchangeCode(context.Background(), AuthorizationCode{
				Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce",
			}); (test.duplicateTokenJSON && !errors.Is(err, ErrOIDCTokenExchange)) ||
				(!test.duplicateTokenJSON && err != nil) {
				t.Fatalf("ExchangeCode() error = %v", err)
			}
		})
	}
}

func TestOIDCJSONRejectsAmbiguousDocuments(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "exact duplicate", body: `{"issuer":"one","issuer":"two"}`},
		{name: "escaped duplicate", body: `{"issuer":"one","\u0069ssuer":"two"}`},
		{name: "case folded duplicate", body: `{"issuer":"one","ISSUER":"two"}`},
		{name: "nested duplicate", body: `{"outer":{"value":1,"value":2}}`},
		{name: "multiple top level values", body: `{"issuer":"one"}{"issuer":"two"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var decoded map[string]any
			if err := unmarshalOIDCJSON([]byte(test.body), &decoded); err == nil {
				t.Fatalf("unmarshalOIDCJSON(%s) unexpectedly succeeded", test.body)
			}
		})
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
			server := newOIDCMetadataServer(t, func(issuer string) oidcTestProviderMetadata { return validOIDCMetadata(issuer) })
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

	redirectServer := newOIDCMetadataServer(t, func(issuer string) oidcTestProviderMetadata { return validOIDCMetadata(issuer) })
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

type oidcTestProviderMetadata struct {
	OIDCProviderMetadata
	TokenEndpointAuthMethodsSupported any `json:"token_endpoint_auth_methods_supported,omitempty"`
}

func validOIDCMetadata(issuer string) oidcTestProviderMetadata {
	return oidcTestProviderMetadata{
		OIDCProviderMetadata: OIDCProviderMetadata{
			Issuer: issuer, AuthorizationEndpoint: issuer + "/authorize", TokenEndpoint: issuer + "/token", JWKSURI: issuer + "/jwks",
			ResponseTypesSupported: []string{"code"}, CodeChallengeMethodsSupported: []string{"S256"},
		},
		TokenEndpointAuthMethodsSupported: []string{oidcTokenAuthNone},
	}
}

func newOIDCMetadataServer(t *testing.T, metadata func(string) oidcTestProviderMetadata) *httptest.Server {
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
