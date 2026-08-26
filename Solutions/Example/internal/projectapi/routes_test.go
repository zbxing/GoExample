package projectapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/httpapi"
)

func newProjectTestAuth(now func() time.Time) *auth.Service {
	return auth.NewService(auth.Config{
		Enabled:  true,
		Username: "project-user",
		Password: "project-password",
		Secret:   "01234567890123456789012345678901",
		Issuer:   "project-test",
		Audience: "project-api",
		TTL:      time.Hour,
		Now:      now,
	})
}

func issueProjectTestToken(t *testing.T, service *auth.Service, roleIDs, roleNames []string) (auth.User, string) {
	t.Helper()
	user, ok := service.Authenticate("project-user", "project-password")
	if !ok {
		t.Fatal("project test authentication failed")
	}
	if roleIDs != nil {
		user.RoleIDs = roleIDs
		user.RoleNames = roleNames
	}
	rawToken, _, err := service.Issue(user)
	if err != nil {
		t.Fatalf("issue project test token: %v", err)
	}
	return user, rawToken
}

func TestQueriesAddProjectRoute(t *testing.T) {
	options := httpapi.Options{
		Name:        "Example Test API",
		Environment: "test",
		Version:     "test-version",
	}
	options.ApplicationQueries = Queries(options)
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project", http.NoBody))
	if err != nil {
		t.Fatalf("project request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("project status = %d", response.StatusCode)
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Name        string `json:"name"`
			Environment string `json:"environment"`
			Version     string `json:"version"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode project response: %v", err)
	}
	if envelope.Code != 0 || envelope.Data.Name != options.Name || envelope.Data.Environment != options.Environment || envelope.Data.Version != options.Version {
		t.Fatalf("project response = %#v", envelope)
	}
}

func TestProjectRouteCreatesChildApplicationSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	options := httpapi.Options{
		Name:           "Example Test API",
		Environment:    "test",
		Version:        "test-version",
		TracerProvider: provider,
	}
	options.ApplicationQueries = Queries(options)
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project", http.NoBody))
	if err != nil {
		t.Fatalf("project request error = %v", err)
	}
	response.Body.Close()

	var serverSpan, applicationSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "GET /api/v1/project":
			serverSpan = span
		case "project.get":
			applicationSpan = span
		}
	}
	if serverSpan == nil || applicationSpan == nil {
		t.Fatalf("route spans = %#v", recorder.Ended())
	}
	if applicationSpan.SpanContext().TraceID() != serverSpan.SpanContext().TraceID() || applicationSpan.Parent().SpanID() != serverSpan.SpanContext().SpanID() {
		t.Fatalf("application parent/trace = %s/%s, server = %s/%s", applicationSpan.Parent().SpanID(), applicationSpan.SpanContext().TraceID(), serverSpan.SpanContext().SpanID(), serverSpan.SpanContext().TraceID())
	}
}

func TestCommandsAddAuthorizedTypedProjectRoute(t *testing.T) {
	now := func() time.Time { return time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC) }
	authService := newProjectTestAuth(now)
	options := httpapi.Options{
		Name:        "Example Test API",
		Environment: "test",
		Version:     "test-version",
		Auth:        authService,
		Now:         now,
	}
	options.ApplicationQueries = Queries(options)
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)

	missing := httptest.NewRequest(http.MethodPost, "/api/v1/project/describe", strings.NewReader(`{"audience":"operators"}`))
	missing.Header.Set("Content-Type", "application/json")
	missingResponse, err := app.Test(missing)
	if err != nil {
		t.Fatalf("missing-token project command request error = %v", err)
	}
	missingResponse.Body.Close()
	if missingResponse.StatusCode != http.StatusUnauthorized || !strings.Contains(missingResponse.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("missing-token project command response = %d, headers %#v", missingResponse.StatusCode, missingResponse.Header)
	}

	_, wrongRoleToken := issueProjectTestToken(t, authService, []string{"viewer"}, []string{"Viewer"})
	forbidden := httptest.NewRequest(http.MethodPost, "/api/v1/project/describe", strings.NewReader(`{"audience":"operators"}`))
	forbidden.Header.Set("Content-Type", "application/json")
	forbidden.Header.Set("Authorization", "Bearer "+wrongRoleToken)
	forbiddenResponse, err := app.Test(forbidden)
	if err != nil {
		t.Fatalf("wrong-role project command request error = %v", err)
	}
	forbiddenResponse.Body.Close()
	if forbiddenResponse.StatusCode != http.StatusForbidden || !strings.Contains(forbiddenResponse.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("wrong-role project command response = %d, headers %#v", forbiddenResponse.StatusCode, forbiddenResponse.Header)
	}

	user, rawToken := issueProjectTestToken(t, authService, nil, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/project/describe", strings.NewReader(`{"audience":"operators"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+rawToken)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("project command request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("project command status = %d", response.StatusCode)
	}
	var envelope struct {
		Code int                        `json:"code"`
		Data projectDescriptionResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode project command response: %v", err)
	}
	if envelope.Code != 0 || envelope.Data.Name != options.Name || envelope.Data.Audience != "operators" || envelope.Data.RequestedBy != user.ID || envelope.Data.Summary != options.Name+" is available for operators" {
		t.Fatalf("project command response = %#v", envelope)
	}
}

func TestProjectCommandCreatesChildApplicationSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	now := func() time.Time { return time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC) }
	authService := newProjectTestAuth(now)
	options := httpapi.Options{
		Name:           "Example Test API",
		Environment:    "test",
		Version:        "test-version",
		Auth:           authService,
		TracerProvider: provider,
		Now:            now,
	}
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)

	user, rawToken := issueProjectTestToken(t, authService, nil, nil)
	deniedRequest := httptest.NewRequest(http.MethodPost, "/api/v1/project/describe", strings.NewReader(`{"tenantId":"other-tenant","audience":"operators"}`))
	deniedRequest.Header.Set("Content-Type", "application/json")
	deniedRequest.Header.Set("Authorization", "Bearer "+rawToken)
	denied, err := app.Test(deniedRequest)
	if err != nil {
		t.Fatalf("cross-tenant command request error = %v", err)
	}
	denied.Body.Close()
	if denied.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-tenant command status = %d", denied.StatusCode)
	}
	for _, span := range recorder.Ended() {
		if span.Name() == "project.describe" {
			t.Fatal("cross-tenant command created an application span")
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/project/describe", strings.NewReader(`{"tenantId":"`+user.ID+`","audience":"operators"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+rawToken)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("project command request error = %v", err)
	}
	response.Body.Close()

	var serverSpan, applicationSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "POST /api/v1/project/describe":
			serverSpan = span
		case "project.describe":
			applicationSpan = span
		}
	}
	if serverSpan == nil || applicationSpan == nil {
		t.Fatalf("route spans = %#v", recorder.Ended())
	}
	if applicationSpan.SpanContext().TraceID() != serverSpan.SpanContext().TraceID() || applicationSpan.Parent().SpanID() != serverSpan.SpanContext().SpanID() {
		t.Fatalf("application parent/trace = %s/%s, server = %s/%s", applicationSpan.Parent().SpanID(), applicationSpan.SpanContext().TraceID(), serverSpan.SpanContext().SpanID(), serverSpan.SpanContext().TraceID())
	}
}

func TestAuthenticatedPreviewBindsPathQueryHeaderAndCreatesChildSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	now := func() time.Time { return time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC) }
	authService := newProjectTestAuth(now)
	options := httpapi.Options{
		Name:           "Example Test API",
		Environment:    "test",
		Version:        "test-version",
		Auth:           authService,
		TracerProvider: provider,
		Now:            now,
	}
	options.ApplicationQueries = Queries(options)
	options.ApplicationCommands = Commands(options)
	app := httpapi.New(options)

	unauthorized, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project/preview/operators?format=summary", http.NoBody))
	if err != nil {
		t.Fatalf("unauthorized preview request error = %v", err)
	}
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized || !strings.Contains(unauthorized.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("unauthorized preview response = %d, headers %#v", unauthorized.StatusCode, unauthorized.Header)
	}

	user, rawToken := issueProjectTestToken(t, authService, nil, nil)
	_, wrongRoleToken := issueProjectTestToken(t, authService, []string{"viewer"}, []string{"Viewer"})
	forbiddenRequest := httptest.NewRequest(http.MethodGet, "/api/v1/project/preview/operators?format=summary", http.NoBody)
	forbiddenRequest.Header.Set("Authorization", "Bearer "+wrongRoleToken)
	forbiddenRequest.Header.Set("X-Client-Locale", "zh-CN")
	forbidden, err := app.Test(forbiddenRequest)
	if err != nil {
		t.Fatalf("forbidden preview request error = %v", err)
	}
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || !strings.Contains(forbidden.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("forbidden preview response = %d, headers %#v", forbidden.StatusCode, forbidden.Header)
	}
	for _, span := range recorder.Ended() {
		if span.Name() == "project.preview" {
			t.Fatal("forbidden preview created an application span")
		}
	}
	crossTenantRequest := httptest.NewRequest(http.MethodGet, "/api/v1/project/preview/operators?format=summary", http.NoBody)
	crossTenantRequest.Header.Set("Authorization", "Bearer "+rawToken)
	crossTenantRequest.Header.Set("X-Client-Locale", "zh-CN")
	crossTenantRequest.Header.Set("X-Tenant-ID", "other-tenant")
	crossTenant, err := app.Test(crossTenantRequest)
	if err != nil {
		t.Fatalf("cross-tenant preview request error = %v", err)
	}
	defer crossTenant.Body.Close()
	if crossTenant.StatusCode != http.StatusForbidden || !strings.Contains(crossTenant.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("cross-tenant preview response = %d, headers %#v", crossTenant.StatusCode, crossTenant.Header)
	}
	crossTenantEnvelope := struct {
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}{}
	if err := json.NewDecoder(crossTenant.Body).Decode(&crossTenantEnvelope); err != nil {
		t.Fatalf("decode cross-tenant preview response: %v", err)
	}
	if crossTenantEnvelope.Msg != "access is forbidden" || strings.Contains(string(crossTenantEnvelope.Data), "other-tenant") {
		t.Fatalf("cross-tenant preview envelope = %#v", crossTenantEnvelope)
	}
	for _, span := range recorder.Ended() {
		if span.Name() == "project.preview" {
			t.Fatal("cross-tenant preview created an application span")
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/project/preview/operators?format=summary&locale=spoofed", http.NoBody)
	request.Header.Set("Authorization", "Bearer "+rawToken)
	request.Header.Set("X-Client-Locale", "zh-CN")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("preview request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("preview response = %d, headers %#v", response.StatusCode, response.Header)
	}
	var envelope struct {
		Code int                    `json:"code"`
		Data projectPreviewResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode preview response: %v", err)
	}
	if envelope.Code != 0 || envelope.Data.Name != options.Name || envelope.Data.Audience != "operators" || envelope.Data.Format != "summary" || envelope.Data.Locale != "zh-CN" || envelope.Data.RequestedBy != user.ID {
		t.Fatalf("preview response = %#v", envelope)
	}

	var serverSpan, applicationSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "GET /api/v1/project/preview/:audience":
			serverSpan = span
		case "project.preview":
			applicationSpan = span
		}
	}
	if serverSpan == nil || applicationSpan == nil {
		t.Fatalf("preview spans = %#v", recorder.Ended())
	}
	if applicationSpan.SpanContext().TraceID() != serverSpan.SpanContext().TraceID() || applicationSpan.Parent().SpanID() != serverSpan.SpanContext().SpanID() {
		t.Fatalf("preview application parent/trace = %s/%s, server = %s/%s", applicationSpan.Parent().SpanID(), applicationSpan.SpanContext().TraceID(), serverSpan.SpanContext().SpanID(), serverSpan.SpanContext().TraceID())
	}
}

func TestEndpointsReturnsIndependentSlice(t *testing.T) {
	if commands := Commands(httpapi.Options{}); len(commands) != 0 {
		t.Fatalf("commands with disabled authentication = %#v", commands)
	}
	first := Endpoints(false)
	first[0] = "changed"
	second := Endpoints(false)
	if second[0] == "changed" || second[len(second)-1] != "GET /api/v1/project" {
		t.Fatalf("endpoints = %#v", second)
	}
	authenticated := Endpoints(true)
	if authenticated[len(authenticated)-2] != "GET /api/v1/project/preview/:audience" || authenticated[len(authenticated)-1] != "POST /api/v1/project/describe" {
		t.Fatalf("authenticated endpoints = %#v", authenticated)
	}
	external := strings.Join(EndpointsForAuth(true, false), "\n")
	if strings.Contains(external, "POST /api/v1/auth/login") || !strings.Contains(external, "GET /api/v1/auth/me") {
		t.Fatalf("external verifier endpoints = %s", external)
	}
}
