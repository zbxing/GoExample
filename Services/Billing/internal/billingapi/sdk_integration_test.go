package billingapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	billing "github.com/zbxing/goexample/SDK/Billing"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapp"
)

func TestGeneratedBillingSDKReadsSummaryFromIndependentFrameworkService(t *testing.T) {
	generatedAt := time.Date(2026, time.August, 26, 10, 0, 0, 0, time.UTC)
	app := httpapi.New(httpapi.Options{
		Name:        "Billing SDK integration",
		Environment: "test",
		Version:     billing.APIVersion,
		Health:      health.New(100*time.Millisecond, time.Millisecond),
		ApplicationQueries: Queries(billingapp.NewService(
			"Billing SDK integration",
			"test",
			billing.APIVersion,
			func() time.Time { return generatedAt },
		)),
	})
	handler, err := httpapi.NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}

	requestHeaders := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestHeaders <- request.Header.Get("X-Consumer-Version")
		handler.ServeHTTP(writer, request)
	}))
	defer server.Close()

	client, err := billing.NewClient(
		server.URL,
		billing.WithHTTPClient(server.Client()),
		billing.WithRequestEditor(func(_ context.Context, request *http.Request) error {
			request.Header.Set("X-Consumer-Version", billing.APIVersion)
			return nil
		}),
	)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	response, err := client.GetBillingSummary(context.Background())
	if err != nil {
		t.Fatalf("GetBillingSummary() error = %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, response.Body)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type = %q", contentType)
	}
	if observed := <-requestHeaders; observed != billing.APIVersion {
		t.Fatalf("X-Consumer-Version = %q, want %q", observed, billing.APIVersion)
	}

	envelope, err := response.DecodeEnvelope()
	if err != nil {
		t.Fatalf("DecodeEnvelope() error = %v", err)
	}
	if envelope.Code != 0 || envelope.Msg != "success" {
		t.Fatalf("envelope = %#v", envelope)
	}
	for field, want := range map[string]string{
		"service":     "Billing SDK integration",
		"environment": "test",
		"version":     billing.APIVersion,
		"status":      "billing-ready",
		"generatedAt": generatedAt.Format(time.RFC3339),
	} {
		if got := envelope.Data[field]; got != want {
			t.Fatalf("data.%s = %#v, want %q", field, got, want)
		}
	}
}
