package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestGeneratedClientCoversBillingOperations(t *testing.T) {
	if APIVersion != "1.0.0" {
		t.Fatalf("APIVersion = %q, want 1.0.0", APIVersion)
	}
	operations := PublishedOperations()
	if len(operations) != 14 {
		t.Fatalf("generated operations = %d, want 14", len(operations))
	}
	operationIDs := make(map[string]struct{}, len(operations))
	for _, operation := range operations {
		operationIDs[operation.OperationID] = struct{}{}
	}
	for _, operationID := range []string{"getReadiness", "getLegacyReadiness", "getBillingSummary"} {
		if _, exists := operationIDs[operationID]; !exists {
			t.Fatalf("generated operations missing %q", operationID)
		}
	}
	operations[0].Path = "/mutated-by-caller"
	if PublishedOperations()[0].Path == operations[0].Path {
		t.Fatal("PublishedOperations exposed mutable package state")
	}
}

func TestGeneratedClientCallsBillingSummaryThroughGatewayPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.EscapedPath() != "/gateway/api/v1/billing/summary" {
			t.Errorf("request = %s %s", request.Method, request.URL.EscapedPath())
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept = %q", request.Header.Get("Accept"))
		}
		if request.Header.Get("X-Consumer-Version") != "1.0.0" {
			t.Errorf("X-Consumer-Version = %q", request.Header.Get("X-Consumer-Version"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"data":{"status":"billing-ready"},"msg":"ok"}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/gateway", WithRequestEditor(func(_ context.Context, request *http.Request) error {
		request.Header.Set("X-Consumer-Version", APIVersion)
		return nil
	}))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	response, err := client.GetBillingSummary(context.Background())
	if err != nil {
		t.Fatalf("GetBillingSummary() error = %v", err)
	}
	envelope, err := response.DecodeEnvelope()
	if err != nil {
		t.Fatalf("DecodeEnvelope() error = %v", err)
	}
	if envelope.Data["status"] != "billing-ready" {
		t.Fatalf("data.status = %#v, want billing-ready", envelope.Data["status"])
	}
}

func TestGeneratedClientMapsEveryPublishedOperation(t *testing.T) {
	name := "Billing SDK"
	age := 42
	delay := 25
	operations := make(map[string]Operation, len(PublishedOperations()))
	for _, operation := range PublishedOperations() {
		operations[operation.OperationID] = operation
	}

	tests := []struct {
		operationID string
		query       string
		body        map[string]any
		invoke      func(*Client) (*Response, error)
	}{
		{operationID: "getServiceInfo", invoke: func(client *Client) (*Response, error) { return client.GetServiceInfo(context.Background()) }},
		{operationID: "getMetrics", invoke: func(client *Client) (*Response, error) { return client.GetMetrics(context.Background()) }},
		{operationID: "getLegacyHealth", invoke: func(client *Client) (*Response, error) { return client.GetLegacyHealth(context.Background()) }},
		{operationID: "getLegacyReadiness", invoke: func(client *Client) (*Response, error) { return client.GetLegacyReadiness(context.Background()) }},
		{operationID: "getLegacyStartup", invoke: func(client *Client) (*Response, error) { return client.GetLegacyStartup(context.Background()) }},
		{operationID: "getSystemInfo", invoke: func(client *Client) (*Response, error) { return client.GetSystemInfo(context.Background()) }},
		{operationID: "getLiveness", invoke: func(client *Client) (*Response, error) { return client.GetLiveness(context.Background()) }},
		{operationID: "getReadiness", invoke: func(client *Client) (*Response, error) { return client.GetReadiness(context.Background()) }},
		{operationID: "getStartup", invoke: func(client *Client) (*Response, error) { return client.GetStartup(context.Background()) }},
		{
			operationID: "getExampleHello",
			query:       "name=Billing+SDK",
			invoke: func(client *Client) (*Response, error) {
				return client.GetExampleHello(context.Background(), GetExampleHelloParams{Name: &name})
			},
		},
		{
			operationID: "postExampleEcho",
			body:        map[string]any{"invoice": "42"},
			invoke: func(client *Client) (*Response, error) {
				return client.PostExampleEcho(context.Background(), EchoRequest{"invoice": "42"})
			},
		},
		{
			operationID: "postExampleValidate",
			body:        map[string]any{"name": "Ada", "email": "ada@example.com", "age": float64(age)},
			invoke: func(client *Client) (*Response, error) {
				return client.PostExampleValidate(context.Background(), ProfileRequest{Name: "Ada", Email: "ada@example.com", Age: &age})
			},
		},
		{
			operationID: "getExampleDelay",
			query:       "ms=25",
			invoke: func(client *Client) (*Response, error) {
				return client.GetExampleDelay(context.Background(), GetExampleDelayParams{Ms: &delay})
			},
		},
		{operationID: "getBillingSummary", invoke: func(client *Client) (*Response, error) { return client.GetBillingSummary(context.Background()) }},
	}

	if len(tests) != len(operations) {
		t.Fatalf("test invocations = %d, published operations = %d", len(tests), len(operations))
	}
	seen := make(map[string]struct{}, len(tests))
	for _, test := range tests {
		test := test
		t.Run(test.operationID, func(t *testing.T) {
			operation, exists := operations[test.operationID]
			if !exists {
				t.Fatalf("published operation %q is missing", test.operationID)
			}
			if _, duplicate := seen[test.operationID]; duplicate {
				t.Fatalf("duplicate invocation for %q", test.operationID)
			}
			seen[test.operationID] = struct{}{}

			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != operation.Method || request.URL.EscapedPath() != "/gateway"+operation.Path {
					t.Errorf("request = %s %s, want %s /gateway%s", request.Method, request.URL.EscapedPath(), operation.Method, operation.Path)
				}
				if request.URL.RawQuery != test.query {
					t.Errorf("query = %q, want %q", request.URL.RawQuery, test.query)
				}
				if request.Header.Get("Accept") != "application/json" {
					t.Errorf("Accept = %q", request.Header.Get("Accept"))
				}
				if request.Header.Get("X-SDK-Operation-Test") != test.operationID {
					t.Errorf("X-SDK-Operation-Test = %q, want %q", request.Header.Get("X-SDK-Operation-Test"), test.operationID)
				}
				if test.body != nil {
					if contentType := request.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
						t.Errorf("Content-Type = %q", contentType)
					}
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Errorf("decode request body: %v", err)
					} else if !reflect.DeepEqual(body, test.body) {
						t.Errorf("body = %#v, want %#v", body, test.body)
					}
				}
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{"code":0,"data":{},"msg":"ok"}`))
			}))
			defer server.Close()

			client, err := NewClient(server.URL+"/gateway", WithRequestEditor(func(_ context.Context, request *http.Request) error {
				request.Header.Set("X-SDK-Operation-Test", test.operationID)
				return nil
			}))
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			response, err := test.invoke(client)
			if err != nil {
				t.Fatalf("%s() error = %v", test.operationID, err)
			}
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
			}
		})
	}
}

func TestGeneratedClientRejectsUnsafeServerAndOversizedResponse(t *testing.T) {
	for _, serverURL := range []string{"", "ftp://example.com", "https://user:secret@example.com", "https://example.com?q=secret"} {
		if _, err := NewClient(serverURL); err == nil {
			t.Fatalf("NewClient(%q) error = nil", serverURL)
		}
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(strings.Repeat("x", 9)))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, WithMaxResponseBytes(8))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.GetReadiness(context.Background()); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("GetReadiness() error = %v, want ErrResponseTooLarge", err)
	}
}

func TestGeneratedClientDefaultHTTPClientPreservesRedirectResponse(t *testing.T) {
	var redirectTargetCalls atomic.Int32
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		redirectTargetCalls.Add(1)
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("redirect target"))
	}))
	defer redirectTarget.Close()

	const responseBody = "redirect response"
	const stateCookie = "__Host-goexample_oidc_state=opaque; Path=/; Secure; HttpOnly; SameSite=Lax"
	redirectSource := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Location", redirectTarget.URL+"/authorize")
		writer.Header().Set("Set-Cookie", stateCookie)
		writer.WriteHeader(http.StatusFound)
		_, _ = writer.Write([]byte(responseBody))
	}))
	defer redirectSource.Close()

	client, err := NewClient(redirectSource.URL)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	response, err := client.GetReadiness(context.Background())
	if err != nil {
		t.Fatalf("GetReadiness() error = %v", err)
	}
	if response.StatusCode != http.StatusFound {
		t.Errorf("status = %d, want %d", response.StatusCode, http.StatusFound)
	}
	if location := response.Header.Get("Location"); location != redirectTarget.URL+"/authorize" {
		t.Errorf("Location = %q, want redirect target", location)
	}
	if cookie := response.Header.Get("Set-Cookie"); cookie != stateCookie {
		t.Errorf("Set-Cookie = %q, want state cookie", cookie)
	}
	if body := string(response.Body); body != responseBody {
		t.Errorf("body = %q, want %q", body, responseBody)
	}
	if calls := redirectTargetCalls.Load(); calls != 0 {
		t.Errorf("redirect target calls = %d, want 0", calls)
	}
}

func TestGeneratedClientDefaultHTTPClientHasBoundedTransport(t *testing.T) {
	client, err := NewClient("https://example.com")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	defaultClient, ok := client.httpClient.(*http.Client)
	if !ok {
		t.Fatalf("default HTTP client type = %T, want *http.Client", client.httpClient)
	}
	if defaultClient != defaultSDKHTTPClient {
		t.Fatal("NewClient() did not select the package default HTTP client")
	}
	if timeout := defaultClient.Timeout; timeout != 30*time.Second {
		t.Errorf("default HTTP client timeout = %s, want 30s", timeout)
	}
	transport, ok := defaultClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("default HTTP transport type = %T, want *http.Transport", defaultClient.Transport)
	}
	if transport == http.DefaultTransport {
		t.Fatal("default HTTP transport aliases the process-wide transport")
	}
	if !transport.ForceAttemptHTTP2 {
		t.Error("default HTTP transport does not attempt HTTP/2")
	}
	if transport.MaxConnsPerHost != 100 || transport.MaxIdleConns != 100 || transport.MaxIdleConnsPerHost != 10 {
		t.Errorf(
			"default HTTP connection limits = per-host:%d idle:%d idle-per-host:%d, want 100/100/10",
			transport.MaxConnsPerHost,
			transport.MaxIdleConns,
			transport.MaxIdleConnsPerHost,
		)
	}
	if transport.ResponseHeaderTimeout != 10*time.Second || transport.MaxResponseHeaderBytes != 1<<20 {
		t.Errorf(
			"default HTTP response-header limits = %s/%d, want 10s/%d",
			transport.ResponseHeaderTimeout,
			transport.MaxResponseHeaderBytes,
			1<<20,
		)
	}
	if transport.Proxy == nil || transport.DialContext == nil {
		t.Error("default HTTP transport must preserve environment proxy and bounded dialing")
	}
	if err := defaultClient.CheckRedirect(nil, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("default redirect policy error = %v, want http.ErrUseLastResponse", err)
	}

	customHTTPClient := &http.Client{}
	customClient, err := NewClient("https://example.com", WithHTTPClient(customHTTPClient))
	if err != nil {
		t.Fatalf("NewClient(WithHTTPClient()) error = %v", err)
	}
	if customClient.httpClient != customHTTPClient {
		t.Fatal("WithHTTPClient() did not preserve the caller HTTP client")
	}
	if timeout := customHTTPClient.Timeout; timeout != 0 {
		t.Errorf("custom HTTP client timeout = %s, want caller value 0s", timeout)
	}
}
