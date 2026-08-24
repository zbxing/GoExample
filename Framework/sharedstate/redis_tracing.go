package sharedstate

import (
	"context"
	"errors"
	"net"
	"strings"

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
		finishRedisSpan(ctx, span, err)
		return err
	}
}

func (hook redisTracingHook) start(ctx context.Context, operation string) (context.Context, trace.Span) {
	return hook.tracer.Start(
		ctx,
		"redis."+operation,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemNameRedis,
			semconv.DBOperationName(strings.ToUpper(operation)),
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
	switch strings.ToLower(name) {
	case "auth", "client", "del", "eval", "evalsha", "get", "hello", "ping", "scan", "select", "set":
		return strings.ToLower(name)
	default:
		return "_other"
	}
}

func boundedRedisPipelineSize(size int) int {
	return min(max(size, 0), maxObservedPipelineCommands)
}

var _ redis.Hook = redisTracingHook{}
