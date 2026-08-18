package projectapp

import "context"

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
}

func NewService(project Project) *Service {
	return &Service{project: project}
}

func (s *Service) GetProject(ctx context.Context, _ GetProjectQuery) (Project, error) {
	if err := ctx.Err(); err != nil {
		return Project{}, err
	}
	return s.project, nil
}
