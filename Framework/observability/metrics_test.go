package observability

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestMetricsRecordsNormalizedRoute(t *testing.T) {
	metrics := NewMetrics()
	app := fiber.New()
	app.Use(metrics.Middleware)
	app.Get("/items/:id", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })
	app.Get("/metrics", metrics.Handler)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/items/42", http.NoBody))
	if err != nil {
		t.Fatalf("item request error = %v", err)
	}
	response.Body.Close()

	metricsResponse, err := app.Test(httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody))
	if err != nil {
		t.Fatalf("metrics request error = %v", err)
	}
	defer metricsResponse.Body.Close()
	content, err := io.ReadAll(metricsResponse.Body)
	if err != nil {
		t.Fatalf("read metrics: %v", err)
	}
	output := string(content)
	if !strings.Contains(output, `route="/items/:id"`) || !strings.Contains(output, "goexample_http_requests_total") {
		t.Fatalf("metrics output = %s", output)
	}
	if !strings.Contains(output, "# TYPE goexample_http_request_duration_seconds histogram") {
		t.Fatalf("histogram declaration missing from metrics output = %s", output)
	}
	if !strings.Contains(output, `goexample_http_request_duration_seconds_bucket{method="GET",route="/items/:id",status="204",le="+Inf"} 1`) {
		t.Fatalf("histogram +Inf bucket missing from metrics output = %s", output)
	}
	for _, metric := range []string{
		"goexample_go_goroutines",
		"goexample_go_gomaxprocs",
		"goexample_go_memory_heap_alloc_bytes",
		"goexample_go_memory_heap_inuse_bytes",
		"goexample_go_memory_heap_objects",
		"goexample_go_gc_cycles_total",
		"goexample_go_gc_pause_seconds_total",
	} {
		if !strings.Contains(output, metric) {
			t.Fatalf("runtime metric %q missing from metrics output", metric)
		}
	}
	if metricsResponse.Header.Get(fiber.HeaderCacheControl) != "no-store" {
		t.Fatalf("metrics Cache-Control = %q", metricsResponse.Header.Get(fiber.HeaderCacheControl))
	}
}

func TestMetricsMapsDeadlineToRequestTimeout(t *testing.T) {
	metrics := NewMetrics()
	app := fiber.New()
	app.Use(metrics.Middleware)
	app.Get("/slow", func(fiber.Ctx) error { return context.DeadlineExceeded })

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/slow", http.NoBody))
	if err != nil {
		t.Fatalf("slow request error = %v", err)
	}
	response.Body.Close()
	if output := metrics.Render(); !strings.Contains(output, `route="/slow",status="408"`) {
		t.Fatalf("deadline metric status = %s", output)
	}
}

func TestMetricsRenderAdmissionRejections(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordAdmissionRejected()
	metrics.RecordAdmissionRejected()
	metrics.RecordDrainingRejected()
	output := metrics.Render()
	if !strings.Contains(output, "# TYPE goexample_http_admission_rejections_total counter") {
		t.Fatal("admission rejection metric type is missing")
	}
	if !strings.Contains(output, "goexample_http_admission_rejections_total 2") {
		t.Fatalf("admission rejection metric = %s", output)
	}
	if !strings.Contains(output, "# TYPE goexample_http_draining_rejections_total counter") ||
		!strings.Contains(output, "goexample_http_draining_rejections_total 1") {
		t.Fatalf("draining rejection metric = %s", output)
	}
}
