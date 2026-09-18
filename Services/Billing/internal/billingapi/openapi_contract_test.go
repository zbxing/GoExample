package billingapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapp"
)

type billingOpenAPIOperation struct {
	OperationID string                     `json:"operationId"`
	Responses   map[string]json.RawMessage `json:"responses"`
}

func readBillingOpenAPI(t *testing.T) map[string]map[string]billingOpenAPIOperation {
	t.Helper()
	repositoryRoot := filepath.Join("..", "..", "..", "..")
	content, err := os.ReadFile(filepath.Join(repositoryRoot, "docs", "openapi", "billing.json"))
	if err != nil {
		t.Fatalf("read Billing OpenAPI document: %v", err)
	}
	var document struct {
		OpenAPI string                                        `json:"openapi"`
		Paths   map[string]map[string]billingOpenAPIOperation `json:"paths"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatalf("decode Billing OpenAPI document: %v", err)
	}
	if document.OpenAPI != "3.1.0" {
		t.Fatalf("openapi = %q, want 3.1.0", document.OpenAPI)
	}
	return document.Paths
}

func billingRoutePath(path string) string {
	segments := strings.Split(path, "/")
	for index, segment := range segments {
		if strings.HasPrefix(segment, ":") {
			segments[index] = "{" + strings.TrimPrefix(segment, ":") + "}"
		}
	}
	return strings.Join(segments, "/")
}

func isBillingDocumentedMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func TestOpenAPIMatchesRegisteredRoutes(t *testing.T) {
	documentedPaths := readBillingOpenAPI(t)
	documented := make([]string, 0)
	operationIDs := make(map[string]struct{})
	for routePath, pathItem := range documentedPaths {
		for method, operation := range pathItem {
			method = strings.ToUpper(method)
			if !isBillingDocumentedMethod(method) {
				continue
			}
			if operation.OperationID == "" {
				t.Fatalf("%s %s has no operationId", method, routePath)
			}
			if _, exists := operationIDs[operation.OperationID]; exists {
				t.Fatalf("operationId %q is duplicated", operation.OperationID)
			}
			operationIDs[operation.OperationID] = struct{}{}
			if len(operation.Responses) == 0 {
				t.Fatalf("%s %s has no responses", method, routePath)
			}
			documented = append(documented, method+" "+routePath)
		}
	}

	service := billingapp.NewService("Billing Contract Test", "test", "1.0.0", nil)
	app := httpapi.New(httpapi.Options{
		Name:               "Billing Contract Test",
		Environment:        "test",
		Version:            "1.0.0",
		Health:             health.New(100, 1),
		ApplicationQueries: Queries(service),
	})
	registered := make([]string, 0)
	for _, route := range app.GetRoutes(true) {
		if isBillingDocumentedMethod(route.Method) {
			registered = append(registered, route.Method+" "+billingRoutePath(route.Path))
		}
	}

	sort.Strings(documented)
	sort.Strings(registered)
	if !slicesEqual(documented, registered) {
		t.Fatalf("OpenAPI routes differ from Framework routes\ndocumented: %#v\nregistered: %#v", documented, registered)
	}
}

func slicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
