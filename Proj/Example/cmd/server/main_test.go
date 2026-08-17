package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
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

func setServerTestEnvironment(t *testing.T, port int) {
	t.Helper()
	values := map[string]string{
		"APP_NAME":               "GoExample Test API",
		"APP_ENV":                "development",
		"LOG_LEVEL":              "info",
		"LOG_FORMAT":             "json",
		"LOG_SKIP_PATHS":         "/livez,/readyz,/startupz,/metrics",
		"HTTP_HOST":              "127.0.0.1",
		"HTTP_PORT":              strconv.Itoa(port),
		"CORS_ALLOW_ORIGINS":     "http://localhost:3000",
		"CORS_ALLOW_CREDENTIALS": "false",
		"TRUSTED_PROXIES":        "",
		"HTTP_BODY_LIMIT":        "4194304",
		"HTTP_READ_TIMEOUT":      "1s",
		"HTTP_WRITE_TIMEOUT":     "1s",
		"HTTP_IDLE_TIMEOUT":      "1s",
		"HTTP_REQUEST_TIMEOUT":   "100ms",
		"HEALTH_CHECK_TIMEOUT":   "100ms",
		"HEALTH_CACHE_TTL":       "100ms",
		"SHUTDOWN_TIMEOUT":       "2s",
		"SHUTDOWN_DRAIN_DELAY":   "0s",
		"RATE_LIMIT_MAX":         "1000",
		"RATE_LIMIT_WINDOW":      "1m",
		"AUTH_RATE_LIMIT_MAX":    "100",
		"IDEMPOTENCY_ENABLED":    "true",
		"IDEMPOTENCY_LIFETIME":   "1m",
		"METRICS_TOKEN":          "",
		"PPROF_ENABLED":          "false",
		"PPROF_TOKEN":            "",
		"SYSTEM_INFO_DETAILED":   "false",
		"DEMO_AUTH_ENABLED":      "false",
		"DEMO_USERNAME":          "demo",
		"DEMO_PASSWORD":          "demo123",
		"JWT_SECRET":             "goexample-development-jwt-secret-change-me",
		"JWT_ISSUER":             "goexample-test",
		"JWT_TTL":                "1h",
	}
	for key, value := range values {
		t.Setenv(key, value)
	}
}
