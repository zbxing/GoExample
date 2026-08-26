package billingapp

import (
	"context"
	"testing"
	"time"
)

func TestSummaryIsTransportNeutralAndDeadlineAware(t *testing.T) {
	service := NewService("billing", "test", "1.0.0", func() time.Time {
		return time.Date(2026, time.August, 26, 1, 2, 3, 0, time.FixedZone("CST", 8*60*60))
	})
	summary, err := service.Summary(context.Background())
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if summary.Status != "billing-ready" || summary.GeneratedAt.Location() != time.UTC {
		t.Fatalf("summary = %#v", summary)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Summary(ctx); err == nil {
		t.Fatal("Summary(canceled) error = nil")
	}
}
