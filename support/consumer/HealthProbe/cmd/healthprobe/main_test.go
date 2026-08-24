package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	goexample "github.com/zbxing/goexample/SDK/GoExample"
)

func TestHealthProbeMigratesFromDeprecatedAliasToCanonicalReadiness(t *testing.T) {
	checker := health.New(100*time.Millisecond, time.Millisecond)
	app := httpapi.New(httpapi.Options{
		Name:        "HealthProbe migration contract",
		Environment: "test",
		Health:      checker,
	})
	frameworkHandler, err := httpapi.NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	var pathsMu sync.Mutex
	requestedPaths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		pathsMu.Lock()
		requestedPaths = append(requestedPaths, request.URL.Path)
		pathsMu.Unlock()
		frameworkHandler.ServeHTTP(writer, request)
	}))
	defer server.Close()

	client, err := goexample.NewClient(server.URL, goexample.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	legacyResponse, err := client.GetApiReadiness(context.Background())
	if err != nil {
		t.Fatalf("GetApiReadiness() error = %v", err)
	}
	if legacyResponse.StatusCode != http.StatusOK {
		t.Fatalf("legacy readiness status = %d", legacyResponse.StatusCode)
	}
	if legacyResponse.Header.Get("Deprecation") != "@1787184000" {
		t.Fatalf("Deprecation = %q", legacyResponse.Header.Get("Deprecation"))
	}
	if legacyResponse.Header.Get("Sunset") != "Sat, 20 Feb 2027 00:00:00 GMT" {
		t.Fatalf("Sunset = %q", legacyResponse.Header.Get("Sunset"))
	}
	if legacyResponse.Header.Get("Link") != "</readyz>; rel=\"successor-version\"" {
		t.Fatalf("Link = %q", legacyResponse.Header.Get("Link"))
	}

	pathsMu.Lock()
	requestedPaths = requestedPaths[:0]
	pathsMu.Unlock()
	if err := checkReadiness(context.Background(), server.URL, server.Client()); err != nil {
		t.Fatalf("checkReadiness() error = %v", err)
	}
	pathsMu.Lock()
	defer pathsMu.Unlock()
	if len(requestedPaths) != 1 || requestedPaths[0] != "/readyz" {
		t.Fatalf("migrated consumer paths = %v, want [/readyz]", requestedPaths)
	}
}

func TestHealthProbeRejectsUnavailableAndMalformedResponses(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "unavailable", status: http.StatusServiceUnavailable, body: `{"code":503,"data":null,"msg":"not ready"}`},
		{name: "malformed envelope", status: http.StatusOK, body: `not-json`},
		{name: "application error", status: http.StatusOK, body: `{"code":17,"data":null,"msg":"failed"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()
			if err := checkReadiness(context.Background(), server.URL, server.Client()); err == nil {
				t.Fatal("checkReadiness() error = nil")
			}
		})
	}
}
