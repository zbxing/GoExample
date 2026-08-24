package observability

import (
	"context"
	"errors"
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
	if metricsResponse.Header.Get(fiber.HeaderPragma) != "no-cache" {
		t.Fatalf("metrics Pragma = %q", metricsResponse.Header.Get(fiber.HeaderPragma))
	}
}

func TestMetricsRecordsBoundedQueueWorkerLifecycle(t *testing.T) {
	metrics := NewMetrics()
	metrics.WorkerStarted()
	metrics.WorkerStarted()
	metrics.WorkerFailed()
	metrics.WorkerStopped()
	metrics.DeliveryAcknowledged()
	metrics.DeliveryRetried()
	metrics.DeliveryRetried()
	metrics.DeliveryDeadLettered()
	metrics.DeliverySettlementFailed()
	metrics.DeliveryLeaseExtended()
	metrics.DeliveryLeaseExtended()
	metrics.DeliveryLeaseExtensionFailed()
	output := metrics.Render()
	for _, want := range []string{
		"goexample_queue_workers_active 1",
		`goexample_queue_worker_events_total{event="started"} 2`,
		`goexample_queue_worker_events_total{event="stopped"} 1`,
		`goexample_queue_worker_events_total{event="failure"} 1`,
		`goexample_queue_delivery_events_total{event="acknowledged"} 1`,
		`goexample_queue_delivery_events_total{event="retried"} 2`,
		`goexample_queue_delivery_events_total{event="dead_lettered"} 1`,
		`goexample_queue_delivery_events_total{event="settlement_failed"} 1`,
		`goexample_queue_delivery_lease_events_total{event="extended"} 2`,
		`goexample_queue_delivery_lease_events_total{event="failure"} 1`,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("queue worker metric %q missing: %s", want, output)
		}
	}
	if strings.Contains(output, "destination") || strings.Contains(output, "backend") ||
		strings.Contains(output, "message_id") || strings.Contains(output, "attempt=") {
		t.Fatalf("queue worker metrics leaked unbounded metadata: %s", output)
	}
}

func TestMetricsRecordsBoundedHTTPConnectionLifecycle(t *testing.T) {
	metrics := NewMetrics()
	metrics.SetHTTPConnectionCapacity(64)
	metrics.ObserveHTTPConnectionState(http.StateNew)
	metrics.ObserveHTTPConnectionState(http.StateActive)
	metrics.ObserveHTTPConnectionState(http.StateIdle)
	metrics.ObserveHTTPConnectionState(http.StateClosed)
	metrics.ObserveHTTPConnectionState(http.StateClosed)
	metrics.ObserveHTTPConnectionState(http.ConnState(99))
	output := metrics.Render()
	for _, want := range []string{
		"goexample_http_server_connection_capacity 64",
		"goexample_http_server_connections 0",
		`goexample_http_server_connection_events_total{state="new"} 1`,
		`goexample_http_server_connection_events_total{state="active"} 1`,
		`goexample_http_server_connection_events_total{state="idle"} 1`,
		`goexample_http_server_connection_events_total{state="hijacked"} 0`,
		`goexample_http_server_connection_events_total{state="closed"} 2`,
		`goexample_http_server_connection_events_total{state="_OTHER"} 1`,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("HTTP connection metric %q missing: %s", want, output)
		}
	}
	if strings.Contains(output, "remote_addr") || strings.Contains(output, "connection_id") {
		t.Fatalf("HTTP connection metrics leaked dynamic metadata: %s", output)
	}

	metrics.SetHTTPConnectionCapacity(-1)
	if output := metrics.Render(); !strings.Contains(output, "goexample_http_server_connection_capacity 0") {
		t.Fatalf("invalid connection capacity was not collapsed: %s", output)
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
	metrics.RecordRequestIDReplaced()
	metrics.RecordRequestIDReplaced()
	metrics.RecordAdmissionRejected()
	metrics.RecordAdmissionRejected()
	metrics.RecordDrainingRejected()
	output := metrics.Render()
	if !strings.Contains(output, "goexample_http_request_id_replacements_total 2") {
		t.Fatalf("request ID replacement counter = %s", output)
	}
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

func TestMetricsRenderSecurityEventsWithFixedLabels(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordSecurityEvent("login", "success")
	metrics.RecordSecurityEvent("login", "failure")
	metrics.RecordSecurityEvent("login", "limited")
	metrics.RecordSecurityEvent("session", "failure")
	metrics.RecordSecurityEvent("authorization", "failure")
	metrics.RecordSecurityEvent("secret-event-must-not-be-a-label", "secret-outcome-must-not-be-a-label")
	output := metrics.Render()
	for _, expected := range []string{
		`goexample_security_events_total{event="login",outcome="success"} 1`,
		`goexample_security_events_total{event="login",outcome="failure"} 1`,
		`goexample_security_events_total{event="login",outcome="limited"} 1`,
		`goexample_security_events_total{event="session",outcome="failure"} 1`,
		`goexample_security_events_total{event="authorization",outcome="failure"} 1`,
		`goexample_security_events_total{event="_OTHER",outcome="_OTHER"} 1`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("security metric %q missing from output = %s", expected, output)
		}
	}
	if strings.Contains(output, "secret-event") || strings.Contains(output, "secret-outcome") {
		t.Fatalf("security metric leaked unbounded input: %s", output)
	}
}

func TestMetricsRenderSecurityAuditSinkOutcomesWithFixedLabels(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordSecurityAuditSinkWrite(true)
	metrics.RecordSecurityAuditSinkWrite(true)
	metrics.RecordSecurityAuditSinkWrite(false)
	output := metrics.Render()
	for _, expected := range []string{
		`goexample_security_audit_sink_writes_total{outcome="success"} 2`,
		`goexample_security_audit_sink_writes_total{outcome="failure"} 1`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("security audit sink metric %q missing from output = %s", expected, output)
		}
	}
}

func TestMetricsRenderTraceExporterOutcomesWithFixedLabels(t *testing.T) {
	metrics := NewMetrics()
	metrics.configureTraceExporter(true)
	metrics.recordTraceExport(3, nil)
	metrics.recordTraceExport(2, errors.New("collector credentials must not become a label"))
	metrics.recordTraceExportAttempt(true)
	metrics.recordTraceExportAttempt(false)
	metrics.configureTraceProcessorCapacity(8)
	metrics.recordTraceProcessorAcquire()
	metrics.recordTraceProcessorAcquire()
	metrics.recordTraceProcessorRelease(1)
	metrics.recordTraceQueueDrop(4)
	output := metrics.Render()
	for _, expected := range []string{
		"goexample_otel_trace_exporter_enabled 1",
		`goexample_otel_trace_export_batches_total{outcome="success"} 1`,
		`goexample_otel_trace_export_batches_total{outcome="failure"} 1`,
		`goexample_otel_trace_export_spans_total{outcome="success"} 3`,
		`goexample_otel_trace_export_spans_total{outcome="failure"} 2`,
		`goexample_otel_trace_export_attempts_total{outcome="success"} 1`,
		`goexample_otel_trace_export_attempts_total{outcome="failure"} 1`,
		"goexample_otel_trace_queue_dropped_spans_total 4",
		"goexample_otel_trace_processor_capacity_spans 8",
		"goexample_otel_trace_processor_pending_spans 1",
		"goexample_otel_trace_processor_high_watermark_spans 2",
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("trace export metric %q missing from output = %s", expected, output)
		}
	}
	if strings.Contains(output, "collector credentials") {
		t.Fatalf("trace exporter metric leaked error text: %s", output)
	}
}
