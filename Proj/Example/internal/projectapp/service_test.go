package projectapp

import (
	"context"
	"errors"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestGetProjectReturnsTypedResult(t *testing.T) {
	service := NewService(Project{Name: "Example", Environment: "test", Version: "v1"})

	project, err := service.GetProject(context.Background(), GetProjectQuery{})
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if project.Name != "Example" || project.Environment != "test" || project.Version != "v1" {
		t.Fatalf("project = %#v", project)
	}
}

func TestGetProjectCreatesApplicationSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	service := NewService(Project{Name: "Example"}, WithTracerProvider(provider))

	if _, err := service.GetProject(context.Background(), GetProjectQuery{}); err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "project.get" {
		t.Fatalf("application spans = %#v", spans)
	}
}

func TestGetProjectHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := NewService(Project{Name: "Example"}).GetProject(ctx, GetProjectQuery{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("GetProject() error = %v, want context.Canceled", err)
	}
}
