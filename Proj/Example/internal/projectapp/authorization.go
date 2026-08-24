package projectapp

import (
	"context"
	"strings"

	"github.com/zbxing/goexample/Framework/authorization"
)

const (
	projectResourceType = "project"
	projectResourceID   = "current"
)

// ResourceAuthorizer applies the Example ownership policy without depending
// on HTTP. A caller may access only its own tenant and only the configured
// project environment.
type ResourceAuthorizer struct {
	environment string
}

func NewResourceAuthorizer(environment string) ResourceAuthorizer {
	return ResourceAuthorizer{environment: strings.TrimSpace(environment)}
}

func (authorizer ResourceAuthorizer) Authorize(ctx context.Context, request authorization.Request) (authorization.Decision, error) {
	if err := ctx.Err(); err != nil {
		return authorization.DecisionDeny, err
	}
	resource := request.Resource
	if resource.TenantID != request.Principal.Subject || resource.Type != projectResourceType ||
		resource.ID != projectResourceID || resource.Attributes["environment"] != authorizer.environment ||
		len(resource.Attributes) != 1 {
		return authorization.DecisionDeny, nil
	}
	switch resource.Action {
	case "preview", "describe":
		return authorization.DecisionAllow, nil
	default:
		return authorization.DecisionDeny, nil
	}
}
