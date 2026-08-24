package projectapi

import (
	"context"

	"github.com/zbxing/goexample/Framework/authorization"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Proj/Example/internal/projectapp"
)

type projectResponse struct {
	Name        string `json:"name"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
}

type describeProjectRequest struct {
	TenantID string `json:"tenantId" validate:"omitempty,max=128"`
	Audience string `json:"audience" validate:"required,min=2,max=80"`
}

type projectDescriptionResponse struct {
	Name        string `json:"name"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
	Audience    string `json:"audience"`
	RequestedBy string `json:"requestedBy"`
	Summary     string `json:"summary"`
}

type previewProjectRequest struct {
	TenantID string `header:"X-Tenant-ID" json:"tenantId" validate:"omitempty,max=128"`
	Audience string `uri:"audience" json:"audience" validate:"required,min=2,max=80"`
	Format   string `query:"format" json:"format" validate:"required,oneof=summary detailed"`
	Locale   string `header:"X-Client-Locale" json:"locale" validate:"required,min=2,max=16"`
}

type projectPreviewResponse struct {
	Name        string `json:"name"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
	Audience    string `json:"audience"`
	Format      string `json:"format"`
	Locale      string `json:"locale"`
	RequestedBy string `json:"requestedBy"`
	Summary     string `json:"summary"`
}

func Endpoints(authEnabled bool) []string {
	return EndpointsForAuth(authEnabled, authEnabled)
}

func EndpointsForAuth(authEnabled, demoLoginEnabled bool) []string {
	endpoints := append([]string{}, httpapi.DefaultEndpointsForAuth(authEnabled, demoLoginEnabled)...)
	endpoints = append(endpoints, "GET /api/v1/project")
	if authEnabled {
		endpoints = append(endpoints, "GET /api/v1/project/preview/:audience", "POST /api/v1/project/describe")
	}
	return endpoints
}

func Queries(options httpapi.Options) []httpapi.ApplicationQuery {
	service := newProjectService(options)
	resourceAuthorizer := projectapp.NewResourceAuthorizer(options.Environment)
	queries := []httpapi.ApplicationQuery{
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
	if httpapi.AuthenticationEnabled(options) {
		queries = append(queries, httpapi.NewResourceAuthorizedQuery(
			"/project/preview/:audience",
			[]string{"demo"},
			resourceAuthorizer,
			func(request previewProjectRequest, principal httpapi.ApplicationPrincipal) authorization.Resource {
				return projectResource(requestedTenant(request.TenantID, principal.Subject), "preview", options.Environment)
			},
			func(ctx context.Context, request previewProjectRequest, principal httpapi.ApplicationPrincipal) (projectPreviewResponse, error) {
				preview, err := service.PreviewProject(ctx, projectapp.PreviewProjectQuery{
					Audience:    request.Audience,
					Format:      request.Format,
					Locale:      request.Locale,
					RequestedBy: principal.Subject,
				})
				if err != nil {
					return projectPreviewResponse{}, err
				}
				return projectPreviewResponse{
					Name:        preview.Project.Name,
					Environment: preview.Project.Environment,
					Version:     preview.Project.Version,
					Audience:    preview.Audience,
					Format:      preview.Format,
					Locale:      preview.Locale,
					RequestedBy: preview.RequestedBy,
					Summary:     preview.Summary,
				}, nil
			},
		))
	}
	return queries
}

func Commands(options httpapi.Options) []httpapi.ApplicationCommand {
	if !httpapi.AuthenticationEnabled(options) {
		return nil
	}
	service := newProjectService(options)
	resourceAuthorizer := projectapp.NewResourceAuthorizer(options.Environment)
	return []httpapi.ApplicationCommand{
		httpapi.NewResourceAuthorizedJSONCommand(
			"/project/describe",
			[]string{"demo"},
			resourceAuthorizer,
			func(request describeProjectRequest, principal httpapi.ApplicationPrincipal) authorization.Resource {
				return projectResource(requestedTenant(request.TenantID, principal.Subject), "describe", options.Environment)
			},
			func(ctx context.Context, request describeProjectRequest, principal httpapi.ApplicationPrincipal) (projectDescriptionResponse, error) {
				description, err := service.DescribeProject(ctx, projectapp.DescribeProjectCommand{
					Audience:    request.Audience,
					RequestedBy: principal.Subject,
				})
				if err != nil {
					return projectDescriptionResponse{}, err
				}
				return projectDescriptionResponse{
					Name:        description.Project.Name,
					Environment: description.Project.Environment,
					Version:     description.Project.Version,
					Audience:    description.Audience,
					RequestedBy: description.RequestedBy,
					Summary:     description.Summary,
				}, nil
			},
		),
	}
}

func projectResource(tenantID, action, environment string) authorization.Resource {
	return authorization.Resource{
		TenantID: tenantID,
		Type:     "project",
		ID:       "current",
		Action:   action,
		Attributes: map[string]string{
			"environment": environment,
		},
	}
}

func requestedTenant(requested, subject string) string {
	if requested == "" {
		return subject
	}
	return requested
}

func newProjectService(options httpapi.Options) *projectapp.Service {
	serviceOptions := []projectapp.Option{}
	if options.TracerProvider != nil {
		serviceOptions = append(serviceOptions, projectapp.WithTracerProvider(options.TracerProvider))
	}
	return projectapp.NewService(
		projectapp.Project{
			Name:        options.Name,
			Environment: options.Environment,
			Version:     options.Version,
		},
		serviceOptions...,
	)
}
