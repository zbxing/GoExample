package projectapp

import (
	"context"
	"testing"

	"github.com/zbxing/goexample/Framework/authorization"
)

func TestResourceAuthorizerEnforcesTenantActionAndEnvironment(t *testing.T) {
	authorizer := NewResourceAuthorizer("production")
	request := authorization.Request{
		Principal: authorization.Principal{Subject: "tenant-1", Username: "operator", RoleIDs: []string{"demo"}},
		Resource: authorization.Resource{
			TenantID: "tenant-1",
			Type:     projectResourceType,
			ID:       projectResourceID,
			Action:   "preview",
			Attributes: map[string]string{
				"environment": "production",
			},
		},
	}
	decision, err := authorizer.Authorize(context.Background(), request)
	if err != nil || decision != authorization.DecisionAllow {
		t.Fatalf("Authorize() = %v, %v", decision, err)
	}

	tests := []struct {
		name   string
		mutate func(*authorization.Request)
	}{
		{name: "cross tenant", mutate: func(request *authorization.Request) { request.Resource.TenantID = "tenant-2" }},
		{name: "wrong type", mutate: func(request *authorization.Request) { request.Resource.Type = "deployment" }},
		{name: "wrong resource", mutate: func(request *authorization.Request) { request.Resource.ID = "other" }},
		{name: "wrong action", mutate: func(request *authorization.Request) { request.Resource.Action = "delete" }},
		{name: "wrong environment", mutate: func(request *authorization.Request) { request.Resource.Attributes["environment"] = "development" }},
		{name: "unexpected attribute", mutate: func(request *authorization.Request) { request.Resource.Attributes["private"] = "value" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := request
			candidate.Resource.Attributes = map[string]string{"environment": request.Resource.Attributes["environment"]}
			test.mutate(&candidate)
			decision, err := authorizer.Authorize(context.Background(), candidate)
			if err != nil || decision != authorization.DecisionDeny {
				t.Fatalf("Authorize() = %v, %v", decision, err)
			}
		})
	}
}

func TestResourceAuthorizerHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	decision, err := NewResourceAuthorizer("test").Authorize(ctx, authorization.Request{})
	if err == nil || decision != authorization.DecisionDeny {
		t.Fatalf("Authorize() = %v, %v", decision, err)
	}
}
