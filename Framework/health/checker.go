package health

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultCheckTimeout = 2 * time.Second
	defaultCacheTTL     = time.Second
)

type Check func(context.Context) error

type Report struct {
	Ready  bool              `json:"-"`
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

type Checker struct {
	timeout   time.Duration
	cacheTTL  time.Duration
	draining  atomic.Bool
	revision  atomic.Uint64
	checksMu  sync.RWMutex
	checks    map[string]Check
	cacheMu   sync.Mutex
	cached    Report
	cacheTill time.Time
	refresh   chan struct{}
}

func New(timeout time.Duration, cacheTTL ...time.Duration) *Checker {
	if timeout <= 0 {
		timeout = defaultCheckTimeout
	}
	ttl := defaultCacheTTL
	if len(cacheTTL) > 0 && cacheTTL[0] > 0 {
		ttl = cacheTTL[0]
	}
	return &Checker{
		timeout:  timeout,
		cacheTTL: ttl,
		checks:   make(map[string]Check),
	}
}

func (c *Checker) Register(name string, check Check) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("health check name cannot be empty")
	}
	if check == nil {
		return errors.New("health check cannot be nil")
	}

	c.checksMu.Lock()
	if _, exists := c.checks[name]; exists {
		c.checksMu.Unlock()
		return fmt.Errorf("health check %q is already registered", name)
	}
	c.checks[name] = check
	c.checksMu.Unlock()
	c.revision.Add(1)
	c.invalidateCache()
	return nil
}

func (c *Checker) SetDraining(draining bool) {
	c.draining.Store(draining)
	c.revision.Add(1)
	c.invalidateCache()
}

// Draining reports whether the instance is refusing new business work during
// graceful shutdown. It is a lock-free snapshot for admission middleware.
func (c *Checker) Draining() bool {
	if c == nil {
		return false
	}
	return c.draining.Load()
}

func (c *Checker) Readiness(ctx context.Context) Report {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		if c.draining.Load() {
			return drainingReport()
		}
		c.cacheMu.Lock()
		if c.draining.Load() {
			c.cacheMu.Unlock()
			return drainingReport()
		}
		if !c.cacheTill.IsZero() && time.Now().Before(c.cacheTill) {
			report := cloneReport(c.cached)
			c.cacheMu.Unlock()
			return report
		}
		refresh := c.refresh
		if refresh == nil {
			refresh = make(chan struct{})
			c.refresh = refresh
			revision := c.revision.Load()
			go c.refreshCache(context.WithoutCancel(ctx), revision, refresh)
		}
		c.cacheMu.Unlock()

		select {
		case <-refresh:
			continue
		case <-ctx.Done():
			return canceledReport()
		}
	}
}

func (c *Checker) runChecks(ctx context.Context) Report {
	c.checksMu.RLock()
	checks := make(map[string]Check, len(c.checks))
	for name, check := range c.checks {
		checks[name] = check
	}
	c.checksMu.RUnlock()
	if len(checks) == 0 {
		return Report{Ready: true, Status: "ready"}
	}

	type result struct {
		name string
		err  error
	}
	checkCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	results := make(chan result, len(checks))
	for name, check := range checks {
		go func() {
			results <- result{name: name, err: check(checkCtx)}
		}()
	}

	report := Report{
		Ready:  true,
		Status: "ready",
		Checks: make(map[string]string, len(checks)),
	}
	pending := make(map[string]struct{}, len(checks))
	for name := range checks {
		pending[name] = struct{}{}
	}
	for len(pending) > 0 {
		select {
		case result := <-results:
			if _, waiting := pending[result.name]; !waiting {
				continue
			}
			delete(pending, result.name)
			if result.err != nil {
				report.Ready = false
				report.Checks[result.name] = "failed"
				continue
			}
			report.Checks[result.name] = "ok"
		case <-checkCtx.Done():
			report.Ready = false
			for name := range pending {
				report.Checks[name] = "failed"
			}
			pending = nil
		}
	}
	if !report.Ready {
		report.Status = "not_ready"
	}
	return report
}

func (c *Checker) refreshCache(ctx context.Context, revision uint64, refresh chan struct{}) {
	report := c.runChecks(ctx)
	c.cacheMu.Lock()
	if !c.draining.Load() && c.revision.Load() == revision {
		c.cached = cloneReport(report)
		c.cacheTill = time.Now().Add(c.cacheTTL)
	}
	if c.refresh == refresh {
		c.refresh = nil
		close(refresh)
	}
	c.cacheMu.Unlock()
}

func (c *Checker) invalidateCache() {
	c.cacheMu.Lock()
	c.cacheTill = time.Time{}
	c.cached = Report{}
	c.cacheMu.Unlock()
}

func drainingReport() Report {
	return Report{
		Ready:  false,
		Status: "not_ready",
		Checks: map[string]string{"lifecycle": "draining"},
	}
}

func canceledReport() Report {
	return Report{
		Ready:  false,
		Status: "not_ready",
		Checks: map[string]string{"request": "canceled"},
	}
}

func cloneReport(report Report) Report {
	clone := Report{Ready: report.Ready, Status: report.Status}
	if report.Checks != nil {
		clone.Checks = make(map[string]string, len(report.Checks))
		for name, status := range report.Checks {
			clone.Checks[name] = status
		}
	}
	return clone
}
