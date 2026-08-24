package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/validation"
)

type testEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

func testOptions() Options {
	now := func() time.Time {
		return time.Date(2026, time.August, 16, 4, 0, 0, 0, time.UTC)
	}
	return Options{
		Name:                "Test API",
		Environment:         "test",
		Version:             "test-version",
		Commit:              "test-commit",
		BuildTime:           "2026-08-16T03:00:00Z",
		AllowedOrigins:      []string{"http://localhost:3000"},
		RequestTimeout:      time.Second,
		RateLimitMax:        1000,
		RateLimitWindow:     time.Minute,
		AuthRateLimitMax:    100,
		IdempotencyEnabled:  true,
		IdempotencyLifetime: time.Minute,
		Auth: auth.NewService(auth.Config{
			Enabled:  true,
			Username: "demo",
			Password: "demo123",
			Secret:   "01234567890123456789012345678901",
			Issuer:   "test",
			TTL:      time.Hour,
			Now:      now,
		}),
		Metrics:   observability.NewMetrics(),
		Validator: validation.New(),
		Logger:    observability.NewLogger("json", "error", io.Discard),
		Now:       now,
	}
}

func newTestApp() *fiber.App {
	return New(testOptions())
}

func assertNoStoreResponse(t *testing.T, response *http.Response) {
	t.Helper()
	if value := response.Header.Get(fiber.HeaderCacheControl); !hasCacheControlDirective(value, "no-store") {
		t.Fatalf("Cache-Control = %q", value)
	}
	if value := response.Header.Get(fiber.HeaderPragma); value != "no-cache" {
		t.Fatalf("Pragma = %q", value)
	}
	if value := response.Header.Get(fiber.HeaderETag); value != "" {
		t.Fatalf("ETag = %q", value)
	}
	if value := response.Header.Get(fiber.HeaderContentEncoding); value != "" {
		t.Fatalf("Content-Encoding = %q", value)
	}
}

func assertBearerChallenge(t *testing.T, response *http.Response, want string) {
	t.Helper()
	if value := response.Header.Get(fiber.HeaderWWWAuthenticate); value != want {
		t.Fatalf("WWW-Authenticate = %q, want %q", value, want)
	}
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	app := newTestApp()
	req := httptest.NewRequest(http.MethodGet, "/api/health", http.NoBody)
	req.Header.Set(fiber.HeaderXRequestID, "test-request-id")

	response, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if response.Header.Get(fiber.HeaderXRequestID) != "test-request-id" {
		t.Fatalf("request ID = %q", response.Header.Get(fiber.HeaderXRequestID))
	}
	if response.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", response.Header.Get("X-Content-Type-Options"))
	}
	if response.Header.Get(fiber.HeaderETag) != "" {
		t.Fatalf("health ETag = %q", response.Header.Get(fiber.HeaderETag))
	}
	if !hasCacheControlDirective(response.Header.Get(fiber.HeaderCacheControl), "no-store") {
		t.Fatalf("health Cache-Control = %q", response.Header.Get(fiber.HeaderCacheControl))
	}
	if response.Header.Get(fiber.HeaderPragma) != "no-cache" {
		t.Fatalf("health Pragma = %q", response.Header.Get(fiber.HeaderPragma))
	}

	envelope := decodeEnvelope(t, response)
	var data struct {
		Status    string `json:"status"`
		Version   string `json:"version"`
		Timestamp string `json:"timestamp"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if data.Status != "ok" || data.Version != "test-version" || data.Timestamp != "2026-08-16T04:00:00Z" {
		t.Fatalf("data = %#v", data)
	}

	hello, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("hello request error = %v", err)
	}
	defer hello.Body.Close()
	if hello.Header.Get(fiber.HeaderETag) == "" {
		t.Fatal("business response ETag is empty")
	}
}

func TestCompatibilityHealthRoutesAdvertiseDeprecation(t *testing.T) {
	app := newTestApp()
	tests := []struct {
		path      string
		successor string
	}{
		{path: "/api/health", successor: "/livez"},
		{path: "/api/health/ready", successor: "/readyz"},
		{path: "/api/health/startup", successor: "/startupz"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, http.NoBody)
			request.Header.Set(fiber.HeaderOrigin, "http://localhost:3000")
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("request error = %v", err)
			}
			defer response.Body.Close()

			assertHealthDeprecationHeaders(t, response, test.successor)
			exposed := response.Header.Get(fiber.HeaderAccessControlExposeHeaders)
			for _, header := range []string{deprecationHeader, sunsetHeader, linkHeader} {
				if !strings.Contains(exposed, header) {
					t.Fatalf("Access-Control-Expose-Headers = %q, missing %s", exposed, header)
				}
			}
		})
	}

	for _, path := range []string{"/livez", "/readyz", "/startupz"} {
		response, err := app.Test(httptest.NewRequest(http.MethodGet, path, http.NoBody))
		if err != nil {
			t.Fatalf("canonical health request %s error = %v", path, err)
		}
		response.Body.Close()
		if response.Header.Get(deprecationHeader) != "" || response.Header.Get(sunsetHeader) != "" || response.Header.Get(linkHeader) != "" {
			t.Fatalf("canonical health route %s is marked deprecated: %#v", path, response.Header)
		}
	}
}

func TestCompatibilityReadinessKeepsDeprecationHeadersWhenUnavailable(t *testing.T) {
	options := testOptions()
	options.Health = health.New(time.Second)
	options.Health.SetDraining(true)
	app := New(options)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/health/ready", http.NoBody))
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusServiceUnavailable)
	}
	assertHealthDeprecationHeaders(t, response, "/readyz")
}

func assertHealthDeprecationHeaders(t *testing.T, response *http.Response, successor string) {
	t.Helper()
	if value := response.Header.Get(deprecationHeader); value != healthDeprecation {
		t.Fatalf("Deprecation = %q, want %q", value, healthDeprecation)
	}
	if value := response.Header.Get(sunsetHeader); value != healthSunset {
		t.Fatalf("Sunset = %q, want %q", value, healthSunset)
	}
	wantLink := "<" + successor + ">; rel=\"successor-version\""
	if value := response.Header.Get(linkHeader); value != wantLink {
		t.Fatalf("Link = %q, want %q", value, wantLink)
	}
}

func TestWeakETagConditionalRequest(t *testing.T) {
	app := newTestApp()
	initial, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("initial request error = %v", err)
	}
	tag := initial.Header.Get(fiber.HeaderETag)
	initial.Body.Close()
	if !strings.HasPrefix(tag, "W/\"") {
		t.Fatalf("initial ETag = %q, want weak validator", tag)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody)
	request.Header.Set(fiber.HeaderIfNoneMatch, `"different", `+strings.TrimPrefix(tag, "W/"))
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("conditional request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want %d", response.StatusCode, http.StatusNotModified)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read conditional response: %v", err)
	}
	if len(body) != 0 {
		t.Fatalf("conditional response body = %q, want empty", body)
	}
}

func TestRequestIDBoundaryPreservesValidAndReplacesUntrustedValues(t *testing.T) {
	var output bytes.Buffer
	options := testOptions()
	options.Logger = observability.NewLogger("json", "info", &output)
	app := New(options)

	tests := []struct {
		name      string
		requestID string
		preserved bool
	}{
		{name: "maximum valid token", requestID: strings.Repeat("a", maxRequestIDLength), preserved: true},
		{name: "over length", requestID: strings.Repeat("b", maxRequestIDLength+1)},
		{name: "delimiter characters", requestID: `client " supplied`},
	}
	replacementIDs := make([]string, 0, 2)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/health", http.NoBody)
			request.Header.Set(fiber.HeaderXRequestID, test.requestID)
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("request error = %v", err)
			}
			response.Body.Close()

			responseID := response.Header.Get(fiber.HeaderXRequestID)
			if test.preserved && responseID != test.requestID {
				t.Fatalf("preserved request ID = %q", responseID)
			}
			if !test.preserved && (responseID == test.requestID || !validRequestID(responseID)) {
				t.Fatalf("replacement request ID = %q", responseID)
			}
			if !test.preserved {
				replacementIDs = append(replacementIDs, responseID)
			}
		})
	}

	logs := output.String()
	if strings.Contains(logs, `client \" supplied`) || strings.Contains(logs, strings.Repeat("b", maxRequestIDLength+1)) {
		t.Fatalf("request logs contain an untrusted request ID: %s", logs)
	}
	for _, replacementID := range replacementIDs {
		if !strings.Contains(logs, `"request_id":"`+replacementID+`"`) {
			t.Fatalf("request logs do not correlate replacement ID %q: %s", replacementID, logs)
		}
	}
	if metrics := options.Metrics.Render(); !strings.Contains(metrics, "goexample_http_request_id_replacements_total 2") {
		t.Fatalf("request ID replacement metric = %s", metrics)
	}
}

func TestPanicLogIncludesTraceCorrelation(t *testing.T) {
	var output bytes.Buffer
	options := testOptions()
	options.Logger = observability.NewLogger("json", "error", &output)
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/panic", func(fiber.Ctx) error {
			panic("test panic")
		})
	}
	app := New(options)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/panic", http.NoBody))
	if err != nil {
		t.Fatalf("panic request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("panic status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)

	var panicRecord map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err == nil && record["msg"] == "panic_recovered" {
			panicRecord = record
			break
		}
	}
	for _, field := range []string{"trace_id", "span_id"} {
		if value, ok := panicRecord[field].(string); !ok || value == "" {
			t.Fatalf("panic log field %q = %#v; output=%s", field, panicRecord[field], output.String())
		}
	}
}

func TestCORSAllowsCredentialsOnlyWhenConfigured(t *testing.T) {
	request := func(t *testing.T, options Options) *http.Response {
		t.Helper()
		app := New(options)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody)
		req.Header.Set(fiber.HeaderOrigin, "http://localhost:3000")
		response, err := app.Test(req)
		if err != nil {
			t.Fatalf("CORS request error = %v", err)
		}
		return response
	}

	options := testOptions()
	response := request(t, options)
	response.Body.Close()
	if response.Header.Get(fiber.HeaderAccessControlAllowOrigin) != "http://localhost:3000" {
		t.Fatalf("allow origin = %q", response.Header.Get(fiber.HeaderAccessControlAllowOrigin))
	}
	if value := response.Header.Get(fiber.HeaderAccessControlAllowCredentials); value != "" {
		t.Fatalf("default allow credentials = %q", value)
	}
	if value := response.Header.Get(fiber.HeaderAccessControlExposeHeaders); !strings.Contains(value, fiber.HeaderWWWAuthenticate) {
		t.Fatalf("exposed headers = %q", value)
	}

	options.AllowCredentials = true
	response = request(t, options)
	response.Body.Close()
	if value := response.Header.Get(fiber.HeaderAccessControlAllowCredentials); value != "true" {
		t.Fatalf("configured allow credentials = %q", value)
	}
}

func TestMutationRequiresJSONMediaType(t *testing.T) {
	app := newTestApp()
	tests := []struct {
		name        string
		contentType string
		wantStatus  int
	}{
		{name: "missing", wantStatus: http.StatusUnsupportedMediaType},
		{name: "plain text", contentType: "text/plain", wantStatus: http.StatusUnsupportedMediaType},
		{name: "invalid", contentType: "not a media type", wantStatus: http.StatusUnsupportedMediaType},
		{name: "vendor JSON", contentType: "application/vnd.goexample+json; charset=utf-8", wantStatus: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":42}`))
			if test.contentType != "" {
				request.Header.Set(fiber.HeaderContentType, test.contentType)
			}
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.wantStatus)
			}
			if test.wantStatus != http.StatusOK {
				if envelope := decodeEnvelope(t, response); envelope.Code != http.StatusUnsupportedMediaType {
					t.Fatalf("code = %d", envelope.Code)
				}
			}
		})
	}

	login := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"demo","password":"demo123"}`))
	loginResponse, err := app.Test(login)
	if err != nil {
		t.Fatalf("login request error = %v", err)
	}
	defer loginResponse.Body.Close()
	if loginResponse.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("login status = %d", loginResponse.StatusCode)
	}
}

func TestSystemInfoDetailPolicy(t *testing.T) {
	options := testOptions()
	options.SystemInfoDetailed = false
	app := New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/system/info", http.NoBody))
	if err != nil {
		t.Fatalf("system info request error = %v", err)
	}
	envelope := decodeEnvelope(t, response)
	response.Body.Close()
	var restricted map[string]any
	if err := json.Unmarshal(envelope.Data, &restricted); err != nil {
		t.Fatalf("decode restricted system info: %v", err)
	}
	if _, exists := restricted["goVersion"]; exists {
		t.Fatalf("restricted system info exposes runtime details = %#v", restricted)
	}
	if restricted["commit"] != "test-commit" {
		t.Fatalf("restricted system info omits build identity = %#v", restricted)
	}

	options.SystemInfoDetailed = true
	app = New(options)
	response, err = app.Test(httptest.NewRequest(http.MethodGet, "/api/system/info", http.NoBody))
	if err != nil {
		t.Fatalf("detailed system info request error = %v", err)
	}
	envelope = decodeEnvelope(t, response)
	response.Body.Close()
	var detailed map[string]any
	if err := json.Unmarshal(envelope.Data, &detailed); err != nil {
		t.Fatalf("decode detailed system info: %v", err)
	}
	if detailed["goVersion"] == nil || detailed["fiberVersion"] == nil {
		t.Fatalf("detailed system info = %#v", detailed)
	}
	if !hasCacheControlDirective(response.Header.Get(fiber.HeaderCacheControl), "no-store") {
		t.Fatalf("system info Cache-Control = %q", response.Header.Get(fiber.HeaderCacheControl))
	}
}

func TestCustomRouteRegistrarReplacesDefaultProjectRoutes(t *testing.T) {
	options := testOptions()
	options.Endpoints = []string{"GET /api/v1/custom"}
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Get("/custom", func(c fiber.Ctx) error {
			return success(c, fiber.Map{"source": "custom"})
		})
	}
	app := New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/custom", http.NoBody))
	if err != nil {
		t.Fatalf("custom request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("custom status = %d", response.StatusCode)
	}

	defaultRoute, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("default route request error = %v", err)
	}
	defaultRoute.Body.Close()
	if defaultRoute.StatusCode != http.StatusNotFound {
		t.Fatalf("default route status = %d", defaultRoute.StatusCode)
	}
}

func TestApplicationQueriesKeepHandlersTransportNeutral(t *testing.T) {
	options := testOptions()
	var traceObserved, deadlineObserved bool
	options.ApplicationQueries = []ApplicationQuery{
		{
			Path: "/project-query",
			Handler: func(ctx context.Context) (any, error) {
				_, traceObserved = observability.FromContext(ctx)
				_, deadlineObserved = ctx.Deadline()
				return map[string]string{"source": "application"}, nil
			},
		},
	}
	app := New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/project-query", http.NoBody))
	if err != nil {
		t.Fatalf("application query error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("application query status = %d", response.StatusCode)
	}
	envelope := decodeEnvelope(t, response)
	if !strings.Contains(string(envelope.Data), `"source":"application"`) {
		t.Fatalf("application query data = %s", envelope.Data)
	}
	if !traceObserved || !deadlineObserved {
		t.Fatalf("application query trace/deadline = %t/%t", traceObserved, deadlineObserved)
	}

	defaultRoute, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("default route request error = %v", err)
	}
	defaultRoute.Body.Close()
	if defaultRoute.StatusCode != http.StatusOK {
		t.Fatalf("default route status = %d", defaultRoute.StatusCode)
	}
}

func TestTypedApplicationQueryBindsIsolatedSourcesAndAuthenticatedPrincipal(t *testing.T) {
	type queryRequest struct {
		ID     int    `uri:"id" json:"id" validate:"min=1"`
		Page   int    `query:"page" json:"page" validate:"min=1,max=100"`
		Locale string `header:"X-Client-Locale" json:"locale" validate:"required,max=16"`
	}
	type queryResponse struct {
		ID        int    `json:"id"`
		Page      int    `json:"page"`
		Locale    string `json:"locale"`
		Subject   string `json:"subject"`
		Username  string `json:"username"`
		RoleCount int    `json:"roleCount"`
	}

	options := testOptions()
	var traceObserved, deadlineObserved bool
	options.ApplicationQueries = []ApplicationQuery{
		NewAuthenticatedQuery("/typed-query/:id", func(ctx context.Context, request queryRequest, principal ApplicationPrincipal) (queryResponse, error) {
			_, traceObserved = observability.FromContext(ctx)
			_, deadlineObserved = ctx.Deadline()
			return queryResponse{
				ID:        request.ID,
				Page:      request.Page,
				Locale:    request.Locale,
				Subject:   principal.Subject,
				Username:  principal.Username,
				RoleCount: len(principal.RoleIDs),
			}, nil
		}),
	}
	app := New(options)

	unauthorized, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/typed-query/42?page=2", http.NoBody))
	if err != nil {
		t.Fatalf("unauthorized typed query error = %v", err)
	}
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized typed query status = %d", unauthorized.StatusCode)
	}
	assertNoStoreResponse(t, unauthorized)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("test user authentication failed")
	}
	rawToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue test token: %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/typed-query/42?id=999&page=2&locale=spoofed", http.NoBody)
	request.Header.Set(fiber.HeaderAuthorization, "Bearer "+rawToken)
	request.Header.Set("X-Client-Locale", "zh-CN")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("typed query error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("typed query status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)
	envelope := decodeEnvelope(t, response)
	var data queryResponse
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode typed query response: %v", err)
	}
	if data.ID != 42 || data.Page != 2 || data.Locale != "zh-CN" || data.Subject != user.ID || data.Username != user.Username || data.RoleCount != 1 {
		t.Fatalf("typed query response = %#v", data)
	}
	if !traceObserved || !deadlineObserved {
		t.Fatalf("typed query trace/deadline = %t/%t", traceObserved, deadlineObserved)
	}

	invalid := httptest.NewRequest(http.MethodGet, "/api/v1/typed-query/not-an-integer?page=2", http.NoBody)
	invalid.Header.Set(fiber.HeaderAuthorization, "Bearer "+rawToken)
	invalid.Header.Set("X-Client-Locale", "zh-CN")
	invalidResponse, err := app.Test(invalid)
	if err != nil {
		t.Fatalf("invalid typed query error = %v", err)
	}
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid typed query status = %d", invalidResponse.StatusCode)
	}
	if invalidEnvelope := decodeEnvelope(t, invalidResponse); invalidEnvelope.Msg != "request parameters are invalid" {
		t.Fatalf("invalid typed query envelope = %#v", invalidEnvelope)
	}
}

func TestAuthorizedApplicationQueryEnforcesCopiedAnyOfRolesBeforeBinding(t *testing.T) {
	type queryRequest struct {
		ID     int    `uri:"id" validate:"min=1"`
		Locale string `header:"X-Client-Locale" validate:"required"`
	}
	type queryResponse struct {
		Subject string `json:"subject"`
	}

	options := testOptions()
	requiredRoles := []string{"operator", "demo"}
	var executions atomic.Int32
	options.ApplicationQueries = []ApplicationQuery{
		NewAuthorizedQuery("/authorized-query/:id", requiredRoles, func(_ context.Context, _ queryRequest, principal ApplicationPrincipal) (queryResponse, error) {
			executions.Add(1)
			return queryResponse{Subject: principal.Subject}, nil
		}),
	}
	requiredRoles[1] = "viewer"
	configured := options.ApplicationQueries[0]
	if !configured.authorizationRequired || len(configured.requiredRoleIDs) != 2 || configured.requiredRoleIDs[1] != "demo" {
		t.Fatalf("authorized query role copy = %#v", configured.requiredRoleIDs)
	}
	app := New(options)

	request := func(rawToken, path string, withLocale bool) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, http.NoBody)
		if rawToken != "" {
			req.Header.Set(fiber.HeaderAuthorization, "Bearer "+rawToken)
		}
		if withLocale {
			req.Header.Set("X-Client-Locale", "zh-CN")
		}
		response, err := app.Test(req)
		if err != nil {
			t.Fatalf("authorized query request error = %v", err)
		}
		return response
	}

	missing := request("", "/api/v1/authorized-query/42", true)
	missing.Body.Close()
	if missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d", missing.StatusCode)
	}
	assertNoStoreResponse(t, missing)

	invalid := request("invalid-token", "/api/v1/authorized-query/42", true)
	invalid.Body.Close()
	if invalid.StatusCode != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d", invalid.StatusCode)
	}
	assertNoStoreResponse(t, invalid)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("test user authentication failed")
	}
	wrongRoleUser := user
	wrongRoleUser.RoleIDs = []string{"viewer"}
	wrongRoleUser.RoleNames = []string{"Viewer"}
	wrongRoleToken, _, err := options.Auth.Issue(wrongRoleUser)
	if err != nil {
		t.Fatalf("issue wrong-role token: %v", err)
	}
	wrongRoleClaims, err := options.Auth.Verify(wrongRoleToken)
	if err != nil || len(wrongRoleClaims.RoleIDs) != 1 || wrongRoleClaims.RoleIDs[0] != "viewer" {
		t.Fatalf("wrong-role claims = %#v, error = %v", wrongRoleClaims.RoleIDs, err)
	}
	forbidden := request(wrongRoleToken, "/api/v1/authorized-query/not-an-integer", false)
	defer forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("wrong-role status/executions = %d/%d", forbidden.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, forbidden)
	if envelope := decodeEnvelope(t, forbidden); envelope.Msg != "access is forbidden" {
		t.Fatalf("wrong-role envelope = %#v", envelope)
	}

	correctRoleToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue correct-role token: %v", err)
	}
	allowed := request(correctRoleToken, "/api/v1/authorized-query/42", true)
	defer allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK || executions.Load() != 1 {
		t.Fatalf("correct-role status/executions = %d/%d", allowed.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, allowed)
}

func TestApplicationQueryErrorsUseTheServerErrorBoundary(t *testing.T) {
	options := testOptions()
	options.ApplicationQueries = []ApplicationQuery{
		{
			Path: "/failure",
			Handler: func(context.Context) (any, error) {
				return nil, errors.New("private downstream detail")
			},
		},
	}
	app := New(options)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/failure", http.NoBody))
	if err != nil {
		t.Fatalf("application query error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("application query status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)
	envelope := decodeEnvelope(t, response)
	if envelope.Msg != "internal server error" || strings.Contains(string(envelope.Data), "private downstream detail") {
		t.Fatalf("application query error envelope = %#v", envelope)
	}
}

func TestVersionedApplicationQueryReturnsStrongETagAndHandlesConditionalGET(t *testing.T) {
	type queryRequest struct {
		ID int `uri:"id" validate:"min=1"`
	}
	type queryResponse struct {
		ID    int    `json:"id"`
		Value string `json:"value"`
	}

	options := testOptions()
	var executions atomic.Int32
	options.ApplicationQueries = []ApplicationQuery{
		NewVersionedQuery("/versioned-query/:id", func(_ context.Context, request queryRequest) (queryResponse, string, error) {
			executions.Add(1)
			return queryResponse{ID: request.ID, Value: "current"}, "v7", nil
		}),
		NewVersionedQuery("/invalid-versioned-query", func(context.Context, struct{}) (queryResponse, string, error) {
			return queryResponse{Value: "private response"}, "private invalid tag", nil
		}),
	}
	app := New(options)

	requestVersioned := func(path, ifNoneMatch string) *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/api/v1"+path, http.NoBody)
		if ifNoneMatch != "" {
			request.Header.Set(fiber.HeaderIfNoneMatch, ifNoneMatch)
		}
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("versioned query request error = %v", err)
		}
		return response
	}

	first := requestVersioned("/versioned-query/42", "")
	if first.StatusCode != http.StatusOK || first.Header.Get(fiber.HeaderETag) != `"v7"` {
		first.Body.Close()
		t.Fatalf("versioned query response = %d/%q", first.StatusCode, first.Header.Get(fiber.HeaderETag))
	}
	if !hasCacheControlDirective(first.Header.Get(fiber.HeaderCacheControl), "no-store") || first.Header.Get(fiber.HeaderPragma) != "no-cache" {
		first.Body.Close()
		t.Fatalf("versioned query cache headers = %#v", first.Header)
	}
	envelope := decodeEnvelope(t, first)
	first.Body.Close()
	if !strings.Contains(string(envelope.Data), `"id":42`) || !strings.Contains(string(envelope.Data), `"value":"current"`) {
		t.Fatalf("versioned query data = %s", envelope.Data)
	}

	nonmatching := requestVersioned("/versioned-query/42", `"v6"`)
	nonmatching.Body.Close()
	if nonmatching.StatusCode != http.StatusOK || nonmatching.Header.Get(fiber.HeaderETag) != `"v7"` {
		t.Fatalf("nonmatching versioned query = %d/%q", nonmatching.StatusCode, nonmatching.Header.Get(fiber.HeaderETag))
	}

	for _, test := range []struct {
		name        string
		ifNoneMatch string
	}{
		{name: "strong", ifNoneMatch: `"v7"`},
		{name: "weak", ifNoneMatch: `W/"v7"`},
		{name: "list", ifNoneMatch: `"v6", W/"v7"`},
		{name: "wildcard", ifNoneMatch: `*`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := requestVersioned("/versioned-query/42", test.ifNoneMatch)
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatalf("read conditional response: %v", err)
			}
			if response.StatusCode != http.StatusNotModified || response.Header.Get(fiber.HeaderETag) != `"v7"` || len(body) != 0 {
				t.Fatalf("conditional versioned query = %d/%q body %q", response.StatusCode, response.Header.Get(fiber.HeaderETag), body)
			}
			if !hasCacheControlDirective(response.Header.Get(fiber.HeaderCacheControl), "no-store") || response.Header.Get(fiber.HeaderPragma) != "no-cache" {
				t.Fatalf("conditional versioned cache headers = %#v", response.Header)
			}
		})
	}
	if executions.Load() != 6 {
		t.Fatalf("versioned query executions = %d, want 6", executions.Load())
	}

	invalid := requestVersioned("/invalid-versioned-query", "*")
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusInternalServerError || invalid.Header.Get(fiber.HeaderETag) != "" {
		t.Fatalf("invalid versioned query response = %d/%q", invalid.StatusCode, invalid.Header.Get(fiber.HeaderETag))
	}
	assertNoStoreResponse(t, invalid)
	invalidEnvelope := decodeEnvelope(t, invalid)
	if invalidEnvelope.Msg != "internal server error" || strings.Contains(string(invalidEnvelope.Data), "private") {
		t.Fatalf("invalid versioned query envelope = %#v", invalidEnvelope)
	}
}

func TestApplicationQuerySupportsExplicitHEADWithoutGETRoute(t *testing.T) {
	options := testOptions()
	var executions atomic.Int32
	options.ApplicationQueries = []ApplicationQuery{
		NewQuery("/head-query", func(context.Context, struct{}) (struct {
			Value string `json:"value"`
		}, error) {
			executions.Add(1)
			return struct {
				Value string `json:"value"`
			}{Value: "head"}, nil
		}).WithMethod(http.MethodHead),
	}
	app := New(options)

	getResponse, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/head-query", http.NoBody))
	if err != nil {
		t.Fatalf("GET explicit HEAD query error = %v", err)
	}
	getResponse.Body.Close()
	if getResponse.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET explicit HEAD query status = %d, want 405", getResponse.StatusCode)
	}

	headResponse, err := app.Test(httptest.NewRequest(http.MethodHead, "/api/v1/head-query", http.NoBody))
	if err != nil {
		t.Fatalf("HEAD query error = %v", err)
	}
	body, err := io.ReadAll(headResponse.Body)
	headResponse.Body.Close()
	if err != nil {
		t.Fatalf("read HEAD query response: %v", err)
	}
	if headResponse.StatusCode != http.StatusOK || len(body) != 0 || executions.Load() != 1 {
		t.Fatalf("HEAD query response = %d, body=%q, executions=%d", headResponse.StatusCode, body, executions.Load())
	}
}

func TestAuthorizedVersionedApplicationQueryChecksAccessBeforeBinding(t *testing.T) {
	type queryRequest struct {
		ID     int    `uri:"id" validate:"min=1"`
		Locale string `header:"X-Client-Locale" validate:"required"`
	}
	type queryResponse struct {
		Subject string `json:"subject"`
	}

	options := testOptions()
	var executions atomic.Int32
	options.ApplicationQueries = []ApplicationQuery{
		NewAuthorizedVersionedQuery("/authorized-versioned-query/:id", []string{"demo"}, func(_ context.Context, _ queryRequest, principal ApplicationPrincipal) (queryResponse, string, error) {
			executions.Add(1)
			return queryResponse{Subject: principal.Subject}, "v1", nil
		}),
	}
	app := New(options)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("versioned query test authentication failed")
	}
	wrongRole := user
	wrongRole.RoleIDs = []string{"viewer"}
	wrongRoleToken, _, err := options.Auth.Issue(wrongRole)
	if err != nil {
		t.Fatalf("issue wrong-role token: %v", err)
	}
	validToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue valid token: %v", err)
	}
	request := func(token, path string, withLocale bool) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1"+path, http.NoBody)
		if token != "" {
			req.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
		}
		if withLocale {
			req.Header.Set("X-Client-Locale", "zh-CN")
		}
		req.Header.Set(fiber.HeaderIfNoneMatch, "*")
		response, requestErr := app.Test(req)
		if requestErr != nil {
			t.Fatalf("authorized versioned query request error = %v", requestErr)
		}
		return response
	}

	unauthorized := request("", "/authorized-versioned-query/not-an-integer", false)
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized || executions.Load() != 0 {
		t.Fatalf("unauthorized versioned query = %d executions %d", unauthorized.StatusCode, executions.Load())
	}

	forbidden := request(wrongRoleToken, "/authorized-versioned-query/not-an-integer", false)
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("forbidden versioned query = %d executions %d", forbidden.StatusCode, executions.Load())
	}

	invalid := request(validToken, "/authorized-versioned-query/not-an-integer", false)
	invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest || executions.Load() != 0 {
		t.Fatalf("invalid versioned query = %d executions %d", invalid.StatusCode, executions.Load())
	}

	allowed := request(validToken, "/authorized-versioned-query/42", true)
	defer allowed.Body.Close()
	if allowed.StatusCode != http.StatusNotModified || allowed.Header.Get(fiber.HeaderETag) != `"v1"` || executions.Load() != 1 {
		t.Fatalf("allowed versioned query = %d/%q executions %d", allowed.StatusCode, allowed.Header.Get(fiber.HeaderETag), executions.Load())
	}
}

func TestApplicationCommandsBindValidateTraceAndReplayWithoutFiber(t *testing.T) {
	type commandRequest struct {
		Audience string `json:"audience" validate:"required,min=2,max=80"`
	}
	type commandResponse struct {
		Audience string `json:"audience"`
	}
	options := testOptions()
	var executions atomic.Int32
	var traceObserved, deadlineObserved bool
	options.ApplicationCommands = []ApplicationCommand{
		NewJSONCommand("/project-command", func(ctx context.Context, request commandRequest) (commandResponse, error) {
			executions.Add(1)
			_, traceObserved = observability.FromContext(ctx)
			_, deadlineObserved = ctx.Deadline()
			return commandResponse{Audience: request.Audience}, nil
		}),
	}
	app := New(options)

	requestCommand := func(body string) *http.Response {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/project-command", strings.NewReader(body))
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		request.Header.Set("X-Idempotency-Key", "123e4567-e89b-12d3-a456-426614174000")
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("application command error = %v", err)
		}
		return response
	}

	first := requestCommand(`{"audience":"operators"}`)
	if first.StatusCode != http.StatusOK {
		first.Body.Close()
		t.Fatalf("application command status = %d", first.StatusCode)
	}
	firstEnvelope := decodeEnvelope(t, first)
	first.Body.Close()
	if !strings.Contains(string(firstEnvelope.Data), `"audience":"operators"`) {
		t.Fatalf("application command data = %s", firstEnvelope.Data)
	}

	replayed := requestCommand(`{"audience":"operators"}`)
	defer replayed.Body.Close()
	if replayed.StatusCode != http.StatusOK || replayed.Header.Get("X-Idempotency-Replayed") != "true" {
		t.Fatalf("application command replay status/header = %d/%q", replayed.StatusCode, replayed.Header.Get("X-Idempotency-Replayed"))
	}
	if executions.Load() != 1 || !traceObserved || !deadlineObserved {
		t.Fatalf("application command executions/trace/deadline = %d/%t/%t", executions.Load(), traceObserved, deadlineObserved)
	}

	invalid := doJSONRequest(t, app, http.MethodPost, "/api/v1/project-command", `{"audience":"x"}`, "")
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest || executions.Load() != 1 {
		t.Fatalf("invalid application command status/executions = %d/%d", invalid.StatusCode, executions.Load())
	}

	unsupported, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/project-command", strings.NewReader(`{"audience":"operators"}`)))
	if err != nil {
		t.Fatalf("unsupported application command error = %v", err)
	}
	defer unsupported.Body.Close()
	if unsupported.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("unsupported application command status = %d", unsupported.StatusCode)
	}
}

func TestApplicationCommandsSupportExplicitMutationMethods(t *testing.T) {
	type request struct {
		Value string `json:"value" validate:"required,min=2"`
	}
	type response struct {
		Method string `json:"method"`
	}
	options := testOptions()
	// The handler must remain transport-neutral; use separate commands to prove
	// the same static path can be registered for each supported method.
	options.ApplicationCommands = []ApplicationCommand{
		NewJSONCommand("/method-command", func(context.Context, request) (response, error) {
			return response{Method: "POST"}, nil
		}),
		NewJSONCommand("/method-command", func(context.Context, request) (response, error) {
			return response{Method: "PUT"}, nil
		}).WithMethod(http.MethodPut),
		NewJSONCommand("/method-command", func(context.Context, request) (response, error) {
			return response{Method: "PATCH"}, nil
		}).WithMethod(http.MethodPatch),
		NewJSONCommand("/method-command", func(context.Context, request) (response, error) {
			return response{Method: "DELETE"}, nil
		}).WithMethod(http.MethodDelete),
	}
	app := New(options)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		response := doJSONRequest(t, app, method, "/api/v1/method-command", `{"value":"ok"}`, "")
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			t.Fatalf("%s status = %d", method, response.StatusCode)
		}
		var envelope testEnvelope
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			response.Body.Close()
			t.Fatalf("%s envelope: %v", method, err)
		}
		response.Body.Close()
		if !strings.Contains(string(envelope.Data), `"method":"`+method+`"`) {
			t.Fatalf("%s response = %s", method, envelope.Data)
		}
	}
}

func TestAuthenticatedApplicationCommandExposesMinimizedPrincipal(t *testing.T) {
	type commandResponse struct {
		Subject string `json:"subject"`
	}
	options := testOptions()
	options.ApplicationCommands = []ApplicationCommand{
		NewAuthenticatedJSONCommand("/authenticated-command", func(_ context.Context, _ struct{}, principal ApplicationPrincipal) (commandResponse, error) {
			return commandResponse{Subject: principal.Subject}, nil
		}),
	}
	app := New(options)

	missing := doJSONRequest(t, app, http.MethodPost, "/api/v1/authenticated-command", `{}`, "")
	missing.Body.Close()
	if missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("authenticated command missing token status = %d", missing.StatusCode)
	}
	assertNoStoreResponse(t, missing)
	invalid := doJSONRequest(t, app, http.MethodPost, "/api/v1/authenticated-command", `{}`, "invalid-token")
	invalid.Body.Close()
	if invalid.StatusCode != http.StatusUnauthorized {
		t.Fatalf("authenticated command invalid token status = %d", invalid.StatusCode)
	}
	assertNoStoreResponse(t, invalid)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("authenticated command test authentication failed")
	}
	rawToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue authenticated command token: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/authenticated-command", strings.NewReader(`{}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(fiber.HeaderAuthorization, "Bearer "+rawToken)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("authenticated command request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("authenticated command status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)
	if envelope := decodeEnvelope(t, response); !strings.Contains(string(envelope.Data), `"subject":"`+user.ID+`"`) {
		t.Fatalf("authenticated command response = %s", envelope.Data)
	}
}

func TestAuthorizedApplicationCommandRejectsBeforeMediaTypeIdempotencyAndBinding(t *testing.T) {
	type commandRequest struct {
		Audience string `json:"audience" validate:"required,min=2,max=80"`
	}
	type commandResponse struct {
		Subject string `json:"subject"`
	}

	options := testOptions()
	requiredRoles := []string{"operator", "demo"}
	var executions atomic.Int32
	options.ApplicationCommands = []ApplicationCommand{
		NewAuthorizedJSONCommand("/authorized-command", requiredRoles, func(_ context.Context, _ commandRequest, principal ApplicationPrincipal) (commandResponse, error) {
			executions.Add(1)
			return commandResponse{Subject: principal.Subject}, nil
		}),
	}
	requiredRoles[1] = "viewer"
	configured := options.ApplicationCommands[0]
	if !configured.authorizationRequired || len(configured.requiredRoleIDs) != 2 || configured.requiredRoleIDs[1] != "demo" {
		t.Fatalf("authorized command role copy = %#v", configured.requiredRoleIDs)
	}
	app := New(options)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("authorized command test authentication failed")
	}
	wrongRoleUser := user
	wrongRoleUser.RoleIDs = []string{"viewer"}
	wrongRoleUser.RoleNames = []string{"Viewer"}
	wrongRoleToken, _, err := options.Auth.Issue(wrongRoleUser)
	if err != nil {
		t.Fatalf("issue wrong-role command token: %v", err)
	}
	const idempotencyKey = "123e4567-e89b-12d3-a456-426614174111"
	forbiddenRequest := httptest.NewRequest(http.MethodPost, "/api/v1/authorized-command", strings.NewReader(`not-json`))
	forbiddenRequest.Header.Set(fiber.HeaderAuthorization, "Bearer "+wrongRoleToken)
	forbiddenRequest.Header.Set("X-Idempotency-Key", idempotencyKey)
	forbidden, err := app.Test(forbiddenRequest)
	if err != nil {
		t.Fatalf("wrong-role command request error = %v", err)
	}
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("wrong-role command status/executions = %d/%d", forbidden.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, forbidden)

	correctRoleToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue correct-role command token: %v", err)
	}
	requestAllowed := func() *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/authorized-command", strings.NewReader(`{"audience":"operators"}`))
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+correctRoleToken)
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		request.Header.Set("X-Idempotency-Key", idempotencyKey)
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("authorized command request error = %v", err)
		}
		return response
	}
	allowed := requestAllowed()
	allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK || executions.Load() != 1 {
		t.Fatalf("correct-role command status/executions = %d/%d", allowed.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, allowed)

	replayed := requestAllowed()
	defer replayed.Body.Close()
	if replayed.StatusCode != http.StatusOK || replayed.Header.Get("X-Idempotency-Replayed") != "true" || executions.Load() != 1 {
		t.Fatalf("authorized command replay status/header/executions = %d/%q/%d", replayed.StatusCode, replayed.Header.Get("X-Idempotency-Replayed"), executions.Load())
	}
	assertNoStoreResponse(t, replayed)
}

func TestApplicationCommandErrorsUseTheServerErrorBoundary(t *testing.T) {
	options := testOptions()
	options.ApplicationCommands = []ApplicationCommand{
		NewJSONCommand("/command-failure", func(context.Context, struct{}) (struct{}, error) {
			return struct{}{}, errors.New("private command detail")
		}),
	}
	app := New(options)
	response := doJSONRequest(t, app, http.MethodPost, "/api/v1/command-failure", `{}`, "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("application command status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)
	envelope := decodeEnvelope(t, response)
	if envelope.Msg != "internal server error" || strings.Contains(string(envelope.Data), "private command detail") {
		t.Fatalf("application command error envelope = %#v", envelope)
	}
}

func TestVersionedApplicationCommandEnforcesStrongPreconditionsAndIdempotency(t *testing.T) {
	type versionedRequest struct {
		Value string `json:"value" validate:"required,min=2,max=32"`
	}
	type versionedResponse struct {
		Value string `json:"value"`
	}

	options := testOptions()
	var executions atomic.Int32
	var version atomic.Int32
	version.Store(1)
	options.ApplicationCommands = []ApplicationCommand{
		NewVersionedJSONCommand("/versioned-command", func(_ context.Context, request versionedRequest, precondition ApplicationPrecondition) (versionedResponse, string, error) {
			executions.Add(1)
			current := version.Load()
			if precondition.EntityTag != fmt.Sprintf("v%d", current) || !version.CompareAndSwap(current, current+1) {
				return versionedResponse{}, "", ErrPreconditionFailed
			}
			return versionedResponse{Value: request.Value}, fmt.Sprintf("v%d", current+1), nil
		}).WithMethod(http.MethodPatch),
		NewVersionedJSONCommand("/invalid-versioned-response", func(_ context.Context, request versionedRequest, _ ApplicationPrecondition) (versionedResponse, string, error) {
			return versionedResponse{Value: request.Value}, "invalid tag", nil
		}).WithMethod(http.MethodPatch),
	}
	app := New(options)

	requestVersioned := func(path, entityTag, key, body string, contentType bool) *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodPatch, "/api/v1"+path, strings.NewReader(body))
		if contentType {
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		}
		if entityTag != "" {
			request.Header.Set(fiber.HeaderIfMatch, entityTag)
		}
		if key != "" {
			request.Header.Set("X-Idempotency-Key", key)
		}
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("versioned command request error = %v", err)
		}
		return response
	}

	missing := requestVersioned("/versioned-command", "", "", `not-json`, false)
	missing.Body.Close()
	if missing.StatusCode != http.StatusPreconditionRequired || executions.Load() != 0 {
		t.Fatalf("missing If-Match status/executions = %d/%d", missing.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, missing)

	if _, err := parseApplicationPrecondition(` "v1"`); !errors.Is(err, errInvalidApplicationPrecondition) {
		t.Fatalf("leading whitespace precondition error = %v", err)
	}
	for _, entityTag := range []string{`W/"v1"`, `*`, `"v1", "v2"`, `v1`, `""`, `"bad tag"`} {
		invalid := requestVersioned("/versioned-command", entityTag, "", `{"value":"first"}`, true)
		invalid.Body.Close()
		if invalid.StatusCode != http.StatusBadRequest || executions.Load() != 0 {
			t.Fatalf("invalid If-Match %q status/executions = %d/%d", entityTag, invalid.StatusCode, executions.Load())
		}
		assertNoStoreResponse(t, invalid)
	}

	unsupported := requestVersioned("/versioned-command", `"v1"`, "", `{"value":"first"}`, false)
	unsupported.Body.Close()
	if unsupported.StatusCode != http.StatusUnsupportedMediaType || executions.Load() != 0 {
		t.Fatalf("versioned media type status/executions = %d/%d", unsupported.StatusCode, executions.Load())
	}

	const firstKey = "123e4567-e89b-12d3-a456-426614174201"
	first := requestVersioned("/versioned-command", `"v1"`, firstKey, `{"value":"first"}`, true)
	if first.StatusCode != http.StatusOK || first.Header.Get(fiber.HeaderETag) != `"v2"` {
		first.Body.Close()
		t.Fatalf("first versioned response = %d/%q", first.StatusCode, first.Header.Get(fiber.HeaderETag))
	}
	if !strings.Contains(first.Header.Get(fiber.HeaderCacheControl), "no-store") || first.Header.Get(fiber.HeaderPragma) != "no-cache" {
		first.Body.Close()
		t.Fatalf("first versioned cache headers = %#v", first.Header)
	}
	first.Body.Close()

	replayed := requestVersioned("/versioned-command", `"v1"`, firstKey, `{"value":"first"}`, true)
	replayed.Body.Close()
	if replayed.StatusCode != http.StatusOK || replayed.Header.Get(fiber.HeaderETag) != `"v2"` || replayed.Header.Get("X-Idempotency-Replayed") != "true" || executions.Load() != 1 {
		t.Fatalf("versioned replay = %d/%q/%q executions %d", replayed.StatusCode, replayed.Header.Get(fiber.HeaderETag), replayed.Header.Get("X-Idempotency-Replayed"), executions.Load())
	}
	if !strings.Contains(replayed.Header.Get(fiber.HeaderCacheControl), "no-store") || replayed.Header.Get(fiber.HeaderPragma) != "no-cache" {
		t.Fatalf("versioned replay cache headers = %#v", replayed.Header)
	}

	fingerprintConflict := requestVersioned("/versioned-command", `"v2"`, firstKey, `{"value":"first"}`, true)
	fingerprintConflict.Body.Close()
	if fingerprintConflict.StatusCode != http.StatusConflict || executions.Load() != 1 {
		t.Fatalf("If-Match fingerprint conflict status/executions = %d/%d", fingerprintConflict.StatusCode, executions.Load())
	}
	assertNoStoreResponse(t, fingerprintConflict)

	stale := requestVersioned("/versioned-command", `"v1"`, "123e4567-e89b-12d3-a456-426614174202", `{"value":"stale"}`, true)
	stale.Body.Close()
	if stale.StatusCode != http.StatusPreconditionFailed || stale.Header.Get(fiber.HeaderETag) != "" || executions.Load() != 2 || version.Load() != 2 {
		t.Fatalf("stale version response = %d/%q executions/version %d/%d", stale.StatusCode, stale.Header.Get(fiber.HeaderETag), executions.Load(), version.Load())
	}
	assertNoStoreResponse(t, stale)

	next := requestVersioned("/versioned-command", `"v2"`, "123e4567-e89b-12d3-a456-426614174203", `{"value":"second"}`, true)
	next.Body.Close()
	if next.StatusCode != http.StatusOK || next.Header.Get(fiber.HeaderETag) != `"v3"` || executions.Load() != 3 || version.Load() != 3 {
		t.Fatalf("next version response = %d/%q executions/version %d/%d", next.StatusCode, next.Header.Get(fiber.HeaderETag), executions.Load(), version.Load())
	}
	if !strings.Contains(next.Header.Get(fiber.HeaderCacheControl), "no-store") || next.Header.Get(fiber.HeaderPragma) != "no-cache" {
		t.Fatalf("next version cache headers = %#v", next.Header)
	}

	invalidResponse := requestVersioned("/invalid-versioned-response", `"v1"`, "", `{"value":"first"}`, true)
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusInternalServerError || invalidResponse.Header.Get(fiber.HeaderETag) != "" {
		t.Fatalf("invalid response ETag status/header = %d/%q", invalidResponse.StatusCode, invalidResponse.Header.Get(fiber.HeaderETag))
	}
	assertNoStoreResponse(t, invalidResponse)
}

func TestAuthorizedVersionedApplicationCommandChecksAccessBeforePrecondition(t *testing.T) {
	type response struct {
		Subject string `json:"subject"`
	}
	options := testOptions()
	var executions atomic.Int32
	options.ApplicationCommands = []ApplicationCommand{
		NewAuthorizedVersionedJSONCommand("/authorized-versioned", []string{"demo"}, func(_ context.Context, _ struct{}, principal ApplicationPrincipal, precondition ApplicationPrecondition) (response, string, error) {
			executions.Add(1)
			return response{Subject: principal.Subject}, precondition.EntityTag + ".next", nil
		}).WithMethod(http.MethodPatch),
	}
	app := New(options)

	user, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("versioned command test authentication failed")
	}
	wrongRole := user
	wrongRole.RoleIDs = []string{"viewer"}
	wrongRoleToken, _, err := options.Auth.Issue(wrongRole)
	if err != nil {
		t.Fatalf("issue wrong-role token: %v", err)
	}
	request := func(token, entityTag string, contentType bool) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/authorized-versioned", strings.NewReader(`{}`))
		req.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
		if entityTag != "" {
			req.Header.Set(fiber.HeaderIfMatch, entityTag)
		}
		if contentType {
			req.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		}
		result, requestErr := app.Test(req)
		if requestErr != nil {
			t.Fatalf("authorized versioned request error = %v", requestErr)
		}
		return result
	}

	forbidden := request(wrongRoleToken, "", false)
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || executions.Load() != 0 {
		t.Fatalf("forbidden versioned status/executions = %d/%d", forbidden.StatusCode, executions.Load())
	}

	validToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue valid token: %v", err)
	}
	missing := request(validToken, "", false)
	missing.Body.Close()
	if missing.StatusCode != http.StatusPreconditionRequired || executions.Load() != 0 {
		t.Fatalf("authorized missing precondition status/executions = %d/%d", missing.StatusCode, executions.Load())
	}
	unsupported := request(validToken, `"v1"`, false)
	unsupported.Body.Close()
	if unsupported.StatusCode != http.StatusUnsupportedMediaType || executions.Load() != 0 {
		t.Fatalf("authorized media type status/executions = %d/%d", unsupported.StatusCode, executions.Load())
	}
	allowed := request(validToken, `"v1"`, true)
	defer allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK || allowed.Header.Get(fiber.HeaderETag) != `"v1.next"` || executions.Load() != 1 {
		t.Fatalf("authorized versioned response = %d/%q executions %d", allowed.StatusCode, allowed.Header.Get(fiber.HeaderETag), executions.Load())
	}
	if !strings.Contains(allowed.Header.Get(fiber.HeaderCacheControl), "no-store") || allowed.Header.Get(fiber.HeaderPragma) != "no-cache" {
		t.Fatalf("authorized versioned cache headers = %#v", allowed.Header)
	}
	if envelope := decodeEnvelope(t, allowed); !strings.Contains(string(envelope.Data), `"subject":"`+user.ID+`"`) {
		t.Fatalf("authorized versioned data = %s", envelope.Data)
	}
}

func TestApplicationCommandsRejectAmbiguousDefinitions(t *testing.T) {
	handler := func(context.Context, struct{}) (struct{}, error) { return struct{}{}, nil }
	authenticatedHandler := func(context.Context, struct{}, ApplicationPrincipal) (struct{}, error) { return struct{}{}, nil }
	versionedHandler := func(context.Context, struct{}, ApplicationPrecondition) (struct{}, string, error) {
		return struct{}{}, "v1", nil
	}
	authenticatedVersionedHandler := func(context.Context, struct{}, ApplicationPrincipal, ApplicationPrecondition) (struct{}, string, error) {
		return struct{}{}, "v1", nil
	}
	command := func(path string) ApplicationCommand { return NewJSONCommand(path, handler) }
	tooManyRoles := make([]string, maxApplicationRequiredRoles+1)
	for index := range tooManyRoles {
		tooManyRoles[index] = fmt.Sprintf("role-%d", index)
	}
	tests := []struct {
		name        string
		commands    []ApplicationCommand
		registrar   RouteRegistrar
		disableAuth bool
	}{
		{name: "empty path", commands: []ApplicationCommand{command("")}},
		{name: "relative path", commands: []ApplicationCommand{command("relative")}},
		{name: "whitespace in path", commands: []ApplicationCommand{command("/project command")}},
		{name: "control character in path", commands: []ApplicationCommand{command("/project\x00command")}},
		{name: "backslash in path", commands: []ApplicationCommand{command("/project\\command")}},
		{name: "query in path", commands: []ApplicationCommand{command("/items?all=true")}},
		{name: "parameter path", commands: []ApplicationCommand{command("/items/:id")}},
		{name: "wildcard path", commands: []ApplicationCommand{command("/items/*")}},
		{name: "encoded path", commands: []ApplicationCommand{command("/items/%2e%2e")}},
		{name: "repeated separator", commands: []ApplicationCommand{command("/items//all")}},
		{name: "relative segment", commands: []ApplicationCommand{command("/items/../all")}},
		{name: "trailing separator", commands: []ApplicationCommand{command("/items/")}},
		{name: "nil handler", commands: []ApplicationCommand{{Path: "/items"}}},
		{name: "duplicate path", commands: []ApplicationCommand{command("/items"), command("/items")}},
		{name: "case insensitive duplicate", commands: []ApplicationCommand{command("/items"), command("/ITEMS")}},
		{name: "default route collision", commands: []ApplicationCommand{command("/example/echo")}},
		{name: "case insensitive default route collision", commands: []ApplicationCommand{command("/EXAMPLE/ECHO")}},
		{name: "enabled auth route collision", commands: []ApplicationCommand{command("/auth/login")}},
		{name: "mixed registration modes", commands: []ApplicationCommand{command("/items")}, registrar: func(fiber.Router) {}},
		{name: "authenticated command requires auth", commands: []ApplicationCommand{NewAuthenticatedJSONCommand("/items", authenticatedHandler)}, disableAuth: true},
		{name: "authorized command requires auth", commands: []ApplicationCommand{NewAuthorizedJSONCommand("/items", []string{"demo"}, authenticatedHandler)}, disableAuth: true},
		{name: "authenticated versioned command requires auth", commands: []ApplicationCommand{NewAuthenticatedVersionedJSONCommand("/items", authenticatedVersionedHandler)}, disableAuth: true},
		{name: "authorized versioned command requires auth", commands: []ApplicationCommand{NewAuthorizedVersionedJSONCommand("/items", []string{"demo"}, authenticatedVersionedHandler)}, disableAuth: true},
		{name: "authorized versioned command requires a role", commands: []ApplicationCommand{NewAuthorizedVersionedJSONCommand("/items", nil, authenticatedVersionedHandler)}},
		{name: "versioned command rejects unsupported method", commands: []ApplicationCommand{NewVersionedJSONCommand("/items", versionedHandler).WithMethod(http.MethodOptions)}},
		{name: "authorized command requires a role", commands: []ApplicationCommand{NewAuthorizedJSONCommand("/items", nil, authenticatedHandler)}},
		{name: "authorized command rejects duplicate roles", commands: []ApplicationCommand{NewAuthorizedJSONCommand("/items", []string{"demo", "demo"}, authenticatedHandler)}},
		{name: "authorized command rejects malformed roles", commands: []ApplicationCommand{NewAuthorizedJSONCommand("/items", []string{"admin role"}, authenticatedHandler)}},
		{name: "authorized command rejects excessive roles", commands: []ApplicationCommand{NewAuthorizedJSONCommand("/items", tooManyRoles, authenticatedHandler)}},
		{name: "command rejects unsupported method", commands: []ApplicationCommand{NewJSONCommand("/items", handler).WithMethod(http.MethodOptions)}},
		{name: "command rejects whitespace method", commands: []ApplicationCommand{NewJSONCommand("/items", handler).WithMethod(" PUT")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered == nil {
					t.Fatal("New() did not reject ambiguous application command configuration")
				}
			}()
			options := testOptions()
			if test.disableAuth {
				options.Auth = auth.NewService(auth.Config{})
			}
			options.ApplicationCommands = test.commands
			options.RegisterRoutes = test.registrar
			_ = New(options)
		})
	}
}

func TestApplicationQueriesRejectAmbiguousDefinitions(t *testing.T) {
	handler := func(context.Context) (any, error) { return nil, nil }
	tests := []struct {
		name      string
		queries   []ApplicationQuery
		registrar RouteRegistrar
	}{
		{name: "empty path", queries: []ApplicationQuery{{Handler: handler}}},
		{name: "relative path", queries: []ApplicationQuery{{Path: "relative", Handler: handler}}},
		{name: "whitespace in path", queries: []ApplicationQuery{{Path: "/project query", Handler: handler}}},
		{name: "control character in path", queries: []ApplicationQuery{{Path: "/project\x00query", Handler: handler}}},
		{name: "backslash in path", queries: []ApplicationQuery{{Path: "/project\\query", Handler: handler}}},
		{name: "query in path", queries: []ApplicationQuery{{Path: "/items?all=true", Handler: handler}}},
		{name: "parameter path", queries: []ApplicationQuery{{Path: "/items/:id", Handler: handler}}},
		{name: "wildcard path", queries: []ApplicationQuery{{Path: "/items/*", Handler: handler}}},
		{name: "encoded path", queries: []ApplicationQuery{{Path: "/items/%2e%2e", Handler: handler}}},
		{name: "repeated separator", queries: []ApplicationQuery{{Path: "/items//all", Handler: handler}}},
		{name: "relative segment", queries: []ApplicationQuery{{Path: "/items/../all", Handler: handler}}},
		{name: "trailing separator", queries: []ApplicationQuery{{Path: "/items/", Handler: handler}}},
		{name: "nil handler", queries: []ApplicationQuery{{Path: "/items"}}},
		{name: "duplicate path", queries: []ApplicationQuery{{Path: "/items", Handler: handler}, {Path: "/items", Handler: handler}}},
		{name: "case insensitive duplicate", queries: []ApplicationQuery{{Path: "/items", Handler: handler}, {Path: "/ITEMS", Handler: handler}}},
		{name: "default route collision", queries: []ApplicationQuery{{Path: "/example/hello", Handler: handler}}},
		{name: "case insensitive default route collision", queries: []ApplicationQuery{{Path: "/EXAMPLE/HELLO", Handler: handler}}},
		{name: "enabled auth route collision", queries: []ApplicationQuery{{Path: "/auth/me", Handler: handler}}},
		{name: "unsupported method", queries: []ApplicationQuery{(ApplicationQuery{Path: "/items", Handler: handler}).WithMethod(http.MethodOptions)}},
		{name: "whitespace method", queries: []ApplicationQuery{(ApplicationQuery{Path: "/items", Handler: handler}).WithMethod(" HEAD ")}},
		{name: "mixed registration modes", queries: []ApplicationQuery{{Path: "/items", Handler: handler}}, registrar: func(fiber.Router) {}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered == nil {
					t.Fatal("New() did not reject ambiguous application query configuration")
				}
			}()
			options := testOptions()
			options.ApplicationQueries = test.queries
			options.RegisterRoutes = test.registrar
			_ = New(options)
		})
	}
}

func TestTypedApplicationQueriesRejectUnsafeBindingsAndOverlappingRoutes(t *testing.T) {
	type itemByID struct {
		ID string `uri:"id"`
	}
	type itemBySlug struct {
		Slug string `uri:"slug"`
	}
	handleID := func(context.Context, itemByID) (struct{}, error) { return struct{}{}, nil }
	handleSlug := func(context.Context, itemBySlug) (struct{}, error) { return struct{}{}, nil }
	authorizedHandler := func(context.Context, struct{}, ApplicationPrincipal) (struct{}, error) { return struct{}{}, nil }
	authenticatedVersionedHandler := func(context.Context, struct{}, ApplicationPrincipal) (struct{}, string, error) {
		return struct{}{}, "v1", nil
	}
	tooManyRoles := make([]string, maxApplicationRequiredRoles+1)
	for index := range tooManyRoles {
		tooManyRoles[index] = fmt.Sprintf("role-%d", index)
	}
	tests := []struct {
		name        string
		queries     []ApplicationQuery
		disableAuth bool
	}{
		{
			name: "request must be a struct",
			queries: []ApplicationQuery{NewQuery("/typed", func(context.Context, string) (struct{}, error) {
				return struct{}{}, nil
			})},
		},
		{
			name: "missing explicit source",
			queries: []ApplicationQuery{NewQuery("/typed", func(context.Context, struct{ Value string }) (struct{}, error) {
				return struct{}{}, nil
			})},
		},
		{
			name: "multiple explicit sources",
			queries: []ApplicationQuery{NewQuery("/typed/:value", func(context.Context, struct {
				Value string `uri:"value" query:"value"`
			}) (struct{}, error) {
				return struct{}{}, nil
			})},
		},
		{
			name:    "URI binding missing from path",
			queries: []ApplicationQuery{NewQuery("/typed", handleID)},
		},
		{
			name:    "path parameter missing from request",
			queries: []ApplicationQuery{NewQuery("/typed/:id", func(context.Context, struct{}) (struct{}, error) { return struct{}{}, nil })},
		},
		{
			name:    "dynamic routes overlap",
			queries: []ApplicationQuery{NewQuery("/items/:id", handleID), NewQuery("/items/:slug", handleSlug)},
		},
		{
			name:    "dynamic and static routes overlap",
			queries: []ApplicationQuery{NewQuery("/items/:id", handleID), NewQuery("/items/all", func(context.Context, struct{}) (struct{}, error) { return struct{}{}, nil })},
		},
		{
			name:    "dynamic route overlaps Framework route",
			queries: []ApplicationQuery{NewQuery("/example/:id", handleID)},
		},
		{
			name: "authenticated query requires auth",
			queries: []ApplicationQuery{NewAuthenticatedQuery("/typed", func(context.Context, struct{}, ApplicationPrincipal) (struct{}, error) {
				return struct{}{}, nil
			})},
			disableAuth: true,
		},
		{
			name:        "authorized query requires auth",
			queries:     []ApplicationQuery{NewAuthorizedQuery("/typed", []string{"demo"}, authorizedHandler)},
			disableAuth: true,
		},
		{
			name:        "authenticated versioned query requires auth",
			queries:     []ApplicationQuery{NewAuthenticatedVersionedQuery("/typed", authenticatedVersionedHandler)},
			disableAuth: true,
		},
		{
			name:        "authorized versioned query requires auth",
			queries:     []ApplicationQuery{NewAuthorizedVersionedQuery("/typed", []string{"demo"}, authenticatedVersionedHandler)},
			disableAuth: true,
		},
		{
			name:    "authorized versioned query requires a role",
			queries: []ApplicationQuery{NewAuthorizedVersionedQuery("/typed", nil, authenticatedVersionedHandler)},
		},
		{
			name:    "authorized query requires a role",
			queries: []ApplicationQuery{NewAuthorizedQuery("/typed", nil, authorizedHandler)},
		},
		{
			name:    "authorized query rejects duplicate roles",
			queries: []ApplicationQuery{NewAuthorizedQuery("/typed", []string{"demo", "demo"}, authorizedHandler)},
		},
		{
			name:    "authorized query rejects malformed roles",
			queries: []ApplicationQuery{NewAuthorizedQuery("/typed", []string{"admin role"}, authorizedHandler)},
		},
		{
			name:    "authorized query rejects excessive roles",
			queries: []ApplicationQuery{NewAuthorizedQuery("/typed", tooManyRoles, authorizedHandler)},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered == nil {
					t.Fatal("New() did not reject unsafe typed query configuration")
				}
			}()
			options := testOptions()
			if test.disableAuth {
				options.Auth = auth.NewService(auth.Config{})
			}
			options.ApplicationQueries = test.queries
			_ = New(options)
		})
	}
}

func TestEchoAndValidation(t *testing.T) {
	app := newTestApp()
	echoResponse := doJSONRequest(t, app, http.MethodPost, "/api/v1/example/echo", `{"answer":42}`, "")
	defer echoResponse.Body.Close()
	echoEnvelope := decodeEnvelope(t, echoResponse)
	var echoData map[string]any
	if err := json.Unmarshal(echoEnvelope.Data, &echoData); err != nil {
		t.Fatalf("decode echo data: %v", err)
	}
	if echoData["answer"] != float64(42) {
		t.Fatalf("echo data = %#v", echoData)
	}

	invalidResponse := doJSONRequest(t, app, http.MethodPost, "/api/v1/example/validate", `{"name":"A","email":"invalid","age":12}`, "")
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("validation status = %d", invalidResponse.StatusCode)
	}
	if envelope := decodeEnvelope(t, invalidResponse); envelope.Code != http.StatusBadRequest {
		t.Fatalf("validation code = %d", envelope.Code)
	}

	validResponse := doJSONRequest(t, app, http.MethodPost, "/api/v1/example/validate", `{"name":"Ada","email":"ada@example.com","age":36}`, "")
	defer validResponse.Body.Close()
	if validResponse.StatusCode != http.StatusOK {
		t.Fatalf("valid status = %d", validResponse.StatusCode)
	}
}

func TestErrorResponsesAreNotCacheable(t *testing.T) {
	options := testOptions()
	options.MetricsToken = "metrics-test-token"
	options.PprofEnabled = true
	options.PprofToken = "pprof-test-token"
	app := New(options)

	tests := []struct {
		name        string
		method      string
		path        string
		body        string
		contentType string
		headers     map[string]string
		wantStatus  int
	}{
		{name: "API not found", method: http.MethodGet, path: "/api/v1/missing", wantStatus: http.StatusNotFound},
		{name: "unsupported media type", method: http.MethodPost, path: "/api/v1/example/echo", body: `{"answer":42}`, wantStatus: http.StatusUnsupportedMediaType},
		{name: "validation", method: http.MethodPost, path: "/api/v1/example/validate", body: `{"name":"A","email":"invalid","age":12}`, contentType: fiber.MIMEApplicationJSON, wantStatus: http.StatusBadRequest},
		{name: "invalid idempotency key", method: http.MethodPost, path: "/api/v1/example/echo", body: `{"answer":42}`, contentType: fiber.MIMEApplicationJSON, headers: map[string]string{"X-Idempotency-Key": "short"}, wantStatus: http.StatusBadRequest},
		{name: "missing access token", method: http.MethodGet, path: "/api/v1/example/private", wantStatus: http.StatusUnauthorized},
		{name: "metrics authentication", method: http.MethodGet, path: "/metrics", wantStatus: http.StatusUnauthorized},
		{name: "pprof authentication", method: http.MethodGet, path: "/debug/pprof/", wantStatus: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			request.Header.Set(fiber.HeaderAcceptEncoding, "gzip")
			if test.contentType != "" {
				request.Header.Set(fiber.HeaderContentType, test.contentType)
			}
			for name, value := range test.headers {
				request.Header.Set(name, value)
			}
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.wantStatus)
			}
			assertNoStoreResponse(t, response)
		})
	}
}

func TestJWTAuthenticationFlow(t *testing.T) {
	app := newTestApp()
	unauthorized := doJSONRequest(t, app, http.MethodGet, "/api/v1/auth/me", "", "")
	defer unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.StatusCode)
	}
	assertBearerChallenge(t, unauthorized, `Bearer realm="goexample"`)
	assertNoStoreResponse(t, unauthorized)

	invalid := doJSONRequest(t, app, http.MethodGet, "/api/v1/auth/me", "", "not-a-valid-token")
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d", invalid.StatusCode)
	}
	assertBearerChallenge(t, invalid, `Bearer realm="goexample", error="invalid_token"`)
	assertNoStoreResponse(t, invalid)

	loginRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"demo","password":"demo123"}`))
	loginRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	loginRequest.Header.Set(fiber.HeaderAcceptEncoding, "gzip")
	login, err := app.Test(loginRequest)
	if err != nil {
		t.Fatalf("login request error = %v", err)
	}
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", login.StatusCode)
	}
	assertNoStoreResponse(t, login)
	loginEnvelope := decodeEnvelope(t, login)
	var loginData struct {
		AccessToken string `json:"accessToken"`
		ExpiresIn   int    `json:"expiresIn"`
	}
	if err := json.Unmarshal(loginEnvelope.Data, &loginData); err != nil {
		t.Fatalf("decode login data: %v", err)
	}
	if loginData.AccessToken == "" || loginData.ExpiresIn != 3600 {
		t.Fatalf("login data = %#v", loginData)
	}

	me := doJSONRequest(t, app, http.MethodGet, "/api/v1/auth/me", "", loginData.AccessToken)
	defer me.Body.Close()
	if me.StatusCode != http.StatusOK {
		t.Fatalf("me status = %d", me.StatusCode)
	}
	assertNoStoreResponse(t, me)
	meEnvelope := decodeEnvelope(t, me)
	var user auth.User
	if err := json.Unmarshal(meEnvelope.Data, &user); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if user.Username != "demo" {
		t.Fatalf("user = %#v", user)
	}
}

func TestSecurityAuditEventsAreCorrelatedBoundedAndCredentialSafe(t *testing.T) {
	var output bytes.Buffer
	options := testOptions()
	options.AuthRateLimitMax = 2
	options.MetricsToken = "metrics-audit-secret"
	options.PprofEnabled = true
	options.PprofToken = "pprof-audit-secret"
	options.Logger = observability.NewLogger("json", "info", &output)
	options.ApplicationQueries = []ApplicationQuery{
		NewAuthorizedQuery("/audited-query", []string{"demo"}, func(context.Context, struct{}, ApplicationPrincipal) (struct{}, error) {
			return struct{}{}, nil
		}),
	}
	options.ApplicationCommands = []ApplicationCommand{
		NewAuthorizedJSONCommand("/audited-command", []string{"demo"}, func(context.Context, struct{}, ApplicationPrincipal) (struct{}, error) {
			return struct{}{}, nil
		}),
	}
	app := New(options)
	deniedUser, authenticated := options.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		t.Fatal("audit test authentication failed")
	}
	deniedUser.RoleIDs = []string{"audit-denied-role"}
	deniedUser.RoleNames = []string{"Audit Denied Role"}
	deniedToken, _, err := options.Auth.Issue(deniedUser)
	if err != nil {
		t.Fatalf("issue denied audit token: %v", err)
	}

	requestIndex := 0
	doRequest := func(method, path, body string, headers map[string]string, wantStatus int) {
		t.Helper()
		requestIndex++
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set(fiber.HeaderXRequestID, fmt.Sprintf("audit-request-%d", requestIndex))
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("%s %s request error = %v", method, path, err)
		}
		response.Body.Close()
		if response.StatusCode != wantStatus {
			t.Fatalf("%s %s status = %d, want %d", method, path, response.StatusCode, wantStatus)
		}
	}

	jsonHeaders := map[string]string{fiber.HeaderContentType: fiber.MIMEApplicationJSON}
	doRequest(http.MethodPost, "/api/v1/auth/login", `{"username":"audit-attacker","password":"login-audit-secret"}`, jsonHeaders, http.StatusUnauthorized)
	doRequest(http.MethodPost, "/api/v1/auth/login", `{"username":"demo","password":"demo123"}`, jsonHeaders, http.StatusOK)
	doRequest(http.MethodPost, "/api/v1/auth/login", `{"username":"audit-attacker","password":"login-audit-secret"}`, jsonHeaders, http.StatusTooManyRequests)
	doRequest(http.MethodGet, "/api/v1/auth/me", "", nil, http.StatusUnauthorized)
	doRequest(http.MethodGet, "/api/v1/auth/me", "", map[string]string{fiber.HeaderAuthorization: "Bearer bearer-audit-secret"}, http.StatusUnauthorized)
	doRequest(http.MethodGet, "/metrics", "", map[string]string{fiber.HeaderAuthorization: "Bearer wrong-metrics-audit-secret"}, http.StatusUnauthorized)
	doRequest(http.MethodGet, "/metrics", "", map[string]string{fiber.HeaderAuthorization: "Bearer " + options.MetricsToken}, http.StatusOK)
	doRequest(http.MethodGet, "/debug/pprof/", "", map[string]string{fiber.HeaderAuthorization: "Bearer wrong-pprof-audit-secret"}, http.StatusUnauthorized)
	doRequest(http.MethodGet, "/debug/pprof/", "", map[string]string{fiber.HeaderAuthorization: "Bearer " + options.PprofToken}, http.StatusOK)
	doRequest(http.MethodGet, "/api/v1/audited-query", "", map[string]string{fiber.HeaderAuthorization: "Bearer " + deniedToken}, http.StatusForbidden)
	doRequest(http.MethodPost, "/api/v1/audited-command", "", map[string]string{fiber.HeaderAuthorization: "Bearer " + deniedToken}, http.StatusForbidden)

	logs := output.String()
	for _, sensitive := range []string{
		"audit-attacker",
		"login-audit-secret",
		"demo123",
		"bearer-audit-secret",
		"metrics-audit-secret",
		"pprof-audit-secret",
		"audit-denied-role",
		"Audit Denied Role",
	} {
		if strings.Contains(logs, sensitive) {
			t.Fatalf("security logs contain sensitive value %q: %s", sensitive, logs)
		}
	}

	type expectedAudit struct {
		event   string
		outcome string
		reason  string
		target  string
	}
	expected := []expectedAudit{
		{event: "login", outcome: "failure", reason: "invalid_credentials", target: "demo_auth"},
		{event: "login", outcome: "success", reason: "credentials_valid", target: "demo_auth"},
		{event: "login", outcome: "limited", reason: "rate_limited", target: "demo_auth"},
		{event: "bearer", outcome: "failure", reason: "token_missing", target: "api"},
		{event: "bearer", outcome: "failure", reason: "token_invalid", target: "api"},
		{event: "diagnostics", outcome: "failure", reason: "token_invalid", target: "metrics"},
		{event: "diagnostics", outcome: "success", reason: "token_valid", target: "metrics"},
		{event: "diagnostics", outcome: "failure", reason: "token_invalid", target: "pprof"},
		{event: "diagnostics", outcome: "success", reason: "token_valid", target: "pprof"},
		{event: "authorization", outcome: "failure", reason: "role_required", target: "application_query"},
		{event: "authorization", outcome: "failure", reason: "role_required", target: "application_command"},
	}
	matched := make([]bool, len(expected))
	auditCount := 0
	loginActorCount := 0
	for _, line := range strings.Split(strings.TrimSpace(logs), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil || record["msg"] != "security_audit" {
			continue
		}
		auditCount++
		for _, field := range []string{"request_id", "trace_id", "span_id"} {
			if value, ok := record[field].(string); !ok || value == "" {
				t.Fatalf("security audit field %q = %#v; record=%#v", field, record[field], record)
			}
		}
		for _, forbidden := range []string{"username", "password", "token", "authorization", "body", "error", "path", "client_ip", "subject", "role", "claims", "email", "display_name"} {
			if _, exists := record[forbidden]; exists {
				t.Fatalf("security audit contains forbidden field %q: %#v", forbidden, record)
			}
		}
		if record["actor_id"] == "fiber-demo-user" {
			loginActorCount++
		}
		for index, want := range expected {
			if record["event"] == want.event && record["outcome"] == want.outcome &&
				record["reason"] == want.reason && record["target"] == want.target {
				matched[index] = true
			}
		}
	}
	if auditCount != len(expected) {
		t.Fatalf("security audit count = %d, want %d; logs=%s", auditCount, len(expected), logs)
	}
	for index, found := range matched {
		if !found {
			t.Fatalf("security audit event missing: %#v; logs=%s", expected[index], logs)
		}
	}
	if loginActorCount != 1 {
		t.Fatalf("successful login actor audit count = %d, want 1; logs=%s", loginActorCount, logs)
	}

	metrics := options.Metrics.Render()
	for _, want := range []string{
		`goexample_security_events_total{event="login",outcome="success"} 1`,
		`goexample_security_events_total{event="login",outcome="failure"} 1`,
		`goexample_security_events_total{event="login",outcome="limited"} 1`,
		`goexample_security_events_total{event="bearer",outcome="failure"} 2`,
		`goexample_security_events_total{event="diagnostics",outcome="success"} 2`,
		`goexample_security_events_total{event="diagnostics",outcome="failure"} 2`,
		`goexample_security_events_total{event="authorization",outcome="failure"} 2`,
	} {
		if !strings.Contains(metrics, want) {
			t.Fatalf("security event metric %q missing: %s", want, metrics)
		}
	}
}

func TestRateLimit(t *testing.T) {
	options := testOptions()
	options.RateLimitMax = 1
	app := New(options)

	first, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("first request error = %v", err)
	}
	first.Body.Close()
	second, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
	if err != nil {
		t.Fatalf("second request error = %v", err)
	}
	defer second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second status = %d", second.StatusCode)
	}
	assertNoStoreResponse(t, second)
	if second.Header.Get("X-RateLimit-Limit") == "" {
		t.Fatal("rate limit header is empty")
	}
}

func TestAuthenticationRateLimitHeaders(t *testing.T) {
	options := testOptions()
	options.AuthRateLimitMax = 1
	app := New(options)

	first := doJSONRequest(t, app, http.MethodPost, "/api/v1/auth/login", `{"username":"demo","password":"wrong-password"}`, "")
	first.Body.Close()
	if first.StatusCode != http.StatusUnauthorized {
		t.Fatalf("first status = %d", first.StatusCode)
	}
	assertNoStoreResponse(t, first)

	second := doJSONRequest(t, app, http.MethodPost, "/api/v1/auth/login", `{"username":"demo","password":"wrong-password"}`, "")
	defer second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second status = %d", second.StatusCode)
	}
	assertNoStoreResponse(t, second)
	if value := second.Header.Get("X-RateLimit-Limit"); value != "1" {
		t.Fatalf("X-RateLimit-Limit = %q", value)
	}
	if value := second.Header.Get("X-RateLimit-Remaining"); value != "0" {
		t.Fatalf("X-RateLimit-Remaining = %q", value)
	}
	if second.Header.Get("X-RateLimit-Reset") == "" || second.Header.Get(fiber.HeaderRetryAfter) == "" {
		t.Fatal("rate limit reset headers are empty")
	}
}

func TestRequestTimeout(t *testing.T) {
	options := testOptions()
	options.RequestTimeout = 10 * time.Millisecond
	app := New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/delay?ms=100", http.NoBody))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestTimeout {
		t.Fatalf("status = %d", response.StatusCode)
	}
	assertNoStoreResponse(t, response)
}

func TestReadinessReflectsChecksAndDraining(t *testing.T) {
	checker := health.New(10 * time.Millisecond)
	if err := checker.Register("database", func(context.Context) error {
		return errors.New("database unavailable")
	}); err != nil {
		t.Fatalf("register check: %v", err)
	}
	options := testOptions()
	options.Health = checker
	app := New(options)

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/readyz", http.NoBody))
	if err != nil {
		t.Fatalf("readiness request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("readiness status = %d", response.StatusCode)
	}
	envelope := decodeEnvelope(t, response)
	var data struct {
		Status string            `json:"status"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if data.Status != "not_ready" || data.Checks["database"] != "failed" {
		t.Fatalf("readiness data = %#v", data)
	}

	checker.SetDraining(true)
	draining, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/health/ready", http.NoBody))
	if err != nil {
		t.Fatalf("draining request error = %v", err)
	}
	defer draining.Body.Close()
	if draining.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("draining status = %d", draining.StatusCode)
	}
}

func TestIdempotencyReplaysSameRequestAndRejectsFingerprintConflict(t *testing.T) {
	app := newTestApp()
	const key = "12345678-1234-1234-1234-123456789012"

	firstRequest := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":1}`))
	firstRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	firstRequest.Header.Set(fiber.HeaderXRequestID, "first-request-id")
	firstRequest.Header.Set("X-Idempotency-Key", key)
	first, err := app.Test(firstRequest)
	if err != nil {
		t.Fatalf("first request error = %v", err)
	}
	first.Body.Close()
	if first.Header.Get("X-Idempotency-Replayed") != "" {
		t.Fatalf("first replay header = %q", first.Header.Get("X-Idempotency-Replayed"))
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":1}`))
	secondRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	secondRequest.Header.Set(fiber.HeaderXRequestID, "second-request-id")
	secondRequest.Header.Set("X-Idempotency-Key", key)
	second, err := app.Test(secondRequest)
	if err != nil {
		t.Fatalf("second request error = %v", err)
	}
	defer second.Body.Close()
	if second.Header.Get("X-Idempotency-Replayed") != "true" {
		t.Fatalf("second replay header = %q", second.Header.Get("X-Idempotency-Replayed"))
	}
	if second.Header.Get(fiber.HeaderXRequestID) != "second-request-id" {
		t.Fatalf("second request ID = %q", second.Header.Get(fiber.HeaderXRequestID))
	}
	envelope := decodeEnvelope(t, second)
	var data map[string]any
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode replay: %v", err)
	}
	if data["answer"] != float64(1) {
		t.Fatalf("replayed data = %#v", data)
	}

	conflictingRequest := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":2}`))
	conflictingRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	conflictingRequest.Header.Set("X-Idempotency-Key", key)
	conflict, err := app.Test(conflictingRequest)
	if err != nil {
		t.Fatalf("conflicting request error = %v", err)
	}
	defer conflict.Body.Close()
	if conflict.StatusCode != http.StatusConflict {
		t.Fatalf("conflicting status = %d, want %d", conflict.StatusCode, http.StatusConflict)
	}
	if conflict.Header.Get("X-Idempotency-Replayed") != "" {
		t.Fatalf("conflicting replay header = %q", conflict.Header.Get("X-Idempotency-Replayed"))
	}
	assertNoStoreResponse(t, conflict)
	if envelope := decodeEnvelope(t, conflict); !strings.Contains(envelope.Msg, "different request") {
		t.Fatalf("conflicting message = %q", envelope.Msg)
	}

	otherRoute := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/example/validate",
		strings.NewReader(`{"name":"Ada","email":"ada@example.com","age":36}`),
	)
	otherRoute.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	otherRoute.Header.Set("X-Idempotency-Key", key)
	otherResponse, err := app.Test(otherRoute)
	if err != nil {
		t.Fatalf("other route request error = %v", err)
	}
	defer otherResponse.Body.Close()
	if otherResponse.StatusCode != http.StatusOK || otherResponse.Header.Get("X-Idempotency-Replayed") != "" {
		t.Fatalf("other route status/header = %d/%q", otherResponse.StatusCode, otherResponse.Header.Get("X-Idempotency-Replayed"))
	}
}

func TestIdempotencyConcurrentFingerprintConflictExecutesOneRequest(t *testing.T) {
	options := testOptions()
	var executions atomic.Int32
	options.RegisterRoutes = func(v1 fiber.Router) {
		v1.Post("/idempotent", requireJSON, idempotencyMiddleware(
			"/idempotent",
			options.IdempotencyLifetime,
			options.SharedStorage,
			options.IdempotencyLock,
		), func(c fiber.Ctx) error {
			executions.Add(1)
			return success(c, fiber.Map{"accepted": true})
		})
	}
	app := New(options)
	const key = "12345678-1234-1234-1234-123456789012"

	start := make(chan struct{})
	statuses := make(chan int, 2)
	var requests sync.WaitGroup
	for _, body := range []string{`{"operation":"first"}`, `{"operation":"second"}`} {
		requests.Add(1)
		go func() {
			defer requests.Done()
			<-start
			request := httptest.NewRequest(http.MethodPost, "/api/v1/idempotent", strings.NewReader(body))
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			request.Header.Set("X-Idempotency-Key", key)
			response, err := app.Test(request)
			if err != nil {
				statuses <- 0
				return
			}
			response.Body.Close()
			statuses <- response.StatusCode
		}()
	}
	close(start)
	requests.Wait()
	close(statuses)

	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent statuses = %#v", counts)
	}
	if got := executions.Load(); got != 1 {
		t.Fatalf("handler executions = %d, want 1", got)
	}
}

func TestIdempotencyRejectsInvalidKeyAndSkipsLogin(t *testing.T) {
	app := newTestApp()
	invalid := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":1}`))
	invalid.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	invalid.Header.Set("X-Idempotency-Key", "short")
	invalidResponse, err := app.Test(invalid)
	if err != nil {
		t.Fatalf("invalid key request error = %v", err)
	}
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid key status = %d", invalidResponse.StatusCode)
	}

	const key = "12345678-1234-1234-1234-123456789012"
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"demo","password":"demo123"}`))
	loginRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	loginRequest.Header.Set("X-Idempotency-Key", key)
	loginResponse, err := app.Test(loginRequest)
	if err != nil {
		t.Fatalf("login request error = %v", err)
	}
	defer loginResponse.Body.Close()
	if loginResponse.StatusCode != http.StatusOK || loginResponse.Header.Get("X-Idempotency-Replayed") != "" {
		t.Fatalf("login status/header = %d/%q", loginResponse.StatusCode, loginResponse.Header.Get("X-Idempotency-Replayed"))
	}
}

func TestEarlyDataRejectsUnsafeRequest(t *testing.T) {
	app := newTestApp()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":1}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set("Early-Data", "1")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("early data request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTooEarly {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestProtectedMetricsAndPprof(t *testing.T) {
	options := testOptions()
	options.MetricsToken = "metrics-test-token"
	options.PprofEnabled = true
	options.PprofToken = "pprof-test-token"
	app := New(options)

	metricsRequest := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	metricsRequest.Header.Set(fiber.HeaderAcceptEncoding, "gzip")
	metrics, err := app.Test(metricsRequest)
	if err != nil {
		t.Fatalf("metrics request error = %v", err)
	}
	metrics.Body.Close()
	if metrics.StatusCode != http.StatusUnauthorized {
		t.Fatalf("metrics status = %d", metrics.StatusCode)
	}
	assertBearerChallenge(t, metrics, `Bearer realm="metrics"`)

	authorizedMetrics := httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody)
	authorizedMetrics.Header.Set(fiber.HeaderAuthorization, "Bearer "+options.MetricsToken)
	metrics, err = app.Test(authorizedMetrics)
	if err != nil {
		t.Fatalf("authorized metrics request error = %v", err)
	}
	metrics.Body.Close()
	if metrics.StatusCode != http.StatusOK {
		t.Fatalf("authorized metrics status = %d", metrics.StatusCode)
	}

	profile, err := app.Test(httptest.NewRequest(http.MethodGet, "/debug/pprof/", http.NoBody))
	if err != nil {
		t.Fatalf("pprof request error = %v", err)
	}
	profile.Body.Close()
	if profile.StatusCode != http.StatusUnauthorized {
		t.Fatalf("pprof status = %d", profile.StatusCode)
	}
	assertBearerChallenge(t, profile, `Bearer realm="pprof"`)

	authorizedProfile := httptest.NewRequest(http.MethodGet, "/debug/pprof/", http.NoBody)
	authorizedProfile.Header.Set(fiber.HeaderAuthorization, "Bearer "+options.PprofToken)
	profile, err = app.Test(authorizedProfile)
	if err != nil {
		t.Fatalf("authorized pprof request error = %v", err)
	}
	profile.Body.Close()
	if profile.StatusCode != http.StatusOK {
		t.Fatalf("authorized pprof status = %d", profile.StatusCode)
	}
}

func TestMetricsAndNotFoundEnvelope(t *testing.T) {
	app := newTestApp()
	health, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/health", http.NoBody))
	if err != nil {
		t.Fatalf("health request error = %v", err)
	}
	health.Body.Close()

	metrics, err := app.Test(httptest.NewRequest(http.MethodGet, "/metrics", http.NoBody))
	if err != nil {
		t.Fatalf("metrics request error = %v", err)
	}
	content, err := io.ReadAll(metrics.Body)
	metrics.Body.Close()
	if err != nil {
		t.Fatalf("read metrics: %v", err)
	}
	if !strings.Contains(string(content), `route="/api/health"`) {
		t.Fatalf("metrics = %s", content)
	}
	if metrics.Header.Get(fiber.HeaderCacheControl) != "no-store" || metrics.Header.Get(fiber.HeaderETag) != "" || metrics.Header.Get(fiber.HeaderContentEncoding) != "" {
		t.Fatalf("metrics infrastructure headers = %#v", metrics.Header)
	}

	notFound, err := app.Test(httptest.NewRequest(http.MethodGet, "/missing", http.NoBody))
	if err != nil {
		t.Fatalf("not found request error = %v", err)
	}
	defer notFound.Body.Close()
	if notFound.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d", notFound.StatusCode)
	}
	if envelope := decodeEnvelope(t, notFound); envelope.Code != http.StatusNotFound {
		t.Fatalf("code = %d", envelope.Code)
	}
	assertNoStoreResponse(t, notFound)
}

func TestBodyLimitUsesEnvelope(t *testing.T) {
	options := testOptions()
	options.BodyLimit = 32
	app := New(options)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	serveErrors := make(chan error, 1)
	go func() {
		serveErrors <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true})
	}()
	t.Cleanup(func() {
		if err := app.Shutdown(); err != nil {
			t.Errorf("shutdown: %v", err)
		}
		if err := <-serveErrors; err != nil && !errors.Is(err, net.ErrClosed) {
			t.Errorf("serve: %v", err)
		}
	})

	request, err := http.NewRequest(
		http.MethodPost,
		"http://"+listener.Addr().String()+"/api/v1/example/echo",
		strings.NewReader(`{"value":"this request body is intentionally larger than thirty-two bytes"}`),
	)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if envelope := decodeEnvelope(t, response); envelope.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("code = %d", envelope.Code)
	}
	assertNoStoreResponse(t, response)
}

func doJSONRequest(t *testing.T, app *fiber.App, method, path, body, accessToken string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	if accessToken != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+accessToken)
	}
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	return response
}

func decodeEnvelope(t *testing.T, response *http.Response) testEnvelope {
	t.Helper()
	var envelope testEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return envelope
}
