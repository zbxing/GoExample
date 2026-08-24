package goexample

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeneratedClientCoversPublishedOperations(t *testing.T) {
	if APIVersion != "1.4.0" {
		t.Fatalf("APIVersion = %q, want 1.4.0", APIVersion)
	}
	operations := PublishedOperations()
	if len(operations) != 26 {
		t.Fatalf("generated operations = %d, want 26", len(operations))
	}
	operationIDs := make(map[string]struct{}, len(operations))
	for _, operation := range operations {
		operationIDs[operation.OperationID] = struct{}{}
	}
	for _, operationID := range []string{"getReadiness", "startOIDCBrowserAuthorization", "completeOIDCBrowserAuthorization", "logoutOIDCBrowserSession", "listOIDCBrowserSessions", "updateOIDCBrowserSessionDeviceName", "revokeOIDCBrowserSession", "revokeAllOIDCBrowserSessions", "previewProject", "describeProject"} {
		if _, exists := operationIDs[operationID]; !exists {
			t.Fatalf("generated operations missing %q", operationID)
		}
	}
	operations[0].Path = "/mutated-by-caller"
	if PublishedOperations()[0].Path == operations[0].Path {
		t.Fatal("PublishedOperations exposed mutable package state")
	}
}

func TestGeneratedClientEncodesTypedParametersAndBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.EscapedPath() != "/api/v1/project/preview/team%2Fblue" {
			t.Errorf("request = %s %s", request.Method, request.URL.EscapedPath())
		}
		if request.URL.Query().Get("format") != "summary" {
			t.Errorf("format = %q", request.URL.Query().Get("format"))
		}
		if request.Header.Get("X-Client-Locale") != "zh-CN" {
			t.Errorf("locale = %q", request.Header.Get("X-Client-Locale"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"data":{"ok":true},"msg":"ok"}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	response, err := client.PreviewProject(context.Background(), PreviewProjectParams{
		Audience:      "team/blue",
		Format:        "summary",
		XClientLocale: "zh-CN",
	})
	if err != nil {
		t.Fatalf("PreviewProject() error = %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if _, err := response.DecodeEnvelope(); err != nil {
		t.Fatalf("DecodeEnvelope() error = %v", err)
	}
}

func TestGeneratedClientRejectsUnsafeServerAndOversizedResponse(t *testing.T) {
	for _, serverURL := range []string{"", "ftp://example.com", "https://user:secret@example.com", "https://example.com?q=secret"} {
		if _, err := NewClient(serverURL); err == nil {
			t.Fatalf("NewClient(%q) error = nil", serverURL)
		}
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(strings.Repeat("x", 9)))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, WithMaxResponseBytes(8))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.GetReadiness(context.Background()); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("GetReadiness() error = %v, want ErrResponseTooLarge", err)
	}
}
