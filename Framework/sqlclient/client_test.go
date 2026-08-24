package sqlclient

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

const scriptedDriverName = "goexample-sqlclient-test"

var registeredScriptedDriver = &scriptedDriver{}
var scriptedDatabaseID atomic.Int64

func init() {
	sql.Register(scriptedDriverName, registeredScriptedDriver)
}

func TestNewValidatesAndAppliesFinitePoolConfiguration(t *testing.T) {
	if _, err := New(nil, Config{}); err == nil {
		t.Fatal("New(nil) error = nil")
	}

	tests := []Config{
		{OperationTimeout: -time.Second},
		{OperationTimeout: 2 * time.Second, TransactionTimeout: time.Second},
		{MaxOpenConnections: -1},
		{MaxOpenConnections: 2, MaxIdleConnections: 3},
		{ConnectionMaxLifetime: -time.Second},
		{ConnectionMaxLifetime: time.Second, ConnectionMaxIdleTime: 2 * time.Second},
		{TransactionMaxAttempts: -1},
		{TransactionMaxAttempts: maxTransactionAttempts + 1},
		{RetryInitialBackoff: -time.Millisecond},
		{RetryMaxBackoff: -time.Millisecond},
		{RetryInitialBackoff: 2 * time.Second, RetryMaxBackoff: time.Second},
	}
	for index, config := range tests {
		database, _ := openScriptedDatabase(t)
		if _, err := New(database, config); err == nil {
			t.Fatalf("New() invalid config %d error = nil", index)
		}
		_ = database.Close()
	}

	database, state := openScriptedDatabase(t)
	client, err := New(database, Config{
		OperationTimeout:      200 * time.Millisecond,
		TransactionTimeout:    time.Second,
		MaxOpenConnections:    7,
		MaxIdleConnections:    3,
		ConnectionMaxLifetime: time.Minute,
		ConnectionMaxIdleTime: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if got := client.Stats().MaxOpenConnections; got != 7 {
		t.Fatalf("MaxOpenConnections = %d, want 7", got)
	}
	if got := state.pings.Load(); got != 0 {
		t.Fatalf("New() performed %d pings, want 0", got)
	}
	if client.transactionMaxAttempts != defaultTransactionAttempts ||
		client.retryInitialBackoff != defaultRetryInitialBackoff ||
		client.retryMaxBackoff != defaultRetryMaxBackoff {
		t.Fatalf("retry defaults = %d/%s/%s", client.transactionMaxAttempts, client.retryInitialBackoff, client.retryMaxBackoff)
	}
	customBackoffDatabase, _ := openScriptedDatabase(t)
	customBackoffClient, err := New(customBackoffDatabase, Config{RetryInitialBackoff: time.Second})
	if err != nil {
		t.Fatalf("New(custom initial backoff) error = %v", err)
	}
	if customBackoffClient.retryMaxBackoff != time.Second {
		t.Fatalf("custom retry max backoff = %s, want 1s", customBackoffClient.retryMaxBackoff)
	}
	_ = customBackoffClient.Close()
	if err := client.Check(context.Background()); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}
	if got := state.closes.Load(); got != 1 {
		t.Fatalf("driver closes = %d, want 1", got)
	}
}

func TestPostgresOperationsAndTransactionCreateBoundedPrivateSpans(t *testing.T) {
	database, state := openScriptedDatabase(t)
	client, recorder, provider := newTracedClient(t, database, Config{})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	if err := client.Check(ctx); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if _, err := client.Exec(ctx, "EXEC secret-sql credential", "secret-argument"); err != nil {
		t.Fatalf("Exec() error = %v", err)
	}
	var queryValues []int64
	if err := client.Query(ctx, "ROWS secret-sql credential", []any{"secret-argument"}, func(rows *sql.Rows) error {
		for rows.Next() {
			var value int64
			if err := rows.Scan(&value); err != nil {
				return err
			}
			queryValues = append(queryValues, value)
		}
		return nil
	}); err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if fmt.Sprint(queryValues) != "[1 2]" {
		t.Fatalf("query values = %v", queryValues)
	}
	var rowValue int64
	if err := client.ScanRow(ctx, "ROW secret-sql credential", []any{"secret-argument"}, &rowValue); err != nil {
		t.Fatalf("ScanRow() error = %v", err)
	}
	if rowValue != 42 {
		t.Fatalf("row value = %d, want 42", rowValue)
	}
	var lockValue int64
	if err := client.LockRow(ctx, "LOCK secret-sql credential", []any{"secret-argument"}, &lockValue); err != nil {
		t.Fatalf("LockRow() error = %v", err)
	}
	if lockValue != 1 {
		t.Fatalf("lock value = %d, want 1", lockValue)
	}

	err := client.Transaction(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable, ReadOnly: true}, func(transactionContext context.Context, transaction *Tx) error {
		if _, err := transaction.Exec(transactionContext, "EXEC transaction-secret", "transaction-argument"); err != nil {
			return err
		}
		var value int64
		if err := transaction.ScanRow(transactionContext, "ROW transaction-secret", nil, &value); err != nil {
			return err
		}
		return transaction.Query(transactionContext, "ROWS transaction-secret", nil, func(rows *sql.Rows) error {
			for rows.Next() {
				if err := rows.Scan(&value); err != nil {
					return err
				}
			}
			return nil
		})
	})
	if err != nil {
		t.Fatalf("Transaction() error = %v", err)
	}
	parent.End()

	if got := state.commits.Load(); got != 1 {
		t.Fatalf("commits = %d, want 1", got)
	}
	if got := state.rollbacks.Load(); got != 0 {
		t.Fatalf("rollbacks = %d, want 0", got)
	}
	if !state.serializable.Load() || !state.readOnly.Load() {
		t.Fatal("transaction options were not passed to database/sql")
	}
	if got := state.rowsClosed.Load(); got != 5 {
		t.Fatalf("closed row sets = %d, want 5", got)
	}

	spans := recorder.Ended()
	if len(spans) != 10 {
		t.Fatalf("ended spans = %d, want 10", len(spans))
	}
	operations := map[string]int{}
	for _, span := range spans {
		if span.Name() == "parent" {
			continue
		}
		operations[span.Name()]++
		if span.SpanKind() != trace.SpanKindClient {
			t.Fatalf("span %q kind = %v", span.Name(), span.SpanKind())
		}
		if span.Parent().SpanID() != parent.SpanContext().SpanID() && span.Name() == "postgresql.transaction" {
			t.Fatalf("transaction parent = %s, want %s", span.Parent().SpanID(), parent.SpanContext().SpanID())
		}
		assertDatabaseSpanAttributes(t, span, "success")
		assertSpanExcludes(t, span, "secret", "credential", "argument", "driver")
	}
	for name, count := range map[string]int{
		"postgresql.check":       1,
		"postgresql.exec":        2,
		"postgresql.query":       4,
		"postgresql.lock":        1,
		"postgresql.transaction": 1,
	} {
		if operations[name] != count {
			t.Fatalf("operation %s count = %d, want %d", name, operations[name], count)
		}
	}
}

func TestDatabaseFailuresTimeoutsAndNotFoundUseFixedTraceResults(t *testing.T) {
	database, _ := openScriptedDatabase(t)
	client, recorder, provider := newTracedClient(t, database, Config{
		OperationTimeout:   20 * time.Millisecond,
		TransactionTimeout: 200 * time.Millisecond,
	})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	if _, err := client.Exec(context.Background(), "FAIL raw-driver-secret"); err == nil {
		t.Fatal("Exec(FAIL) error = nil")
	}
	var value int64
	if err := client.ScanRow(context.Background(), "EMPTY raw-driver-secret", nil, &value); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("ScanRow(EMPTY) error = %v, want sql.ErrNoRows", err)
	}
	if _, err := client.Exec(context.Background(), "WAIT raw-driver-secret"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Exec(WAIT) error = %v, want context deadline", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.Exec(canceled, "WAIT raw-driver-secret"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Exec(canceled) error = %v, want context canceled", err)
	}

	spans := recorder.Ended()
	if len(spans) != 4 {
		t.Fatalf("ended spans = %d, want 4", len(spans))
	}
	wantResults := []string{"failure", "not_found", "timeout", "canceled"}
	for index, span := range spans {
		assertDatabaseSpanAttributes(t, span, wantResults[index])
		assertSpanExcludes(t, span, "raw-driver-secret", "driver failure")
		if wantResults[index] == "failure" && span.Status().Description != "database operation failed" {
			t.Fatalf("failure description = %q", span.Status().Description)
		}
		if wantResults[index] == "not_found" && span.Status().Code != codes.Unset {
			t.Fatalf("not-found status = %v, want unset", span.Status().Code)
		}
	}
}

func TestVersionedExecRequiresExactlyOneAffectedRow(t *testing.T) {
	database, state := openScriptedDatabase(t)
	client, recorder, provider := newTracedClient(t, database, Config{})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	if err := client.ExecVersioned(context.Background(), "VERSIONED_OK private-sql", "private-value"); err != nil {
		t.Fatalf("ExecVersioned(success) error = %v", err)
	}
	if err := client.ExecVersioned(context.Background(), "VERSIONED_CONFLICT private-sql", "private-value"); !errors.Is(err, ErrOptimisticConflict) {
		t.Fatalf("ExecVersioned(conflict) error = %v, want ErrOptimisticConflict", err)
	}
	if err := client.ExecVersioned(context.Background(), "VERSIONED_MULTI private-sql", "private-value"); !errors.Is(err, errUnexpectedRowsAffected) {
		t.Fatalf("ExecVersioned(multiple rows) error = %v", err)
	}
	if err := client.ExecVersioned(context.Background(), "VERSIONED_RESULT_FAIL private-sql", "private-value"); !errors.Is(err, errRowsAffectedUnavailable) {
		t.Fatalf("ExecVersioned(rows affected failure) error = %v", err)
	}
	err := client.Transaction(context.Background(), nil, func(ctx context.Context, transaction *Tx) error {
		return transaction.ExecVersioned(ctx, "VERSIONED_CONFLICT transaction-private-sql", "private-value")
	})
	if !errors.Is(err, ErrOptimisticConflict) {
		t.Fatalf("Transaction(ExecVersioned conflict) error = %v, want ErrOptimisticConflict", err)
	}
	if state.commits.Load() != 0 || state.rollbacks.Load() != 1 {
		t.Fatalf("versioned transaction commits/rollbacks = %d/%d, want 0/1", state.commits.Load(), state.rollbacks.Load())
	}

	spans := recorder.Ended()
	if len(spans) != 6 {
		t.Fatalf("versioned spans = %d, want 6", len(spans))
	}
	wantResults := []string{"success", "conflict", "failure", "failure", "conflict", "conflict"}
	for index, span := range spans {
		assertDatabaseSpanAttributes(t, span, wantResults[index])
		assertSpanExcludes(t, span, "private-sql", "private-value", "rows affected raw secret")
		if wantResults[index] == "conflict" && span.Status().Code != codes.Unset {
			t.Fatalf("conflict span %d status = %v, want unset", index, span.Status().Code)
		}
	}
}

func TestQueryAlwaysClosesRowsAndPropagatesConsumerError(t *testing.T) {
	database, state := openScriptedDatabase(t)
	client, recorder, provider := newTracedClient(t, database, Config{})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	consumerErr := errors.New("consumer secret error")
	err := client.Query(context.Background(), "ROWS statement-secret", nil, func(rows *sql.Rows) error {
		if !rows.Next() {
			return errors.New("missing first row")
		}
		return consumerErr
	})
	if !errors.Is(err, consumerErr) {
		t.Fatalf("Query() error = %v, want consumer error", err)
	}
	if err := client.Query(context.Background(), "ROWS", nil, nil); err == nil {
		t.Fatal("Query(nil consumer) error = nil")
	}
	panicValue := "rows panic secret value"
	func() {
		defer func() {
			if recovered := recover(); recovered != panicValue {
				t.Fatalf("recovered panic = %v", recovered)
			}
		}()
		_ = client.Query(context.Background(), "ROWS panic-statement-secret", nil, func(*sql.Rows) error {
			panic(panicValue)
		})
	}()
	if got := state.rowsClosed.Load(); got != 2 {
		t.Fatalf("closed row sets = %d, want 2", got)
	}
	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans = %d, want 2", len(spans))
	}
	for _, span := range spans {
		assertDatabaseSpanAttributes(t, span, "failure")
		assertSpanExcludes(t, span, "consumer secret error", "statement-secret", "rows panic secret")
	}
}

func TestTransactionRollsBackOnErrorTimeoutAndPanic(t *testing.T) {
	database, state := openScriptedDatabase(t)
	client, recorder, provider := newTracedClient(t, database, Config{
		OperationTimeout:   20 * time.Millisecond,
		TransactionTimeout: 40 * time.Millisecond,
	})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	callbackErr := errors.New("callback secret error")
	if err := client.Transaction(context.Background(), nil, func(context.Context, *Tx) error {
		return callbackErr
	}); !errors.Is(err, callbackErr) {
		t.Fatalf("Transaction(callback error) = %v", err)
	}
	if err := client.Transaction(context.Background(), nil, func(ctx context.Context, _ *Tx) error {
		<-ctx.Done()
		return ctx.Err()
	}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Transaction(timeout) = %v", err)
	}

	panicValue := "panic secret value"
	func() {
		defer func() {
			if recovered := recover(); recovered != panicValue {
				t.Fatalf("recovered panic = %v", recovered)
			}
		}()
		_ = client.Transaction(context.Background(), nil, func(context.Context, *Tx) error {
			panic(panicValue)
		})
	}()

	if got := state.rollbacks.Load(); got != 3 {
		t.Fatalf("rollbacks = %d, want 3", got)
	}
	if got := state.commits.Load(); got != 0 {
		t.Fatalf("commits = %d, want 0", got)
	}
	spans := recorder.Ended()
	if len(spans) != 3 {
		t.Fatalf("ended spans = %d, want 3", len(spans))
	}
	for _, span := range spans {
		if span.Name() != "postgresql.transaction" {
			t.Fatalf("span name = %q", span.Name())
		}
		if span.Status().Code != codes.Error {
			t.Fatalf("transaction status = %v, want error", span.Status().Code)
		}
		assertSpanExcludes(t, span, "callback secret", "panic secret", "raw-driver-secret")
	}
	if result := spanAttribute(spans[0], "goexample.database.result"); result != "failure" {
		t.Fatalf("callback result = %q", result)
	}
	if result := spanAttribute(spans[1], "goexample.database.result"); result != "timeout" {
		t.Fatalf("timeout result = %q", result)
	}
	if result := spanAttribute(spans[2], "goexample.database.result"); result != "failure" {
		t.Fatalf("panic result = %q", result)
	}
}

func TestRetryTransactionRetriesOnlySerializationAndDeadlockFailures(t *testing.T) {
	for _, sqlState := range []string{"40001", "40P01"} {
		t.Run(sqlState, func(t *testing.T) {
			database, state := openScriptedDatabase(t)
			client, recorder, provider := newTracedClient(t, database, Config{
				OperationTimeout:       50 * time.Millisecond,
				TransactionTimeout:     500 * time.Millisecond,
				TransactionMaxAttempts: 3,
				RetryInitialBackoff:    time.Millisecond,
				RetryMaxBackoff:        2 * time.Millisecond,
			})
			defer func() {
				_ = client.Close()
				_ = provider.Shutdown(context.Background())
			}()

			attempts := 0
			err := client.RetryTransaction(context.Background(), &sql.TxOptions{Isolation: sql.LevelSerializable}, func(context.Context, *Tx) error {
				attempts++
				if attempts < 3 {
					return fmt.Errorf("callback retry secret: %w", scriptedPostgresError{code: sqlState})
				}
				return nil
			})
			if err != nil {
				t.Fatalf("RetryTransaction() error = %v", err)
			}
			if attempts != 3 || state.rollbacks.Load() != 2 || state.commits.Load() != 1 {
				t.Fatalf("attempts/rollbacks/commits = %d/%d/%d", attempts, state.rollbacks.Load(), state.commits.Load())
			}
			spans := recorder.Ended()
			if len(spans) != 3 {
				t.Fatalf("ended spans = %d, want 3", len(spans))
			}
			for index, span := range spans {
				result := "failure"
				if index == 2 {
					result = "success"
				}
				assertDatabaseSpanAttributes(t, span, result)
				assertSpanExcludes(t, span, "callback retry secret", sqlState)
			}
		})
	}
}

func TestRetryTransactionRetriesCommitSerializationFailure(t *testing.T) {
	database, state := openScriptedDatabase(t)
	state.commitFailures.Store(1)
	state.commitSQLState = "40001"
	client, recorder, provider := newTracedClient(t, database, Config{
		OperationTimeout:       50 * time.Millisecond,
		TransactionTimeout:     500 * time.Millisecond,
		TransactionMaxAttempts: 2,
		RetryInitialBackoff:    time.Millisecond,
		RetryMaxBackoff:        time.Millisecond,
	})
	defer func() {
		_ = client.Close()
		_ = provider.Shutdown(context.Background())
	}()

	attempts := 0
	err := client.RetryTransaction(context.Background(), nil, func(context.Context, *Tx) error {
		attempts++
		return nil
	})
	if err != nil {
		t.Fatalf("RetryTransaction() error = %v", err)
	}
	if attempts != 2 || state.commits.Load() != 2 {
		t.Fatalf("attempts/commits = %d/%d, want 2/2", attempts, state.commits.Load())
	}
	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans = %d, want 2", len(spans))
	}
	assertDatabaseSpanAttributes(t, spans[0], "failure")
	assertDatabaseSpanAttributes(t, spans[1], "success")
	assertSpanExcludes(t, spans[0], "commit retry secret", "40001")
}

func TestRetryTransactionStopsForNonRetryableLimitAndUnsafeRollback(t *testing.T) {
	tests := []struct {
		name             string
		code             string
		maxAttempts      int
		rollbackFailures int64
		wantAttempts     int
	}{
		{name: "non retryable", code: "23505", maxAttempts: 3, wantAttempts: 1},
		{name: "attempt limit", code: "40001", maxAttempts: 2, wantAttempts: 2},
		{name: "rollback failure", code: "40001", maxAttempts: 3, rollbackFailures: 1, wantAttempts: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			database, state := openScriptedDatabase(t)
			state.rollbackFailures.Store(test.rollbackFailures)
			client, err := New(database, Config{
				OperationTimeout:       50 * time.Millisecond,
				TransactionTimeout:     500 * time.Millisecond,
				TransactionMaxAttempts: test.maxAttempts,
				RetryInitialBackoff:    time.Millisecond,
				RetryMaxBackoff:        time.Millisecond,
			})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			defer client.Close()

			attempts := 0
			err = client.RetryTransaction(context.Background(), nil, func(context.Context, *Tx) error {
				attempts++
				return fmt.Errorf("retry decision secret: %w", scriptedPostgresError{code: test.code})
			})
			if err == nil {
				t.Fatal("RetryTransaction() error = nil")
			}
			if attempts != test.wantAttempts {
				t.Fatalf("attempts = %d, want %d", attempts, test.wantAttempts)
			}
			if test.rollbackFailures > 0 && !strings.Contains(err.Error(), "rollback raw secret") {
				t.Fatalf("rollback error = %v", err)
			}
		})
	}
}

func TestRetryTransactionBackoffSharesTransactionDeadline(t *testing.T) {
	database, state := openScriptedDatabase(t)
	client, err := New(database, Config{
		OperationTimeout:       10 * time.Millisecond,
		TransactionTimeout:     30 * time.Millisecond,
		TransactionMaxAttempts: 3,
		RetryInitialBackoff:    100 * time.Millisecond,
		RetryMaxBackoff:        100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Close()

	attempts := 0
	started := time.Now()
	err = client.RetryTransaction(context.Background(), nil, func(context.Context, *Tx) error {
		attempts++
		return scriptedPostgresError{code: "40P01"}
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("RetryTransaction() error = %v, want deadline", err)
	}
	if attempts != 1 || state.rollbacks.Load() != 1 {
		t.Fatalf("attempts/rollbacks = %d/%d, want 1/1", attempts, state.rollbacks.Load())
	}
	if elapsed := time.Since(started); elapsed >= 100*time.Millisecond {
		t.Fatalf("RetryTransaction() elapsed = %s, exceeded shared budget", elapsed)
	}
}

func TestNilReceiversAndContextsFailWithoutPanic(t *testing.T) {
	var client *Client
	if err := client.Check(context.Background()); !errors.Is(err, errNilClient) {
		t.Fatalf("nil Client.Check() error = %v", err)
	}
	if err := client.Close(); !errors.Is(err, errNilClient) {
		t.Fatalf("nil Client.Close() error = %v", err)
	}
	var transaction *Tx
	if _, err := transaction.Exec(context.Background(), "EXEC"); err == nil {
		t.Fatal("nil Tx.Exec() error = nil")
	}

	database, _ := openScriptedDatabase(t)
	validClient, err := New(database, Config{})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer validClient.Close()
	if err := validClient.Check(nil); !errors.Is(err, errNilContext) {
		t.Fatalf("Check(nil) error = %v", err)
	}
	if err := validClient.Transaction(context.Background(), nil, nil); err == nil {
		t.Fatal("Transaction(nil callback) error = nil")
	}
}

func newTracedClient(t *testing.T, database *sql.DB, config Config) (*Client, *tracetest.SpanRecorder, *sdktrace.TracerProvider) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	config.TracerProvider = provider
	client, err := New(database, config)
	if err != nil {
		_ = provider.Shutdown(context.Background())
		t.Fatalf("New() error = %v", err)
	}
	return client, recorder, provider
}

func assertDatabaseSpanAttributes(t *testing.T, span sdktrace.ReadOnlySpan, result string) {
	t.Helper()
	if got := spanAttribute(span, "db.system.name"); got != "postgresql" {
		t.Fatalf("db.system.name = %q", got)
	}
	operation := spanAttribute(span, "db.operation.name")
	if !map[string]bool{"CHECK": true, "EXEC": true, "UPDATE": true, "QUERY": true, "LOCK": true, "TRANSACTION": true}[operation] {
		t.Fatalf("db.operation.name = %q", operation)
	}
	if got := spanAttribute(span, "goexample.database.result"); got != result {
		t.Fatalf("database result = %q, want %q", got, result)
	}
	if len(span.Attributes()) != 3 {
		t.Fatalf("span %q attributes = %v, want exactly 3", span.Name(), span.Attributes())
	}
}

func spanAttribute(span sdktrace.ReadOnlySpan, name string) string {
	for _, item := range span.Attributes() {
		if string(item.Key) == name {
			return item.Value.AsString()
		}
	}
	return ""
}

func assertSpanExcludes(t *testing.T, span sdktrace.ReadOnlySpan, forbidden ...string) {
	t.Helper()
	var content strings.Builder
	content.WriteString(span.Name())
	content.WriteString(" ")
	content.WriteString(span.Status().Description)
	for _, item := range span.Attributes() {
		content.WriteString(" ")
		content.WriteString(string(item.Key))
		content.WriteString("=")
		content.WriteString(item.Value.Emit())
	}
	for _, event := range span.Events() {
		content.WriteString(" ")
		content.WriteString(event.Name)
		for _, item := range event.Attributes {
			content.WriteString(" ")
			content.WriteString(string(item.Key))
			content.WriteString("=")
			content.WriteString(item.Value.Emit())
		}
	}
	observed := strings.ToLower(content.String())
	for _, value := range forbidden {
		if strings.Contains(observed, strings.ToLower(value)) {
			t.Fatalf("span contains forbidden value %q: %s", value, content.String())
		}
	}
}

type scriptedDriver struct {
	states sync.Map
}

func (scripted *scriptedDriver) Open(name string) (driver.Conn, error) {
	value, exists := scripted.states.Load(name)
	if !exists {
		return nil, errors.New("unknown scripted database")
	}
	return &scriptedConnection{state: value.(*scriptedState)}, nil
}

type scriptedState struct {
	pings            atomic.Int64
	closes           atomic.Int64
	commits          atomic.Int64
	rollbacks        atomic.Int64
	rowsClosed       atomic.Int64
	serializable     atomic.Bool
	readOnly         atomic.Bool
	commitFailures   atomic.Int64
	rollbackFailures atomic.Int64
	commitSQLState   string
}

type scriptedConnection struct {
	state *scriptedState
}

func (connection *scriptedConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not implemented")
}

func (connection *scriptedConnection) Close() error {
	connection.state.closes.Add(1)
	return nil
}

func (connection *scriptedConnection) Begin() (driver.Tx, error) {
	return connection.BeginTx(context.Background(), driver.TxOptions{})
}

func (connection *scriptedConnection) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	connection.state.serializable.Store(options.Isolation == driver.IsolationLevel(sql.LevelSerializable))
	connection.state.readOnly.Store(options.ReadOnly)
	return &scriptedTransaction{state: connection.state}, nil
}

func (connection *scriptedConnection) Ping(context.Context) error {
	connection.state.pings.Add(1)
	return nil
}

func (connection *scriptedConnection) ExecContext(ctx context.Context, statement string, _ []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.HasPrefix(statement, "FAIL"):
		return nil, errors.New("driver failure contains raw-driver-secret")
	case strings.HasPrefix(statement, "WAIT"):
		<-ctx.Done()
		return nil, ctx.Err()
	case strings.HasPrefix(statement, "VERSIONED_CONFLICT"):
		return driver.RowsAffected(0), nil
	case strings.HasPrefix(statement, "VERSIONED_MULTI"):
		return driver.RowsAffected(2), nil
	case strings.HasPrefix(statement, "VERSIONED_RESULT_FAIL"):
		return scriptedResultError{}, nil
	default:
		return driver.RowsAffected(1), nil
	}
}

type scriptedResultError struct{}

func (scriptedResultError) LastInsertId() (int64, error) {
	return 0, errors.New("last insert ID raw secret")
}

func (scriptedResultError) RowsAffected() (int64, error) {
	return 0, errors.New("rows affected raw secret")
}

func (connection *scriptedConnection) QueryContext(ctx context.Context, statement string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.HasPrefix(statement, "FAIL"):
		return nil, errors.New("driver failure contains raw-driver-secret")
	case strings.HasPrefix(statement, "WAIT"):
		<-ctx.Done()
		return nil, ctx.Err()
	case strings.HasPrefix(statement, "EMPTY"):
		return &scriptedRows{state: connection.state, values: nil}, nil
	case strings.HasPrefix(statement, "ROWS"):
		return &scriptedRows{state: connection.state, values: [][]driver.Value{{int64(1)}, {int64(2)}}}, nil
	case strings.HasPrefix(statement, "LOCK"):
		return &scriptedRows{state: connection.state, values: [][]driver.Value{{int64(1)}}}, nil
	default:
		return &scriptedRows{state: connection.state, values: [][]driver.Value{{int64(42)}}}, nil
	}
}

type scriptedTransaction struct {
	state *scriptedState
}

func (transaction *scriptedTransaction) Commit() error {
	transaction.state.commits.Add(1)
	if consumeFailure(&transaction.state.commitFailures) {
		return fmt.Errorf("commit retry secret: %w", scriptedPostgresError{code: transaction.state.commitSQLState})
	}
	return nil
}

func (transaction *scriptedTransaction) Rollback() error {
	transaction.state.rollbacks.Add(1)
	if consumeFailure(&transaction.state.rollbackFailures) {
		return errors.New("rollback raw secret failure")
	}
	return nil
}

type scriptedPostgresError struct {
	code string
}

func (postgresError scriptedPostgresError) Error() string {
	return "postgres raw SQLSTATE secret " + postgresError.code
}

func (postgresError scriptedPostgresError) SQLState() string {
	return postgresError.code
}

func consumeFailure(counter *atomic.Int64) bool {
	for {
		remaining := counter.Load()
		if remaining <= 0 {
			return false
		}
		if counter.CompareAndSwap(remaining, remaining-1) {
			return true
		}
	}
}

type scriptedRows struct {
	state  *scriptedState
	values [][]driver.Value
	index  int
	closed bool
}

func (*scriptedRows) Columns() []string {
	return []string{"value"}
}

func (rows *scriptedRows) Close() error {
	if !rows.closed {
		rows.closed = true
		rows.state.rowsClosed.Add(1)
	}
	return nil
}

func (rows *scriptedRows) Next(destination []driver.Value) error {
	if rows.index >= len(rows.values) {
		return io.EOF
	}
	copy(destination, rows.values[rows.index])
	rows.index++
	return nil
}

func openScriptedDatabase(t *testing.T) (*sql.DB, *scriptedState) {
	t.Helper()
	name := strings.NewReplacer("/", "-", " ", "-").Replace(t.Name()) + fmt.Sprintf("-%d", scriptedDatabaseID.Add(1))
	state := &scriptedState{}
	registeredScriptedDriver.states.Store(name, state)
	database, err := sql.Open(scriptedDriverName, name)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
		registeredScriptedDriver.states.Delete(name)
	})
	return database, state
}

var (
	_ driver.Driver         = registeredScriptedDriver
	_ driver.Conn           = (*scriptedConnection)(nil)
	_ driver.ConnBeginTx    = (*scriptedConnection)(nil)
	_ driver.ExecerContext  = (*scriptedConnection)(nil)
	_ driver.QueryerContext = (*scriptedConnection)(nil)
	_ driver.Pinger         = (*scriptedConnection)(nil)
	_ driver.Tx             = (*scriptedTransaction)(nil)
	_ driver.Rows           = (*scriptedRows)(nil)
)
