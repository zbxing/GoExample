package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/config"
)

func TestRunServesAndShutsDownOnContextCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release port: %v", err)
	}

	setServerTestEnvironment(t, port)
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var output bytes.Buffer
	errors := make(chan error, 1)
	go func() {
		errors <- run(ctx, &output)
	}()

	client := &http.Client{Timeout: 200 * time.Millisecond}
	address := fmt.Sprintf("http://127.0.0.1:%d/livez", port)
	deadline := time.Now().Add(3 * time.Second)
	for {
		response, requestErr := client.Get(address)
		if requestErr == nil {
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("livez status = %d", response.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not become ready: %v", requestErr)
		}
		time.Sleep(10 * time.Millisecond)
	}

	projectResponse, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/project", port))
	if err != nil {
		t.Fatalf("project endpoint request: %v", err)
	}
	projectResponse.Body.Close()
	if projectResponse.StatusCode != http.StatusOK {
		t.Fatalf("project endpoint status = %d", projectResponse.StatusCode)
	}

	cancel()
	select {
	case err := <-errors:
		if err != nil {
			t.Fatalf("run() error = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not stop after context cancellation")
	}
	if logs := output.String(); !strings.Contains(logs, "server_started") || !strings.Contains(logs, "server_stopped") {
		t.Fatalf("lifecycle logs = %s", logs)
	}
}

func TestRunRejectsProductionWithoutExternalSharedState(t *testing.T) {
	setServerTestEnvironment(t, 3001)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")
	t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
	t.Setenv("SHARED_STATE_MODE", "external")

	err := run(context.Background(), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "REDIS_URL") {
		t.Fatalf("run() error = %v", err)
	}
}

func TestRedisTLSConfigLoadsBoundedCAWithoutWeakeningVerification(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	caPath := filepath.Join(t.TempDir(), "redis-ca.pem")
	if err := os.WriteFile(caPath, certificate, 0o600); err != nil {
		t.Fatalf("write Redis CA: %v", err)
	}
	tlsConfig, err := redisTLSConfig(config.Config{
		RedisTLSEnabled:    true,
		RedisTLSServerName: "redis.internal",
		RedisTLSCAFile:     caPath,
	})
	if err != nil {
		t.Fatalf("redisTLSConfig() error = %v", err)
	}
	if tlsConfig.MinVersion != tls.VersionTLS12 || tlsConfig.ServerName != "redis.internal" ||
		tlsConfig.RootCAs == nil || tlsConfig.InsecureSkipVerify {
		t.Fatalf("Redis TLS config = %#v", tlsConfig)
	}

	invalidPath := filepath.Join(t.TempDir(), "private-ca-name.pem")
	if err := os.WriteFile(invalidPath, []byte("not a certificate"), 0o600); err != nil {
		t.Fatalf("write invalid Redis CA: %v", err)
	}
	_, err = redisTLSConfig(config.Config{RedisTLSEnabled: true, RedisTLSCAFile: invalidPath})
	if err == nil || strings.Contains(err.Error(), invalidPath) {
		t.Fatalf("invalid Redis CA error = %v", err)
	}
}

func TestRunFailsClosedWhenOIDCJWKSIsUnavailable(t *testing.T) {
	setServerTestEnvironment(t, 3001)
	t.Setenv("OIDC_AUTH_ENABLED", "true")
	t.Setenv("OIDC_ISSUER", "http://issuer.example/tenant")
	t.Setenv("OIDC_AUDIENCE", "goexample-test-api")
	t.Setenv("OIDC_JWKS_URL", "http://127.0.0.1:1/credential-secret/jwks")
	t.Setenv("OIDC_JWKS_HTTP_TIMEOUT", "100ms")

	err := run(context.Background(), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "initialize OIDC token verifier") || strings.Contains(err.Error(), "credential-secret") {
		t.Fatalf("run() error = %v", err)
	}
}

func TestRunFailsClosedWhenOIDCBrowserDiscoveryIsUnavailable(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/jwks" {
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte(`{"error":"provider-discovery-secret"}`))
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"keys": []any{map[string]any{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": "browser-startup-key",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer provider.Close()

	setServerTestEnvironment(t, 3001)
	t.Setenv("OIDC_AUTH_ENABLED", "true")
	t.Setenv("OIDC_ISSUER", provider.URL)
	t.Setenv("OIDC_AUDIENCE", "goexample-test-api")
	t.Setenv("OIDC_JWKS_URL", provider.URL+"/jwks")
	t.Setenv("OIDC_BROWSER_ENABLED", "true")
	t.Setenv("OIDC_CLIENT_ID", "goexample-browser")
	t.Setenv("OIDC_CLIENT_SECRET", "browser-client-private")
	t.Setenv("OIDC_REDIRECT_URL", "https://api.example.com/api/v1/auth/oidc/callback")

	err = run(context.Background(), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "initialize browser OIDC client") ||
		strings.Contains(err.Error(), "provider-discovery-secret") || strings.Contains(err.Error(), "browser-client-private") {
		t.Fatalf("run() error = %v", err)
	}
}

func TestRunServesAuthorizedProjectRouteWithOIDCJWKS(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release port: %v", err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}
	jwksServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"keys": []any{map[string]any{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": "example-oidc-key",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer jwksServer.Close()

	setServerTestEnvironment(t, port)
	t.Setenv("OIDC_AUTH_ENABLED", "true")
	t.Setenv("OIDC_ISSUER", jwksServer.URL)
	t.Setenv("OIDC_AUDIENCE", "goexample-test-api")
	t.Setenv("OIDC_JWKS_URL", jwksServer.URL)
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runErrors := make(chan error, 1)
	go func() {
		runErrors <- run(ctx, &bytes.Buffer{})
	}()

	client := &http.Client{Timeout: 500 * time.Millisecond}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	waitForServer(t, client, baseURL+"/livez")

	now := time.Now().UTC()
	claims := auth.Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"demo"}, RoleNames: []string{"Demo"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: jwksServer.URL, Subject: "oidc-user-1", Audience: jwt.ClaimStrings{"goexample-test-api"}, ID: "oidc-token-1",
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now.Add(-time.Second)), ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "example-oidc-key"
	rawToken, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	request, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/project/preview/operators?format=summary", http.NoBody)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+rawToken)
	request.Header.Set("X-Client-Locale", "zh-CN")
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("OIDC project request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("OIDC project status = %d", response.StatusCode)
	}

	cancel()
	select {
	case err := <-runErrors:
		if err != nil {
			t.Fatalf("run() error = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not stop after OIDC contract")
	}
}

func waitForServer(t *testing.T, client *http.Client, endpoint string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		response, err := client.Get(endpoint)
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not become ready: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func setServerTestEnvironment(t *testing.T, port int) {
	t.Helper()
	values := map[string]string{
		"APP_NAME":                              "GoExample Test API",
		"APP_ENV":                               "development",
		"LOG_LEVEL":                             "info",
		"LOG_FORMAT":                            "json",
		"LOG_SKIP_PATHS":                        "/livez,/readyz,/startupz,/metrics",
		"OTEL_TRACES_EXPORTER":                  "none",
		"OTEL_EXPORTER_OTLP_ENDPOINT":           "",
		"OTEL_TRACES_SAMPLER_ARG":               "0.1",
		"OTEL_BSP_EXPORT_TIMEOUT":               "100",
		"OTEL_BSP_SCHEDULE_DELAY":               "50",
		"OTEL_BSP_MAX_QUEUE_SIZE":               "128",
		"OTEL_BSP_MAX_EXPORT_BATCH_SIZE":        "32",
		"HTTP_HOST":                             "127.0.0.1",
		"HTTP_PORT":                             strconv.Itoa(port),
		"CORS_ALLOW_ORIGINS":                    "http://localhost:3000",
		"CORS_ALLOW_CREDENTIALS":                "false",
		"TRUSTED_PROXIES":                       "",
		"HTTP_BODY_LIMIT":                       "4194304",
		"HTTP_READ_TIMEOUT":                     "1s",
		"HTTP_WRITE_TIMEOUT":                    "1s",
		"HTTP_IDLE_TIMEOUT":                     "1s",
		"HTTP_REQUEST_TIMEOUT":                  "100ms",
		"HEALTH_CHECK_TIMEOUT":                  "100ms",
		"HEALTH_CACHE_TTL":                      "100ms",
		"SHUTDOWN_TIMEOUT":                      "2s",
		"SHUTDOWN_DRAIN_DELAY":                  "0s",
		"RATE_LIMIT_MAX":                        "1000",
		"RATE_LIMIT_WINDOW":                     "1m",
		"AUTH_RATE_LIMIT_MAX":                   "100",
		"IDEMPOTENCY_ENABLED":                   "true",
		"IDEMPOTENCY_LIFETIME":                  "1m",
		"SHARED_STATE_MODE":                     "memory",
		"ALLOW_IN_MEMORY_SHARED_STATE":          "false",
		"REDIS_URL":                             "",
		"REDIS_TOPOLOGY":                        "standalone",
		"REDIS_SENTINEL_ADDRESSES":              "",
		"REDIS_SENTINEL_MASTER_NAME":            "",
		"REDIS_USERNAME":                        "",
		"REDIS_PASSWORD":                        "",
		"REDIS_SENTINEL_USERNAME":               "",
		"REDIS_SENTINEL_PASSWORD":               "",
		"REDIS_DATABASE":                        "0",
		"REDIS_TLS_ENABLED":                     "false",
		"REDIS_TLS_SERVER_NAME":                 "",
		"REDIS_TLS_CA_FILE":                     "",
		"REDIS_KEY_PREFIX":                      "goexample:test:",
		"REDIS_OPERATION_TIMEOUT":               "50ms",
		"REDIS_LOCK_TTL":                        "1s",
		"REDIS_LOCK_WAIT_TIMEOUT":               "50ms",
		"REDIS_LOCK_RETRY_INTERVAL":             "5ms",
		"REDIS_POOL_SIZE":                       "4",
		"REDIS_MIN_IDLE_CONNECTIONS":            "0",
		"METRICS_TOKEN":                         "",
		"PPROF_ENABLED":                         "false",
		"PPROF_TOKEN":                           "",
		"SYSTEM_INFO_DETAILED":                  "false",
		"DEMO_AUTH_ENABLED":                     "false",
		"DEMO_USERNAME":                         "demo",
		"DEMO_PASSWORD":                         "demo123",
		"JWT_SECRET":                            "goexample-development-jwt-secret-change-me",
		"JWT_ISSUER":                            "goexample-test",
		"JWT_AUDIENCE":                          "goexample-test-api",
		"JWT_TTL":                               "1h",
		"OIDC_AUTH_ENABLED":                     "false",
		"OIDC_ISSUER":                           "",
		"OIDC_AUDIENCE":                         "",
		"OIDC_JWKS_URL":                         "",
		"OIDC_JWKS_HTTP_TIMEOUT":                "3s",
		"OIDC_JWKS_REFRESH_INTERVAL":            "5m",
		"OIDC_MAX_TOKEN_AGE":                    "15m",
		"OIDC_REQUIRED_ACR":                     "",
		"OIDC_REQUIRED_AMR":                     "",
		"OIDC_MAX_AUTH_AGE":                     "0s",
		"OIDC_BROWSER_ENABLED":                  "false",
		"OIDC_CLIENT_ID":                        "",
		"OIDC_CLIENT_SECRET":                    "",
		"OIDC_REDIRECT_URL":                     "",
		"OIDC_AUTHORIZATION_TTL":                "5m",
		"OIDC_BROWSER_SESSION_TTL":              "15m",
		"OIDC_BROWSER_MAX_SESSIONS":             "10000",
		"OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT": "10",
	}
	for key, value := range values {
		t.Setenv(key, value)
	}
}
