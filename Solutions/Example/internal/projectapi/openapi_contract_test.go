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

type projectContractManifest struct {
	Version  int `json:"version"`
	Projects []struct {
		ProjectPath string `json:"projectPath"`
		Contract    struct {
			Repository     string `json:"repository"`
			Ref            string `json:"ref"`
			ResolvedCommit string `json:"resolvedCommit"`
			Document       string `json:"document"`
		} `json:"contract"`
	} `json:"projects"`
}

func readExampleOpenAPI(t *testing.T) []byte {
	t.Helper()
	repositoryRoot := filepath.Join("..", "..", "..", "..")
	manifestContent, err := os.ReadFile(filepath.Join(repositoryRoot, "contracts", "projects.json"))
	if err != nil {
		t.Fatalf("read project contract manifest: %v", err)
	}
	var manifest projectContractManifest
	if err := json.Unmarshal(manifestContent, &manifest); err != nil {
		t.Fatalf("decode project contract manifest: %v", err)
	}
	if manifest.Version != 1 {
		t.Fatalf("project contract manifest version = %d, want 1", manifest.Version)
	}
	for _, project := range manifest.Projects {
		if project.ProjectPath != "Solutions/Example" {
			continue
		}
		documentPath := filepath.FromSlash(project.Contract.Document)
		cleanDocumentPath := filepath.Clean(documentPath)
		if filepath.IsAbs(documentPath) || cleanDocumentPath == ".." || strings.HasPrefix(cleanDocumentPath, ".."+string(filepath.Separator)) {
			t.Fatalf("Example contract document is unsafe: %q", project.Contract.Document)
		}
		contractPath := filepath.Join(repositoryRoot, documentPath)
		if project.Contract.Repository != "workspace" {
			if !strings.HasPrefix(project.Contract.Ref, "refs/heads/") && !strings.HasPrefix(project.Contract.Ref, "refs/tags/") {
				t.Fatalf("Example external contract ref is not pinned to a branch or tag: %q", project.Contract.Ref)
			}
			if len(project.Contract.ResolvedCommit) != 40 || strings.Trim(project.Contract.ResolvedCommit, "0123456789abcdef") != "" {
				t.Fatalf("Example external contract resolvedCommit is not a lower-case SHA-1: %q", project.Contract.ResolvedCommit)
			}
			contractPath = filepath.Join(repositoryRoot, ".temp", "contracts", "Example", project.Contract.ResolvedCommit, documentPath)
		}
		content, err := os.ReadFile(contractPath)
		if err != nil {
			t.Fatalf("read materialized Example OpenAPI document %q: %v", contractPath, err)
		}
		return content
	}
		t.Fatal("Solutions/Example is missing from project contract manifest")
	return nil
}

func TestOpenAPIMatchesRegisteredRoutes(t *testing.T) {
	content := readExampleOpenAPI(t)

	type operation struct {
		OperationID           string   `json:"operationId"`
		Deprecated            bool     `json:"deprecated"`
		RequiredRoles         []string `json:"x-required-roles"`
		ResourceAuthorization struct {
			TenantSource string `json:"tenantSource"`
			ResourceType string `json:"resourceType"`
			ResourceID   string `json:"resourceId"`
			Action       string `json:"action"`
		} `json:"x-resource-authorization"`
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
	expectedRoleRequirements := map[string][]string{
		"GET /api/v1/project/preview/{audience}": {"demo"},
		"POST /api/v1/project/describe":          {"demo"},
	}
	expectedResourceAuthorization := map[string][4]string{
		"GET /api/v1/project/preview/{audience}": {"header:X-Tenant-ID or principal:subject", "project", "current", "preview"},
		"POST /api/v1/project/describe":          {"body:tenantId or principal:subject", "project", "current", "describe"},
	}
	seenRoleRequirements := make(map[string]bool, len(expectedRoleRequirements))
	deprecatedCount := 0
	roleProtectedCount := 0
	resourceProtectedCount := 0
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
			if len(operation.RequiredRoles) > 0 {
				roleProtectedCount++
				operationKey := method + " " + path
				if len(operation.Security) == 0 {
					t.Fatalf("%s %s declares roles without authentication", method, path)
				}
				var forbidden struct {
					Ref string `json:"$ref"`
				}
				if err := json.Unmarshal(operation.Responses["403"], &forbidden); err != nil {
					t.Fatalf("decode %s %s 403 response: %v", method, path, err)
				}
				if forbidden.Ref != "#/components/responses/Forbidden" {
					t.Fatalf("%s %s 403 response = %q", method, path, forbidden.Ref)
				}
				expectedRoles, expected := expectedRoleRequirements[operationKey]
				if !expected || !slices.Equal(operation.RequiredRoles, expectedRoles) {
					t.Fatalf("%s required roles = %#v", operationKey, operation.RequiredRoles)
				}
				seenRoleRequirements[operationKey] = true
			}
			resourceAuthorization := operation.ResourceAuthorization
			if resourceAuthorization.TenantSource != "" {
				resourceProtectedCount++
				operationKey := method + " " + path
				expected, ok := expectedResourceAuthorization[operationKey]
				actual := [4]string{resourceAuthorization.TenantSource, resourceAuthorization.ResourceType, resourceAuthorization.ResourceID, resourceAuthorization.Action}
				if !ok || actual != expected || len(operation.Security) == 0 || len(operation.RequiredRoles) == 0 {
					t.Fatalf("%s resource authorization = %#v", operationKey, actual)
				}
			}
			operationIDs[operation.OperationID] = method + " " + path
			documented = append(documented, method+" "+path)
		}
	}
	if deprecatedCount != len(deprecatedHealthRoutes) {
		t.Fatalf("deprecated operation count = %d, want %d", deprecatedCount, len(deprecatedHealthRoutes))
	}
	if roleProtectedCount != len(expectedRoleRequirements) {
		t.Fatalf("role-protected operation count = %d, want %d", roleProtectedCount, len(expectedRoleRequirements))
	}
	if resourceProtectedCount != len(expectedResourceAuthorization) {
		t.Fatalf("resource-protected operation count = %d, want %d", resourceProtectedCount, len(expectedResourceAuthorization))
	}
	for operationKey := range expectedRoleRequirements {
		if !seenRoleRequirements[operationKey] {
			t.Fatalf("role requirement missing for %s", operationKey)
		}
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
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)
	registered := make([]string, 0)
	for _, route := range app.GetRoutes(true) {
		if !isDocumentedHTTPMethod(route.Method) {
			continue
		}
		registered = append(registered, route.Method+" "+openAPIPath(route.Path))
	}

	slices.Sort(documented)
	slices.Sort(registered)
	conditionalOIDCBrowserRoutes := map[string]struct{}{
		"GET /api/v1/auth/oidc/start":                   {},
		"GET /api/v1/auth/oidc/callback":                {},
		"POST /api/v1/auth/oidc/logout":                 {},
		"GET /api/v1/auth/oidc/sessions":                {},
		"PATCH /api/v1/auth/oidc/sessions/{sessionId}":  {},
		"DELETE /api/v1/auth/oidc/sessions":             {},
		"DELETE /api/v1/auth/oidc/sessions/{sessionId}": {},
	}
	documentedForDemoMode := slices.DeleteFunc(slices.Clone(documented), func(route string) bool {
		_, conditional := conditionalOIDCBrowserRoutes[route]
		return conditional
	})
	if !slices.Equal(documentedForDemoMode, registered) {
		t.Fatalf("OpenAPI routes differ from Fiber routes\ndocumented: %#v\nregistered: %#v", documented, registered)
	}
}

func openAPIPath(fiberPath string) string {
	segments := strings.Split(fiberPath, "/")
	for index, segment := range segments {
		if strings.HasPrefix(segment, ":") {
			segments[index] = "{" + strings.TrimPrefix(segment, ":") + "}"
		}
	}
	return strings.Join(segments, "/")
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
