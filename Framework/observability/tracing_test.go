package observability

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestParseTraceparentStrictlyValidatesVersionIDsAndFlags(t *testing.T) {
	valid := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	traceID, parentSpanID, flags, ok := ParseTraceparent(valid)
	if !ok || traceID != "4bf92f3577b34da6a3ce929d0e0e4736" || parentSpanID != "00f067aa0ba902b7" || flags != 1 {
		t.Fatalf("parse valid traceparent = %q/%q/%d/%v", traceID, parentSpanID, flags, ok)
	}
	for _, invalid := range []string{
		"",
		"00-00000000000000000000000000000000-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0g",
		"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra",
	} {
		if _, _, _, ok := ParseTraceparent(invalid); ok {
			t.Fatalf("invalid traceparent accepted: %q", invalid)
		}
	}
}

func TestTraceMiddlewareCreatesServerSpanAndPropagatesContext(t *testing.T) {
	app := fiber.New()
	app.Use(TraceMiddleware)
	app.Get("/work", func(c fiber.Ctx) error {
		trace, ok := FromContext(c.Context())
		if !ok || trace.ParentSpanID != "00f067aa0ba902b7" || trace.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
			t.Fatalf("request trace = %#v/%v", trace, ok)
		}
		return c.JSON(trace)
	})

	request := httptest.NewRequest(http.MethodGet, "/work", http.NoBody)
	request.Header.Set(TraceparentHeader, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("trace request error = %v", err)
	}
	defer response.Body.Close()
	if response.Header.Get(TraceparentHeader) == request.Header.Get(TraceparentHeader) {
		t.Fatalf("server must create a new span: %q", response.Header.Get(TraceparentHeader))
	}
	traceID, parentSpanID, flags, ok := ParseTraceparent(response.Header.Get(TraceparentHeader))
	if !ok || traceID != "4bf92f3577b34da6a3ce929d0e0e4736" || parentSpanID == "00f067aa0ba902b7" || flags != 1 {
		t.Fatalf("response traceparent = %q parsed as %q/%q/%d/%v", response.Header.Get(TraceparentHeader), traceID, parentSpanID, flags, ok)
	}
}

func TestTraceMiddlewareRegeneratesInvalidParentAndRequestLoggerCorrelates(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("json", "info", &output)
	app := fiber.New()
	app.Use(TraceMiddleware)
	app.Use(RequestLogger(logger))
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/work", http.NoBody)
	request.Header.Set(TraceparentHeader, "not-a-traceparent")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("trace request error = %v", err)
	}
	response.Body.Close()
	if response.Header.Get(TraceparentHeader) == "" {
		t.Fatal("generated traceparent response header is empty")
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode request log: %v; output=%s", err, output.String())
	}
	for _, field := range []string{"trace_id", "span_id", "route"} {
		if value, ok := record[field].(string); !ok || strings.TrimSpace(value) == "" {
			t.Fatalf("log field %q = %#v; output=%s", field, record[field], output.String())
		}
	}
}
