package httpapi

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
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
