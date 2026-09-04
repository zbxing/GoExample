package httpclient

import (
	"errors"
	"io"
	"net/http"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var (
	// ErrResponseBodyTooLarge indicates that an opt-in response body limit was
	// exceeded. The response body is closed instead of being drained without a
	// bound, so the underlying connection might not be reusable.
	ErrResponseBodyTooLarge = errors.New("outbound HTTP response body exceeds the configured limit")

	errInvalidResponseBody      = errors.New("outbound HTTP response body is unavailable")
	errInvalidResponseBodyLimit = errors.New("outbound HTTP response body limit must be greater than zero")
)

// LimitResponseBody applies an opt-in streaming byte limit to response.Body.
// A known oversized Content-Length is rejected before reading. Unknown-length
// and chunked bodies remain streaming and fail only when an extra byte proves
// that the limit was exceeded. Callers must still close every accepted body.
func LimitResponseBody(response *http.Response, maxBytes int64) error {
	if response == nil || response.Body == nil {
		return errInvalidResponseBody
	}
	if maxBytes <= 0 {
		return errInvalidResponseBodyLimit
	}
	reportTooLarge := responseBodyTooLargeReporter(response)
	if response.ContentLength > maxBytes {
		reportTooLarge()
		_ = response.Body.Close()
		return ErrResponseBodyTooLarge
	}
	response.Body = &limitedResponseBody{
		ReadCloser: response.Body,
		remaining:  maxBytes,
		tooLarge:   reportTooLarge,
	}
	return nil
}

type limitedResponseBody struct {
	io.ReadCloser
	remaining int64
	closeOnce sync.Once
	closeErr  error
	closed    bool
	exceeded  bool
	tooLarge  func()
}

func (body *limitedResponseBody) Read(buffer []byte) (int, error) {
	if body.exceeded {
		return 0, ErrResponseBodyTooLarge
	}
	if body.closed {
		return 0, http.ErrBodyReadAfterClose
	}
	if len(buffer) == 0 {
		return 0, nil
	}
	if body.remaining > 0 {
		readBuffer := buffer
		if int64(len(readBuffer)) > body.remaining {
			readBuffer = readBuffer[:int(body.remaining)]
		}
		read, err := body.ReadCloser.Read(readBuffer)
		body.remaining -= int64(read)
		return read, err
	}

	var extra [1]byte
	read, err := body.ReadCloser.Read(extra[:])
	if read == 0 {
		return 0, err
	}
	body.exceeded = true
	body.tooLarge()
	_ = body.Close()
	return 0, ErrResponseBodyTooLarge
}

func (body *limitedResponseBody) Close() error {
	body.closeOnce.Do(func() {
		body.closed = true
		body.closeErr = body.ReadCloser.Close()
	})
	return body.closeErr
}

func responseBodyTooLargeReporter(response *http.Response) func() {
	if response.Request != nil {
		span := trace.SpanFromContext(response.Request.Context())
		if span.IsRecording() {
			return func() {
				span.SetAttributes(attribute.String("error.type", "response_body_too_large"))
				span.SetStatus(codes.Error, "outbound response body exceeded configured limit")
			}
		}
	}
	if observer, ok := response.Body.(interface{ responseBodyTooLarge() }); ok {
		return observer.responseBodyTooLarge
	}
	return func() {}
}
