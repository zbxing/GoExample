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

func TestDescribeProjectReturnsTypedResultAndSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	service := NewService(
		Project{Name: "Example", Environment: "test", Version: "v1"},
		WithTracerProvider(provider),
	)

	description, err := service.DescribeProject(context.Background(), DescribeProjectCommand{Audience: "operators", RequestedBy: "user-1"})
	if err != nil {
		t.Fatalf("DescribeProject() error = %v", err)
	}
	if description.Project.Name != "Example" || description.Audience != "operators" || description.RequestedBy != "user-1" || description.Summary != "Example is available for operators" {
		t.Fatalf("description = %#v", description)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "project.describe" {
		t.Fatalf("application spans = %#v", spans)
	}
}

func TestDescribeProjectHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := NewService(Project{Name: "Example"}).DescribeProject(ctx, DescribeProjectCommand{Audience: "operators"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("DescribeProject() error = %v, want context.Canceled", err)
	}
}

func TestPreviewProjectReturnsTypedResultAndSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	service := NewService(
		Project{Name: "Example", Environment: "test", Version: "v1"},
		WithTracerProvider(provider),
	)

	preview, err := service.PreviewProject(context.Background(), PreviewProjectQuery{
		Audience:    "operators",
		Format:      "summary",
		Locale:      "zh-CN",
		RequestedBy: "user-1",
	})
	if err != nil {
		t.Fatalf("PreviewProject() error = %v", err)
	}
	if preview.Project.Name != "Example" || preview.Audience != "operators" || preview.Format != "summary" || preview.Locale != "zh-CN" || preview.RequestedBy != "user-1" || preview.Summary != "Example is available for operators" {
		t.Fatalf("preview = %#v", preview)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "project.preview" {
		t.Fatalf("application spans = %#v", spans)
	}
}

func TestPreviewProjectHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := NewService(Project{Name: "Example"}).PreviewProject(ctx, PreviewProjectQuery{Audience: "operators"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("PreviewProject() error = %v, want context.Canceled", err)
	}
}
