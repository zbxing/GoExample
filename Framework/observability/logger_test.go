package observability

import (
	"bytes"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"
)

type readTrackingReader struct {
	read bool
}

type remoteAddressTrackingConn struct {
	net.Conn
	remoteAddressRead bool
}

func (connection *remoteAddressTrackingConn) LocalAddr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 8080}
}

func (connection *remoteAddressTrackingConn) RemoteAddr() net.Addr {
	connection.remoteAddressRead = true
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 32000}
}

func (connection *remoteAddressTrackingConn) SetDeadline(time.Time) error      { return nil }
func (connection *remoteAddressTrackingConn) SetReadDeadline(time.Time) error  { return nil }
func (connection *remoteAddressTrackingConn) SetWriteDeadline(time.Time) error { return nil }

func (reader *readTrackingReader) Read([]byte) (int, error) {
	reader.read = true
	return 0, io.EOF
}

func TestRequestLoggerSkipsConfiguredPaths(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("json", "info", &output)
	app := fiber.New()
	app.Use(RequestLogger(logger, "/livez"))
	app.Get("/livez", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/livez", http.NoBody))
	if err != nil {
		t.Fatalf("livez request error = %v", err)
	}
	response.Body.Close()
	if output.Len() != 0 {
		t.Fatalf("skipped request log = %s", output.String())
	}

	response, err = app.Test(httptest.NewRequest(http.MethodGet, "/work", http.NoBody))
	if err != nil {
		t.Fatalf("work request error = %v", err)
	}
	response.Body.Close()
	if !strings.Contains(output.String(), `"path":"/work"`) {
		t.Fatalf("request log = %s", output.String())
	}
}

func TestRequestLoggerSkipsAttributeExtractionWhenLevelIsDisabled(t *testing.T) {
	logger := NewLogger("json", "error", io.Discard)
	app := fiber.New()
	app.Use(RequestLogger(logger))
	app.Get("/work", func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	connection := &remoteAddressTrackingConn{}
	requestContext := &fasthttp.RequestCtx{}
	requestContext.Init2(connection, nil, true)
	requestContext.Request.Header.SetMethod(fiber.MethodGet)
	requestContext.Request.SetRequestURI("/work")
	app.Handler()(requestContext)

	if status := requestContext.Response.StatusCode(); status != fiber.StatusNoContent {
		t.Fatalf("response status = %d, want %d", status, fiber.StatusNoContent)
	}
	if connection.remoteAddressRead {
		t.Fatal("disabled request log extracted the client address")
	}
}

func TestResponseBytesDoesNotMaterializeStream(t *testing.T) {
	app := fiber.New()
	requestContext := &fasthttp.RequestCtx{}
	stream := &readTrackingReader{}
	requestContext.Response.SetBodyStream(stream, -1)
	ctx := app.AcquireCtx(requestContext)
	defer app.ReleaseCtx(ctx)
	defer requestContext.Response.CloseBodyStream() //nolint:errcheck // test cleanup

	if got := responseBytes(ctx); got != -1 {
		t.Fatalf("stream response bytes = %d, want -1 for unknown length", got)
	}
	if stream.read {
		t.Fatal("response byte logging materialized the body stream")
	}

	requestContext.Response.ResetBody()
	requestContext.Response.SetBodyString("known")
	if got := responseBytes(ctx); got != len("known") {
		t.Fatalf("buffered response bytes = %d, want %d", got, len("known"))
	}
}
