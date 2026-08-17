package projectapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/httpapi"
)

func TestOpenAPIMatchesRegisteredRoutes(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "openapi", "openapi.json"))
	if err != nil {
		t.Fatalf("read OpenAPI document: %v", err)
	}

	var document struct {
		OpenAPI string `json:"openapi"`
		Paths   map[string]map[string]struct {
			OperationID string                     `json:"operationId"`
			Responses   map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatalf("decode OpenAPI document: %v", err)
	}
	if !strings.HasPrefix(document.OpenAPI, "3.1.") {
		t.Fatalf("openapi = %q, want 3.1.x", document.OpenAPI)
	}

	documented := make([]string, 0)
	operationIDs := make(map[string]string)
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
			operationIDs[operation.OperationID] = method + " " + path
			documented = append(documented, method+" "+path)
		}
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
	options.RegisterRoutes = func(v1 fiber.Router) {
		Register(v1, options)
	}
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

func isDocumentedHTTPMethod(method string) bool {
	switch method {
	case fiber.MethodGet, fiber.MethodPost, fiber.MethodPut, fiber.MethodPatch, fiber.MethodDelete:
		return true
	default:
		return false
	}
}
