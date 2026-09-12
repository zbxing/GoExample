package auth

import (
	"context"
	"crypto/tls"
	"net/http"
	"testing"
	"time"
)

func TestAuthDefaultHTTPClientsUseBoundedPrivateTransport(t *testing.T) {
	tests := []struct {
		name   string
		client *http.Client
	}{
		{name: "OIDC", client: newTestOIDCClientHTTPClient(t)},
		{name: "JWKS", client: newTestJWKSVerifierHTTPClient(t)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.client.Transport != defaultAuthHTTPTransport {
				t.Fatalf("default auth transport = %p, want package transport %p", test.client.Transport, defaultAuthHTTPTransport)
			}
			if test.client.Transport == http.DefaultTransport {
				t.Fatal("default auth transport aliases process-wide http.DefaultTransport")
			}
			transport := test.client.Transport.(*http.Transport)
			if !transport.ForceAttemptHTTP2 || transport.Proxy == nil || transport.DialContext == nil {
				t.Fatal("default auth transport must preserve proxy, bounded dialing, and HTTP/2 attempt")
			}
			if transport.MaxConnsPerHost != defaultAuthMaxConnections ||
				transport.MaxIdleConns != defaultAuthMaxIdleConnections ||
				transport.MaxIdleConnsPerHost != defaultAuthMaxIdlePerHost ||
				transport.ResponseHeaderTimeout != defaultAuthResponseHeaderLimit ||
				transport.MaxResponseHeaderBytes != defaultAuthMaxResponseHeaders ||
				transport.TLSHandshakeTimeout != defaultAuthConnectTimeout {
				t.Fatalf("default auth transport budgets are not fixed: %#v", transport)
			}
			if transport.TLSClientConfig == nil || transport.TLSClientConfig.MinVersion != tls.VersionTLS12 {
				t.Fatalf("default auth minimum TLS version = %v, want TLS 1.2", transport.TLSClientConfig)
			}
		})
	}
}

func newTestOIDCClientHTTPClient(t *testing.T) *http.Client {
	t.Helper()
	server := newOIDCMetadataServer(t, func(issuer string) oidcTestProviderMetadata { return validOIDCMetadata(issuer) })
	t.Cleanup(server.Close)
	client, err := NewOIDCClient(context.Background(), OIDCClientConfig{
		Issuer: server.URL, ClientID: "client", RedirectURL: "https://app.example/callback", HTTPTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("NewOIDCClient() error = %v", err)
	}
	return client.httpClient
}

func newTestJWKSVerifierHTTPClient(t *testing.T) *http.Client {
	t.Helper()
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "default", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, time.Now)
	t.Cleanup(server.Close)
	return verifier.httpClient
}
