package projectapi

import (
	"context"

	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Proj/Example/internal/projectapp"
)

type projectResponse struct {
	Name        string `json:"name"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
}

func Endpoints(authEnabled bool) []string {
	endpoints := append([]string{}, httpapi.DefaultEndpoints(authEnabled)...)
	return append(endpoints, "GET /api/v1/project")
}

func Queries(options httpapi.Options) []httpapi.ApplicationQuery {
	serviceOptions := []projectapp.Option{}
	if options.TracerProvider != nil {
		serviceOptions = append(serviceOptions, projectapp.WithTracerProvider(options.TracerProvider))
	}
	service := projectapp.NewService(
		projectapp.Project{
			Name:        options.Name,
			Environment: options.Environment,
			Version:     options.Version,
		},
		serviceOptions...,
	)
	return []httpapi.ApplicationQuery{
		{
			Path: "/project",
			Handler: func(ctx context.Context) (any, error) {
				project, err := service.GetProject(ctx, projectapp.GetProjectQuery{})
				if err != nil {
					return nil, err
				}
				return projectResponse{
					Name:        project.Name,
					Environment: project.Environment,
					Version:     project.Version,
				}, nil
			},
		},
	}
}
