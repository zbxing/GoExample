package httpapi

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/zbxing/goexample/Framework/observability"
)

type securityAuditSinkFunc func(context.Context, SecurityAuditRecord) error

func (write securityAuditSinkFunc) WriteSecurityAudit(ctx context.Context, record SecurityAuditRecord) error {
	return write(ctx, record)
}

func TestSecurityAuditSinkReceivesBoundedLowSensitivityRecord(t *testing.T) {
	var received SecurityAuditRecord
	options := testOptions()
	options.SecurityAuditSink = securityAuditSinkFunc(func(_ context.Context, record SecurityAuditRecord) error {
		received = record
		return nil
	})
	app := New(options)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me?token=query-secret", http.NoBody)
	request.Header.Set("Authorization", "Bearer header-secret")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}

	if received.Event != securityEventBearer || received.Outcome != securityOutcomeFailure ||
		received.Reason != "token_invalid" || received.Target != "api" {
		t.Fatalf("record decision = %#v", received)
	}
	if received.RequestID == "" || received.TraceID == "" || received.SpanID == "" {
		t.Fatalf("record correlation = %#v", received)
	}
	if !received.Timestamp.Equal(options.Now().UTC()) {
		t.Fatalf("record timestamp = %s, want %s", received.Timestamp, options.Now().UTC())
	}
	if received.ActorID != "" {
		t.Fatalf("failed authentication actor ID = %q", received.ActorID)
	}
	recordType := reflect.TypeOf(received)
	fieldNames := make([]string, 0, recordType.NumField())
	for index := range recordType.NumField() {
		fieldNames = append(fieldNames, recordType.Field(index).Name)
	}
	wantFieldNames := []string{"Timestamp", "Event", "Outcome", "Reason", "Target", "RequestID", "TraceID", "SpanID", "ActorID"}
	if !reflect.DeepEqual(fieldNames, wantFieldNames) {
		t.Fatalf("SecurityAuditRecord fields = %v, want low-sensitivity fields %v", fieldNames, wantFieldNames)
	}
	if rendered := strings.ToLower(strings.Join([]string{
		received.Timestamp.String(), received.Event, received.Outcome, received.Reason,
		received.Target, received.RequestID, received.TraceID, received.SpanID, received.ActorID,
	}, " ")); strings.Contains(rendered, "query-secret") || strings.Contains(rendered, "header-secret") {
		t.Fatalf("SecurityAuditRecord leaked request credential: %s", rendered)
	}
	metrics := options.Metrics.Render()
	if !strings.Contains(metrics, `goexample_security_audit_sink_writes_total{outcome="success"} 1`) {
		t.Fatalf("successful sink metric missing: %s", metrics)
	}
}

func TestSecurityAuditSinkFailuresAreIsolatedAndCredentialSafe(t *testing.T) {
	tests := []struct {
		name string
		sink securityAuditSinkFunc
	}{
		{
			name: "error",
			sink: func(context.Context, SecurityAuditRecord) error {
				return errors.New("sink-error-secret")
			},
		},
		{
			name: "panic",
			sink: func(context.Context, SecurityAuditRecord) error {
				panic("sink-panic-secret")
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			options := testOptions()
			options.Logger = observability.NewLogger("json", "info", &output)
			options.SecurityAuditSink = test.sink
			app := New(options)

			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody))
			if err != nil {
				t.Fatalf("request error = %v", err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
			}
			combined := output.String() + options.Metrics.Render()
			if strings.Contains(combined, "sink-error-secret") || strings.Contains(combined, "sink-panic-secret") {
				t.Fatalf("sink failure secret leaked: %s", combined)
			}
			if !strings.Contains(combined, `goexample_security_audit_sink_writes_total{outcome="failure"} 1`) {
				t.Fatalf("failed sink metric missing: %s", combined)
			}
		})
	}
}

func TestSecurityAuditSinkHonorsConfiguredTimeoutWithoutChangingResponse(t *testing.T) {
	const timeout = 20 * time.Millisecond
	options := testOptions()
	options.SecurityAuditTimeout = timeout
	options.SecurityAuditSink = securityAuditSinkFunc(func(ctx context.Context, _ SecurityAuditRecord) error {
		<-ctx.Done()
		return ctx.Err()
	})
	app := New(options)

	startedAt := time.Now()
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", http.NoBody))
	elapsed := time.Since(startedAt)
	if err != nil {
		t.Fatalf("request error = %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
	if elapsed < timeout || elapsed > 500*time.Millisecond {
		t.Fatalf("request elapsed = %s, want bounded near %s", elapsed, timeout)
	}
	if metrics := options.Metrics.Render(); !strings.Contains(metrics, `goexample_security_audit_sink_writes_total{outcome="failure"} 1`) {
		t.Fatalf("timed-out sink metric missing: %s", metrics)
	}
}
