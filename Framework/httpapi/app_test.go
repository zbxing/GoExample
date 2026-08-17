package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
		t.Fatalf("health Cache-Control = %q", response.Header.Get(fiber.HeaderCacheControl))
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
	if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
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

func TestJWTAuthenticationFlow(t *testing.T) {
	app := newTestApp()
	unauthorized := doJSONRequest(t, app, http.MethodGet, "/api/v1/auth/me", "", "")
	defer unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.StatusCode)
	}

	login := doJSONRequest(t, app, http.MethodPost, "/api/v1/auth/login", `{"username":"demo","password":"demo123"}`, "")
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", login.StatusCode)
	}
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
	meEnvelope := decodeEnvelope(t, me)
	var user auth.User
	if err := json.Unmarshal(meEnvelope.Data, &user); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if user.Username != "demo" {
		t.Fatalf("user = %#v", user)
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

	second := doJSONRequest(t, app, http.MethodPost, "/api/v1/auth/login", `{"username":"demo","password":"wrong-password"}`, "")
	defer second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second status = %d", second.StatusCode)
	}
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

func TestIdempotencyReplaysSuccessfulMutation(t *testing.T) {
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

	secondRequest := httptest.NewRequest(http.MethodPost, "/api/v1/example/echo", strings.NewReader(`{"answer":2}`))
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
