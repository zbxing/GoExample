package projectapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/zbxing/goexample/Framework/httpapi"
)

func TestQueriesAddProjectRoute(t *testing.T) {
	options := httpapi.Options{
		Name:        "Example Test API",
		Environment: "test",
		Version:     "test-version",
	}
	options.ApplicationQueries = Queries(options)
	app := httpapi.New(options)

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
			Name        string `json:"name"`
			Environment string `json:"environment"`
			Version     string `json:"version"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode project response: %v", err)
	}
	if envelope.Code != 0 || envelope.Data.Name != options.Name || envelope.Data.Environment != options.Environment || envelope.Data.Version != options.Version {
		t.Fatalf("project response = %#v", envelope)
	}
}

func TestProjectRouteCreatesChildApplicationSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	options := httpapi.Options{
		Name:           "Example Test API",
		Environment:    "test",
		Version:        "test-version",
		TracerProvider: provider,
	}
	options.ApplicationQueries = Queries(options)
	app := httpapi.New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project", http.NoBody))
	if err != nil {
		t.Fatalf("project request error = %v", err)
	}
	response.Body.Close()

	var serverSpan, applicationSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "GET /api/v1/project":
			serverSpan = span
		case "project.get":
			applicationSpan = span
		}
	}
	if serverSpan == nil || applicationSpan == nil {
		t.Fatalf("route spans = %#v", recorder.Ended())
	}
	if applicationSpan.SpanContext().TraceID() != serverSpan.SpanContext().TraceID() || applicationSpan.Parent().SpanID() != serverSpan.SpanContext().SpanID() {
		t.Fatalf("application parent/trace = %s/%s, server = %s/%s", applicationSpan.Parent().SpanID(), applicationSpan.SpanContext().TraceID(), serverSpan.SpanContext().SpanID(), serverSpan.SpanContext().TraceID())
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
