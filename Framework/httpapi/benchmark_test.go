package httpapi

import (
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/sharedstate"
)

func BenchmarkHelloEndpoint(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	app := New(options)

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
		if err != nil {
			b.Fatal(err)
		}
		response.Body.Close()
	}
}

func BenchmarkHelloEndpointParallel(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	app := New(options)

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody))
			if err != nil {
				b.Error(err)
				return
			}
			response.Body.Close()
		}
	})
}

func BenchmarkHelloEndpointWithTraceparent(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	app := New(options)

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody)
		request.Header.Set(observability.TraceparentHeader, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
		response, err := app.Test(request)
		if err != nil {
			b.Fatal(err)
		}
		response.Body.Close()
	}
}

func BenchmarkHelloFiberHandler(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	benchmarkHelloFiberHandler(b, options)
}

func BenchmarkHelloFiberHandlerAtomicRateLimiter(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	options.SharedStorage = &benchmarkAtomicRateLimiter{}
	benchmarkHelloFiberHandler(b, options)
}

var benchmarkMiddlewareResponse = strings.Repeat("middleware-budget-", 256)

func BenchmarkHelloFiberHandlerMiddlewareMatrix(b *testing.B) {
	tests := []struct {
		name      string
		configure func(*Options)
		disable   func(*appMiddlewareSet)
	}{
		{name: "all_filtered_request_log"},
		{
			name: "all_emitted_request_log",
			configure: func(options *Options) {
				options.Logger = observability.NewLogger("json", "info", io.Discard)
			},
		},
		{name: "without_request_log", disable: func(set *appMiddlewareSet) { set.requestLog = false }},
		{name: "without_trace", disable: func(set *appMiddlewareSet) { set.trace = false }},
		{name: "without_metrics", disable: func(set *appMiddlewareSet) { set.metrics = false }},
		{name: "without_cors", disable: func(set *appMiddlewareSet) { set.cors = false }},
		{name: "without_compression", disable: func(set *appMiddlewareSet) { set.compression = false }},
		{name: "without_etag", disable: func(set *appMiddlewareSet) { set.etag = false }},
	}

	for _, test := range tests {
		b.Run(test.name, func(b *testing.B) {
			options := testOptions()
			options.RateLimitMax = math.MaxInt
			options.SharedStorage = &benchmarkAtomicRateLimiter{}
			options.RegisterRoutes = func(router fiber.Router) {
				router.Get("/benchmark-middleware", func(c fiber.Ctx) error {
					c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
					return c.SendString(benchmarkMiddlewareResponse)
				})
			}
			if test.configure != nil {
				test.configure(&options)
			}
			set := defaultAppMiddlewareSet()
			if test.disable != nil {
				test.disable(&set)
			}
			benchmarkFiberHandler(b, newApp(options, set).Handler(), func(ctx *fasthttp.RequestCtx) {
				ctx.Request.Header.SetMethod(http.MethodGet)
				ctx.Request.SetRequestURI("/api/v1/benchmark-middleware")
				ctx.Request.Header.Set(fiber.HeaderOrigin, "http://localhost:3000")
				ctx.Request.Header.Set(fiber.HeaderAcceptEncoding, "gzip")
			})
		})
	}
}

func BenchmarkAuthenticationMiddlewareMatrix(b *testing.B) {
	baseOptions := testOptions()
	baseOptions.TokenVerifier = baseOptions.Auth
	user, authenticated := baseOptions.Auth.Authenticate("demo", "demo123")
	if !authenticated {
		b.Fatal("authenticate benchmark user")
	}
	token, _, err := baseOptions.Auth.Issue(user)
	if err != nil {
		b.Fatalf("issue benchmark token: %v", err)
	}

	for _, enabled := range []bool{false, true} {
		name := "disabled"
		if enabled {
			name = "enabled_valid_bearer"
		}
		b.Run(name, func(b *testing.B) {
			options := baseOptions
			options.RateLimitMax = math.MaxInt
			options.SharedStorage = &benchmarkAtomicRateLimiter{}
			options.RegisterRoutes = func(router fiber.Router) {
				handler := func(c fiber.Ctx) error {
					setNoStoreHeaders(c)
					return c.SendStatus(fiber.StatusNoContent)
				}
				if enabled {
					router.Get("/benchmark-auth", requireAuth(options), handler)
					return
				}
				router.Get("/benchmark-auth", handler)
			}
			benchmarkFiberHandler(b, New(options).Handler(), func(ctx *fasthttp.RequestCtx) {
				ctx.Request.Header.SetMethod(http.MethodGet)
				ctx.Request.SetRequestURI("/api/v1/benchmark-auth")
				ctx.Request.Header.Set(fiber.HeaderAuthorization, "Bearer "+token)
			})
		})
	}
}

func BenchmarkIdempotencyMiddlewareMatrix(b *testing.B) {
	tests := []struct {
		name    string
		enabled bool
		key     string
	}{
		{name: "disabled_without_key"},
		{name: "enabled_without_key", enabled: true},
		{name: "disabled_with_key", key: "00000000-0000-4000-8000-000000000001"},
		{name: "enabled_replay", enabled: true, key: "00000000-0000-4000-8000-000000000001"},
	}

	for _, test := range tests {
		b.Run(test.name, func(b *testing.B) {
			options := testOptions()
			options.RateLimitMax = math.MaxInt
			options.SharedStorage = &benchmarkAtomicRateLimiter{}
			storage := &contractStorage{}
			lock := &contractLock{}
			options.RegisterRoutes = func(router fiber.Router) {
				handler := func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) }
				if test.enabled {
					router.Post(
						"/benchmark-idempotency",
						idempotencyMiddleware("/benchmark-idempotency", time.Minute, storage, lock),
						handler,
					)
					return
				}
				router.Post("/benchmark-idempotency", handler)
			}
			benchmarkFiberHandler(b, New(options).Handler(), func(ctx *fasthttp.RequestCtx) {
				ctx.Request.Header.SetMethod(http.MethodPost)
				ctx.Request.SetRequestURI("/api/v1/benchmark-idempotency")
				if test.key != "" {
					ctx.Request.Header.Set("X-Idempotency-Key", test.key)
				}
			})
		})
	}
}

func benchmarkHelloFiberHandler(b *testing.B, options Options) {
	benchmarkFiberHandler(b, New(options).Handler(), func(ctx *fasthttp.RequestCtx) {
		ctx.Request.Header.SetMethod(http.MethodGet)
		ctx.Request.SetRequestURI("/api/v1/example/hello")
	})
}

func benchmarkFiberHandler(
	b *testing.B,
	handler fasthttp.RequestHandler,
	configure func(*fasthttp.RequestCtx),
) {
	requestContext := &fasthttp.RequestCtx{}
	configure(requestContext)

	handler(requestContext)
	requestContext.Response.Reset()

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		handler(requestContext)
		requestContext.Response.Reset()
	}
}

type benchmarkAtomicRateLimiter struct {
	contractStorage
}

func (*benchmarkAtomicRateLimiter) Take(context.Context, string, int, time.Duration) (sharedstate.RateLimitResult, error) {
	return sharedstate.RateLimitResult{
		Allowed:    true,
		Remaining:  math.MaxInt - 1,
		ResetAfter: time.Minute,
	}, nil
}

func BenchmarkStandardHTTPHandler(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	handler, err := NewHTTPHandler(New(options))
	if err != nil {
		b.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody)
	response := &benchmarkResponseWriter{header: make(http.Header)}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		handler.ServeHTTP(response, request)
	}
}

func BenchmarkStandardHTTPHandlerParallel(b *testing.B) {
	options := testOptions()
	options.RateLimitMax = math.MaxInt
	handler, err := NewHTTPHandler(New(options))
	if err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/example/hello", http.NoBody)
		response := &benchmarkResponseWriter{header: make(http.Header)}
		for pb.Next() {
			handler.ServeHTTP(response, request)
		}
	})
}

type benchmarkResponseWriter struct {
	header http.Header
}

func (response *benchmarkResponseWriter) Header() http.Header {
	return response.header
}

func (*benchmarkResponseWriter) Write(body []byte) (int, error) {
	return len(body), nil
}

func (*benchmarkResponseWriter) WriteHeader(int) {}
