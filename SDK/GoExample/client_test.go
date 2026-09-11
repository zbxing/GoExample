package goexample

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type sdkHTTPClientFunc func(*http.Request) (*http.Response, error)

func (client sdkHTTPClientFunc) Do(request *http.Request) (*http.Response, error) {
	return client(request)
}

type sdkTrackingBody struct {
	reader     *strings.Reader
	onRead     func()
	readErr    error
	read       bool
	closeCalls int
}

func newSDKTrackingBody(contents string, onRead func()) *sdkTrackingBody {
	return &sdkTrackingBody{reader: strings.NewReader(contents), onRead: onRead}
}

func (body *sdkTrackingBody) Read(buffer []byte) (int, error) {
	if !body.read {
		body.read = true
		if body.onRead != nil {
			body.onRead()
		}
	}
	if body.readErr != nil {
		return 0, body.readErr
	}
	return body.reader.Read(buffer)
}

func (body *sdkTrackingBody) Close() error {
	body.closeCalls++
	return nil
}

func TestGeneratedClientCoversPublishedOperations(t *testing.T) {
	if APIVersion != "1.4.0" {
		t.Fatalf("APIVersion = %q, want 1.4.0", APIVersion)
	}
	operations := PublishedOperations()
	if len(operations) != 26 {
		t.Fatalf("generated operations = %d, want 26", len(operations))
	}
	operationIDs := make(map[string]struct{}, len(operations))
	for _, operation := range operations {
		operationIDs[operation.OperationID] = struct{}{}
	}
	for _, operationID := range []string{"getReadiness", "startOIDCBrowserAuthorization", "completeOIDCBrowserAuthorization", "logoutOIDCBrowserSession", "listOIDCBrowserSessions", "updateOIDCBrowserSessionDeviceName", "revokeOIDCBrowserSession", "revokeAllOIDCBrowserSessions", "previewProject", "describeProject"} {
		if _, exists := operationIDs[operationID]; !exists {
			t.Fatalf("generated operations missing %q", operationID)
		}
	}
	operations[0].Path = "/mutated-by-caller"
	if PublishedOperations()[0].Path == operations[0].Path {
		t.Fatal("PublishedOperations exposed mutable package state")
	}
}

func TestGeneratedClientEncodesTypedParametersAndBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.EscapedPath() != "/api/v1/project/preview/team%2Fblue" {
			t.Errorf("request = %s %s", request.Method, request.URL.EscapedPath())
		}
		if request.URL.Query().Get("format") != "summary" {
			t.Errorf("format = %q", request.URL.Query().Get("format"))
		}
		if request.Header.Get("X-Client-Locale") != "zh-CN" {
			t.Errorf("locale = %q", request.Header.Get("X-Client-Locale"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"data":{"ok":true},"msg":"ok"}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	response, err := client.PreviewProject(context.Background(), PreviewProjectParams{
		Audience:      "team/blue",
		Format:        "summary",
		XClientLocale: "zh-CN",
	})
	if err != nil {
		t.Fatalf("PreviewProject() error = %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if _, err := response.DecodeEnvelope(); err != nil {
		t.Fatalf("DecodeEnvelope() error = %v", err)
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
	response, err := client.StartOIDCBrowserAuthorization(context.Background())
	if err != nil {
		t.Fatalf("StartOIDCBrowserAuthorization() error = %v", err)
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

func TestGeneratedClientRejectsCompletedContextAcrossRequestLifecycle(t *testing.T) {
	t.Run("pre-completed", func(t *testing.T) {
		var editorCalls, clientCalls int
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			clientCalls++
			return nil, errors.New("unexpected HTTP call")
		})), WithRequestEditor(func(context.Context, *http.Request) error {
			editorCalls++
			return nil
		}))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := client.GetServiceIndex(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("GetServiceIndex() error = %v, want context.Canceled", err)
		}
		if editorCalls != 0 || clientCalls != 0 {
			t.Fatalf("calls = editor:%d client:%d, want zero", editorCalls, clientCalls)
		}
	})

	t.Run("elapsed deadline without done signal", func(t *testing.T) {
		var clientCalls int
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			clientCalls++
			return nil, errors.New("unexpected HTTP call")
		})))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(elapsedSDKContext{}); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("GetServiceIndex() error = %v, want context.DeadlineExceeded", err)
		}
		if clientCalls != 0 {
			t.Fatalf("HTTP client calls = %d, want zero", clientCalls)
		}
	})

	t.Run("editor late success", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		requestBody := newSDKTrackingBody("request", nil)
		var laterEditorCalls, clientCalls int
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			clientCalls++
			return nil, errors.New("unexpected HTTP call")
		})), WithRequestEditor(func(_ context.Context, request *http.Request) error {
			request.Body = requestBody
			cancel()
			return nil
		}))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(ctx, func(context.Context, *http.Request) error {
			laterEditorCalls++
			return nil
		}); !errors.Is(err, context.Canceled) {
			t.Fatalf("GetServiceIndex() error = %v, want context.Canceled", err)
		}
		if laterEditorCalls != 0 || clientCalls != 0 {
			t.Fatalf("later calls = editor:%d client:%d, want zero", laterEditorCalls, clientCalls)
		}
		if requestBody.closeCalls != 1 {
			t.Fatalf("request body close calls = %d, want 1", requestBody.closeCalls)
		}
	})

	t.Run("transport late success", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		responseBody := newSDKTrackingBody(`{"status":"late"}`, nil)
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			cancel()
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: responseBody}, nil
		})))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("GetServiceIndex() error = %v, want context.Canceled", err)
		}
		if responseBody.closeCalls != 1 {
			t.Fatalf("response body close calls = %d, want 1", responseBody.closeCalls)
		}
	})

	t.Run("body late success", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		responseBody := newSDKTrackingBody(`{"status":"late"}`, cancel)
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: responseBody}, nil
		})))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("GetServiceIndex() error = %v, want context.Canceled", err)
		}
		if responseBody.closeCalls != 1 {
			t.Fatalf("response body close calls = %d, want 1", responseBody.closeCalls)
		}
	})

	t.Run("response plus error", func(t *testing.T) {
		backendErr := errors.New("backend failure")
		responseBody := newSDKTrackingBody("ignored", nil)
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusBadGateway, Header: make(http.Header), Body: responseBody}, backendErr
		})))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(context.Background()); !errors.Is(err, backendErr) {
			t.Fatalf("GetServiceIndex() error = %v, want backend error", err)
		}
		if responseBody.closeCalls != 1 {
			t.Fatalf("response body close calls = %d, want 1", responseBody.closeCalls)
		}
	})

	t.Run("editor error remains authoritative", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		editorErr := errors.New("editor failure")
		requestBody := newSDKTrackingBody("request", nil)
		var clientCalls int
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			clientCalls++
			return nil, errors.New("unexpected HTTP call")
		})), WithRequestEditor(func(_ context.Context, request *http.Request) error {
			request.Body = requestBody
			cancel()
			return editorErr
		}))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(ctx); !errors.Is(err, editorErr) {
			t.Fatalf("GetServiceIndex() error = %v, want editor error", err)
		}
		if clientCalls != 0 || requestBody.closeCalls != 1 {
			t.Fatalf("calls = client:%d request-close:%d, want 0/1", clientCalls, requestBody.closeCalls)
		}
	})

	t.Run("body read error remains authoritative", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		readErr := errors.New("read failure")
		responseBody := newSDKTrackingBody("", cancel)
		responseBody.readErr = readErr
		client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: responseBody}, nil
		})))
		if err != nil {
			t.Fatalf("NewClient() error = %v", err)
		}
		if _, err := client.GetServiceIndex(ctx); !errors.Is(err, readErr) {
			t.Fatalf("GetServiceIndex() error = %v, want read error", err)
		}
		if responseBody.closeCalls != 1 {
			t.Fatalf("response body close calls = %d, want 1", responseBody.closeCalls)
		}
	})

	for _, test := range []struct {
		name     string
		response *http.Response
	}{
		{name: "nil response"},
		{name: "nil response body", response: &http.Response{StatusCode: http.StatusOK, Header: make(http.Header)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, err := NewClient("https://example.com", WithHTTPClient(sdkHTTPClientFunc(func(*http.Request) (*http.Response, error) {
				return test.response, nil
			})))
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			if _, err := client.GetServiceIndex(context.Background()); err == nil || err.Error() != "execute goexample SDK request: goexample SDK received an invalid HTTP response" {
				t.Fatalf("GetServiceIndex() error = %v, want fixed invalid-response error", err)
			}
		})
	}
}

func TestCompletedSDKContextErrorFastPath(t *testing.T) {
	if err := completedSDKContextError(context.Background()); err != nil {
		t.Fatalf("completedSDKContextError(background) = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := completedSDKContextError(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("completedSDKContextError(canceled) = %v", err)
	}
	if err := completedSDKContextError(elapsedSDKContext{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("completedSDKContextError(elapsed) = %v", err)
	}
	if allocations := testing.AllocsPerRun(1_000, func() {
		if err := completedSDKContextError(context.Background()); err != nil {
			panic("live context unexpectedly completed")
		}
	}); allocations != 0 {
		t.Fatalf("completedSDKContextError(background) allocations = %f, want 0", allocations)
	}
}

type elapsedSDKContext struct{}

func (elapsedSDKContext) Deadline() (time.Time, bool) { return time.Now().Add(-time.Second), true }
func (elapsedSDKContext) Done() <-chan struct{}       { return nil }
func (elapsedSDKContext) Err() error                  { return nil }
func (elapsedSDKContext) Value(any) any               { return nil }

var _ io.ReadCloser = (*sdkTrackingBody)(nil)
