package billingapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapp"
)

func TestSummaryUsesFrameworkStandardHandler(t *testing.T) {
	app := httpapi.New(httpapi.Options{
		Name:               "billing",
		Environment:        "test",
		Health:             health.New(100, 1),
		ApplicationQueries: Queries(billingapp.NewService("billing", "test", "1.0.0", nil)),
	})
	handler, err := httpapi.NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/billing/summary", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("Content-Type = %q", got)
	}
}
