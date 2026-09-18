package observability

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func BenchmarkMetricsRender(b *testing.B) {
	metrics := NewMetrics()
	for index := 0; index < 32; index++ {
		metrics.requests.Store(metricKey{method: http.MethodGet, route: "/items/:id/" + strconv.Itoa(index), status: http.StatusNoContent}, &metricValue{})
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_ = metrics.Render()
	}
}

func BenchmarkMetricsMiddlewareParallel(b *testing.B) {
	metrics := NewMetrics()
	app := fiber.New()
	app.Use(metrics.Middleware)
	app.Get("/items/:id", func(c fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/items/42", http.NoBody))
			if err != nil {
				b.Error(err)
				return
			}
			response.Body.Close()
		}
	})
}
