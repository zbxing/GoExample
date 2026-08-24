package authorization

import (
	"strings"
	"testing"
)

func TestValidateRequestAcceptsBoundedTenantResourceAndAttributes(t *testing.T) {
	request := validRequest()
	if err := ValidateRequest(request); err != nil {
		t.Fatalf("ValidateRequest() error = %v", err)
	}
}

func TestValidateRequestRejectsUnboundedOrMalformedInput(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Request)
	}{
		{name: "missing subject", mutate: func(request *Request) { request.Principal.Subject = "" }},
		{name: "control username", mutate: func(request *Request) { request.Principal.Username = "user\nname" }},
		{name: "missing roles", mutate: func(request *Request) { request.Principal.RoleIDs = nil }},
		{name: "malformed role", mutate: func(request *Request) { request.Principal.RoleIDs = []string{"tenant admin"} }},
		{name: "long tenant", mutate: func(request *Request) { request.Resource.TenantID = strings.Repeat("t", maxIdentifierLength+1) }},
		{name: "malformed type", mutate: func(request *Request) { request.Resource.Type = "project type" }},
		{name: "missing id", mutate: func(request *Request) { request.Resource.ID = "" }},
		{name: "malformed action", mutate: func(request *Request) { request.Resource.Action = "preview?all" }},
		{name: "too many attributes", mutate: func(request *Request) {
			request.Resource.Attributes = make(map[string]string, maxAttributeCount+1)
			for index := 0; index <= maxAttributeCount; index++ {
				request.Resource.Attributes[string(rune('a'+index))] = "value"
			}
		}},
		{name: "control attribute", mutate: func(request *Request) { request.Resource.Attributes["environment"] = "prod\x00secret" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validRequest()
			test.mutate(&request)
			if err := ValidateRequest(request); err == nil {
				t.Fatal("ValidateRequest() error = nil")
			}
		})
	}
}

func validRequest() Request {
	return Request{
		Principal: Principal{
			Subject:  "oidc|subject-1",
			Username: "operator@example.test",
			RoleIDs:  []string{"tenant:operator"},
		},
		Resource: Resource{
			TenantID: "oidc|subject-1",
			Type:     "project",
			ID:       "current",
			Action:   "preview",
			Attributes: map[string]string{
				"environment": "production-eu1",
			},
		},
	}
}
