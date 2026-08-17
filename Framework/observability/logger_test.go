package observability

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestRequestLoggerSkipsConfiguredPaths(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("json", "info", &output)
	app := fiber.New()
	app.Use(RequestLogger(logger, "/livez"))
	app.Get("/livez", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/livez", http.NoBody))
	if err != nil {
		t.Fatalf("livez request error = %v", err)
	}
	response.Body.Close()
	if output.Len() != 0 {
		t.Fatalf("skipped request log = %s", output.String())
	}

	response, err = app.Test(httptest.NewRequest(http.MethodGet, "/work", http.NoBody))
	if err != nil {
		t.Fatalf("work request error = %v", err)
	}
	response.Body.Close()
	if !strings.Contains(output.String(), `"path":"/work"`) {
		t.Fatalf("request log = %s", output.String())
	}
}
