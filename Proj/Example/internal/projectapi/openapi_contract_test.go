package projectapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/httpapi"
)

type contractOpenAPIResponse struct {
	Headers map[string]json.RawMessage `json:"headers"`
}

func TestOpenAPIMatchesRegisteredRoutes(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "openapi", "openapi.json"))
	if err != nil {
		t.Fatalf("read OpenAPI document: %v", err)
	}

	type operation struct {
		OperationID  string `json:"operationId"`
		Deprecated   bool   `json:"deprecated"`
		ExternalDocs struct {
			URL string `json:"url"`
		} `json:"externalDocs"`
		Responses map[string]json.RawMessage `json:"responses"`
		Security  []map[string][]string      `json:"security"`
	}
	var document struct {
		OpenAPI    string                          `json:"openapi"`
		Paths      map[string]map[string]operation `json:"paths"`
		Components struct {
			Responses map[string]contractOpenAPIResponse `json:"responses"`
		} `json:"components"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatalf("decode OpenAPI document: %v", err)
	}
	if !strings.HasPrefix(document.OpenAPI, "3.1.") {
		t.Fatalf("openapi = %q, want 3.1.x", document.OpenAPI)
	}

	documented := make([]string, 0)
	operationIDs := make(map[string]string)
	deprecatedHealthRoutes := map[string]string{
		"/api/health":         "/livez",
		"/api/health/ready":   "/readyz",
		"/api/health/startup": "/startupz",
	}
	deprecatedCount := 0
	for path, pathItem := range document.Paths {
		for method, operation := range pathItem {
			method = strings.ToUpper(method)
			if !isDocumentedHTTPMethod(method) {
				continue
			}
			if strings.TrimSpace(operation.OperationID) == "" {
				t.Fatalf("%s %s has no operationId", method, path)
			}
			if previous, exists := operationIDs[operation.OperationID]; exists {
				t.Fatalf("operationId %q is shared by %s and %s %s", operation.OperationID, previous, method, path)
			}
			if len(operation.Responses) == 0 {
				t.Fatalf("%s %s has no responses", method, path)
			}
			if _, expectedDeprecated := deprecatedHealthRoutes[path]; operation.Deprecated != expectedDeprecated {
				t.Fatalf("%s %s deprecated = %t, want %t", method, path, operation.Deprecated, expectedDeprecated)
			}
			if operation.Deprecated {
				deprecatedCount++
				if operation.ExternalDocs.URL != "./health-endpoint-migration.md" {
					t.Fatalf("%s %s externalDocs = %q", method, path, operation.ExternalDocs.URL)
				}
				assertDeprecatedResponses(t, document.Components.Responses, method, path, operation.Responses)
			}
			if len(operation.Security) > 0 {
				var unauthorized struct {
					Ref string `json:"$ref"`
				}
				if err := json.Unmarshal(operation.Responses["401"], &unauthorized); err != nil {
					t.Fatalf("decode %s %s 401 response: %v", method, path, err)
				}
				if unauthorized.Ref != "#/components/responses/BearerUnauthorized" {
					t.Fatalf("%s %s 401 response = %q", method, path, unauthorized.Ref)
				}
			}
			operationIDs[operation.OperationID] = method + " " + path
			documented = append(documented, method+" "+path)
		}
	}
	if deprecatedCount != len(deprecatedHealthRoutes) {
		t.Fatalf("deprecated operation count = %d, want %d", deprecatedCount, len(deprecatedHealthRoutes))
	}
	challenge, exists := document.Components.Responses["BearerUnauthorized"]
	if !exists {
		t.Fatal("BearerUnauthorized response component is missing")
	}
	if _, exists := challenge.Headers["WWW-Authenticate"]; !exists {
		t.Fatal("BearerUnauthorized response does not document WWW-Authenticate")
	}

	options := httpapi.Options{
		Name:        "OpenAPI Contract Test",
		Environment: "test",
		Version:     "test",
		Auth: auth.NewService(auth.Config{
			Enabled:  true,
			Username: "contract-user",
			Password: "contract-password",
			Secret:   strings.Repeat("s", 32),
			Issuer:   "contract-test",
		}),
	}
	options.ApplicationQueries = Queries(options)
	app := httpapi.New(options)
	registered := make([]string, 0)
	for _, route := range app.GetRoutes(true) {
		if !isDocumentedHTTPMethod(route.Method) {
			continue
		}
		registered = append(registered, route.Method+" "+route.Path)
	}

	slices.Sort(documented)
	slices.Sort(registered)
	if !slices.Equal(documented, registered) {
		t.Fatalf("OpenAPI routes differ from Fiber routes\ndocumented: %#v\nregistered: %#v", documented, registered)
	}
}

func assertDeprecatedResponses(
	t *testing.T,
	components map[string]contractOpenAPIResponse,
	method string,
	path string,
	responses map[string]json.RawMessage,
) {
	t.Helper()
	for status, rawResponse := range responses {
		var reference struct {
			Ref string `json:"$ref"`
		}
		if err := json.Unmarshal(rawResponse, &reference); err != nil {
			t.Fatalf("decode %s %s response %s: %v", method, path, status, err)
		}
		const prefix = "#/components/responses/"
		if !strings.HasPrefix(reference.Ref, prefix) {
			t.Fatalf("%s %s response %s must reference a component", method, path, status)
		}
		componentName := strings.TrimPrefix(reference.Ref, prefix)
		component, exists := components[componentName]
		if !exists {
			t.Fatalf("%s %s response %s component %q is missing", method, path, status, componentName)
		}
		for _, header := range []string{"Deprecation", "Sunset", "Link"} {
			if _, exists := component.Headers[header]; !exists {
				t.Fatalf("%s %s response %s does not document %s", method, path, status, header)
			}
		}
	}
}

func isDocumentedHTTPMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}
