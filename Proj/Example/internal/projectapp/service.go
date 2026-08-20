package projectapp

import (
	"context"

	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

const tracerInstrumentationName = "github.com/zbxing/goexample/Proj/Example/internal/projectapp"

// Project is the transport-neutral representation of the Example project.
type Project struct {
	Name        string
	Environment string
	Version     string
}

// GetProjectQuery is intentionally explicit so the application contract can
// grow without accepting a transport-specific request object.
type GetProjectQuery struct{}

// Service owns project use cases and does not depend on an HTTP framework.
type Service struct {
	project Project
	tracer  trace.Tracer
}

type Option func(*Service)

func WithTracerProvider(provider trace.TracerProvider) Option {
	return func(service *Service) {
		if provider != nil {
			service.tracer = provider.Tracer(tracerInstrumentationName)
		}
	}
}

func NewService(project Project, options ...Option) *Service {
	service := &Service{
		project: project,
		tracer:  noop.NewTracerProvider().Tracer(tracerInstrumentationName),
	}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	return service
}

func (s *Service) GetProject(ctx context.Context, _ GetProjectQuery) (Project, error) {
	ctx, span := s.tracer.Start(ctx, "project.get")
	defer span.End()
	if err := ctx.Err(); err != nil {
		span.SetStatus(codes.Error, "context canceled")
		return Project{}, err
	}
	return s.project, nil
}
