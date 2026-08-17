package observability

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v3"
)

var requestDurationBuckets = [...]time.Duration{
	5 * time.Millisecond,
	10 * time.Millisecond,
	25 * time.Millisecond,
	50 * time.Millisecond,
	100 * time.Millisecond,
	250 * time.Millisecond,
	500 * time.Millisecond,
	time.Second,
	2500 * time.Millisecond,
	5 * time.Second,
	10 * time.Second,
}

type metricKey struct {
	method string
	route  string
	status int
}

type metricValue struct {
	count             atomic.Uint64
	durationTotalNano atomic.Uint64
	buckets           [len(requestDurationBuckets)]atomic.Uint64
}

type metricSnapshot struct {
	key               metricKey
	count             uint64
	durationTotalNano uint64
	buckets           [len(requestDurationBuckets)]uint64
}

type Metrics struct {
	startedAt time.Time
	inFlight  atomic.Int64
	requests  sync.Map
}

func NewMetrics() *Metrics {
	return &Metrics{startedAt: time.Now()}
}

func (m *Metrics) Middleware(c fiber.Ctx) error {
	if c.Path() == "/metrics" {
		return c.Next()
	}

	m.inFlight.Add(1)
	startedAt := time.Now()
	err := c.Next()
	duration := time.Since(startedAt)
	m.inFlight.Add(-1)

	key := metricKey{method: c.Method(), route: routePath(c), status: responseStatus(c, err)}
	loaded, exists := m.requests.Load(key)
	if !exists {
		loaded, _ = m.requests.LoadOrStore(key, &metricValue{})
	}
	value := loaded.(*metricValue)
	value.count.Add(1)
	value.durationTotalNano.Add(uint64(duration))
	for index, upperBound := range requestDurationBuckets {
		if duration <= upperBound {
			value.buckets[index].Add(1)
			break
		}
	}
	return err
}

func (m *Metrics) Handler(c fiber.Ctx) error {
	c.Set(fiber.HeaderContentType, "text/plain; version=0.0.4; charset=utf-8")
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.SendString(m.Render())
}

func (m *Metrics) Render() string {
	snapshots := make([]metricSnapshot, 0)
	m.requests.Range(func(rawKey, rawValue any) bool {
		key := rawKey.(metricKey)
		value := rawValue.(*metricValue)
		snapshot := metricSnapshot{
			key:               key,
			count:             value.count.Load(),
			durationTotalNano: value.durationTotalNano.Load(),
		}
		for index := range requestDurationBuckets {
			snapshot.buckets[index] = value.buckets[index].Load()
		}
		snapshots = append(snapshots, snapshot)
		return true
	})
	sort.Slice(snapshots, func(i, j int) bool {
		left := snapshots[i].key
		right := snapshots[j].key
		if left.route != right.route {
			return left.route < right.route
		}
		if left.method != right.method {
			return left.method < right.method
		}
		return left.status < right.status
	})

	var builder strings.Builder
	builder.WriteString("# HELP goexample_http_requests_in_flight Current HTTP requests.\n")
	builder.WriteString("# TYPE goexample_http_requests_in_flight gauge\n")
	fmt.Fprintf(&builder, "goexample_http_requests_in_flight %d\n", m.inFlight.Load())
	builder.WriteString("# HELP goexample_http_requests_total Total HTTP requests.\n")
	builder.WriteString("# TYPE goexample_http_requests_total counter\n")
	builder.WriteString("# HELP goexample_http_request_duration_seconds HTTP request duration histogram.\n")
	builder.WriteString("# TYPE goexample_http_request_duration_seconds histogram\n")
	for _, snapshot := range snapshots {
		labels := fmt.Sprintf(
			"method=%s,route=%s,status=%s",
			strconv.Quote(snapshot.key.method),
			strconv.Quote(snapshot.key.route),
			strconv.Quote(strconv.Itoa(snapshot.key.status)),
		)
		fmt.Fprintf(&builder, "goexample_http_requests_total{%s} %d\n", labels, snapshot.count)
		var cumulative uint64
		for index, upperBound := range requestDurationBuckets {
			cumulative += snapshot.buckets[index]
			fmt.Fprintf(
				&builder,
				"goexample_http_request_duration_seconds_bucket{%s,le=%s} %d\n",
				labels,
				strconv.Quote(formatDurationBucket(upperBound)),
				cumulative,
			)
		}
		fmt.Fprintf(&builder, "goexample_http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\n", labels, snapshot.count)
		fmt.Fprintf(&builder, "goexample_http_request_duration_seconds_sum{%s} %.9f\n", labels, float64(snapshot.durationTotalNano)/float64(time.Second))
		fmt.Fprintf(&builder, "goexample_http_request_duration_seconds_count{%s} %d\n", labels, snapshot.count)
	}
	builder.WriteString("# HELP goexample_process_uptime_seconds Process uptime in seconds.\n")
	builder.WriteString("# TYPE goexample_process_uptime_seconds gauge\n")
	fmt.Fprintf(&builder, "goexample_process_uptime_seconds %.3f\n", time.Since(m.startedAt).Seconds())
	writeRuntimeMetrics(&builder)
	return builder.String()
}

func writeRuntimeMetrics(builder *strings.Builder) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)

	builder.WriteString("# HELP goexample_go_goroutines Current number of goroutines.\n")
	builder.WriteString("# TYPE goexample_go_goroutines gauge\n")
	fmt.Fprintf(builder, "goexample_go_goroutines %d\n", runtime.NumGoroutine())
	builder.WriteString("# HELP goexample_go_gomaxprocs Current GOMAXPROCS value.\n")
	builder.WriteString("# TYPE goexample_go_gomaxprocs gauge\n")
	fmt.Fprintf(builder, "goexample_go_gomaxprocs %d\n", runtime.GOMAXPROCS(0))
	builder.WriteString("# HELP goexample_go_memory_heap_alloc_bytes Bytes allocated and still in use on the Go heap.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_alloc_bytes gauge\n")
	fmt.Fprintf(builder, "goexample_go_memory_heap_alloc_bytes %d\n", memory.HeapAlloc)
	builder.WriteString("# HELP goexample_go_memory_heap_inuse_bytes Bytes in in-use Go heap spans.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_inuse_bytes gauge\n")
	fmt.Fprintf(builder, "goexample_go_memory_heap_inuse_bytes %d\n", memory.HeapInuse)
	builder.WriteString("# HELP goexample_go_memory_heap_objects Current number of allocated Go heap objects.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_objects gauge\n")
	fmt.Fprintf(builder, "goexample_go_memory_heap_objects %d\n", memory.HeapObjects)
	builder.WriteString("# HELP goexample_go_gc_cycles_total Total completed Go garbage collection cycles.\n")
	builder.WriteString("# TYPE goexample_go_gc_cycles_total counter\n")
	fmt.Fprintf(builder, "goexample_go_gc_cycles_total %d\n", memory.NumGC)
	builder.WriteString("# HELP goexample_go_gc_pause_seconds_total Total stop-the-world GC pause time in seconds.\n")
	builder.WriteString("# TYPE goexample_go_gc_pause_seconds_total counter\n")
	fmt.Fprintf(builder, "goexample_go_gc_pause_seconds_total %.9f\n", float64(memory.PauseTotalNs)/float64(time.Second))
}

func formatDurationBucket(value time.Duration) string {
	return strconv.FormatFloat(value.Seconds(), 'f', -1, 64)
}

func responseStatus(c fiber.Ctx, err error) int {
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return fiber.StatusRequestTimeout
		}
		var fiberError *fiber.Error
		if errors.As(err, &fiberError) {
			return fiberError.Code
		}
		return fiber.StatusInternalServerError
	}
	return c.Response().StatusCode()
}

func routePath(c fiber.Ctx) string {
	if route := c.Route(); route != nil && route.Path != "" {
		return route.Path
	}
	return "unmatched"
}
