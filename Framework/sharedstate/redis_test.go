package sharedstate

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestRedisStorageTTLAndNamespaceReset(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:test-a:")
	defer state.Close()

	if err := state.Set("session", []byte("value"), time.Minute); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	value, err := state.Get("session")
	if err != nil || string(value) != "value" {
		t.Fatalf("Get() = %q, %v", value, err)
	}
	if ttl := server.TTL("goexample:test-a:session"); ttl <= 0 || ttl > time.Minute {
		t.Fatalf("storage TTL = %s", ttl)
	}
	server.Set("goexample:other:session", "keep")
	if err := state.Reset(); err != nil {
		t.Fatalf("Reset() error = %v", err)
	}
	if server.Exists("goexample:test-a:session") {
		t.Fatal("Reset() retained a key in its namespace")
	}
	if !server.Exists("goexample:other:session") {
		t.Fatal("Reset() removed another namespace")
	}
	if err := state.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}
}

func TestRedisAtomicRateLimitAcrossClients(t *testing.T) {
	server := miniredis.RunT(t)
	first := newTestRedis(t, server, "goexample:rate:")
	second := newTestRedis(t, server, "goexample:rate:")
	defer first.Close()
	defer second.Close()

	start := make(chan struct{})
	results := make(chan RateLimitResult, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for _, state := range []*Redis{first, second} {
		wait.Add(1)
		go func(state *Redis) {
			defer wait.Done()
			<-start
			result, err := state.Take(context.Background(), "client", 1, time.Minute)
			results <- result
			errorsChannel <- err
		}(state)
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("Take() error = %v", err)
		}
	}
	allowed := 0
	for result := range results {
		if result.Allowed {
			allowed++
		}
		if result.ResetAfter <= 0 || result.ResetAfter > time.Minute {
			t.Fatalf("reset after = %s", result.ResetAfter)
		}
	}
	if allowed != 1 {
		t.Fatalf("allowed requests = %d, want 1", allowed)
	}
	if ttl := server.TTL("goexample:rate:client"); ttl <= 0 || ttl > time.Minute {
		t.Fatalf("rate limit TTL = %s", ttl)
	}
}

func TestRedisLockOwnerCannotDeleteReplacementLease(t *testing.T) {
	server := miniredis.RunT(t)
	first := newTestRedis(t, server, "goexample:lock:")
	second := newTestRedis(t, server, "goexample:lock:")
	defer first.Close()
	defer second.Close()

	if err := first.Lock("resource"); err != nil {
		t.Fatalf("first Lock() error = %v", err)
	}
	firstToken, err := server.Get("goexample:lock:resource")
	if err != nil {
		t.Fatalf("first owner token error = %v", err)
	}
	server.FastForward(300 * time.Millisecond)
	if err := second.Lock("resource"); err != nil {
		t.Fatalf("second Lock() error = %v", err)
	}
	secondToken, err := server.Get("goexample:lock:resource")
	if err != nil || secondToken == firstToken {
		t.Fatalf("replacement token = %q, error = %v", secondToken, err)
	}
	if err := first.Unlock("resource"); err != nil {
		t.Fatalf("stale Unlock() error = %v", err)
	}
	currentToken, err := server.Get("goexample:lock:resource")
	if err != nil || currentToken != secondToken {
		t.Fatalf("token after stale unlock = %q, %v", currentToken, err)
	}
	if err := second.Unlock("resource"); err != nil {
		t.Fatalf("replacement Unlock() error = %v", err)
	}
	if server.Exists("goexample:lock:resource") {
		t.Fatal("replacement lease still exists after owner unlock")
	}
}

func TestRedisLockWaitIsBounded(t *testing.T) {
	server := miniredis.RunT(t)
	first := newTestRedis(t, server, "goexample:wait:")
	second := newTestRedis(t, server, "goexample:wait:")
	defer first.Close()
	defer second.Close()
	if err := first.Lock("resource"); err != nil {
		t.Fatalf("first Lock() error = %v", err)
	}
	defer first.Unlock("resource")

	started := time.Now()
	err := second.Lock("resource")
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("second Lock() error = %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("lock wait elapsed = %s", elapsed)
	}
}

func TestRedisOperationsFailWhenBackendStops(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:failure:")
	defer state.Close()
	server.Close()

	if _, err := state.Take(context.Background(), "client", 1, time.Minute); err == nil {
		t.Fatal("Take() succeeded after Redis stopped")
	}
	if err := state.Set("key", []byte("value"), time.Minute); err == nil {
		t.Fatal("Set() succeeded after Redis stopped")
	}
	if err := state.Check(context.Background()); err == nil {
		t.Fatal("Check() succeeded after Redis stopped")
	}
}

func TestRedisConfigDoesNotExposeCredentialURL(t *testing.T) {
	secretURL := "redis://user:super-secret@127.0.0.1:1/0"
	_, err := NewRedis(context.Background(), RedisConfig{
		URL:              secretURL,
		KeyPrefix:        "goexample:secret:",
		OperationTimeout: 10 * time.Millisecond,
	})
	if err == nil {
		t.Fatal("NewRedis() unexpectedly succeeded")
	}
	if strings.Contains(err.Error(), secretURL) || strings.Contains(err.Error(), "super-secret") {
		t.Fatalf("NewRedis() exposed credentials: %v", err)
	}
}

func TestRedisRejectsNegativeBudgets(t *testing.T) {
	_, err := NewRedis(context.Background(), RedisConfig{
		URL:              "redis://127.0.0.1:6379/0",
		KeyPrefix:        "goexample:invalid:",
		OperationTimeout: -time.Second,
	})
	if err == nil || !strings.Contains(err.Error(), "greater than zero") {
		t.Fatalf("NewRedis() error = %v", err)
	}

	_, err = NewRedis(context.Background(), RedisConfig{
		URL:               "redis://127.0.0.1:6379/0",
		KeyPrefix:         "goexample:invalid:",
		LockTTL:           time.Second,
		LockWaitTimeout:   time.Second,
		LockRetryInterval: time.Millisecond,
	})
	if err == nil || !strings.Contains(err.Error(), "less than REDIS_LOCK_TTL") {
		t.Fatalf("NewRedis() lock budget error = %v", err)
	}
}

func TestRedisSentinelOptionsStayBoundedAndCredentialSeparated(t *testing.T) {
	tlsSource := &tls.Config{MinVersion: tls.VersionTLS10, ServerName: "redis.internal"}
	config := withDefaults(RedisConfig{
		Topology:           RedisTopologySentinel,
		SentinelAddresses:  []string{"sentinel-a.internal:26379", "sentinel-b.internal:26379", "sentinel-c.internal:26379"},
		SentinelMasterName: "goexample-primary",
		Username:           "application-user",
		Password:           "application-password",
		SentinelUsername:   "sentinel-user",
		SentinelPassword:   "sentinel-password",
		Database:           2,
		TLSConfig:          tlsSource,
		KeyPrefix:          "goexample:sentinel:",
	})
	if err := validateConfig(config); err != nil {
		t.Fatalf("validateConfig() error = %v", err)
	}
	options := redisSentinelOptions(config)
	if options.MasterName != config.SentinelMasterName || options.DB != 2 ||
		options.Username != config.Username || options.Password != config.Password ||
		options.SentinelUsername != config.SentinelUsername || options.SentinelPassword != config.SentinelPassword {
		t.Fatalf("Sentinel identity options = %#v", options)
	}
	if len(options.SentinelAddrs) != 3 || options.SentinelAddrs[0] != config.SentinelAddresses[0] {
		t.Fatalf("Sentinel addresses = %#v", options.SentinelAddrs)
	}
	if options.TLSConfig == tlsSource || options.TLSConfig.MinVersion != tls.VersionTLS12 ||
		options.TLSConfig.ServerName != "redis.internal" || tlsSource.MinVersion != tls.VersionTLS10 {
		t.Fatalf("Sentinel TLS clone = %#v, source = %#v", options.TLSConfig, tlsSource)
	}
	if options.DialTimeout != defaultOperationTimeout || options.ReadTimeout != defaultOperationTimeout ||
		options.WriteTimeout != defaultOperationTimeout || options.PoolTimeout != defaultOperationTimeout ||
		!options.ContextTimeoutEnabled || options.PoolSize != defaultPoolSize {
		t.Fatalf("Sentinel budgets = %#v", options)
	}
	config.SentinelAddresses[0] = "changed.internal:26379"
	if options.SentinelAddrs[0] == config.SentinelAddresses[0] {
		t.Fatal("Sentinel options retained the caller address slice")
	}
}

func TestRedisRejectsUnsafeSentinelConfigurationBeforeConnecting(t *testing.T) {
	valid := RedisConfig{
		Topology:           RedisTopologySentinel,
		SentinelAddresses:  []string{"sentinel-a:26379", "sentinel-b:26379", "sentinel-c:26379"},
		SentinelMasterName: "goexample-primary",
		KeyPrefix:          "goexample:sentinel:",
	}
	for _, test := range []struct {
		name    string
		mutate  func(*RedisConfig)
		message string
	}{
		{name: "too few addresses", mutate: func(config *RedisConfig) { config.SentinelAddresses = config.SentinelAddresses[:2] }, message: "between 3 and 16"},
		{name: "duplicate address", mutate: func(config *RedisConfig) { config.SentinelAddresses[2] = config.SentinelAddresses[0] }, message: "must be unique"},
		{name: "credential in address", mutate: func(config *RedisConfig) { config.SentinelAddresses[0] = "user@sentinel-a:26379" }, message: "address 1 is invalid"},
		{name: "invalid port", mutate: func(config *RedisConfig) { config.SentinelAddresses[0] = "sentinel-a:70000" }, message: "address 1 is invalid"},
		{name: "missing master", mutate: func(config *RedisConfig) { config.SentinelMasterName = "" }, message: "MASTER_NAME"},
		{name: "unsafe master", mutate: func(config *RedisConfig) { config.SentinelMasterName = "primary name" }, message: "MASTER_NAME"},
		{name: "URL ambiguity", mutate: func(config *RedisConfig) { config.URL = "redis://127.0.0.1:6379/0" }, message: "must be empty"},
		{name: "database", mutate: func(config *RedisConfig) { config.Database = 16 }, message: "REDIS_DATABASE"},
		{name: "data ACL", mutate: func(config *RedisConfig) { config.Username = "app" }, message: "REDIS_PASSWORD"},
		{name: "Sentinel ACL", mutate: func(config *RedisConfig) { config.SentinelUsername = "sentinel" }, message: "REDIS_SENTINEL_PASSWORD"},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := valid
			config.SentinelAddresses = append([]string(nil), valid.SentinelAddresses...)
			test.mutate(&config)
			_, err := NewRedis(context.Background(), config)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("NewRedis() error = %v", err)
			}
		})
	}
}

func TestRedisSentinelStartupFailureDoesNotExposeCredentials(t *testing.T) {
	config := RedisConfig{
		Topology:           RedisTopologySentinel,
		SentinelAddresses:  []string{"127.0.0.1:1", "127.0.0.1:2", "127.0.0.1:3"},
		SentinelMasterName: "goexample-primary",
		Username:           "application-user",
		Password:           "application-private-password",
		SentinelUsername:   "sentinel-user",
		SentinelPassword:   "sentinel-private-password",
		KeyPrefix:          "goexample:sentinel-failure:",
		OperationTimeout:   20 * time.Millisecond,
	}
	_, err := NewRedis(context.Background(), config)
	if err == nil {
		t.Fatal("NewRedis() unexpectedly connected to unavailable Sentinels")
	}
	for _, secret := range []string{config.Password, config.SentinelPassword} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("NewRedis() exposed credential %q: %v", secret, err)
		}
	}
}

func TestRedisFailureDoesNotMasqueradeAsClientDeadline(t *testing.T) {
	err := redisFailure("read Redis", context.DeadlineExceeded)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("redisFailure() unwraps dependency deadline: %v", err)
	}
}

func TestRedisCreatesLowSensitivityClientSpans(t *testing.T) {
	recorder, provider := newRedisTestTracerProvider(t)
	server := miniredis.RunT(t)
	prefix := "goexample:private-prefix:"
	parentCtx, parent := provider.Tracer("test").Start(context.Background(), "redis-parent")
	state := newTestRedisWithProvider(t, parentCtx, server, prefix, provider)
	defer state.Close()

	key := "customer-ip-203.0.113.9"
	value := "private-value"
	if err := state.SetWithContext(parentCtx, key, []byte(value), time.Minute); err != nil {
		t.Fatalf("SetWithContext() error = %v", err)
	}
	missingKey := "missing-session"
	if result, err := state.GetWithContext(parentCtx, missingKey); err != nil || result != nil {
		t.Fatalf("missing GetWithContext() = %q, %v", result, err)
	}
	if _, err := state.Take(parentCtx, "rate-limit-ip", 2, time.Minute); err != nil {
		t.Fatalf("Take() error = %v", err)
	}
	lockKey := "private-lock"
	if err := state.Lock(lockKey); err != nil {
		t.Fatalf("Lock() error = %v", err)
	}
	ownerToken, err := server.Get(prefix + lockKey)
	if err != nil {
		t.Fatalf("read lock owner token: %v", err)
	}
	if err := state.Unlock(lockKey); err != nil {
		t.Fatalf("Unlock() error = %v", err)
	}

	pipeline := state.client.Pipeline()
	pipeline.Set(parentCtx, prefix+"pipeline-key", "pipeline-value", time.Minute)
	pipeline.Get(parentCtx, prefix+"pipeline-key")
	if _, err := pipeline.Exec(parentCtx); err != nil {
		t.Fatalf("pipeline Exec() error = %v", err)
	}
	parent.End()

	allowedResults := map[string]bool{
		"success": true, "not_found": true, "timeout": true, "canceled": true, "failure": true,
	}
	var sawParentSet, sawMissingGet, sawScript, sawPipeline bool
	for _, span := range recorder.Ended() {
		if !strings.HasPrefix(span.Name(), "redis.") {
			continue
		}
		attributes := redisSpanAttributes(span)
		if span.SpanKind() != trace.SpanKindClient || attributes["db.system.name"].AsString() != "redis" {
			t.Fatalf("Redis span kind/system = %s/%#v", span.SpanKind(), attributes)
		}
		operation := attributes["db.operation.name"].AsString()
		result := attributes["goexample.redis.result"].AsString()
		if operation == "" || !allowedResults[result] {
			t.Fatalf("Redis span operation/result = %q/%q", operation, result)
		}
		if len(span.Events()) != 0 {
			t.Fatalf("Redis span %q recorded raw error events: %#v", span.Name(), span.Events())
		}
		if result == "success" || result == "not_found" {
			if span.Status().Code != codes.Unset || span.Status().Description != "" {
				t.Fatalf("Redis non-error span status = %#v", span.Status())
			}
		} else if span.Status().Code != codes.Error || !isFixedRedisStatus(span.Status().Description) {
			t.Fatalf("Redis error span status = %#v", span.Status())
		}
		if span.Name() == "redis.set" && span.Parent().SpanID() == parent.SpanContext().SpanID() {
			sawParentSet = true
		}
		if span.Name() == "redis.get" && result == "not_found" && span.Parent().SpanID() == parent.SpanContext().SpanID() {
			sawMissingGet = true
		}
		if (span.Name() == "redis.eval" || span.Name() == "redis.evalsha") && span.Parent().SpanID() == parent.SpanContext().SpanID() {
			sawScript = true
		}
		if span.Name() == "redis.pipeline" && attributes["db.operation.batch.size"].AsInt64() == 2 && span.Parent().SpanID() == parent.SpanContext().SpanID() {
			sawPipeline = true
		}

		encoded := encodeRedisSpan(span)
		for _, secret := range []string{
			prefix, key, value, missingKey, "rate-limit-ip", lockKey, ownerToken,
			"pipeline-key", "pipeline-value", server.Addr(), "redis://",
		} {
			if strings.Contains(encoded, secret) {
				t.Fatalf("Redis span leaked %q: %s", secret, encoded)
			}
		}
	}
	if !sawParentSet || !sawMissingGet || !sawScript || !sawPipeline {
		t.Fatalf("Redis span coverage: set=%t missing=%t script=%t pipeline=%t", sawParentSet, sawMissingGet, sawScript, sawPipeline)
	}
}

func TestRedisFailureSpanDoesNotExposeBackendError(t *testing.T) {
	recorder, provider := newRedisTestTracerProvider(t)
	server := miniredis.RunT(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:failure-trace:", provider)
	defer state.Close()
	previousSpanCount := len(recorder.Ended())
	serverAddress := server.Addr()
	server.Close()

	key := "credential-bearing-key"
	_, operationErr := state.GetWithContext(context.Background(), key)
	if operationErr == nil {
		t.Fatal("GetWithContext() succeeded after Redis stopped")
	}
	for _, span := range recorder.Ended()[previousSpanCount:] {
		if span.Name() != "redis.get" {
			continue
		}
		result := redisSpanAttributes(span)["goexample.redis.result"].AsString()
		if result != "failure" && result != "timeout" {
			t.Fatalf("backend failure result = %q", result)
		}
		encoded := encodeRedisSpan(span)
		for _, secret := range []string{key, serverAddress, operationErr.Error()} {
			if strings.Contains(encoded, secret) {
				t.Fatalf("Redis failure span leaked %q: %s", secret, encoded)
			}
		}
		return
	}
	t.Fatal("Redis GET failure span was not recorded")
}

func TestRedisTraceClassificationIsBounded(t *testing.T) {
	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	timedOutCtx, timeoutCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer timeoutCancel()
	for _, test := range []struct {
		ctx  context.Context
		err  error
		want string
	}{
		{context.Background(), nil, "success"},
		{context.Background(), redis.ErrNoScript, "not_found"},
		{canceledCtx, context.Canceled, "canceled"},
		{timedOutCtx, context.DeadlineExceeded, "timeout"},
		{context.Background(), errors.New("private backend error"), "failure"},
	} {
		result, _ := classifyRedisTraceResult(test.ctx, test.err)
		if result != test.want {
			t.Fatalf("classifyRedisTraceResult(%v) = %q, want %q", test.err, result, test.want)
		}
	}
	if operation := redisSpanOperation("PRIVATE-COMMAND"); operation != "_other" {
		t.Fatalf("unknown Redis operation = %q", operation)
	}
	if size := boundedRedisPipelineSize(maxObservedPipelineCommands + 500); size != maxObservedPipelineCommands {
		t.Fatalf("bounded pipeline size = %d", size)
	}
}

func TestRedisTracingHooksRejectLateNilResults(t *testing.T) {
	recorder, provider := newRedisTestTracerProvider(t)
	hook := newRedisTracingHook(provider).(redisTracingHook)

	t.Run("dial", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		connection := &countingRedisTestConnection{}
		wrapped := hook.DialHook(func(context.Context, string, string) (net.Conn, error) {
			cancel()
			return connection, nil
		})

		result, err := wrapped(ctx, "tcp", "private-redis-address")
		if result != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("late dial connection/error = %#v/%v, want nil/context.Canceled", result, err)
		}
		if connection.closes.Load() != 1 {
			t.Fatalf("late dial close count = %d, want 1", connection.closes.Load())
		}
	})

	t.Run("command", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		wrapped := hook.ProcessHook(func(context.Context, redis.Cmder) error {
			cancel()
			return nil
		})
		err := wrapped(ctx, redis.NewCmd(ctx, "GET", "private-key"))
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("late command error = %v, want context.Canceled", err)
		}
	})

	t.Run("pipeline", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		wrapped := hook.ProcessPipelineHook(func(context.Context, []redis.Cmder) error {
			cancel()
			return nil
		})
		err := wrapped(ctx, []redis.Cmder{redis.NewCmd(ctx, "GET", "private-key")})
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("late pipeline error = %v, want context.Canceled", err)
		}
	})

	var sawDial, sawCommand, sawPipeline bool
	for _, span := range recorder.Ended() {
		result := redisSpanAttributes(span)["goexample.redis.result"].AsString()
		if result != "canceled" {
			t.Fatalf("late nil span %q result = %q, want canceled", span.Name(), result)
		}
		switch span.Name() {
		case "redis.connect":
			sawDial = true
		case "redis.get":
			sawCommand = true
		case "redis.pipeline":
			sawPipeline = true
		}
	}
	if !sawDial || !sawCommand || !sawPipeline {
		t.Fatalf("late nil span coverage: dial=%t command=%t pipeline=%t", sawDial, sawCommand, sawPipeline)
	}
}

func TestRedisTracingHooksObserveElapsedDeadlineAndPreserveExplicitErrors(t *testing.T) {
	recorder, provider := newRedisTestTracerProvider(t)
	hook := newRedisTracingHook(provider).(redisTracingHook)
	elapsed := redisDeadlineOnlyContext{
		Context:  context.Background(),
		deadline: time.Now().Add(-time.Millisecond),
	}

	if err := completedRedisContextError(context.Background()); err != nil {
		t.Fatalf("live context error = %v, want nil", err)
	}
	canceled, cancelCanceled := context.WithCancel(context.Background())
	cancelCanceled()
	if err := completedRedisContextError(canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error = %v, want context.Canceled", err)
	}
	if err := completedRedisContextError(elapsed); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed context error = %v, want context.DeadlineExceeded", err)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if completedRedisContextError(context.Background()) != nil {
			t.Fatal("live context unexpectedly completed")
		}
	}); allocations != 0 {
		t.Fatalf("completed context allocations = %v, want 0", allocations)
	}
	wrapped := hook.ProcessHook(func(context.Context, redis.Cmder) error { return nil })
	if err := wrapped(elapsed, redis.NewCmd(elapsed, "GET", "private-key")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed command error = %v, want context.DeadlineExceeded", err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || redisSpanAttributes(spans[0])["goexample.redis.result"].AsString() != "timeout" {
		t.Fatalf("elapsed command spans = %#v, want one timeout", spans)
	}

	backendErr := errors.New("private backend error")
	ctx, cancel := context.WithCancel(context.Background())
	preserve := hook.ProcessHook(func(context.Context, redis.Cmder) error {
		cancel()
		return backendErr
	})
	if err := preserve(ctx, redis.NewCmd(ctx, "GET", "private-key")); !errors.Is(err, backendErr) {
		t.Fatalf("explicit backend error = %v, want original error", err)
	}

	nilDial := hook.DialHook(func(context.Context, string, string) (net.Conn, error) {
		return nil, nil
	})
	if connection, err := nilDial(elapsed, "tcp", "private-redis-address"); connection != nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("nil elapsed dial connection/error = %#v/%v", connection, err)
	}
	closeErr := errors.New("private close error")
	closeFailureConnection := &countingRedisTestConnection{closeErr: closeErr}
	closeFailureDial := hook.DialHook(func(context.Context, string, string) (net.Conn, error) {
		return closeFailureConnection, nil
	})
	if connection, err := closeFailureDial(elapsed, "tcp", "private-redis-address"); connection != nil ||
		!errors.Is(err, context.DeadlineExceeded) || errors.Is(err, closeErr) {
		t.Fatalf("close-failing elapsed dial connection/error = %#v/%v", connection, err)
	}
	if closeFailureConnection.closes.Load() != 1 {
		t.Fatalf("close-failing dial close count = %d, want 1", closeFailureConnection.closes.Load())
	}
}

type redisDeadlineOnlyContext struct {
	context.Context
	deadline time.Time
}

func (ctx redisDeadlineOnlyContext) Deadline() (time.Time, bool) { return ctx.deadline, true }
func (redisDeadlineOnlyContext) Done() <-chan struct{}           { return nil }
func (redisDeadlineOnlyContext) Err() error                      { return nil }

type countingRedisTestConnection struct {
	closes   atomic.Int32
	closeErr error
}

func (*countingRedisTestConnection) Read([]byte) (int, error)         { return 0, io.EOF }
func (*countingRedisTestConnection) Write(buffer []byte) (int, error) { return len(buffer), nil }
func (connection *countingRedisTestConnection) Close() error {
	connection.closes.Add(1)
	return connection.closeErr
}
func (*countingRedisTestConnection) LocalAddr() net.Addr              { return redisTestAddress("local") }
func (*countingRedisTestConnection) RemoteAddr() net.Addr             { return redisTestAddress("remote") }
func (*countingRedisTestConnection) SetDeadline(time.Time) error      { return nil }
func (*countingRedisTestConnection) SetReadDeadline(time.Time) error  { return nil }
func (*countingRedisTestConnection) SetWriteDeadline(time.Time) error { return nil }

type redisTestAddress string

func (address redisTestAddress) Network() string { return string(address) }
func (address redisTestAddress) String() string  { return string(address) }

func TestRealRedisIntegration(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("REDIS_TEST_URL"))
	if url == "" {
		t.Skip("REDIS_TEST_URL is not set; real Redis integration is opt-in")
	}
	prefix := "goexample:integration:" + time.Now().UTC().Format("20060102T150405.000000000") + ":"
	first, err := NewRedis(context.Background(), RedisConfig{URL: url, KeyPrefix: prefix})
	if err != nil {
		t.Fatalf("create first Redis client: %v", err)
	}
	defer first.Close()
	second, err := NewRedis(context.Background(), RedisConfig{URL: url, KeyPrefix: prefix})
	if err != nil {
		t.Fatalf("create second Redis client: %v", err)
	}
	defer second.Close()
	defer first.Reset()

	if err := first.Set("probe", []byte("ok"), time.Minute); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	if value, err := second.Get("probe"); err != nil || string(value) != "ok" {
		t.Fatalf("cross-client Get() = %q, %v", value, err)
	}
	firstResult, err := first.Take(context.Background(), "limit", 1, time.Minute)
	if err != nil || !firstResult.Allowed {
		t.Fatalf("first Take() = %#v, %v", firstResult, err)
	}
	secondResult, err := second.Take(context.Background(), "limit", 1, time.Minute)
	if err != nil || secondResult.Allowed {
		t.Fatalf("second Take() = %#v, %v", secondResult, err)
	}
	if err := first.Lock("lease"); err != nil {
		t.Fatalf("Lock() error = %v", err)
	}
	if err := first.Unlock("lease"); err != nil {
		t.Fatalf("Unlock() error = %v", err)
	}
}

func newTestRedis(t *testing.T, server *miniredis.Miniredis, prefix string) *Redis {
	t.Helper()
	return newTestRedisWithProvider(t, context.Background(), server, prefix, nil)
}

func newTestRedisWithProvider(t *testing.T, ctx context.Context, server *miniredis.Miniredis, prefix string, provider trace.TracerProvider) *Redis {
	t.Helper()
	state, err := NewRedis(ctx, RedisConfig{
		URL:                "redis://" + server.Addr() + "/0",
		KeyPrefix:          prefix,
		OperationTimeout:   100 * time.Millisecond,
		LockTTL:            250 * time.Millisecond,
		LockWaitTimeout:    80 * time.Millisecond,
		LockRetryInterval:  5 * time.Millisecond,
		PoolSize:           4,
		MinIdleConnections: 0,
		TracerProvider:     provider,
	})
	if err != nil {
		t.Fatalf("NewRedis() error = %v", err)
	}
	return state
}

func newRedisTestTracerProvider(t *testing.T) (*tracetest.SpanRecorder, *sdktrace.TracerProvider) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(recorder),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	return recorder, provider
}

func redisSpanAttributes(span sdktrace.ReadOnlySpan) map[string]attribute.Value {
	result := make(map[string]attribute.Value)
	for _, item := range span.Attributes() {
		result[string(item.Key)] = item.Value
	}
	return result
}

func encodeRedisSpan(span sdktrace.ReadOnlySpan) string {
	var encoded strings.Builder
	encoded.WriteString(span.Name())
	encoded.WriteString(span.Status().Description)
	for _, item := range span.Attributes() {
		encoded.WriteString(string(item.Key))
		encoded.WriteString(item.Value.Emit())
	}
	for _, event := range span.Events() {
		encoded.WriteString(event.Name)
		for _, item := range event.Attributes {
			encoded.WriteString(string(item.Key))
			encoded.WriteString(item.Value.Emit())
		}
	}
	return encoded.String()
}

func isFixedRedisStatus(description string) bool {
	return description == "redis operation canceled" || description == "redis operation timed out" || description == "redis operation failed"
}
