package observability

import (
	"context"
	"errors"
	"net/http"
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

// requestDurationBucketLabels caches quoted Prometheus `le` values for the
// fixed histogram buckets. Scrapes may render these labels for many snapshots,
// so formatting the constants repeatedly only creates temporary strings.
var requestDurationBucketLabels = func() [len(requestDurationBuckets)]string {
	var labels [len(requestDurationBuckets)]string
	for index, bucket := range requestDurationBuckets {
		labels[index] = strconv.Quote(formatDurationBucket(bucket))
	}
	return labels
}()

var securityEventLabels = [...]string{"login", "bearer", "session", "diagnostics", "authorization", "_OTHER"}
var securityOutcomeLabels = [...]string{"success", "failure", "limited", "_OTHER"}
var httpConnectionStateLabels = [...]string{"new", "active", "idle", "hijacked", "closed", "_OTHER"}

var securityEventLabelValues = quoteMetricLabels(securityEventLabels[:])
var securityOutcomeLabelValues = quoteMetricLabels(securityOutcomeLabels[:])
var httpConnectionStateLabelValues = quoteMetricLabels(httpConnectionStateLabels[:])

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
	startedAt                 time.Time
	inFlight                  atomic.Int64
	requestIDReplaced         atomic.Uint64
	admissionRejected         atomic.Uint64
	drainingRejected          atomic.Uint64
	httpConnectionCapacity    atomic.Int64
	httpConnectionsOpen       atomic.Int64
	httpConnectionEvents      [len(httpConnectionStateLabels)]atomic.Uint64
	traceExporterEnabled      atomic.Bool
	traceExportBatchSuccess   atomic.Uint64
	traceExportBatchFailure   atomic.Uint64
	traceExportSpanSuccess    atomic.Uint64
	traceExportSpanFailure    atomic.Uint64
	traceExportAttemptSuccess atomic.Uint64
	traceExportAttemptFailure atomic.Uint64
	traceQueueDroppedSpans    atomic.Uint64
	traceProcessorCapacity    atomic.Int64
	traceProcessorPending     atomic.Int64
	traceProcessorHighWater   atomic.Int64
	securityEvents            [len(securityEventLabels)][len(securityOutcomeLabels)]atomic.Uint64
	securityAuditSinkSuccess  atomic.Uint64
	securityAuditSinkFailure  atomic.Uint64
	queueWorkersActive        atomic.Int64
	queueWorkerStarted        atomic.Uint64
	queueWorkerStopped        atomic.Uint64
	queueWorkerFailed         atomic.Uint64
	queueDeliveryAcknowledged atomic.Uint64
	queueDeliveryRetried      atomic.Uint64
	queueDeliveryDeadLettered atomic.Uint64
	queueDeliverySettleFailed atomic.Uint64
	queueLeaseExtended        atomic.Uint64
	queueLeaseExtensionFailed atomic.Uint64
	requests                  sync.Map
}

func NewMetrics() *Metrics {
	return &Metrics{startedAt: time.Now()}
}

// RecordRequestIDReplaced records an untrusted request ID that was replaced.
// It intentionally has no labels and never records the rejected value.
func (m *Metrics) RecordRequestIDReplaced() {
	if m == nil {
		return
	}
	m.requestIDReplaced.Add(1)
}

// RecordAdmissionRejected records a request rejected by the bounded
// concurrency guard. It intentionally has no labels to keep cardinality low.
func (m *Metrics) RecordAdmissionRejected() {
	if m == nil {
		return
	}
	m.admissionRejected.Add(1)
}

// RecordDrainingRejected records a request rejected because the instance is
// leaving service. It intentionally has no labels to keep cardinality low.
func (m *Metrics) RecordDrainingRejected() {
	if m == nil {
		return
	}
	m.drainingRejected.Add(1)
}

// SetHTTPConnectionCapacity records the configured standard server connection
// bound. Values outside the server contract collapse to zero.
func (m *Metrics) SetHTTPConnectionCapacity(capacity int) {
	if m == nil {
		return
	}
	if capacity < 1 || capacity > 1<<20 {
		capacity = 0
	}
	m.httpConnectionCapacity.Store(int64(capacity))
}

// ObserveHTTPConnectionState records fixed net/http lifecycle states without
// connection addresses or identifiers.
func (m *Metrics) ObserveHTTPConnectionState(state http.ConnState) {
	if m == nil {
		return
	}
	m.httpConnectionEvents[httpConnectionStateIndex(state)].Add(1)
	switch state {
	case http.StateNew:
		m.httpConnectionsOpen.Add(1)
	case http.StateHijacked, http.StateClosed:
		decrementNonnegative(&m.httpConnectionsOpen)
	}
}

// RecordSecurityEvent records a security event using a fixed-cardinality
// event/outcome matrix. Unknown values collapse to _OTHER and are never
// emitted as labels.
func (m *Metrics) RecordSecurityEvent(event, outcome string) {
	if m == nil {
		return
	}
	m.securityEvents[securityLabelIndex(securityEventLabels[:], event)][securityLabelIndex(securityOutcomeLabels[:], outcome)].Add(1)
}

// RecordSecurityAuditSinkWrite records an audit sink delivery outcome without
// labels derived from the sink, its error or the audit record.
func (m *Metrics) RecordSecurityAuditSinkWrite(success bool) {
	if m == nil {
		return
	}
	if success {
		m.securityAuditSinkSuccess.Add(1)
		return
	}
	m.securityAuditSinkFailure.Add(1)
}

// WorkerStarted records one queue worker entering its receive loop. It has no
// labels so broker names, destinations, and message metadata cannot leak.
func (m *Metrics) WorkerStarted() {
	if m == nil {
		return
	}
	m.queueWorkersActive.Add(1)
	m.queueWorkerStarted.Add(1)
}

// WorkerStopped records one queue worker leaving its receive loop.
func (m *Metrics) WorkerStopped() {
	if m == nil {
		return
	}
	m.queueWorkersActive.Add(-1)
	m.queueWorkerStopped.Add(1)
}

// WorkerFailed records the first failure observed by a queue worker group.
func (m *Metrics) WorkerFailed() {
	if m != nil {
		m.queueWorkerFailed.Add(1)
	}
}

// DeliveryAcknowledged records a successfully processed and acknowledged
// reliable delivery without broker or message labels.
func (m *Metrics) DeliveryAcknowledged() {
	if m != nil {
		m.queueDeliveryAcknowledged.Add(1)
	}
}

// DeliveryRetried records one bounded in-process delivery retry.
func (m *Metrics) DeliveryRetried() {
	if m != nil {
		m.queueDeliveryRetried.Add(1)
	}
}

// DeliveryDeadLettered records a failed delivery settled through its injected
// dead-letter callback.
func (m *Metrics) DeliveryDeadLettered() {
	if m != nil {
		m.queueDeliveryDeadLettered.Add(1)
	}
}

// DeliverySettlementFailed records acknowledgement or dead-letter callback
// failure, timeout, or panic without exposing the underlying error.
func (m *Metrics) DeliverySettlementFailed() {
	if m != nil {
		m.queueDeliverySettleFailed.Add(1)
	}
}

// DeliveryLeaseExtended records one successful broker lease-extension signal
// without broker, destination, message, interval, or error labels.
func (m *Metrics) DeliveryLeaseExtended() {
	if m != nil {
		m.queueLeaseExtended.Add(1)
	}
}

// DeliveryLeaseExtensionFailed records a failed, timed-out, or panicking
// lease-extension callback without exposing backend details.
func (m *Metrics) DeliveryLeaseExtensionFailed() {
	if m != nil {
		m.queueLeaseExtensionFailed.Add(1)
	}
}

func securityLabelIndex(labels []string, value string) int {
	for index := 0; index < len(labels)-1; index++ {
		if value == labels[index] {
			return index
		}
	}
	return len(labels) - 1
}

func httpConnectionStateIndex(state http.ConnState) int {
	switch state {
	case http.StateNew:
		return 0
	case http.StateActive:
		return 1
	case http.StateIdle:
		return 2
	case http.StateHijacked:
		return 3
	case http.StateClosed:
		return 4
	default:
		return len(httpConnectionStateLabels) - 1
	}
}

func decrementNonnegative(value *atomic.Int64) {
	for {
		current := value.Load()
		if current <= 0 || value.CompareAndSwap(current, current-1) {
			return
		}
	}
}

func (m *Metrics) configureTraceExporter(enabled bool) {
	if m != nil {
		m.traceExporterEnabled.Store(enabled)
	}
}

func (m *Metrics) recordTraceExport(spanCount int, err error) {
	if m == nil {
		return
	}
	if err == nil {
		m.traceExportBatchSuccess.Add(1)
		m.traceExportSpanSuccess.Add(uint64(spanCount))
		return
	}
	m.traceExportBatchFailure.Add(1)
	m.traceExportSpanFailure.Add(uint64(spanCount))
}

func (m *Metrics) recordTraceExportAttempt(success bool) {
	if m == nil {
		return
	}
	if success {
		m.traceExportAttemptSuccess.Add(1)
		return
	}
	m.traceExportAttemptFailure.Add(1)
}

func (m *Metrics) recordTraceQueueDrop(spanCount int) {
	if m != nil {
		m.traceQueueDroppedSpans.Add(uint64(spanCount))
	}
}

func (m *Metrics) configureTraceProcessorCapacity(capacity int) {
	if m != nil {
		m.traceProcessorCapacity.Store(int64(capacity))
	}
}

func (m *Metrics) recordTraceProcessorAcquire() {
	if m == nil {
		return
	}
	pending := m.traceProcessorPending.Add(1)
	for {
		highWater := m.traceProcessorHighWater.Load()
		if pending <= highWater || m.traceProcessorHighWater.CompareAndSwap(highWater, pending) {
			return
		}
	}
}

func (m *Metrics) recordTraceProcessorRelease(spanCount int) {
	if m != nil {
		m.traceProcessorPending.Add(-int64(spanCount))
	}
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
	c.Set(fiber.HeaderPragma, "no-cache")
	return c.SendString(m.Render())
}

func (m *Metrics) Render() string {
	snapshots := make([]metricSnapshot, 0, 32)
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
	builder.Grow(16 << 10)
	builder.WriteString("# HELP goexample_http_requests_in_flight Current HTTP requests.\n")
	builder.WriteString("# TYPE goexample_http_requests_in_flight gauge\n")
	writeMetricInt(&builder, "goexample_http_requests_in_flight ", m.inFlight.Load())
	builder.WriteString("# HELP goexample_http_request_id_replacements_total Untrusted request IDs replaced by the server.\n")
	builder.WriteString("# TYPE goexample_http_request_id_replacements_total counter\n")
	writeMetricUint(&builder, "goexample_http_request_id_replacements_total ", m.requestIDReplaced.Load())
	builder.WriteString("# HELP goexample_http_admission_rejections_total Requests rejected because API admission capacity was exhausted.\n")
	builder.WriteString("# TYPE goexample_http_admission_rejections_total counter\n")
	writeMetricUint(&builder, "goexample_http_admission_rejections_total ", m.admissionRejected.Load())
	builder.WriteString("# HELP goexample_http_draining_rejections_total Requests rejected because the instance is draining.\n")
	builder.WriteString("# TYPE goexample_http_draining_rejections_total counter\n")
	writeMetricUint(&builder, "goexample_http_draining_rejections_total ", m.drainingRejected.Load())
	builder.WriteString("# HELP goexample_http_server_connection_capacity Maximum connections accepted by the standard HTTP server.\n")
	builder.WriteString("# TYPE goexample_http_server_connection_capacity gauge\n")
	writeMetricInt(&builder, "goexample_http_server_connection_capacity ", m.httpConnectionCapacity.Load())
	builder.WriteString("# HELP goexample_http_server_connections Current connections accepted by the standard HTTP server.\n")
	builder.WriteString("# TYPE goexample_http_server_connections gauge\n")
	writeMetricInt(&builder, "goexample_http_server_connections ", m.httpConnectionsOpen.Load())
	builder.WriteString("# HELP goexample_http_server_connection_events_total Fixed-cardinality standard HTTP connection lifecycle events.\n")
	builder.WriteString("# TYPE goexample_http_server_connection_events_total counter\n")
	for index := range httpConnectionStateLabels {
		builder.WriteString("goexample_http_server_connection_events_total{state=")
		builder.WriteString(httpConnectionStateLabelValues[index])
		builder.WriteString("} ")
		writeMetricUintValue(&builder, m.httpConnectionEvents[index].Load())
		builder.WriteByte('\n')
	}
	builder.WriteString("# HELP goexample_security_events_total Security authentication and privileged-access events with fixed labels.\n")
	builder.WriteString("# TYPE goexample_security_events_total counter\n")
	for eventIndex := range securityEventLabels {
		for outcomeIndex := range securityOutcomeLabels {
			builder.WriteString("goexample_security_events_total{event=")
			builder.WriteString(securityEventLabelValues[eventIndex])
			builder.WriteString(",outcome=")
			builder.WriteString(securityOutcomeLabelValues[outcomeIndex])
			builder.WriteString("} ")
			writeMetricUintValue(&builder, m.securityEvents[eventIndex][outcomeIndex].Load())
			builder.WriteByte('\n')
		}
	}
	builder.WriteString("# HELP goexample_security_audit_sink_writes_total Security audit sink write outcomes with fixed labels.\n")
	builder.WriteString("# TYPE goexample_security_audit_sink_writes_total counter\n")
	writeMetricUint(&builder, "goexample_security_audit_sink_writes_total{outcome=\"success\"} ", m.securityAuditSinkSuccess.Load())
	writeMetricUint(&builder, "goexample_security_audit_sink_writes_total{outcome=\"failure\"} ", m.securityAuditSinkFailure.Load())
	builder.WriteString("# HELP goexample_queue_workers_active Current active broker-neutral queue workers.\n")
	builder.WriteString("# TYPE goexample_queue_workers_active gauge\n")
	writeMetricInt(&builder, "goexample_queue_workers_active ", m.queueWorkersActive.Load())
	builder.WriteString("# HELP goexample_queue_worker_events_total Fixed-cardinality queue worker lifecycle events.\n")
	builder.WriteString("# TYPE goexample_queue_worker_events_total counter\n")
	writeMetricUint(&builder, "goexample_queue_worker_events_total{event=\"started\"} ", m.queueWorkerStarted.Load())
	writeMetricUint(&builder, "goexample_queue_worker_events_total{event=\"stopped\"} ", m.queueWorkerStopped.Load())
	writeMetricUint(&builder, "goexample_queue_worker_events_total{event=\"failure\"} ", m.queueWorkerFailed.Load())
	builder.WriteString("# HELP goexample_queue_delivery_events_total Fixed-cardinality reliable-delivery settlement events.\n")
	builder.WriteString("# TYPE goexample_queue_delivery_events_total counter\n")
	writeMetricUint(&builder, "goexample_queue_delivery_events_total{event=\"acknowledged\"} ", m.queueDeliveryAcknowledged.Load())
	writeMetricUint(&builder, "goexample_queue_delivery_events_total{event=\"retried\"} ", m.queueDeliveryRetried.Load())
	writeMetricUint(&builder, "goexample_queue_delivery_events_total{event=\"dead_lettered\"} ", m.queueDeliveryDeadLettered.Load())
	writeMetricUint(&builder, "goexample_queue_delivery_events_total{event=\"settlement_failed\"} ", m.queueDeliverySettleFailed.Load())
	builder.WriteString("# HELP goexample_queue_delivery_lease_events_total Fixed-cardinality delivery lease-extension events.\n")
	builder.WriteString("# TYPE goexample_queue_delivery_lease_events_total counter\n")
	writeMetricUint(&builder, "goexample_queue_delivery_lease_events_total{event=\"extended\"} ", m.queueLeaseExtended.Load())
	writeMetricUint(&builder, "goexample_queue_delivery_lease_events_total{event=\"failure\"} ", m.queueLeaseExtensionFailed.Load())
	builder.WriteString("# HELP goexample_otel_trace_exporter_enabled Whether OTLP trace export is configured for this process.\n")
	builder.WriteString("# TYPE goexample_otel_trace_exporter_enabled gauge\n")
	if m.traceExporterEnabled.Load() {
		builder.WriteString("goexample_otel_trace_exporter_enabled 1\n")
	} else {
		builder.WriteString("goexample_otel_trace_exporter_enabled 0\n")
	}
	builder.WriteString("# HELP goexample_otel_trace_export_batches_total Final OTLP trace export batch outcomes after exporter retries.\n")
	builder.WriteString("# TYPE goexample_otel_trace_export_batches_total counter\n")
	writeMetricUint(&builder, "goexample_otel_trace_export_batches_total{outcome=\"success\"} ", m.traceExportBatchSuccess.Load())
	writeMetricUint(&builder, "goexample_otel_trace_export_batches_total{outcome=\"failure\"} ", m.traceExportBatchFailure.Load())
	builder.WriteString("# HELP goexample_otel_trace_export_spans_total Spans in final OTLP trace export batch outcomes.\n")
	builder.WriteString("# TYPE goexample_otel_trace_export_spans_total counter\n")
	writeMetricUint(&builder, "goexample_otel_trace_export_spans_total{outcome=\"success\"} ", m.traceExportSpanSuccess.Load())
	writeMetricUint(&builder, "goexample_otel_trace_export_spans_total{outcome=\"failure\"} ", m.traceExportSpanFailure.Load())
	builder.WriteString("# HELP goexample_otel_trace_export_attempts_total Individual OTLP HTTP attempt outcomes before and during exporter retries.\n")
	builder.WriteString("# TYPE goexample_otel_trace_export_attempts_total counter\n")
	writeMetricUint(&builder, "goexample_otel_trace_export_attempts_total{outcome=\"success\"} ", m.traceExportAttemptSuccess.Load())
	writeMetricUint(&builder, "goexample_otel_trace_export_attempts_total{outcome=\"failure\"} ", m.traceExportAttemptFailure.Load())
	builder.WriteString("# HELP goexample_otel_trace_queue_dropped_spans_total Spans dropped before OTLP export because the bounded processor capacity was exhausted.\n")
	builder.WriteString("# TYPE goexample_otel_trace_queue_dropped_spans_total counter\n")
	writeMetricUint(&builder, "goexample_otel_trace_queue_dropped_spans_total ", m.traceQueueDroppedSpans.Load())
	builder.WriteString("# HELP goexample_otel_trace_processor_capacity_spans Maximum spans admitted across the current batch and queue.\n")
	builder.WriteString("# TYPE goexample_otel_trace_processor_capacity_spans gauge\n")
	writeMetricInt(&builder, "goexample_otel_trace_processor_capacity_spans ", m.traceProcessorCapacity.Load())
	builder.WriteString("# HELP goexample_otel_trace_processor_pending_spans Spans admitted and awaiting a final exporter outcome.\n")
	builder.WriteString("# TYPE goexample_otel_trace_processor_pending_spans gauge\n")
	writeMetricInt(&builder, "goexample_otel_trace_processor_pending_spans ", m.traceProcessorPending.Load())
	builder.WriteString("# HELP goexample_otel_trace_processor_high_watermark_spans Highest pending span count observed by this process.\n")
	builder.WriteString("# TYPE goexample_otel_trace_processor_high_watermark_spans gauge\n")
	writeMetricInt(&builder, "goexample_otel_trace_processor_high_watermark_spans ", m.traceProcessorHighWater.Load())
	builder.WriteString("# HELP goexample_http_requests_total Total HTTP requests.\n")
	builder.WriteString("# TYPE goexample_http_requests_total counter\n")
	builder.WriteString("# HELP goexample_http_request_duration_seconds HTTP request duration histogram.\n")
	builder.WriteString("# TYPE goexample_http_request_duration_seconds histogram\n")
	var labelsBuffer [256]byte
	for _, snapshot := range snapshots {
		labels := appendMetricLabels(labelsBuffer[:0], snapshot.key)
		builder.WriteString("goexample_http_requests_total{")
		_, _ = builder.Write(labels)
		builder.WriteString("} ")
		writeMetricUintValue(&builder, snapshot.count)
		builder.WriteByte('\n')
		var cumulative uint64
		for index := range requestDurationBuckets {
			cumulative += snapshot.buckets[index]
			builder.WriteString("goexample_http_request_duration_seconds_bucket{")
			_, _ = builder.Write(labels)
			builder.WriteString(",le=")
			builder.WriteString(requestDurationBucketLabels[index])
			builder.WriteString("} ")
			writeMetricUintValue(&builder, cumulative)
			builder.WriteByte('\n')
		}
		builder.WriteString("goexample_http_request_duration_seconds_bucket{")
		_, _ = builder.Write(labels)
		builder.WriteString(",le=\"+Inf\"} ")
		writeMetricUintValue(&builder, snapshot.count)
		builder.WriteByte('\n')
		builder.WriteString("goexample_http_request_duration_seconds_sum{")
		_, _ = builder.Write(labels)
		builder.WriteString("} ")
		writeMetricFloat(&builder, float64(snapshot.durationTotalNano)/float64(time.Second), 9)
		builder.WriteByte('\n')
		builder.WriteString("goexample_http_request_duration_seconds_count{")
		_, _ = builder.Write(labels)
		builder.WriteString("} ")
		writeMetricUintValue(&builder, snapshot.count)
		builder.WriteByte('\n')
	}
	builder.WriteString("# HELP goexample_process_uptime_seconds Process uptime in seconds.\n")
	builder.WriteString("# TYPE goexample_process_uptime_seconds gauge\n")
	builder.WriteString("goexample_process_uptime_seconds ")
	writeMetricFloat(&builder, time.Since(m.startedAt).Seconds(), 3)
	builder.WriteByte('\n')
	writeRuntimeMetrics(&builder)
	return builder.String()
}

func appendMetricLabels(labels []byte, key metricKey) []byte {
	labels = append(labels, "method="...)
	labels = strconv.AppendQuote(labels, key.method)
	labels = append(labels, ",route="...)
	labels = strconv.AppendQuote(labels, key.route)
	labels = append(labels, ",status=\""...)
	labels = strconv.AppendInt(labels, int64(key.status), 10)
	return append(labels, '"')
}

func quoteMetricLabels(labels []string) []string {
	quoted := make([]string, len(labels))
	for index, label := range labels {
		quoted[index] = strconv.Quote(label)
	}
	return quoted
}

func writeMetricUint(builder *strings.Builder, prefix string, value uint64) {
	builder.WriteString(prefix)
	writeMetricUintValue(builder, value)
	builder.WriteByte('\n')
}

func writeMetricUintValue(builder *strings.Builder, value uint64) {
	var buffer [20]byte
	_, _ = builder.Write(strconv.AppendUint(buffer[:0], value, 10))
}

func writeMetricInt(builder *strings.Builder, prefix string, value int64) {
	builder.WriteString(prefix)
	var buffer [20]byte
	_, _ = builder.Write(strconv.AppendInt(buffer[:0], value, 10))
	builder.WriteByte('\n')
}

func writeMetricFloat(builder *strings.Builder, value float64, precision int) {
	var buffer [32]byte
	_, _ = builder.Write(strconv.AppendFloat(buffer[:0], value, 'f', precision, 64))
}

func writeRuntimeMetrics(builder *strings.Builder) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)

	builder.WriteString("# HELP goexample_go_goroutines Current number of goroutines.\n")
	builder.WriteString("# TYPE goexample_go_goroutines gauge\n")
	writeMetricUint(builder, "goexample_go_goroutines ", uint64(runtime.NumGoroutine()))
	builder.WriteString("# HELP goexample_go_gomaxprocs Current GOMAXPROCS value.\n")
	builder.WriteString("# TYPE goexample_go_gomaxprocs gauge\n")
	writeMetricInt(builder, "goexample_go_gomaxprocs ", int64(runtime.GOMAXPROCS(0)))
	builder.WriteString("# HELP goexample_go_memory_heap_alloc_bytes Bytes allocated and still in use on the Go heap.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_alloc_bytes gauge\n")
	writeMetricUint(builder, "goexample_go_memory_heap_alloc_bytes ", memory.HeapAlloc)
	builder.WriteString("# HELP goexample_go_memory_heap_inuse_bytes Bytes in in-use Go heap spans.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_inuse_bytes gauge\n")
	writeMetricUint(builder, "goexample_go_memory_heap_inuse_bytes ", memory.HeapInuse)
	builder.WriteString("# HELP goexample_go_memory_heap_objects Current number of allocated Go heap objects.\n")
	builder.WriteString("# TYPE goexample_go_memory_heap_objects gauge\n")
	writeMetricUint(builder, "goexample_go_memory_heap_objects ", memory.HeapObjects)
	builder.WriteString("# HELP goexample_go_gc_cycles_total Total completed Go garbage collection cycles.\n")
	builder.WriteString("# TYPE goexample_go_gc_cycles_total counter\n")
	writeMetricUint(builder, "goexample_go_gc_cycles_total ", uint64(memory.NumGC))
	builder.WriteString("# HELP goexample_go_gc_pause_seconds_total Total stop-the-world GC pause time in seconds.\n")
	builder.WriteString("# TYPE goexample_go_gc_pause_seconds_total counter\n")
	builder.WriteString("goexample_go_gc_pause_seconds_total ")
	writeMetricFloat(builder, float64(memory.PauseTotalNs)/float64(time.Second), 9)
	builder.WriteByte('\n')
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
