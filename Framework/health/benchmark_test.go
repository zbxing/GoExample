package health

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func BenchmarkReadiness(b *testing.B) {
	checker := New(time.Second)
	var calls atomic.Uint64
	if err := checker.Register("database", func(context.Context) error {
		calls.Add(1)
		return nil
	}); err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if report := checker.Readiness(context.Background()); !report.Ready {
			b.Fatal("checker reported not ready")
		}
	}
	b.StopTimer()
	b.ReportMetric(float64(calls.Load()), "check_calls")
}
