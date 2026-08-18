package health

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadinessChecksAndDraining(t *testing.T) {
	checker := New(10 * time.Millisecond)
	if err := checker.Register("database", func(context.Context) error { return nil }); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}
	if err := checker.Register("cache", func(context.Context) error { return errors.New("unavailable") }); err != nil {
		t.Fatalf("Register(cache) error = %v", err)
	}

	report := checker.Readiness(context.Background())
	if report.Ready || report.Status != "not_ready" {
		t.Fatalf("report = %#v", report)
	}
	if report.Checks["database"] != "ok" || report.Checks["cache"] != "failed" {
		t.Fatalf("checks = %#v", report.Checks)
	}

	checker.SetDraining(true)
	if !checker.Draining() {
		t.Fatal("Draining() = false after SetDraining(true)")
	}
	report = checker.Readiness(context.Background())
	if report.Ready || report.Checks["lifecycle"] != "draining" {
		t.Fatalf("draining report = %#v", report)
	}
	checker.SetDraining(false)
	if checker.Draining() {
		t.Fatal("Draining() = true after SetDraining(false)")
	}
}

func TestReadinessCachesAndCopiesReports(t *testing.T) {
	checker := New(time.Second, 20*time.Millisecond)
	var calls atomic.Int64
	if err := checker.Register("database", func(context.Context) error {
		calls.Add(1)
		return nil
	}); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}

	first := checker.Readiness(context.Background())
	first.Checks["database"] = "changed-by-caller"
	second := checker.Readiness(context.Background())
	if calls.Load() != 1 {
		t.Fatalf("calls within cache TTL = %d, want 1", calls.Load())
	}
	if second.Checks["database"] != "ok" {
		t.Fatalf("cached report was mutated = %#v", second.Checks)
	}

	time.Sleep(30 * time.Millisecond)
	checker.Readiness(context.Background())
	if calls.Load() != 2 {
		t.Fatalf("calls after cache TTL = %d, want 2", calls.Load())
	}
}

func TestReadinessMergesConcurrentRefreshes(t *testing.T) {
	checker := New(time.Second, time.Second)
	var calls atomic.Int64
	started := make(chan struct{})
	release := make(chan struct{})
	if err := checker.Register("database", func(context.Context) error {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return nil
	}); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}

	const readers = 16
	var waitGroup sync.WaitGroup
	waitGroup.Add(readers)
	for range readers {
		go func() {
			defer waitGroup.Done()
			report := checker.Readiness(context.Background())
			if !report.Ready {
				t.Errorf("report = %#v", report)
			}
		}()
	}
	<-started
	close(release)
	waitGroup.Wait()
	if calls.Load() != 1 {
		t.Fatalf("concurrent check calls = %d, want 1", calls.Load())
	}
}

func TestCanceledCallerDoesNotCancelSharedRefresh(t *testing.T) {
	checker := New(time.Second, time.Second)
	var calls atomic.Int64
	started := make(chan struct{})
	release := make(chan struct{})
	if err := checker.Register("database", func(ctx context.Context) error {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan Report, 1)
	go func() {
		result <- checker.Readiness(ctx)
	}()
	<-started
	cancel()
	if report := <-result; report.Ready || report.Checks["request"] != "canceled" {
		t.Fatalf("canceled report = %#v", report)
	}

	close(release)
	if report := checker.Readiness(context.Background()); !report.Ready {
		t.Fatalf("shared refresh report = %#v", report)
	}
	if calls.Load() != 1 {
		t.Fatalf("check calls = %d, want 1", calls.Load())
	}
}

func TestRegisterDuringRefreshInvalidatesResult(t *testing.T) {
	checker := New(time.Second, time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	if err := checker.Register("database", func(context.Context) error {
		select {
		case <-started:
		default:
			close(started)
		}
		<-release
		return nil
	}); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}

	first := make(chan Report, 1)
	go func() {
		first <- checker.Readiness(context.Background())
	}()
	<-started
	var cacheCalls atomic.Int64
	if err := checker.Register("cache", func(context.Context) error {
		cacheCalls.Add(1)
		return nil
	}); err != nil {
		t.Fatalf("Register(cache) error = %v", err)
	}
	close(release)

	if report := <-first; !report.Ready || report.Checks["cache"] != "ok" {
		t.Fatalf("refreshed report = %#v", report)
	}
	if cacheCalls.Load() != 1 {
		t.Fatalf("cache check calls = %d, want 1", cacheCalls.Load())
	}
}

func TestReadinessCheckTimeout(t *testing.T) {
	checker := New(time.Millisecond)
	if err := checker.Register("slow", func(context.Context) error {
		time.Sleep(100 * time.Millisecond)
		return nil
	}); err != nil {
		t.Fatalf("Register(slow) error = %v", err)
	}

	startedAt := time.Now()
	report := checker.Readiness(context.Background())
	if report.Ready || report.Checks["slow"] != "failed" {
		t.Fatalf("report = %#v", report)
	}
	if elapsed := time.Since(startedAt); elapsed > 50*time.Millisecond {
		t.Fatalf("readiness took %s", elapsed)
	}
}

func TestRegisterRejectsInvalidChecks(t *testing.T) {
	checker := New(time.Second)
	if err := checker.Register("", func(context.Context) error { return nil }); err == nil {
		t.Fatal("Register(empty name) error = nil")
	}
	if err := checker.Register("database", nil); err == nil {
		t.Fatal("Register(nil check) error = nil")
	}
	if err := checker.Register("database", func(context.Context) error { return nil }); err != nil {
		t.Fatalf("Register(database) error = %v", err)
	}
	if err := checker.Register("database", func(context.Context) error { return nil }); err == nil {
		t.Fatal("Register(duplicate) error = nil")
	}
}
