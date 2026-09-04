package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func TestApplicationRouteUsesTransportNeutralRequestAndResponse(t *testing.T) {
	options := testOptions()
	options.ApplicationRoutes = []ApplicationRoute{{
		Method: http.MethodPost,
		Path:   "/custom",
		Handler: func(ctx context.Context, request ApplicationRouteRequest) (ApplicationRouteResponse, error) {
			if ctx == nil || request.Method != http.MethodPost || request.Path != "/api/v1/custom" {
				return ApplicationRouteResponse{}, errors.New("request boundary was not preserved")
			}
			if got := request.Query["tag"]; len(got) != 2 || got[0] != "one" || got[1] != "two" {
				return ApplicationRouteResponse{}, errors.New("query values were not preserved")
			}
			if request.Headers.Get("X-Custom") != "value" || string(request.Body) != "payload" {
				return ApplicationRouteResponse{}, errors.New("request snapshot was not copied")
			}
			return ApplicationRouteResponse{
				StatusCode: http.StatusCreated,
				Headers:    http.Header{"X-Route": {"custom"}},
				Body:       []byte("created"),
			}, nil
		},
	}}
	application, err := NewHTTPApplication(options)
	if err != nil {
		t.Fatalf("NewHTTPApplication() error = %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = application.Shutdown(ctx)
	})

	request := httptest.NewRequest(http.MethodPost, "/api/v1/custom?tag=one&tag=two", strings.NewReader("payload"))
	request.Header.Set("X-Custom", "value")
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || response.Header().Get("X-Route") != "custom" || response.Body.String() != "created" {
		t.Fatalf("custom route response = %d/%q/%q", response.Code, response.Header().Get("X-Route"), response.Body.String())
	}
}

func TestApplicationRouteSupportsTransportNeutralSSE(t *testing.T) {
	options := testOptions()
	options.ApplicationRoutes = []ApplicationRoute{{
		Path: "/custom-events",
		Stream: func(ctx context.Context, lastEventID string) (<-chan ServerSentEvent, error) {
			if ctx == nil || lastEventID != "41" {
				return nil, errors.New("stream request boundary was not preserved")
			}
			events := make(chan ServerSentEvent, 1)
			events <- ServerSentEvent{ID: "42", Event: "ready", Data: "ok"}
			close(events)
			return events, nil
		},
		StreamOptions: ServerSentEventOptions{},
	}}
	application, err := NewHTTPApplication(options)
	if err != nil {
		t.Fatalf("NewHTTPApplication() error = %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = application.Shutdown(ctx)
	})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/custom-events", http.NoBody)
	request.Header.Set("Last-Event-ID", "41")
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != fiber.MIMETextEventStream || response.Body.String() != "id: 42\nevent: ready\ndata: ok\n\n" {
		t.Fatalf("custom SSE response = %d/%q/%q", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
}

func TestApplicationRouteResponseValidationUsesErrorBoundary(t *testing.T) {
	options := testOptions()
	options.ApplicationRoutes = []ApplicationRoute{{
		Path: "/invalid-response",
		Handler: func(context.Context, ApplicationRouteRequest) (ApplicationRouteResponse, error) {
			return ApplicationRouteResponse{StatusCode: http.StatusNoContent, Body: []byte("not allowed")}, nil
		},
	}}
	app := New(options)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/invalid-response", http.NoBody))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusInternalServerError || !strings.Contains(string(body), "internal server error") {
		t.Fatalf("invalid response boundary = %d/%q", response.StatusCode, string(body))
	}
}

func TestApplicationRoutesRejectAmbiguousDefinitionsAtStartup(t *testing.T) {
	validHandler := func(context.Context, ApplicationRouteRequest) (ApplicationRouteResponse, error) {
		return ApplicationRouteResponse{}, nil
	}
	tests := []struct {
		name   string
		routes []ApplicationRoute
	}{
		{name: "relative path", routes: []ApplicationRoute{{Path: "custom", Handler: validHandler}}},
		{name: "parameter path", routes: []ApplicationRoute{{Path: "/custom/:id", Handler: validHandler}}},
		{name: "duplicate path", routes: []ApplicationRoute{{Path: "/custom", Handler: validHandler}, {Path: "/CUSTOM", Handler: validHandler}}},
		{name: "both handlers", routes: []ApplicationRoute{{Path: "/custom", Handler: validHandler, Stream: func(context.Context, string) (<-chan ServerSentEvent, error) { return nil, nil }}}},
		{name: "no handler", routes: []ApplicationRoute{{Path: "/custom"}}},
		{name: "default route collision", routes: []ApplicationRoute{{Path: "/example/hello", Handler: validHandler}}},
		{name: "stream requires GET", routes: []ApplicationRoute{{Method: http.MethodPost, Path: "/custom", Stream: func(context.Context, string) (<-chan ServerSentEvent, error) { return nil, nil }}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("New() did not reject invalid application route")
				}
			}()
			options := testOptions()
			options.ApplicationRoutes = test.routes
			_ = New(options)
		})
	}
}
