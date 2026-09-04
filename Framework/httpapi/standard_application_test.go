package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPApplicationImplementsStandardServingAndShutdown(t *testing.T) {
	type contextKey struct{}
	observed := make(chan string, 1)
	options := testOptions()
	options.ApplicationQueries = []ApplicationQuery{
		NewQuery[struct{}, string]("/standard-application", func(ctx context.Context, _ struct{}) (string, error) {
			observed <- ctx.Value(contextKey{}).(string)
			return "standard", nil
		}),
	}

	application, err := NewHTTPApplication(options)
	if err != nil {
		t.Fatalf("NewHTTPApplication() error = %v", err)
	}
	var handler http.Handler = application
	request := httptest.NewRequest(http.MethodGet, "/api/v1/standard-application", http.NoBody)
	request = request.WithContext(context.WithValue(request.Context(), contextKey{}, "preserved"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if value := <-observed; value != "preserved" {
		t.Fatalf("application context value = %q, want preserved", value)
	}
	body, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatalf("ReadAll() error = %v", err)
	}
	if !strings.Contains(string(body), `"data":"standard"`) {
		t.Fatalf("response body = %q", body)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := application.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
}

func TestHTTPApplicationRejectsUnavailableLifecycle(t *testing.T) {
	var application *HTTPApplication
	response := httptest.NewRecorder()
	application.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", http.NoBody))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("zero application status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if err := application.Shutdown(context.Background()); err == nil {
		t.Fatal("zero application Shutdown() error = nil")
	}

	application, err := NewHTTPApplication(testOptions())
	if err != nil {
		t.Fatalf("NewHTTPApplication() error = %v", err)
	}
	if err := application.Shutdown(nil); err == nil {
		t.Fatal("Shutdown(nil) error = nil")
	}
	if err := application.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() cleanup error = %v", err)
	}
}
