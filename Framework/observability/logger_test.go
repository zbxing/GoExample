package observability

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"
)

type readTrackingReader struct {
	read bool
}

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
