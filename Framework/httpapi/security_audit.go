package httpapi

import (
	"context"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	"github.com/zbxing/goexample/Framework/observability"
)

const (
	securityEventLogin         = "login"
	securityEventBearer        = "bearer"
	securityEventSession       = "session"
	securityEventDiagnostics   = "diagnostics"
	securityEventAuthorization = "authorization"

	securityOutcomeSuccess = "success"
	securityOutcomeFailure = "failure"
	securityOutcomeLimited = "limited"
)

func recordSecurityAudit(
	c fiber.Ctx,
	options Options,
	event, outcome, reason, target, actorID string,
) {
	options.Metrics.RecordSecurityEvent(event, outcome)
	requestID := requestid.FromContext(c)
	traceID := ""
	spanID := ""
	if traceContext, ok := observability.FromContext(c.Context()); ok {
		traceID = traceContext.TraceID
		spanID = traceContext.SpanID
	}
	attributes := []any{
		"event", event,
		"outcome", outcome,
		"reason", reason,
		"target", target,
		"request_id", requestID,
	}
	if actorID != "" {
		attributes = append(attributes, "actor_id", actorID)
	}
	if traceID != "" || spanID != "" {
		attributes = append(attributes,
			"trace_id", traceID,
			"span_id", spanID,
		)
	}

	logContext := c.Context()
	if logContext == nil {
		logContext = context.Background()
	}
	if outcome == securityOutcomeSuccess {
		options.Logger.InfoContext(logContext, "security_audit", attributes...)
	} else {
		options.Logger.WarnContext(logContext, "security_audit", attributes...)
	}

	if options.SecurityAuditSink == nil {
		return
	}
	record := SecurityAuditRecord{
		Timestamp: options.Now().UTC(),
		Event:     event,
		Outcome:   outcome,
		Reason:    reason,
		Target:    target,
		RequestID: requestID,
		TraceID:   traceID,
		SpanID:    spanID,
		ActorID:   actorID,
	}
	options.Metrics.RecordSecurityAuditSinkWrite(writeSecurityAudit(logContext, options, record))
}

func writeSecurityAudit(parent context.Context, options Options, record SecurityAuditRecord) (success bool) {
	defer func() {
		if recover() != nil {
			success = false
		}
	}()
	writeContext, cancel := context.WithTimeout(parent, options.SecurityAuditTimeout)
	defer cancel()
	return options.SecurityAuditSink.WriteSecurityAudit(writeContext, record) == nil
}
