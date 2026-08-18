package projectapp

import (
	"context"
	"errors"
	"testing"
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

func TestGetProjectHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := NewService(Project{Name: "Example"}).GetProject(ctx, GetProjectQuery{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("GetProject() error = %v, want context.Canceled", err)
	}
}
