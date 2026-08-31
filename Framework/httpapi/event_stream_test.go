package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	frameworkserver "github.com/zbxing/goexample/Framework/server"
)

func TestWriteServerSentEventEncodesBoundedWireFormat(t *testing.T) {
	var body bytes.Buffer
	writer := bufio.NewWriter(&body)
	event := ServerSentEvent{
		ID:    "42",
		Event: "project.updated",
		Data:  "first\r\nsecond\n",
		Retry: 2500 * time.Millisecond,
	}
	if err := writeServerSentEvent(writer, event, 1024); err != nil {
		t.Fatalf("writeServerSentEvent() error = %v", err)
	}
	want := "id: 42\nevent: project.updated\nretry: 2500\ndata: first\ndata: second\ndata: \n\n"
	if body.String() != want {
		t.Fatalf("event body = %q, want %q", body.String(), want)
	}
}

func TestWriteServerSentEventRejectsUnsafeOrOversizedFields(t *testing.T) {
	tests := map[string]ServerSentEvent{
		"id newline":       {ID: "first\nsecond"},
		"id nul":           {ID: "first\x00second"},
		"event newline":    {Event: "first\rsecond"},
		"invalid utf8":     {Data: string([]byte{0xff})},
		"negative retry":   {Retry: -time.Millisecond},
		"sub-ms retry":     {Retry: time.Microsecond},
		"fractional retry": {Retry: time.Millisecond + time.Nanosecond},
		"oversized":        {Data: strings.Repeat("x", 65)},
	}
	for name, event := range tests {
		t.Run(name, func(t *testing.T) {
			writer := bufio.NewWriter(io.Discard)
			if err := writeServerSentEvent(writer, event, 64); err == nil {
				t.Fatal("writeServerSentEvent() error = nil")
			}
		})
	}
}

func TestValidateServerSentEventLastEventID(t *testing.T) {
	for _, value := range []string{"", "41", "tenant-1:project-42", "contains,comma"} {
		if actual, err := validateServerSentEventLastEventID(value); err != nil || actual != value {
			t.Fatalf("validateServerSentEventLastEventID(%q) = %q, %v", value, actual, err)
		}
	}

	for name, value := range map[string]string{
		"newline":      "first\nsecond",
		"carriage":     "first\rsecond",
		"nul":          "first\x00second",
		"invalid utf8": string([]byte{0xff}),
		"oversized":    strings.Repeat("x", maximumServerSentEventLastEventIDBytes+1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateServerSentEventLastEventID(value); err == nil {
				t.Fatal("validateServerSentEventLastEventID() error = nil")
			}
		})
	}
}

func TestSendServerSentEventsRejectsInvalidOptionsBeforeStreaming(t *testing.T) {
	validEvents := make(chan ServerSentEvent)
	close(validEvents)
	if err := SendServerSentEvents(nil, ServerSentEventOptions{Events: validEvents}); err == nil {
		t.Fatal("SendServerSentEvents(nil) error = nil")
	}

	tests := map[string]ServerSentEventOptions{
		"missing events":        {},
		"heartbeat below bound": {Events: validEvents, HeartbeatInterval: 9 * time.Millisecond},
		"heartbeat above bound": {Events: validEvents, HeartbeatInterval: 5*time.Minute + time.Nanosecond},
		"negative byte limit":   {Events: validEvents, MaxEventBytes: -1},
		"byte limit above bound": {
			Events:        validEvents,
			MaxEventBytes: maximumServerSentEventBytes + 1,
		},
	}
	for name, streamOptions := range tests {
		t.Run(name, func(t *testing.T) {
			options := testOptions()
			options.RegisterRoutes = func(router fiber.Router) {
				router.Get("/events", func(c fiber.Ctx) error {
					return SendServerSentEvents(c, streamOptions)
				})
			}
			response, err := New(options).Test(httptest.NewRequest(http.MethodGet, "/api/v1/events", http.NoBody))
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusInternalServerError {
				t.Fatalf("invalid stream status = %d, want %d", response.StatusCode, http.StatusInternalServerError)
			}
		})
	}

	t.Run("missing Framework lifecycle", func(t *testing.T) {
		app := fiber.New()
		app.Get("/events", func(c fiber.Ctx) error {
			return SendServerSentEvents(c, ServerSentEventOptions{Events: validEvents})
		})
		response, err := app.Test(httptest.NewRequest(http.MethodGet, "/events", http.NoBody))
		if err != nil {
			t.Fatalf("app.Test() error = %v", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusInternalServerError {
			t.Fatalf("missing lifecycle status = %d, want %d", response.StatusCode, http.StatusInternalServerError)
		}
	})

}

func TestSendServerSentEventsFromSourceFailsClosedBeforeStreaming(t *testing.T) {
	validEvents := make(chan ServerSentEvent)
	close(validEvents)
	validSource := func(context.Context, string) (<-chan ServerSentEvent, error) {
		return validEvents, nil
	}
	tests := map[string]struct {
		source  ServerSentEventSource
		options ServerSentEventOptions
	}{
		"missing source": {},
		"static channel also configured": {
			source:  validSource,
			options: ServerSentEventOptions{Events: validEvents},
		},
		"heartbeat below bound": {
			source:  validSource,
			options: ServerSentEventOptions{HeartbeatInterval: 9 * time.Millisecond},
		},
		"source error": {
			source: func(context.Context, string) (<-chan ServerSentEvent, error) {
				return nil, errors.New("private replay store detail")
			},
		},
		"source without channel": {
			source: func(context.Context, string) (<-chan ServerSentEvent, error) {
				return nil, nil
			},
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			options := testOptions()
			options.RegisterRoutes = func(router fiber.Router) {
				router.Get("/events", func(c fiber.Ctx) error {
					return SendServerSentEventsFromSource(c, test.source, test.options)
				})
			}
			response, err := New(options).Test(httptest.NewRequest(http.MethodGet, "/api/v1/events", http.NoBody))
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusInternalServerError {
				t.Fatalf("source failure status = %d, want %d", response.StatusCode, http.StatusInternalServerError)
			}
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatalf("read source failure response: %v", err)
			}
			if bytes.Contains(body, []byte("private replay store detail")) {
				t.Fatalf("source failure leaked private detail: %q", body)
			}
		})
	}
}

func TestNewHTTPHandlerServerSentEventsResumesFromLastEventID(t *testing.T) {
	tests := []struct {
		name          string
		start         func(*testing.T, http.Handler) (*httptest.Server, *http.Client)
		protocolMajor int
	}{
		{
			name: "HTTP/1.1",
			start: func(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
				t.Helper()
				server := httptest.NewServer(handler)
				return server, &http.Client{Timeout: 3 * time.Second}
			},
			protocolMajor: 1,
		},
		{
			name: "HTTP/2",
			start: func(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
				t.Helper()
				server := httptest.NewUnstartedServer(handler)
				server.EnableHTTP2 = true
				server.StartTLS()
				client := server.Client()
				client.Timeout = 3 * time.Second
				return server, client
			},
			protocolMajor: 2,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			type sourceRequest struct {
				ctx         context.Context
				lastEventID string
			}
			opened := make(chan sourceRequest, 1)
			options := testOptions()
			options.RegisterRoutes = func(router fiber.Router) {
				router.Get("/events", func(c fiber.Ctx) error {
					return SendServerSentEventsFromSource(
						c,
						func(ctx context.Context, lastEventID string) (<-chan ServerSentEvent, error) {
							events := make(chan ServerSentEvent, 1)
							events <- ServerSentEvent{ID: "42", Event: "resumed", Data: "after-41"}
							close(events)
							opened <- sourceRequest{ctx: ctx, lastEventID: lastEventID}
							return events, nil
						},
						ServerSentEventOptions{},
					)
				})
			}
			handler, err := NewHTTPHandler(New(options))
			if err != nil {
				t.Fatalf("NewHTTPHandler() error = %v", err)
			}
			server, client := test.start(t, handler)
			defer server.Close()

			request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/events", http.NoBody)
			if err != nil {
				t.Fatalf("create resumed event stream request: %v", err)
			}
			request.Header.Set(serverSentEventLastEventIDHeader, "41")
			response, err := client.Do(request)
			if err != nil {
				t.Fatalf("GET resumed event stream: %v", err)
			}
			defer response.Body.Close()
			if response.ProtoMajor != test.protocolMajor {
				t.Fatalf("resumed event stream protocol = HTTP/%d, want HTTP/%d", response.ProtoMajor, test.protocolMajor)
			}
			assertServerSentEvent(t, bufio.NewReader(response.Body), "id: 42\nevent: resumed\ndata: after-41\n\n")

			select {
			case source := <-opened:
				if source.lastEventID != "41" {
					t.Fatalf("source Last-Event-ID = %q, want %q", source.lastEventID, "41")
				}
				select {
				case <-source.ctx.Done():
				case <-time.After(time.Second):
					t.Fatal("resumed event source context remained active after stream completion")
				}
			case <-time.After(time.Second):
				t.Fatal("resumed event source was not opened")
			}
		})
	}
}

func TestNewHTTPHandlerServerSentEventsFlushAndCleanUpOnDisconnect(t *testing.T) {
	tests := []struct {
		name          string
		start         func(*testing.T, http.Handler) (*httptest.Server, *http.Client)
		protocolMajor int
	}{
		{
			name: "HTTP/1.1",
			start: func(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
				t.Helper()
				server := httptest.NewServer(handler)
				return server, &http.Client{Timeout: 3 * time.Second}
			},
			protocolMajor: 1,
		},
		{
			name: "HTTP/2",
			start: func(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
				t.Helper()
				server := httptest.NewUnstartedServer(handler)
				server.EnableHTTP2 = true
				server.StartTLS()
				client := server.Client()
				client.Timeout = 3 * time.Second
				return server, client
			},
			protocolMajor: 2,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			events := make(chan ServerSentEvent, 1)
			events <- ServerSentEvent{ID: "1", Event: "ready", Data: "connected"}
			options := testOptions()
			options.RequestTimeout = time.Minute
			options.RegisterRoutes = func(router fiber.Router) {
				router.Get("/events", func(c fiber.Ctx) error {
					return SendServerSentEvents(c, ServerSentEventOptions{
						Events:            events,
						HeartbeatInterval: 10 * time.Millisecond,
					})
				})
			}
			handler, err := NewHTTPHandler(New(options))
			if err != nil {
				t.Fatalf("NewHTTPHandler() error = %v", err)
			}
			served := make(chan struct{}, 1)
			tracked := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				handler.ServeHTTP(response, request)
				served <- struct{}{}
			})
			server, client := test.start(t, tracked)
			defer server.Close()
			defer close(events)

			response, err := client.Get(server.URL + "/api/v1/events")
			if err != nil {
				t.Fatalf("GET event stream: %v", err)
			}
			if response.ProtoMajor != test.protocolMajor {
				response.Body.Close()
				t.Fatalf("event stream protocol = HTTP/%d, want HTTP/%d", response.ProtoMajor, test.protocolMajor)
			}
			if response.Header.Get(fiber.HeaderContentType) != fiber.MIMETextEventStream {
				response.Body.Close()
				t.Fatalf("event stream content type = %q", response.Header.Get(fiber.HeaderContentType))
			}
			if response.Header.Get(fiber.HeaderCacheControl) != "no-cache, no-transform" {
				response.Body.Close()
				t.Fatalf("event stream cache control = %q", response.Header.Get(fiber.HeaderCacheControl))
			}
			reader := bufio.NewReader(response.Body)
			assertServerSentEvent(t, reader, "id: 1\nevent: ready\ndata: connected\n\n")
			assertServerSentEventHeartbeat(t, reader)
			if err := response.Body.Close(); err != nil {
				t.Fatalf("close event stream body: %v", err)
			}
			select {
			case <-served:
			case <-time.After(time.Second):
				t.Fatal("event stream producer remained active after client disconnect")
			}
		})
	}
}

func TestRunHTTPStopsServerSentEventsDuringApplicationShutdown(t *testing.T) {
	events := make(chan ServerSentEvent)
	defer close(events)
	options := testOptions()
	options.RequestTimeout = time.Minute
	options.RegisterRoutes = func(router fiber.Router) {
		router.Get("/events", func(c fiber.Ctx) error {
			return SendServerSentEvents(c, ServerSentEventOptions{
				Events:            events,
				HeartbeatInterval: 10 * time.Millisecond,
			})
		})
	}
	app := New(options)
	handler, err := NewHTTPHandler(app)
	if err != nil {
		t.Fatalf("NewHTTPHandler() error = %v", err)
	}
	address := reserveServerSentEventAddress(t)
	serverContext, cancelServer := context.WithCancel(context.Background())
	serverResult := make(chan error, 1)
	go func() {
		serverResult <- frameworkserver.RunHTTP(serverContext, frameworkserver.HTTPOptions{
			Handler:             handler,
			Address:             address,
			ShutdownTimeout:     time.Second,
			ApplicationShutdown: app.ShutdownWithContext,
		})
	}()

	client := &http.Client{Timeout: 3 * time.Second}
	var response *http.Response
	deadline := time.Now().Add(2 * time.Second)
	for {
		response, err = client.Get("http://" + address + "/api/v1/events")
		if err == nil {
			break
		}
		select {
		case runErr := <-serverResult:
			cancelServer()
			t.Fatalf("RunHTTP() returned before serving: %v", runErr)
		default:
		}
		if time.Now().After(deadline) {
			cancelServer()
			t.Fatalf("connect to RunHTTP event stream: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	defer response.Body.Close()
	assertServerSentEventHeartbeat(t, bufio.NewReader(response.Body))

	cancelServer()
	select {
	case runErr := <-serverResult:
		if runErr != nil {
			t.Fatalf("RunHTTP() shutdown error = %v", runErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunHTTP() did not stop the active event stream within its shutdown budget")
	}
}

func assertServerSentEventHeartbeat(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read event stream heartbeat: %v", err)
	}
	separator, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read event stream heartbeat separator: %v", err)
	}
	if line != ": heartbeat\n" || separator != "\n" {
		t.Fatalf("event stream heartbeat = %q%q", line, separator)
	}
}

func assertServerSentEvent(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	var event strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read server-sent event: %v", err)
		}
		event.WriteString(line)
		if line == "\n" {
			break
		}
	}
	if event.String() != expected {
		t.Fatalf("server-sent event = %q, want %q", event.String(), expected)
	}
}

func reserveServerSentEventAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve event stream address: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		t.Fatalf("release event stream address: %v", err)
	}
	return address
}
