package httpapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
)

func TestApplicationEventStreamUsesStandardApplicationContextAndResumeID(t *testing.T) {
	type contextKey struct{}
	observed := make(chan struct {
		value       string
		lastEventID string
		hasDeadline bool
	}, 1)
	options := testOptions()
	options.ApplicationQueries = []ApplicationQuery{
		NewQuery[struct{}, string]("/stream-status", func(context.Context, struct{}) (string, error) {
			return "ready", nil
		}),
	}
	options.ApplicationEventStreams = []ApplicationEventStream{
		NewEventStream("/events", func(ctx context.Context, lastEventID string) (<-chan ServerSentEvent, error) {
			_, hasDeadline := ctx.Deadline()
			observed <- struct {
				value       string
				lastEventID string
				hasDeadline bool
			}{ctx.Value(contextKey{}).(string), lastEventID, hasDeadline}
			events := make(chan ServerSentEvent, 1)
			events <- ServerSentEvent{ID: "43", Event: "project.updated", Data: "ready"}
			close(events)
			return events, nil
		}, ServerSentEventOptions{}),
	}

	application, err := NewHTTPApplication(options)
	if err != nil {
		t.Fatalf("NewHTTPApplication() error = %v", err)
	}
	t.Cleanup(func() {
		shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := application.Shutdown(shutdownContext); err != nil {
			t.Errorf("Shutdown() error = %v", err)
		}
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/events", http.NoBody)
	request.Header.Set(serverSentEventLastEventIDHeader, "42")
	request = request.WithContext(context.WithValue(request.Context(), contextKey{}, "preserved"))
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("Content-Type = %q", contentType)
	}
	if body := response.Body.String(); body != "id: 43\nevent: project.updated\ndata: ready\n\n" {
		t.Fatalf("event stream body = %q", body)
	}
	got := <-observed
	if got.value != "preserved" || got.lastEventID != "42" || !got.hasDeadline {
		t.Fatalf("source context = %#v", got)
	}

	queryRequest := httptest.NewRequest(http.MethodGet, "/api/v1/stream-status", http.NoBody)
	queryResponse := httptest.NewRecorder()
	application.ServeHTTP(queryResponse, queryRequest)
	if queryResponse.Code != http.StatusOK || !strings.Contains(queryResponse.Body.String(), `"data":"ready"`) {
		t.Fatalf("coexisting query response = %d %q", queryResponse.Code, queryResponse.Body.String())
	}
}

func TestApplicationEventStreamsEnforceAuthenticationAndCopiedRoles(t *testing.T) {
	options := testOptions()
	var sourceCalls int
	source := func(context.Context, string) (<-chan ServerSentEvent, error) {
		sourceCalls++
		events := make(chan ServerSentEvent)
		close(events)
		return events, nil
	}
	requiredRoles := []string{"operator", "demo"}
	options.ApplicationEventStreams = []ApplicationEventStream{
		NewAuthenticatedEventStream("/authenticated-events", source, ServerSentEventOptions{}),
		NewAuthorizedEventStream("/authorized-events", requiredRoles, source, ServerSentEventOptions{}),
	}
	requiredRoles[1] = "viewer"
	if got := options.ApplicationEventStreams[1].requiredRoleIDs; len(got) != 2 || got[1] != "demo" {
		t.Fatalf("authorized stream role copy = %#v", got)
	}
	app := New(options)

	request := func(routePath, token string) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, routePath, http.NoBody)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := app.Test(req)
		if err != nil {
			t.Fatalf("event stream request error = %v", err)
		}
		return response
	}

	missing := request("/api/v1/authenticated-events", "")
	missing.Body.Close()
	if missing.StatusCode != http.StatusUnauthorized || sourceCalls != 0 {
		t.Fatalf("missing token status/source calls = %d/%d", missing.StatusCode, sourceCalls)
	}

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
	forbidden := request("/api/v1/authorized-events", wrongRoleToken)
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden || sourceCalls != 0 {
		t.Fatalf("wrong role status/source calls = %d/%d", forbidden.StatusCode, sourceCalls)
	}

	correctRoleToken, _, err := options.Auth.Issue(user)
	if err != nil {
		t.Fatalf("issue correct-role token: %v", err)
	}
	for _, routePath := range []string{"/api/v1/authenticated-events", "/api/v1/authorized-events"} {
		allowed := request(routePath, correctRoleToken)
		_, readErr := io.Copy(io.Discard, allowed.Body)
		allowed.Body.Close()
		if readErr != nil || allowed.StatusCode != http.StatusOK {
			t.Fatalf("allowed stream %q = status %d, error %v", routePath, allowed.StatusCode, readErr)
		}
	}
	if sourceCalls != 2 {
		t.Fatalf("source calls = %d, want 2", sourceCalls)
	}
}

func TestApplicationEventStreamsRejectAmbiguousDefinitionsAtStartup(t *testing.T) {
	validSource := func(context.Context, string) (<-chan ServerSentEvent, error) {
		events := make(chan ServerSentEvent)
		close(events)
		return events, nil
	}
	queryHandler := func(context.Context) (any, error) { return nil, nil }
	events := make(chan ServerSentEvent)
	close(events)
	tooManyRoles := make([]string, maxApplicationRequiredRoles+1)
	for index := range tooManyRoles {
		tooManyRoles[index] = fmt.Sprintf("role-%d", index)
	}
	tests := []struct {
		name        string
		streams     []ApplicationEventStream
		queries     []ApplicationQuery
		registrar   RouteRegistrar
		disableAuth bool
	}{
		{name: "empty path", streams: []ApplicationEventStream{NewEventStream("", validSource, ServerSentEventOptions{})}},
		{name: "relative path", streams: []ApplicationEventStream{NewEventStream("events", validSource, ServerSentEventOptions{})}},
		{name: "parameter path", streams: []ApplicationEventStream{NewEventStream("/events/:id", validSource, ServerSentEventOptions{})}},
		{name: "wildcard path", streams: []ApplicationEventStream{NewEventStream("/events/*", validSource, ServerSentEventOptions{})}},
		{name: "encoded path", streams: []ApplicationEventStream{NewEventStream("/events/%2e%2e", validSource, ServerSentEventOptions{})}},
		{name: "trailing separator", streams: []ApplicationEventStream{NewEventStream("/events/", validSource, ServerSentEventOptions{})}},
		{name: "nil source", streams: []ApplicationEventStream{NewEventStream("/events", nil, ServerSentEventOptions{})}},
		{name: "static channel", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{Events: events})}},
		{name: "heartbeat below bound", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{HeartbeatInterval: time.Millisecond})}},
		{name: "byte limit above bound", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{MaxEventBytes: maximumServerSentEventBytes + 1})}},
		{name: "timeout above bound", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{StreamTimeout: maximumServerSentEventStreamTimeout + time.Nanosecond})}},
		{name: "duplicate path", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{}), NewEventStream("/EVENTS", validSource, ServerSentEventOptions{})}},
		{name: "default route collision", streams: []ApplicationEventStream{NewEventStream("/example/hello", validSource, ServerSentEventOptions{})}},
		{name: "query GET collision", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{})}, queries: []ApplicationQuery{{Path: "/events", Handler: queryHandler}}},
		{name: "query HEAD collision", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{})}, queries: []ApplicationQuery{(ApplicationQuery{Path: "/events", Handler: queryHandler}).WithMethod(http.MethodHead)}},
		{name: "dynamic query collision", streams: []ApplicationEventStream{NewEventStream("/events/current", validSource, ServerSentEventOptions{})}, queries: []ApplicationQuery{NewQuery("/events/:id", func(context.Context, struct {
			ID string `uri:"id"`
		}) (struct{}, error) {
			return struct{}{}, nil
		})}},
		{name: "mixed registration modes", streams: []ApplicationEventStream{NewEventStream("/events", validSource, ServerSentEventOptions{})}, registrar: func(fiber.Router) {}},
		{name: "authenticated stream requires auth", streams: []ApplicationEventStream{NewAuthenticatedEventStream("/events", validSource, ServerSentEventOptions{})}, disableAuth: true},
		{name: "authorized stream requires a role", streams: []ApplicationEventStream{NewAuthorizedEventStream("/events", nil, validSource, ServerSentEventOptions{})}},
		{name: "authorized stream rejects duplicate roles", streams: []ApplicationEventStream{NewAuthorizedEventStream("/events", []string{"demo", "demo"}, validSource, ServerSentEventOptions{})}},
		{name: "authorized stream rejects malformed roles", streams: []ApplicationEventStream{NewAuthorizedEventStream("/events", []string{"admin role"}, validSource, ServerSentEventOptions{})}},
		{name: "authorized stream rejects excessive roles", streams: []ApplicationEventStream{NewAuthorizedEventStream("/events", tooManyRoles, validSource, ServerSentEventOptions{})}},
		{name: "authorization requires authentication", streams: []ApplicationEventStream{{Path: "/events", source: validSource, authorizationRequired: true, requiredRoleIDs: []string{"demo"}}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered == nil {
					t.Fatal("New() did not reject ambiguous application event stream configuration")
				}
			}()
			options := testOptions()
			if test.disableAuth {
				options.Auth = auth.NewService(auth.Config{})
			}
			options.ApplicationEventStreams = test.streams
			options.ApplicationQueries = test.queries
			options.RegisterRoutes = test.registrar
			_ = New(options)
		})
	}
}
