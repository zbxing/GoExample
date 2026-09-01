package httpapi

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zbxing/goexample/Framework/observability"
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
