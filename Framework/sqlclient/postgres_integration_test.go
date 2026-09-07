package sqlclient

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/zbxing/goexample/Framework/httpapi"
)

var postgresIntegrationTableID atomic.Uint64

func TestRealPostgresRetryTransactionSerializationConflict(t *testing.T) {
	client, database, testContext := openRealPostgresClient(t, Config{
		OperationTimeout:       2 * time.Second,
		TransactionTimeout:     10 * time.Second,
		MaxOpenConnections:     4,
		MaxIdleConnections:     4,
		TransactionMaxAttempts: 3,
		RetryInitialBackoff:    time.Millisecond,
		RetryMaxBackoff:        5 * time.Millisecond,
	})
	table := createRealPostgresCounterTable(t, database, testContext)
	outboxTable := createRealPostgresOutboxTable(t, database, testContext)

	firstSnapshotRead := make(chan struct{})
	competingCommit := make(chan error, 1)
	go func() {
		select {
		case <-firstSnapshotRead:
		case <-testContext.Done():
			competingCommit <- testContext.Err()
			return
		}

		transaction, err := database.BeginTx(testContext, &sql.TxOptions{Isolation: sql.LevelSerializable})
		if err != nil {
			competingCommit <- err
			return
		}
		defer transaction.Rollback()
		var value int
		if err = transaction.QueryRowContext(testContext, "SELECT value FROM "+table+" WHERE id = 1").Scan(&value); err == nil {
			_, err = transaction.ExecContext(testContext, "UPDATE "+table+" SET value = $1 WHERE id = 1", value+1)
		}
		if err == nil {
			err = transaction.Commit()
		}
		competingCommit <- err
	}()

	attempts := 0
	err := client.RetryTransaction(testContext, &sql.TxOptions{Isolation: sql.LevelSerializable}, func(ctx context.Context, transaction *Tx) error {
		attempts++
		var value int
		if err := transaction.ScanRow(ctx, "SELECT value FROM "+table+" WHERE id = 1", nil, &value); err != nil {
			return err
		}
		if attempts == 1 {
			close(firstSnapshotRead)
			if err := <-competingCommit; err != nil {
				return fmt.Errorf("commit competing serializable transaction: %w", err)
			}
		}
		if err := transaction.EnqueueOutbox(
			ctx,
			"INSERT INTO "+outboxTable+" (event_id, payload) VALUES ($1, $2)",
			"counter.updated",
			value+1,
		); err != nil {
			return err
		}
		_, err := transaction.Exec(ctx, "UPDATE "+table+" SET value = $1 WHERE id = 1", value+1)
		return err
	})
	if err != nil {
		t.Fatalf("RetryTransaction() error = %v", err)
	}
	if attempts != 2 {
		t.Fatalf("RetryTransaction() attempts = %d, want 2", attempts)
	}
	var value int
	if err := client.ScanRow(testContext, "SELECT value FROM "+table+" WHERE id = 1", nil, &value); err != nil {
		t.Fatalf("read final counter: %v", err)
	}
	if value != 2 {
		t.Fatalf("final counter = %d, want 2", value)
	}
	var eventCount int
	var eventPayload int
	if err := client.ScanRow(
		testContext,
		"SELECT COUNT(*), COALESCE(MAX(payload), 0) FROM "+outboxTable+" WHERE event_id = $1",
		[]any{"counter.updated"},
		&eventCount,
		&eventPayload,
	); err != nil {
		t.Fatalf("read retried outbox event: %v", err)
	}
	if eventCount != 1 || eventPayload != 2 {
		t.Fatalf("retried outbox event = count %d/payload %d, want 1/2", eventCount, eventPayload)
	}

	err = client.Transaction(testContext, nil, func(ctx context.Context, transaction *Tx) error {
		if _, err := transaction.Exec(ctx, "UPDATE "+table+" SET value = value + 100 WHERE id = 1"); err != nil {
			return err
		}
		return transaction.EnqueueOutbox(
			ctx,
			"INSERT INTO "+outboxTable+" (event_id, payload) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			"counter.updated",
			102,
		)
	})
	if !errors.Is(err, ErrOutboxEnqueue) {
		t.Fatalf("duplicate outbox transaction error = %v, want ErrOutboxEnqueue", err)
	}
	err = client.Transaction(testContext, nil, func(ctx context.Context, transaction *Tx) error {
		if _, err := transaction.Exec(ctx, "UPDATE "+table+" SET value = value + 100 WHERE id = 1"); err != nil {
			return err
		}
		return transaction.EnqueueOutbox(
			ctx,
			"INSERT INTO "+outboxTable+" (event_id, payload) VALUES ($1, $3), ($2, $3)",
			"counter.multi-one",
			"counter.multi-two",
			202,
		)
	})
	if !errors.Is(err, ErrOutboxEnqueue) {
		t.Fatalf("multi-row outbox transaction error = %v, want ErrOutboxEnqueue", err)
	}
	if err := client.ScanRow(testContext, "SELECT value FROM "+table+" WHERE id = 1", nil, &value); err != nil {
		t.Fatalf("read counter after rejected outbox writes: %v", err)
	}
	if err := client.ScanRow(testContext, "SELECT COUNT(*) FROM "+outboxTable, nil, &eventCount); err != nil {
		t.Fatalf("read outbox after rejected writes: %v", err)
	}
	if value != 2 || eventCount != 1 {
		t.Fatalf("counter/outbox after rejected writes = %d/%d, want 2/1", value, eventCount)
	}
}

func TestRealPostgresRetryTransactionDeadlock(t *testing.T) {
	client, database, testContext := openRealPostgresClient(t, Config{
		OperationTimeout:       4 * time.Second,
		TransactionTimeout:     12 * time.Second,
		MaxOpenConnections:     4,
		MaxIdleConnections:     4,
		TransactionMaxAttempts: 3,
		RetryInitialBackoff:    time.Millisecond,
		RetryMaxBackoff:        5 * time.Millisecond,
	})
	table := createRealPostgresCounterTable(t, database, testContext)
	if _, err := database.ExecContext(testContext, "INSERT INTO "+table+" (id, value) VALUES (2, 0)"); err != nil {
		t.Fatalf("seed second PostgreSQL counter: %v", err)
	}

	type workerResult struct {
		attempts int
		err      error
	}
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	results := make(chan workerResult, 2)
	worker := func(firstID, secondID int) {
		attempts := 0
		err := client.RetryTransaction(testContext, nil, func(ctx context.Context, transaction *Tx) error {
			attempts++
			var value int
			if err := transaction.LockRow(
				ctx,
				"SELECT value FROM "+table+" WHERE id = $1 FOR UPDATE",
				[]any{firstID},
				&value,
			); err != nil {
				return err
			}
			if attempts == 1 {
				select {
				case ready <- struct{}{}:
				case <-ctx.Done():
					return ctx.Err()
				}
				select {
				case <-release:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			if err := transaction.LockRow(
				ctx,
				"SELECT value FROM "+table+" WHERE id = $1 FOR UPDATE",
				[]any{secondID},
				&value,
			); err != nil {
				return err
			}
			_, err := transaction.Exec(
				ctx,
				"UPDATE "+table+" SET value = value + 1 WHERE id IN ($1, $2)",
				firstID,
				secondID,
			)
			return err
		})
		results <- workerResult{attempts: attempts, err: err}
	}

	go worker(1, 2)
	go worker(2, 1)
	for count := 0; count < 2; count++ {
		select {
		case <-ready:
		case <-testContext.Done():
			t.Fatalf("workers did not acquire their first locks: %v", testContext.Err())
		}
	}
	close(release)

	totalAttempts := 0
	retriedWorkers := 0
	for count := 0; count < 2; count++ {
		select {
		case result := <-results:
			if result.err != nil {
				t.Fatalf("deadlock worker error = %v", result.err)
			}
			totalAttempts += result.attempts
			if result.attempts == 2 {
				retriedWorkers++
			} else if result.attempts != 1 {
				t.Fatalf("deadlock worker attempts = %d, want 1 or 2", result.attempts)
			}
		case <-testContext.Done():
			t.Fatalf("deadlock workers did not finish: %v", testContext.Err())
		}
	}
	if totalAttempts != 3 || retriedWorkers != 1 {
		t.Fatalf("deadlock attempts = %d with %d retried workers, want 3 and 1", totalAttempts, retriedWorkers)
	}

	rows, err := database.QueryContext(testContext, "SELECT value FROM "+table+" ORDER BY id")
	if err != nil {
		t.Fatalf("read deadlock counters: %v", err)
	}
	defer rows.Close()
	values := make([]int, 0, 2)
	for rows.Next() {
		var value int
		if err := rows.Scan(&value); err != nil {
			t.Fatalf("scan deadlock counter: %v", err)
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate deadlock counters: %v", err)
	}
	if len(values) != 2 || values[0] != 2 || values[1] != 2 {
		t.Fatalf("deadlock counter values = %v, want [2 2]", values)
	}
}

func TestRealPostgresVersionedUpdateAllowsOneConcurrentWriter(t *testing.T) {
	client, database, testContext := openRealPostgresClient(t, Config{
		OperationTimeout:      2 * time.Second,
		TransactionTimeout:    5 * time.Second,
		MaxOpenConnections:    4,
		MaxIdleConnections:    4,
		ConnectionMaxLifetime: time.Minute,
		ConnectionMaxIdleTime: time.Minute,
	})
	table := createRealPostgresCounterTable(t, database, testContext)
	if _, err := database.ExecContext(testContext, "ALTER TABLE "+table+" ADD COLUMN version BIGINT NOT NULL DEFAULT 0"); err != nil {
		t.Fatalf("add PostgreSQL counter version: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	for _, value := range []int{10, 20} {
		go func(nextValue int) {
			select {
			case <-start:
			case <-testContext.Done():
				results <- testContext.Err()
				return
			}
			results <- client.ExecVersioned(
				testContext,
				"UPDATE "+table+" SET value = $1, version = version + 1 WHERE id = 1 AND version = $2",
				nextValue,
				0,
			)
		}(value)
	}
	close(start)

	successes := 0
	conflicts := 0
	for count := 0; count < 2; count++ {
		select {
		case err := <-results:
			switch {
			case err == nil:
				successes++
			case errors.Is(err, ErrOptimisticConflict):
				conflicts++
			default:
				t.Fatalf("versioned PostgreSQL update error = %v", err)
			}
		case <-testContext.Done():
			t.Fatalf("versioned PostgreSQL updates did not finish: %v", testContext.Err())
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("versioned PostgreSQL results = %d success/%d conflict, want 1/1", successes, conflicts)
	}

	var value int
	var version int64
	if err := client.ScanRow(testContext, "SELECT value, version FROM "+table+" WHERE id = 1", nil, &value, &version); err != nil {
		t.Fatalf("read versioned PostgreSQL counter: %v", err)
	}
	if (value != 10 && value != 20) || version != 1 {
		t.Fatalf("versioned PostgreSQL counter = value %d/version %d, want one candidate/version 1", value, version)
	}
}

func TestRealPostgresVersionedHTTPPrecondition(t *testing.T) {
	client, database, testContext := openRealPostgresClient(t, Config{
		OperationTimeout:      2 * time.Second,
		TransactionTimeout:    5 * time.Second,
		MaxOpenConnections:    4,
		MaxIdleConnections:    4,
		ConnectionMaxLifetime: time.Minute,
		ConnectionMaxIdleTime: time.Minute,
	})
	table := createRealPostgresCounterTable(t, database, testContext)
	if _, err := database.ExecContext(testContext, "ALTER TABLE "+table+" ADD COLUMN version BIGINT NOT NULL DEFAULT 0"); err != nil {
		t.Fatalf("add HTTP PostgreSQL counter version: %v", err)
	}

	type updateRequest struct {
		Value int `json:"value"`
	}
	type updateResponse struct {
		Value   int   `json:"value"`
		Version int64 `json:"version"`
	}
	query := httpapi.NewVersionedQuery("/counter", func(ctx context.Context, _ struct{}) (updateResponse, string, error) {
		var response updateResponse
		if err := client.ScanRow(ctx, "SELECT value, version FROM "+table+" WHERE id = 1", nil, &response.Value, &response.Version); err != nil {
			return updateResponse{}, "", err
		}
		return response, fmt.Sprint(response.Version), nil
	})
	command := httpapi.NewVersionedJSONCommand("/counter", func(ctx context.Context, request updateRequest, precondition httpapi.ApplicationPrecondition) (updateResponse, string, error) {
		expectedVersion, err := strconv.ParseInt(precondition.EntityTag, 10, 64)
		if err != nil {
			return updateResponse{}, "", errors.New("invalid application version")
		}
		err = client.ExecVersioned(
			ctx,
			"UPDATE "+table+" SET value = $1, version = version + 1 WHERE id = 1 AND version = $2",
			request.Value,
			expectedVersion,
		)
		if errors.Is(err, ErrOptimisticConflict) {
			return updateResponse{}, "", httpapi.ErrPreconditionFailed
		}
		if err != nil {
			return updateResponse{}, "", err
		}
		var response updateResponse
		if err := client.ScanRow(ctx, "SELECT value, version FROM "+table+" WHERE id = 1", nil, &response.Value, &response.Version); err != nil {
			return updateResponse{}, "", err
		}
		return response, fmt.Sprint(response.Version), nil
	}).WithMethod(http.MethodPatch)
	app := httpapi.New(httpapi.Options{
		ApplicationQueries:  []httpapi.ApplicationQuery{query},
		ApplicationCommands: []httpapi.ApplicationCommand{command},
	})

	read := func(ifNoneMatch string) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/counter", http.NoBody)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		response, err := app.Test(req)
		if err != nil {
			t.Fatalf("versioned PostgreSQL HTTP read: %v", err)
		}
		return response
	}

	request := func(entityTag string, value int) *http.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/counter", strings.NewReader(fmt.Sprintf(`{"value":%d}`, value)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", entityTag)
		response, err := app.Test(req)
		if err != nil {
			t.Fatalf("versioned PostgreSQL HTTP request: %v", err)
		}
		return response
	}

	initial := read("")
	initial.Body.Close()
	if initial.StatusCode != http.StatusOK || initial.Header.Get("ETag") != `"0"` {
		t.Fatalf("initial PostgreSQL HTTP read = %d/%q", initial.StatusCode, initial.Header.Get("ETag"))
	}

	updated := request(initial.Header.Get("ETag"), 10)
	updated.Body.Close()
	if updated.StatusCode != http.StatusOK || updated.Header.Get("ETag") != `"1"` {
		t.Fatalf("versioned PostgreSQL HTTP update = %d/%q", updated.StatusCode, updated.Header.Get("ETag"))
	}
	stale := request(`"0"`, 20)
	stale.Body.Close()
	if stale.StatusCode != http.StatusPreconditionFailed || stale.Header.Get("ETag") != "" {
		t.Fatalf("stale PostgreSQL HTTP update = %d/%q", stale.StatusCode, stale.Header.Get("ETag"))
	}

	notModified := read(`"1"`)
	body, err := io.ReadAll(notModified.Body)
	notModified.Body.Close()
	if err != nil {
		t.Fatalf("read conditional PostgreSQL HTTP body: %v", err)
	}
	if notModified.StatusCode != http.StatusNotModified || notModified.Header.Get("ETag") != `"1"` || len(body) != 0 {
		t.Fatalf("conditional PostgreSQL HTTP read = %d/%q body %q", notModified.StatusCode, notModified.Header.Get("ETag"), body)
	}

	var value int
	var version int64
	if err := client.ScanRow(testContext, "SELECT value, version FROM "+table+" WHERE id = 1", nil, &value, &version); err != nil {
		t.Fatalf("read HTTP PostgreSQL counter: %v", err)
	}
	if value != 10 || version != 1 {
		t.Fatalf("HTTP PostgreSQL counter = value %d/version %d, want 10/1", value, version)
	}
}

func TestRealPostgresLockWaitHonorsDeadlineAndRecovers(t *testing.T) {
	client, database, testContext := openRealPostgresClient(t, Config{
		OperationTimeout:      2 * time.Second,
		TransactionTimeout:    5 * time.Second,
		MaxOpenConnections:    4,
		MaxIdleConnections:    4,
		RetryInitialBackoff:   time.Millisecond,
		RetryMaxBackoff:       5 * time.Millisecond,
		ConnectionMaxLifetime: time.Minute,
		ConnectionMaxIdleTime: time.Minute,
	})
	table := createRealPostgresCounterTable(t, database, testContext)

	holder, err := database.BeginTx(testContext, nil)
	if err != nil {
		t.Fatalf("begin lock holder: %v", err)
	}
	defer holder.Rollback()
	var heldValue int
	if err := holder.QueryRowContext(testContext, "SELECT value FROM "+table+" WHERE id = 1 FOR UPDATE").Scan(&heldValue); err != nil {
		t.Fatalf("acquire holder row lock: %v", err)
	}

	started := time.Now()
	err = client.Transaction(testContext, nil, func(ctx context.Context, transaction *Tx) error {
		lockContext, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
		defer cancel()
		var value int
		return transaction.LockRow(lockContext, "SELECT value FROM "+table+" WHERE id = 1 FOR UPDATE", nil, &value)
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked LockRow() error = %v, want context deadline", err)
	}
	if elapsed := time.Since(started); elapsed >= time.Second {
		t.Fatalf("blocked LockRow() elapsed = %s, want less than 1s", elapsed)
	}
	if err := holder.Rollback(); err != nil {
		t.Fatalf("release holder row lock: %v", err)
	}

	err = client.Transaction(testContext, nil, func(ctx context.Context, transaction *Tx) error {
		var value int
		return transaction.LockRow(ctx, "SELECT value FROM "+table+" WHERE id = 1 FOR UPDATE", nil, &value)
	})
	if err != nil {
		t.Fatalf("LockRow() after release error = %v", err)
	}
}

func openRealPostgresClient(t *testing.T, config Config) (*Client, *sql.DB, context.Context) {
	t.Helper()
	postgresURL := strings.TrimSpace(os.Getenv("POSTGRES_TEST_URL"))
	if postgresURL == "" {
		t.Skip("POSTGRES_TEST_URL is not set; real PostgreSQL integration is opt-in")
	}
	testContext, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	database, err := sql.Open("pgx", postgresURL)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	client, err := New(database, config)
	if err != nil {
		database.Close()
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	if err := client.Check(testContext); err != nil {
		t.Fatalf("check PostgreSQL: %v", err)
	}
	return client, database, testContext
}

func createRealPostgresCounterTable(t *testing.T, database *sql.DB, ctx context.Context) string {
	t.Helper()
	// The identifier consists only of this fixed prefix, the process ID, and decimal digits.
	table := fmt.Sprintf("goexample_sqlclient_%d_%d", os.Getpid(), postgresIntegrationTableID.Add(1))
	if _, err := database.ExecContext(ctx, "CREATE TABLE "+table+" (id integer PRIMARY KEY, value integer NOT NULL)"); err != nil {
		t.Fatalf("create PostgreSQL table: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := database.ExecContext(cleanupContext, "DROP TABLE IF EXISTS "+table); err != nil {
			t.Errorf("drop PostgreSQL table: %v", err)
		}
	})
	if _, err := database.ExecContext(ctx, "INSERT INTO "+table+" (id, value) VALUES (1, 0)"); err != nil {
		t.Fatalf("seed PostgreSQL table: %v", err)
	}
	return table
}

func createRealPostgresOutboxTable(t *testing.T, database *sql.DB, ctx context.Context) string {
	t.Helper()
	// The identifier consists only of this fixed prefix, the process ID, and decimal digits.
	table := fmt.Sprintf("goexample_sqlclient_outbox_%d_%d", os.Getpid(), postgresIntegrationTableID.Add(1))
	if _, err := database.ExecContext(ctx, "CREATE TABLE "+table+" (event_id text PRIMARY KEY, payload integer NOT NULL)"); err != nil {
		t.Fatalf("create PostgreSQL outbox table: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := database.ExecContext(cleanupContext, "DROP TABLE IF EXISTS "+table); err != nil {
			t.Errorf("drop PostgreSQL outbox table: %v", err)
		}
	})
	return table
}
