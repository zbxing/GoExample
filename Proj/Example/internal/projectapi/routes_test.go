package projectapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/httpapi"
)

func TestRegisterAddsProjectRoute(t *testing.T) {
	app := fiber.New()
	options := httpapi.Options{
		Name:        "Example Test API",
		Environment: "test",
		Version:     "test-version",
	}
	Register(app.Group("/api/v1"), options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project", http.NoBody))
	if err != nil {
		t.Fatalf("project request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("project status = %d", response.StatusCode)
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode project response: %v", err)
	}
	if envelope.Code != 0 || envelope.Data.Name != options.Name {
		t.Fatalf("project response = %#v", envelope)
	}
}

func TestEndpointsReturnsIndependentSlice(t *testing.T) {
	first := Endpoints(false)
	first[0] = "changed"
	second := Endpoints(false)
	if second[0] == "changed" || second[len(second)-1] != "GET /api/v1/project" {
		t.Fatalf("endpoints = %#v", second)
	}
}
