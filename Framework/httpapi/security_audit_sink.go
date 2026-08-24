package httpapi

import (
	"context"
	"time"
)

// SecurityAuditRecord is the transport-neutral, low-sensitivity record passed
// to an optional SecurityAuditSink. It intentionally excludes request input,
// credentials, client addresses, raw paths, claims, roles and error text.
type SecurityAuditRecord struct {
	Timestamp time.Time `json:"timestamp"`
	Event     string    `json:"event"`
	Outcome   string    `json:"outcome"`
	Reason    string    `json:"reason"`
	Target    string    `json:"target"`
	RequestID string    `json:"request_id"`
	TraceID   string    `json:"trace_id,omitempty"`
	SpanID    string    `json:"span_id,omitempty"`
	ActorID   string    `json:"actor_id,omitempty"`
}

// SecurityAuditSink receives bounded, low-sensitivity security audit records.
// Implementations must honor context cancellation and should durably enqueue
// records before returning. A sink failure never changes the request result.
type SecurityAuditSink interface {
	WriteSecurityAudit(context.Context, SecurityAuditRecord) error
}
