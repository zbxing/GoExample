package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/authorization"
)

type resourceQueryRequest struct {
	TenantID string `header:"X-Tenant-ID" validate:"required"`
	ID       string `uri:"id" validate:"required"`
}

type resourceCommandRequest struct {
	TenantID string `json:"tenantId" validate:"required"`
	Value    string `json:"value" validate:"required"`
}

func TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler(t *testing.T) {
	tests := []struct {
		name       string
		tenantID   string
		authorize  authorization.AuthorizerFunc
		wantStatus int
	}{
		{
			name:     "allow",
			tenantID: "fiber-demo-user",
			authorize: func(_ context.Context, request authorization.Request) (authorization.Decision, error) {
				if request.Principal.Subject != "fiber-demo-user" || request.Resource.TenantID != request.Principal.Subject ||
					request.Resource.Type != "project" || request.Resource.ID != "42" || request.Resource.Action != "read" ||
					request.Resource.Attributes["classification"] != "internal" {
					t.Fatalf("authorization request = %#v", request)
				}
				return authorization.DecisionAllow, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:     "cross tenant deny",
			tenantID: "other-tenant",
			authorize: func(_ context.Context, request authorization.Request) (authorization.Decision, error) {
				if request.Resource.TenantID == request.Principal.Subject {
					t.Fatal("cross-tenant request unexpectedly matched")
				}
				return authorization.DecisionDeny, nil
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "backend error",
			tenantID: "fiber-demo-user",
			authorize: func(context.Context, authorization.Request) (authorization.Decision, error) {
				return authorization.DecisionDeny, errors.New("private-policy-backend.example:9443 secret")
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "invalid decision",
			tenantID: "fiber-demo-user",
			authorize: func(context.Context, authorization.Request) (authorization.Decision, error) {
				return authorization.Decision(99), nil
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "panic",
			tenantID: "fiber-demo-user",
			authorize: func(context.Context, authorization.Request) (authorization.Decision, error) {
				panic("private-policy-panic secret")
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "timeout",
			tenantID: "fiber-demo-user",
			authorize: func(ctx context.Context, _ authorization.Request) (authorization.Decision, error) {
				<-ctx.Done()
				return authorization.DecisionDeny, ctx.Err()
			},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			options := testOptions()
			var logs bytes.Buffer
			options.Logger = slog.New(slog.NewJSONHandler(&logs, nil))
			options.ResourceAuthorizationTimeout = 10 * time.Millisecond
			var executions atomic.Int32
			options.ApplicationQueries = []ApplicationQuery{
				NewResourceAuthorizedQuery(
					"/resource-query/:id",
					[]string{"demo"},
					test.authorize,
					func(request resourceQueryRequest, _ ApplicationPrincipal) authorization.Resource {
						return authorization.Resource{
							TenantID: request.TenantID,
							Type:     "project",
							ID:       request.ID,
							Action:   "read",
							Attributes: map[string]string{
								"classification": "internal",
							},
						}
					},
					func(context.Context, resourceQueryRequest, ApplicationPrincipal) (struct{}, error) {
						executions.Add(1)
						return struct{}{}, nil
					},
				),
			}
			app := New(options)
			token := resourceAuthorizationToken(t, options)
			request := httptest.NewRequest(http.MethodGet, "/api/v1/resource-query/42", http.NoBody)
			request.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
			request.Header.Set("X-Tenant-ID", test.tenantID)
			started := time.Now()
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("resource query request error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.wantStatus)
			}
			if test.name == "timeout" && time.Since(started) > 250*time.Millisecond {
				t.Fatalf("authorization timeout elapsed = %s", time.Since(started))
			}
			if test.wantStatus == http.StatusOK {
				if executions.Load() != 1 {
					t.Fatalf("handler executions = %d", executions.Load())
				}
				return
			}
			if executions.Load() != 0 {
				t.Fatalf("denied handler executions = %d", executions.Load())
			}
			assertNoStoreResponse(t, response)
			envelope := decodeEnvelope(t, response)
			if envelope.Msg != "access is forbidden" || strings.Contains(string(envelope.Data), "private") || strings.Contains(string(envelope.Data), test.tenantID) {
				t.Fatalf("denied envelope = %#v", envelope)
			}
			for _, forbidden := range []string{"private-policy-backend.example", "private-policy-panic", test.tenantID} {
				if strings.Contains(logs.String(), forbidden) {
					t.Fatalf("authorization logs leaked %q: %s", forbidden, logs.String())
				}
			}
		})
	}
}

func TestResourceAuthorizedQueryChecksRolesAndResourceShapeBeforePolicy(t *testing.T) {
	options := testOptions()
	var policyCalls atomic.Int32
	authorizer := authorization.AuthorizerFunc(func(context.Context, authorization.Request) (authorization.Decision, error) {
		policyCalls.Add(1)
		return authorization.DecisionAllow, nil
	})
	options.ApplicationQueries = []ApplicationQuery{
		NewResourceAuthorizedQuery(
			"/resource-query/:id",
			[]string{"demo"},
			authorizer,
			func(request resourceQueryRequest, _ ApplicationPrincipal) authorization.Resource {
				return authorization.Resource{TenantID: request.TenantID, Type: "project", ID: request.ID, Action: "read"}
			},
			func(context.Context, resourceQueryRequest, ApplicationPrincipal) (struct{}, error) {
				return struct{}{}, nil
			},
		),
	}
	app := New(options)
	user, ok := options.Auth.Authenticate("demo", "demo123")
	if !ok {
		t.Fatal("authentication failed")
	}
	user.RoleIDs = []string{"viewer"}
	user.RoleNames = []string{"Viewer"}
	wrongRoleToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue wrong-role token: %v", err)
	}
	wrongRole := httptest.NewRequest(http.MethodGet, "/api/v1/resource-query/42", http.NoBody)
	wrongRole.Header.Set(fiber.HeaderAuthorization, "Bearer "+wrongRoleToken)
	response, err := app.Test(wrongRole)
	if err != nil {
		t.Fatalf("wrong-role request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden || policyCalls.Load() != 0 {
		t.Fatalf("wrong-role status/policy calls = %d/%d", response.StatusCode, policyCalls.Load())
	}

	validToken := resourceAuthorizationToken(t, options)
	malformed := httptest.NewRequest(http.MethodGet, "/api/v1/resource-query/42", http.NoBody)
	malformed.Header.Set(fiber.HeaderAuthorization, "Bearer "+validToken)
	malformed.Header.Set("X-Tenant-ID", "invalid tenant")
	response, err = app.Test(malformed)
	if err != nil {
		t.Fatalf("malformed resource request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || policyCalls.Load() != 0 {
		t.Fatalf("malformed resource status/policy calls = %d/%d", response.StatusCode, policyCalls.Load())
	}
	if envelope := decodeEnvelope(t, response); envelope.Msg != "request resource is invalid" {
		t.Fatalf("malformed resource envelope = %#v", envelope)
	}
}

func TestResourceAuthorizedCommandDoesNotPolluteIdempotencyOnDeny(t *testing.T) {
	options := testOptions()
	var allow atomic.Bool
	var policyCalls, executions atomic.Int32
	options.ApplicationCommands = []ApplicationCommand{
		NewResourceAuthorizedJSONCommand(
			"/resource-command",
			[]string{"demo"},
			authorization.AuthorizerFunc(func(_ context.Context, request authorization.Request) (authorization.Decision, error) {
				policyCalls.Add(1)
				if request.Resource.TenantID != request.Principal.Subject || !allow.Load() {
					return authorization.DecisionDeny, nil
				}
				return authorization.DecisionAllow, nil
			}),
			func(request resourceCommandRequest, _ ApplicationPrincipal) authorization.Resource {
				return authorization.Resource{TenantID: request.TenantID, Type: "project", ID: "current", Action: "update"}
			},
			func(context.Context, resourceCommandRequest, ApplicationPrincipal) (struct{}, error) {
				executions.Add(1)
				return struct{}{}, nil
			},
		),
	}
	app := New(options)
	token := resourceAuthorizationToken(t, options)
	do := func() *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/resource-command", strings.NewReader(`{"tenantId":"fiber-demo-user","value":"updated"}`))
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		request.Header.Set("X-Idempotency-Key", "123e4567-e89b-12d3-a456-426614174001")
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("resource command request error = %v", err)
		}
		return response
	}

	denied := do()
	denied.Body.Close()
	if denied.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("denied status/executions = %d/%d", denied.StatusCode, executions.Load())
	}
	allow.Store(true)
	allowed := do()
	allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK || allowed.Header.Get("X-Idempotency-Replayed") != "" || executions.Load() != 1 {
		t.Fatalf("allowed status/replay/executions = %d/%q/%d", allowed.StatusCode, allowed.Header.Get("X-Idempotency-Replayed"), executions.Load())
	}
	replayed := do()
	replayed.Body.Close()
	if replayed.StatusCode != http.StatusOK || replayed.Header.Get("X-Idempotency-Replayed") != "true" || executions.Load() != 1 || policyCalls.Load() != 3 {
		t.Fatalf("replay status/header/executions/policy = %d/%q/%d/%d", replayed.StatusCode, replayed.Header.Get("X-Idempotency-Replayed"), executions.Load(), policyCalls.Load())
	}
}

func TestResourceAuthorizedVersionedCommandChecksPolicyBeforePrecondition(t *testing.T) {
	options := testOptions()
	var allow atomic.Bool
	var executions atomic.Int32
	options.ApplicationCommands = []ApplicationCommand{
		NewResourceAuthorizedVersionedJSONCommand(
			"/resource-versioned-command",
			[]string{"demo"},
			authorization.AuthorizerFunc(func(context.Context, authorization.Request) (authorization.Decision, error) {
				if allow.Load() {
					return authorization.DecisionAllow, nil
				}
				return authorization.DecisionDeny, nil
			}),
			func(request resourceCommandRequest, principal ApplicationPrincipal) authorization.Resource {
				return authorization.Resource{TenantID: principal.Subject, Type: "project", ID: "current", Action: "update"}
			},
			func(_ context.Context, _ resourceCommandRequest, _ ApplicationPrincipal, precondition ApplicationPrecondition) (struct{}, string, error) {
				executions.Add(1)
				if precondition.EntityTag != "v1" {
					t.Fatalf("precondition = %q", precondition.EntityTag)
				}
				return struct{}{}, "v2", nil
			},
		).WithMethod(http.MethodPatch),
	}
	app := New(options)
	token := resourceAuthorizationToken(t, options)
	do := func(ifMatch string) *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodPatch, "/api/v1/resource-versioned-command", strings.NewReader(`{"tenantId":"ignored","value":"updated"}`))
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		if ifMatch != "" {
			request.Header.Set(fiber.HeaderIfMatch, ifMatch)
		}
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("versioned resource command request error = %v", err)
		}
		return response
	}

	denied := do("")
	denied.Body.Close()
	if denied.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("denied status/executions = %d/%d", denied.StatusCode, executions.Load())
	}
	allow.Store(true)
	missing := do("")
	missing.Body.Close()
	if missing.StatusCode != http.StatusPreconditionRequired || executions.Load() != 0 {
		t.Fatalf("missing precondition status/executions = %d/%d", missing.StatusCode, executions.Load())
	}
	allowed := do(`"v1"`)
	allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK || allowed.Header.Get(fiber.HeaderETag) != `"v2"` || executions.Load() != 1 {
		t.Fatalf("allowed status/etag/executions = %d/%q/%d", allowed.StatusCode, allowed.Header.Get(fiber.HeaderETag), executions.Load())
	}
}

func TestResourceAuthorizationConfigurationFailsAtStartup(t *testing.T) {
	handler := func(context.Context, resourceQueryRequest, ApplicationPrincipal) (struct{}, error) {
		return struct{}{}, nil
	}
	resolver := func(request resourceQueryRequest, _ ApplicationPrincipal) authorization.Resource {
		return authorization.Resource{TenantID: request.TenantID, Type: "project", ID: request.ID, Action: "read"}
	}
	tests := []struct {
		name    string
		options func() Options
	}{
		{name: "missing authorizer", options: func() Options {
			options := testOptions()
			options.ApplicationQueries = []ApplicationQuery{NewResourceAuthorizedQuery("/resource/:id", []string{"demo"}, nil, resolver, handler)}
			return options
		}},
		{name: "missing resolver", options: func() Options {
			options := testOptions()
			options.ApplicationQueries = []ApplicationQuery{NewResourceAuthorizedQuery("/resource/:id", []string{"demo"}, authorization.AuthorizerFunc(func(context.Context, authorization.Request) (authorization.Decision, error) {
				return authorization.DecisionAllow, nil
			}), nil, handler)}
			return options
		}},
		{name: "excessive timeout", options: func() Options {
			options := testOptions()
			options.ResourceAuthorizationTimeout = time.Second + time.Nanosecond
			return options
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered == nil {
					t.Fatal("New() did not panic")
				}
			}()
			New(test.options())
		})
	}
}

func resourceAuthorizationToken(t *testing.T, options Options) string {
	t.Helper()
	user, ok := options.Auth.Authenticate("demo", "demo123")
	if !ok {
		t.Fatal("authentication failed")
	}
	token, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}
	return token
}
