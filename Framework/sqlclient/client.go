// Package sqlclient wraps a PostgreSQL database/sql pool with finite resource
// budgets and low-sensitivity OpenTelemetry spans. It never records DSNs, SQL
// statements, arguments, row values, or raw driver errors.
package sqlclient

import (
	"context"
	"database/sql"
	"errors"
	"math/rand/v2"
	"net"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	instrumentationName        = "github.com/zbxing/goexample/Framework/sqlclient"
	defaultOperationTimeout    = 3 * time.Second
	defaultTransactionTimeout  = 15 * time.Second
	defaultMaxOpenConnections  = 32
	defaultMaxIdleConnections  = 8
	defaultConnectionLifetime  = 30 * time.Minute
	defaultConnectionIdleTime  = 5 * time.Minute
	defaultTransactionAttempts = 3
	defaultRetryInitialBackoff = 25 * time.Millisecond
	defaultRetryMaxBackoff     = 250 * time.Millisecond
	maxTransactionAttempts     = 10
)

var (
	errNilContext              = errors.New("database operation context cannot be nil")
	errNilClient               = errors.New("database client is nil")
	errRowsConsumerPanic       = errors.New("database rows consumer panicked")
	errTransactionPanic        = errors.New("database transaction callback panicked")
	errRowsAffectedUnavailable = errors.New("database update affected-row count is unavailable")
	errUnexpectedRowsAffected  = errors.New("database versioned update affected an unexpected row count")
)

// ErrOptimisticConflict reports that a caller-owned version predicate no
// longer matched. Missing and stale records intentionally share one result so
// callers do not need a racy existence check before returning a conflict.
var ErrOptimisticConflict = errors.New("optimistic update conflict")

// ErrOutboxEnqueue reports that a caller-owned transactional outbox statement
// did not prove that it inserted exactly one event row.
var ErrOutboxEnqueue = errors.New("outbox enqueue did not affect exactly one row")

// Config defines finite PostgreSQL operation, transaction, and connection-pool
// budgets. Zero values select conservative defaults; negative values are
// rejected.
type Config struct {
	OperationTimeout       time.Duration
	TransactionTimeout     time.Duration
	MaxOpenConnections     int
	MaxIdleConnections     int
	ConnectionMaxLifetime  time.Duration
	ConnectionMaxIdleTime  time.Duration
	TransactionMaxAttempts int
	RetryInitialBackoff    time.Duration
	RetryMaxBackoff        time.Duration
	TracerProvider         trace.TracerProvider
}

// Client owns a configured database/sql pool. Call Close during application
// shutdown after new work has been stopped.
type Client struct {
	db                     *sql.DB
	operationTimeout       time.Duration
	transactionTimeout     time.Duration
	transactionMaxAttempts int
	retryInitialBackoff    time.Duration
	retryMaxBackoff        time.Duration
	tracer                 trace.Tracer
	closeOnce              sync.Once
	closeErr               error
}

// Tx exposes bounded operations inside a transaction callback. Commit and
// rollback remain owned by Client.Transaction or Client.RetryTransaction.
type Tx struct {
	tx               *sql.Tx
	operationTimeout time.Duration
	tracer           trace.Tracer
}

// New configures and takes ownership of an existing database/sql pool. Driver
// selection and DSN parsing remain at the application composition root so the
// Framework does not force a PostgreSQL driver or observe credentials.
func New(db *sql.DB, config Config) (*Client, error) {
	if db == nil {
		return nil, errors.New("database pool cannot be nil")
	}
	config = withDefaults(config)
	if err := validateConfig(config); err != nil {
		return nil, err
	}
	provider := config.TracerProvider
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	db.SetMaxOpenConns(config.MaxOpenConnections)
	db.SetMaxIdleConns(config.MaxIdleConnections)
	db.SetConnMaxLifetime(config.ConnectionMaxLifetime)
	db.SetConnMaxIdleTime(config.ConnectionMaxIdleTime)
	return &Client{
		db:                     db,
		operationTimeout:       config.OperationTimeout,
		transactionTimeout:     config.TransactionTimeout,
		transactionMaxAttempts: config.TransactionMaxAttempts,
		retryInitialBackoff:    config.RetryInitialBackoff,
		retryMaxBackoff:        config.RetryMaxBackoff,
		tracer:                 provider.Tracer(instrumentationName),
	}, nil
}

// Check pings PostgreSQL inside the operation budget. It is suitable for a
// startup or readiness check; New deliberately does not perform I/O.
func (client *Client) Check(ctx context.Context) error {
	if err := client.validate(); err != nil {
		return err
	}
	ctx, cancel, err := boundedContext(ctx, client.operationTimeout)
	if err != nil {
		return err
	}
	defer cancel()
	ctx, span := startSpan(ctx, client.tracer, "CHECK")
	err = client.db.PingContext(ctx)
	if err == nil {
		err = completedContextError(ctx)
	}
	finishSpan(ctx, span, err)
	return err
}

// Exec runs a statement inside the operation budget. The statement and its
// arguments are passed only to database/sql and are excluded from tracing.
func (client *Client) Exec(ctx context.Context, statement string, arguments ...any) (sql.Result, error) {
	if err := client.validate(); err != nil {
		return nil, err
	}
	return exec(ctx, client.db, client.tracer, client.operationTimeout, "EXEC", statement, arguments...)
}

// ExecVersioned executes a caller-owned optimistic update inside the operation
// budget. The statement must include the expected version in its predicate and
// advance that version atomically. Exactly one affected row succeeds, zero
// affected rows returns ErrOptimisticConflict, and any other result fails.
func (client *Client) ExecVersioned(ctx context.Context, statement string, arguments ...any) error {
	if err := client.validate(); err != nil {
		return err
	}
	return execVersioned(ctx, client.db, client.tracer, client.operationTimeout, statement, arguments...)
}

// Query runs a rows statement and invokes consume inside the operation budget.
// Rows are always closed when consume returns; callers must not retain them.
func (client *Client) Query(ctx context.Context, statement string, arguments []any, consume func(*sql.Rows) error) error {
	if err := client.validate(); err != nil {
		return err
	}
	return query(ctx, client.db, client.tracer, client.operationTimeout, "QUERY", statement, arguments, consume)
}

// ScanRow runs a single-row query and scans it inside the operation budget.
func (client *Client) ScanRow(ctx context.Context, statement string, arguments []any, destinations ...any) error {
	if err := client.validate(); err != nil {
		return err
	}
	return scanRow(ctx, client.db, client.tracer, client.operationTimeout, "QUERY", statement, arguments, destinations...)
}

// LockRow runs and scans a PostgreSQL lock statement using the fixed LOCK span
// category. The caller still owns the exact advisory or row-lock SQL.
func (client *Client) LockRow(ctx context.Context, statement string, arguments []any, destinations ...any) error {
	if err := client.validate(); err != nil {
		return err
	}
	return scanRow(ctx, client.db, client.tracer, client.operationTimeout, "LOCK", statement, arguments, destinations...)
}

// Transaction runs callback inside the transaction budget, commits only after
// a nil result, and rolls back on callback error, commit failure, cancellation,
// or panic. The original panic is rethrown after rollback and span completion.
func (client *Client) Transaction(ctx context.Context, options *sql.TxOptions, callback func(context.Context, *Tx) error) (err error) {
	if err := client.validate(); err != nil {
		return err
	}
	if callback == nil {
		return errors.New("database transaction callback cannot be nil")
	}
	ctx, cancel, err := boundedContext(ctx, client.transactionTimeout)
	if err != nil {
		return err
	}
	defer cancel()
	err, _ = client.transactionAttempt(ctx, options, callback)
	return err
}

// RetryTransaction reruns a replay-safe callback only after PostgreSQL
// serialization failure (40001) or deadlock detection (40P01). Every attempt
// and jittered backoff shares one transaction timeout. The callback may execute
// more than once, so external side effects require their own idempotency or an
// outbox pattern.
func (client *Client) RetryTransaction(ctx context.Context, options *sql.TxOptions, callback func(context.Context, *Tx) error) error {
	if err := client.validate(); err != nil {
		return err
	}
	if callback == nil {
		return errors.New("database transaction callback cannot be nil")
	}
	ctx, cancel, err := boundedContext(ctx, client.transactionTimeout)
	if err != nil {
		return err
	}
	defer cancel()

	backoff := client.retryInitialBackoff
	for attempt := 1; attempt <= client.transactionMaxAttempts; attempt++ {
		attemptErr, retrySafe := client.transactionAttempt(ctx, options, callback)
		if attemptErr == nil || !retrySafe || !isRetryablePostgresError(attemptErr) || attempt == client.transactionMaxAttempts {
			return attemptErr
		}
		if err := waitForRetry(ctx, jitteredBackoff(backoff)); err != nil {
			return err
		}
		backoff = nextRetryBackoff(backoff, client.retryMaxBackoff)
	}
	return nil
}

func (client *Client) transactionAttempt(ctx context.Context, options *sql.TxOptions, callback func(context.Context, *Tx) error) (err error, retrySafe bool) {
	ctx, span := startSpan(ctx, client.tracer, "TRANSACTION")
	databaseTx, err := client.db.BeginTx(ctx, options)
	if err != nil {
		finishSpan(ctx, span, err)
		return err, true
	}
	transaction := &Tx{
		tx:               databaseTx,
		operationTimeout: client.operationTimeout,
		tracer:           client.tracer,
	}
	// A driver may successfully begin a transaction while the caller is
	// canceled concurrently. Do not enter user code in that state: the
	// callback could perform external side effects before its first SQL call.
	if ctxErr := completedContextError(ctx); ctxErr != nil {
		rollbackErr := databaseTx.Rollback()
		if rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			ctxErr = errors.Join(ctxErr, rollbackErr)
		}
		finishSpan(ctx, span, ctxErr)
		return ctxErr, rollbackErr == nil || errors.Is(rollbackErr, sql.ErrTxDone)
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			rollbackErr := databaseTx.Rollback()
			traceErr := errTransactionPanic
			if rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
				traceErr = errors.Join(traceErr, rollbackErr)
			}
			finishSpan(ctx, span, traceErr)
			panic(recovered)
		}
	}()

	err = callback(ctx, transaction)
	if err != nil {
		rollbackErr := databaseTx.Rollback()
		retrySafe = rollbackErr == nil || errors.Is(rollbackErr, sql.ErrTxDone)
		if !retrySafe {
			err = errors.Join(err, rollbackErr)
		}
		finishSpan(ctx, span, err)
		return err, retrySafe
	}
	// A callback may finish successfully just as the caller is canceled. Do not
	// commit work after that cancellation: some drivers can still accept
	// Commit even though the transaction context is already done.
	if ctxErr := completedContextError(ctx); ctxErr != nil {
		rollbackErr := databaseTx.Rollback()
		if rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			ctxErr = errors.Join(ctxErr, rollbackErr)
		}
		finishSpan(ctx, span, ctxErr)
		return ctxErr, rollbackErr == nil || errors.Is(rollbackErr, sql.ErrTxDone)
	}
	if err = databaseTx.Commit(); err != nil {
		rollbackErr := databaseTx.Rollback()
		retrySafe = rollbackErr == nil || errors.Is(rollbackErr, sql.ErrTxDone)
		if !retrySafe {
			err = errors.Join(err, rollbackErr)
		}
		finishSpan(ctx, span, err)
		return err, retrySafe
	}
	finishSpan(ctx, span, nil)
	return nil, false
}

// Stats returns the current database/sql pool counters.
func (client *Client) Stats() sql.DBStats {
	if client == nil || client.db == nil {
		return sql.DBStats{}
	}
	return client.db.Stats()
}

// Close releases the owned database/sql pool once.
func (client *Client) Close() error {
	if err := client.validate(); err != nil {
		return err
	}
	client.closeOnce.Do(func() {
		client.closeErr = client.db.Close()
	})
	return client.closeErr
}

// Exec runs a statement within the transaction and operation budgets.
func (transaction *Tx) Exec(ctx context.Context, statement string, arguments ...any) (sql.Result, error) {
	if err := transaction.validate(); err != nil {
		return nil, err
	}
	return exec(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, "EXEC", statement, arguments...)
}

// ExecVersioned executes a caller-owned optimistic update within the
// transaction and operation budgets using the same exactly-one-row contract as
// Client.ExecVersioned.
func (transaction *Tx) ExecVersioned(ctx context.Context, statement string, arguments ...any) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return execVersioned(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, statement, arguments...)
}

// EnqueueOutbox executes a caller-owned outbox insert within the current
// transaction and requires exactly one affected row. Callers own the schema,
// SQL, stable event identifier, payload, and dispatcher. This method does not
// provide broker settlement or exactly-once delivery.
func (transaction *Tx) EnqueueOutbox(ctx context.Context, statement string, arguments ...any) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return enqueueOutbox(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, statement, arguments...)
}

// Query consumes rows within the transaction and operation budgets.
func (transaction *Tx) Query(ctx context.Context, statement string, arguments []any, consume func(*sql.Rows) error) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return query(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, "QUERY", statement, arguments, consume)
}

// ScanRow scans one row within the transaction and operation budgets.
func (transaction *Tx) ScanRow(ctx context.Context, statement string, arguments []any, destinations ...any) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return scanRow(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, "QUERY", statement, arguments, destinations...)
}

// LockRow scans a lock operation within the transaction and operation budgets.
func (transaction *Tx) LockRow(ctx context.Context, statement string, arguments []any, destinations ...any) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return scanRow(ctx, transaction.tx, transaction.tracer, transaction.operationTimeout, "LOCK", statement, arguments, destinations...)
}

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func exec(ctx context.Context, target executor, tracer trace.Tracer, timeout time.Duration, operation, statement string, arguments ...any) (sql.Result, error) {
	ctx, cancel, err := boundedContext(ctx, timeout)
	if err != nil {
		return nil, err
	}
	defer cancel()
	ctx, span := startSpan(ctx, tracer, operation)
	result, err := target.ExecContext(ctx, statement, arguments...)
	if err == nil {
		if contextErr := completedContextError(ctx); contextErr != nil {
			result = nil
			err = contextErr
		}
	}
	finishSpan(ctx, span, err)
	return result, err
}

func execVersioned(ctx context.Context, target executor, tracer trace.Tracer, timeout time.Duration, statement string, arguments ...any) error {
	ctx, cancel, err := boundedContext(ctx, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	ctx, span := startSpan(ctx, tracer, "UPDATE")
	result, err := target.ExecContext(ctx, statement, arguments...)
	if err == nil {
		err = completedContextError(ctx)
	}
	if err == nil {
		var affected int64
		affected, err = rowsAffected(result)
		if err == nil {
			err = completedContextError(ctx)
		}
		if err == nil {
			switch {
			case affected == 0:
				err = ErrOptimisticConflict
			case affected != 1:
				err = errUnexpectedRowsAffected
			}
		}
	}
	finishSpan(ctx, span, err)
	return err
}

func enqueueOutbox(ctx context.Context, target executor, tracer trace.Tracer, timeout time.Duration, statement string, arguments ...any) error {
	ctx, cancel, err := boundedContext(ctx, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	ctx, span := startSpan(ctx, tracer, "OUTBOX")
	result, err := target.ExecContext(ctx, statement, arguments...)
	if err == nil {
		err = completedContextError(ctx)
	}
	if err == nil {
		affected, rowsErr := rowsAffected(result)
		contextErr := completedContextError(ctx)
		switch {
		case rowsErr != nil:
			err = errors.Join(ErrOutboxEnqueue, rowsErr)
		case contextErr != nil:
			err = contextErr
		case affected != 1:
			err = ErrOutboxEnqueue
		}
	}
	finishSpan(ctx, span, err)
	return err
}

func rowsAffected(result sql.Result) (affected int64, err error) {
	if result == nil {
		return 0, errRowsAffectedUnavailable
	}
	defer func() {
		if recover() != nil {
			affected = 0
			err = errRowsAffectedUnavailable
		}
	}()
	affected, err = result.RowsAffected()
	if err != nil {
		return 0, errors.Join(errRowsAffectedUnavailable, err)
	}
	return affected, nil
}

func query(ctx context.Context, target queryer, tracer trace.Tracer, timeout time.Duration, operation, statement string, arguments []any, consume func(*sql.Rows) error) (err error) {
	if consume == nil {
		return errors.New("database rows consumer cannot be nil")
	}
	ctx, cancel, err := boundedContext(ctx, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	ctx, span := startSpan(ctx, tracer, operation)
	rows, err := target.QueryContext(ctx, statement, arguments...)
	if err != nil {
		finishSpan(ctx, span, err)
		return err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			cleanupErr := errors.Join(errRowsConsumerPanic, rows.Close(), rows.Err())
			finishSpan(ctx, span, cleanupErr)
			panic(recovered)
		}
		err = errors.Join(err, rows.Close(), rows.Err())
		finishSpan(ctx, span, err)
	}()
	if contextErr := completedContextError(ctx); contextErr != nil {
		return contextErr
	}
	err = consume(rows)
	if err == nil {
		err = completedContextError(ctx)
	}
	return err
}

func scanRow(ctx context.Context, target queryer, tracer trace.Tracer, timeout time.Duration, operation, statement string, arguments []any, destinations ...any) error {
	ctx, cancel, err := boundedContext(ctx, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	ctx, span := startSpan(ctx, tracer, operation)
	err = target.QueryRowContext(ctx, statement, arguments...).Scan(destinations...)
	if err == nil {
		err = completedContextError(ctx)
	}
	finishSpan(ctx, span, err)
	return err
}

func startSpan(ctx context.Context, tracer trace.Tracer, operation string) (context.Context, trace.Span) {
	return tracer.Start(
		ctx,
		"postgresql."+postgresOperationName(operation),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemNamePostgreSQL,
			semconv.DBOperationName(operation),
		),
	)
}

// postgresOperationName maps the fixed internal operation vocabulary to
// immutable lowercase strings. SQL operations create a span on every request;
// avoiding strings.ToLower on the uppercase internal constants removes a
// temporary string allocation from that hot path while retaining a defensive
// lowercase fallback for package-local future callers.
func postgresOperationName(operation string) string {
	switch operation {
	case "CHECK":
		return "check"
	case "EXEC":
		return "exec"
	case "QUERY":
		return "query"
	case "LOCK":
		return "lock"
	case "UPDATE":
		return "update"
	case "OUTBOX":
		return "outbox"
	case "TRANSACTION":
		return "transaction"
	default:
		return lowerASCII(operation)
	}
}

func lowerASCII(value string) string {
	for index := 0; index < len(value); index++ {
		if value[index] >= 'A' && value[index] <= 'Z' {
			buffer := make([]byte, len(value))
			copy(buffer, value)
			for position := index; position < len(buffer); position++ {
				if buffer[position] >= 'A' && buffer[position] <= 'Z' {
					buffer[position] += 'a' - 'A'
				}
			}
			return string(buffer)
		}
	}
	return value
}

func finishSpan(ctx context.Context, span trace.Span, err error) {
	result, description := classifyResult(ctx, err)
	span.SetAttributes(attribute.String("goexample.database.result", result))
	if description != "" {
		span.SetStatus(codes.Error, description)
	}
	span.End()
}

func classifyResult(ctx context.Context, err error) (string, string) {
	switch {
	case err == nil:
		return "success", ""
	case errors.Is(err, ErrOptimisticConflict):
		return "conflict", ""
	case errors.Is(err, sql.ErrNoRows):
		return "not_found", ""
	case errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled):
		return "canceled", "database operation canceled"
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return "timeout", "database operation timed out"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "timeout", "database operation timed out"
	}
	return "failure", "database operation failed"
}

type postgresSQLStateError interface {
	SQLState() string
}

func isRetryablePostgresError(err error) bool {
	var stateError postgresSQLStateError
	if !errors.As(err, &stateError) {
		return false
	}
	switch stateError.SQLState() {
	case "40001", "40P01":
		return true
	default:
		return false
	}
}

func jitteredBackoff(backoff time.Duration) time.Duration {
	half := backoff / 2
	window := backoff - half
	if window <= 0 {
		return backoff
	}
	return half + time.Duration(rand.Int64N(int64(window)+1))
}

func nextRetryBackoff(current, maximum time.Duration) time.Duration {
	if current >= maximum || current > maximum/2 {
		return maximum
	}
	return current * 2
}

func waitForRetry(ctx context.Context, backoff time.Duration) error {
	timer := time.NewTimer(backoff)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func boundedContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc, error) {
	if ctx == nil {
		return nil, nil, errNilContext
	}
	bounded, cancel := context.WithTimeout(ctx, timeout)
	return bounded, cancel, nil
}

// completedContextError also observes a deadline whose timer has elapsed but
// whose Done channel has not been scheduled yet. Callers use it only at
// operation result boundaries, so an explicit driver or consumer error remains
// authoritative while a late nil result cannot be reported as success.
func completedContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

func withDefaults(config Config) Config {
	if config.OperationTimeout == 0 {
		config.OperationTimeout = defaultOperationTimeout
	}
	if config.TransactionTimeout == 0 {
		config.TransactionTimeout = defaultTransactionTimeout
	}
	if config.MaxOpenConnections == 0 {
		config.MaxOpenConnections = defaultMaxOpenConnections
	}
	if config.MaxIdleConnections == 0 {
		config.MaxIdleConnections = min(defaultMaxIdleConnections, config.MaxOpenConnections)
	}
	if config.ConnectionMaxLifetime == 0 {
		config.ConnectionMaxLifetime = defaultConnectionLifetime
	}
	if config.ConnectionMaxIdleTime == 0 {
		config.ConnectionMaxIdleTime = defaultConnectionIdleTime
	}
	if config.TransactionMaxAttempts == 0 {
		config.TransactionMaxAttempts = defaultTransactionAttempts
	}
	if config.RetryInitialBackoff == 0 {
		config.RetryInitialBackoff = defaultRetryInitialBackoff
		if config.RetryMaxBackoff > 0 {
			config.RetryInitialBackoff = min(config.RetryInitialBackoff, config.RetryMaxBackoff)
		}
	}
	if config.RetryMaxBackoff == 0 {
		config.RetryMaxBackoff = max(defaultRetryMaxBackoff, config.RetryInitialBackoff)
	}
	return config
}

func validateConfig(config Config) error {
	if config.OperationTimeout <= 0 || config.TransactionTimeout <= 0 {
		return errors.New("database operation and transaction timeouts must be greater than zero")
	}
	if config.OperationTimeout > config.TransactionTimeout {
		return errors.New("database operation timeout must not exceed transaction timeout")
	}
	if config.MaxOpenConnections <= 0 || config.MaxIdleConnections <= 0 {
		return errors.New("database connection limits must be greater than zero")
	}
	if config.MaxIdleConnections > config.MaxOpenConnections {
		return errors.New("database idle connections must not exceed open connections")
	}
	if config.ConnectionMaxLifetime <= 0 || config.ConnectionMaxIdleTime <= 0 {
		return errors.New("database connection lifetime and idle time must be greater than zero")
	}
	if config.ConnectionMaxIdleTime > config.ConnectionMaxLifetime {
		return errors.New("database connection idle time must not exceed connection lifetime")
	}
	if config.TransactionMaxAttempts <= 0 || config.TransactionMaxAttempts > maxTransactionAttempts {
		return errors.New("database transaction attempts must be between 1 and 10")
	}
	if config.RetryInitialBackoff <= 0 || config.RetryMaxBackoff <= 0 {
		return errors.New("database transaction retry backoffs must be greater than zero")
	}
	if config.RetryInitialBackoff > config.RetryMaxBackoff {
		return errors.New("database transaction retry initial backoff must not exceed maximum backoff")
	}
	return nil
}

func (client *Client) validate() error {
	if client == nil || client.db == nil {
		return errNilClient
	}
	return nil
}

func (transaction *Tx) validate() error {
	if transaction == nil || transaction.tx == nil {
		return errors.New("database transaction is nil")
	}
	return nil
}
