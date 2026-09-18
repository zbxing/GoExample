package sharedstate

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	redisInstrumentationName    = "github.com/zbxing/goexample/Framework/sharedstate"
	maxObservedPipelineCommands = 1000
)

type redisTracingHook struct {
	tracer trace.Tracer
}

func newRedisTracingHook(provider trace.TracerProvider) redis.Hook {
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	return redisTracingHook{tracer: provider.Tracer(redisInstrumentationName)}
}

func (hook redisTracingHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		ctx, span := hook.start(ctx, "connect")
		connection, err := next(ctx, network, address)
		if err == nil {
			if contextErr := completedRedisContextError(ctx); contextErr != nil {
				if connection != nil {
					_ = connection.Close()
				}
				connection = nil
				err = contextErr
			}
		}
		finishRedisSpan(ctx, span, err)
		return connection, err
	}
}

func (hook redisTracingHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, command redis.Cmder) error {
		operation := "_other"
		if command != nil {
			operation = redisSpanOperation(command.Name())
		}
		ctx, span := hook.start(ctx, operation)
		err := next(ctx, command)
		if err == nil {
			err = completedRedisContextError(ctx)
		}
		finishRedisSpan(ctx, span, err)
		return err
	}
}

func (hook redisTracingHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, commands []redis.Cmder) error {
		ctx, span := hook.tracer.Start(
			ctx,
			"redis.pipeline",
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(
				semconv.DBSystemNameRedis,
				semconv.DBOperationName("PIPELINE"),
				semconv.DBOperationBatchSize(boundedRedisPipelineSize(len(commands))),
			),
		)
		err := next(ctx, commands)
		if err == nil {
			err = completedRedisContextError(ctx)
		}
		finishRedisSpan(ctx, span, err)
		return err
	}
}

// completedRedisContextError also observes a deadline whose timer has elapsed
// but whose Done channel has not been scheduled yet. Hooks use it only after a
// nil dependency result, so explicit backend errors remain authoritative.
func completedRedisContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

func (hook redisTracingHook) start(ctx context.Context, operation string) (context.Context, trace.Span) {
	return hook.tracer.Start(
		ctx,
		"redis."+operation,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemNameRedis,
			semconv.DBOperationName(redisDatabaseOperationName(operation)),
		),
	)
}

func finishRedisSpan(ctx context.Context, span trace.Span, err error) {
	result, description := classifyRedisTraceResult(ctx, err)
	span.SetAttributes(attribute.String("goexample.redis.result", result))
	if description != "" {
		span.SetStatus(codes.Error, description)
	}
	span.End()
}

func classifyRedisTraceResult(ctx context.Context, err error) (string, string) {
	switch {
	case err == nil:
		return "success", ""
	case errors.Is(err, redis.Nil) || redis.HasErrorPrefix(err, "NOSCRIPT"):
		return "not_found", ""
	case errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled):
		return "canceled", "redis operation canceled"
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return "timeout", "redis operation timed out"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "timeout", "redis operation timed out"
	}
	return "failure", "redis operation failed"
}

func redisSpanOperation(name string) string {
	switch name {
	case "auth":
		return "auth"
	case "client":
		return "client"
	case "del":
		return "del"
	case "eval":
		return "eval"
	case "evalsha":
		return "evalsha"
	case "get":
		return "get"
	case "hello":
		return "hello"
	case "ping":
		return "ping"
	case "scan":
		return "scan"
	case "select":
		return "select"
	case "set":
		return "set"
	}

	// go-redis supplies lowercase command names. EqualFold retains the prior
	// compatibility for custom Cmder implementations without allocating a
	// normalized copy on either path.
	switch len(name) {
	case 3:
		switch {
		case strings.EqualFold(name, "del"):
			return "del"
		case strings.EqualFold(name, "get"):
			return "get"
		case strings.EqualFold(name, "set"):
			return "set"
		}
	case 4:
		switch {
		case strings.EqualFold(name, "auth"):
			return "auth"
		case strings.EqualFold(name, "eval"):
			return "eval"
		case strings.EqualFold(name, "ping"):
			return "ping"
		case strings.EqualFold(name, "scan"):
			return "scan"
		}
	case 5:
		if strings.EqualFold(name, "hello") {
			return "hello"
		}
	case 6:
		switch {
		case strings.EqualFold(name, "client"):
			return "client"
		case strings.EqualFold(name, "select"):
			return "select"
		}
	case 7:
		if strings.EqualFold(name, "evalsha") {
			return "evalsha"
		}
	}
	return "_other"
}

func redisDatabaseOperationName(operation string) string {
	switch operation {
	case "auth":
		return "AUTH"
	case "client":
		return "CLIENT"
	case "connect":
		return "CONNECT"
	case "del":
		return "DEL"
	case "eval":
		return "EVAL"
	case "evalsha":
		return "EVALSHA"
	case "get":
		return "GET"
	case "hello":
		return "HELLO"
	case "ping":
		return "PING"
	case "scan":
		return "SCAN"
	case "select":
		return "SELECT"
	case "set":
		return "SET"
	default:
		return "_OTHER"
	}
}

func boundedRedisPipelineSize(size int) int {
	return min(max(size, 0), maxObservedPipelineCommands)
}

var _ redis.Hook = redisTracingHook{}
