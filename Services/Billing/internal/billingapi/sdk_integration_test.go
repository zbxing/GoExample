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

func TestGeneratedBillingSDKInvokesEveryPublicOperationThroughFrameworkHandler(t *testing.T) {
	app := httpapi.New(httpapi.Options{
		Name:        "Billing SDK operation integration",
		Environment: "test",
		Version:     billing.APIVersion,
		Health:      health.New(100*time.Millisecond, time.Millisecond),
		ApplicationQueries: Queries(billingapp.NewService(
			"Billing SDK operation integration",
			"test",
			billing.APIVersion,
			nil,
		)),
	})
	handler, err := httpapi.NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	client, err := billing.NewClient(server.URL, billing.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	name := "Billing SDK"
	age := 42
	delay := 1
	operations := make(map[string]billing.Operation, len(billing.PublishedOperations()))
	for _, operation := range billing.PublishedOperations() {
		operations[operation.OperationID] = operation
	}
	tests := []struct {
		operationID string
		invoke      func() (*billing.Response, error)
	}{
		{operationID: "getServiceInfo", invoke: func() (*billing.Response, error) { return client.GetServiceInfo(context.Background()) }},
		{operationID: "getMetrics", invoke: func() (*billing.Response, error) { return client.GetMetrics(context.Background()) }},
		{operationID: "getLegacyHealth", invoke: func() (*billing.Response, error) { return client.GetLegacyHealth(context.Background()) }},
		{operationID: "getLegacyReadiness", invoke: func() (*billing.Response, error) { return client.GetLegacyReadiness(context.Background()) }},
		{operationID: "getLegacyStartup", invoke: func() (*billing.Response, error) { return client.GetLegacyStartup(context.Background()) }},
		{operationID: "getSystemInfo", invoke: func() (*billing.Response, error) { return client.GetSystemInfo(context.Background()) }},
		{operationID: "getLiveness", invoke: func() (*billing.Response, error) { return client.GetLiveness(context.Background()) }},
		{operationID: "getReadiness", invoke: func() (*billing.Response, error) { return client.GetReadiness(context.Background()) }},
		{operationID: "getStartup", invoke: func() (*billing.Response, error) { return client.GetStartup(context.Background()) }},
		{operationID: "getExampleHello", invoke: func() (*billing.Response, error) {
			return client.GetExampleHello(context.Background(), billing.GetExampleHelloParams{Name: &name})
		}},
		{operationID: "postExampleEcho", invoke: func() (*billing.Response, error) {
			return client.PostExampleEcho(context.Background(), billing.EchoRequest{"invoice": "42"})
		}},
		{operationID: "postExampleValidate", invoke: func() (*billing.Response, error) {
			return client.PostExampleValidate(context.Background(), billing.ProfileRequest{Name: "Ada", Email: "ada@example.com", Age: &age})
		}},
		{operationID: "getExampleDelay", invoke: func() (*billing.Response, error) {
			return client.GetExampleDelay(context.Background(), billing.GetExampleDelayParams{Ms: &delay})
		}},
		{operationID: "getBillingSummary", invoke: func() (*billing.Response, error) { return client.GetBillingSummary(context.Background()) }},
	}
	if len(tests) != len(operations) {
		t.Fatalf("test invocations = %d, published operations = %d", len(tests), len(operations))
	}

	seen := make(map[string]struct{}, len(tests))
	for _, test := range tests {
		test := test
		t.Run(test.operationID, func(t *testing.T) {
			if _, exists := operations[test.operationID]; !exists {
				t.Fatalf("published operation %q is missing", test.operationID)
			}
			if _, duplicate := seen[test.operationID]; duplicate {
				t.Fatalf("duplicate invocation for %q", test.operationID)
			}
			seen[test.operationID] = struct{}{}

			response, err := test.invoke()
			if err != nil {
				t.Fatalf("%s() error = %v", test.operationID, err)
			}
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.StatusCode, response.Body)
			}
			if test.operationID == "getMetrics" {
				return
			}
			envelope, err := response.DecodeEnvelope()
			if err != nil {
				t.Fatalf("DecodeEnvelope() error = %v", err)
			}
			if envelope.Code != 0 {
				t.Fatalf("envelope = %#v", envelope)
			}
			switch test.operationID {
			case "getLegacyHealth", "getLegacyReadiness", "getLegacyStartup":
				if response.Header.Get("Deprecation") == "" || response.Header.Get("Link") == "" {
					t.Fatalf("deprecated response headers = %#v", response.Header)
				}
			case "getExampleHello":
				if envelope.Data["message"] != "Hello, Billing SDK!" {
					t.Fatalf("hello data = %#v", envelope.Data)
				}
			case "postExampleEcho":
				if envelope.Data["invoice"] != "42" {
					t.Fatalf("echo data = %#v", envelope.Data)
				}
			case "postExampleValidate":
				if envelope.Data["name"] != "Ada" || envelope.Data["email"] != "ada@example.com" || envelope.Data["age"] != float64(age) {
					t.Fatalf("validate data = %#v", envelope.Data)
				}
			case "getExampleDelay":
				if envelope.Data["delayedMs"] != float64(delay) {
					t.Fatalf("delay data = %#v", envelope.Data)
				}
			}
		})
	}
}
