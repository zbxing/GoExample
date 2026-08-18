package projectapi

import (
	"github.com/gofiber/fiber/v3"

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

func Register(v1 fiber.Router, options httpapi.Options) {
	httpapi.RegisterDefaultRoutes(v1, options)
	service := projectapp.NewService(projectapp.Project{
		Name:        options.Name,
		Environment: options.Environment,
		Version:     options.Version,
	})
	v1.Get("/project", func(c fiber.Ctx) error {
		project, err := service.GetProject(c.Context(), projectapp.GetProjectQuery{})
		if err != nil {
			return err
		}
		return httpapi.Success(c, projectResponse{
			Name:        project.Name,
			Environment: project.Environment,
			Version:     project.Version,
		})
	})
}
