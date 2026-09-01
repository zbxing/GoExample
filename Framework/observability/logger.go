package observability

import (
	"context"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
)

func NewLogger(format, level string, output io.Writer) *slog.Logger {
	if output == nil {
		output = os.Stdout
	}
	options := &slog.HandlerOptions{Level: parseLevel(level)}
	if format == "text" {
		return slog.New(slog.NewTextHandler(output, options))
	}
	return slog.New(slog.NewJSONHandler(output, options))
}

func RequestLogger(logger *slog.Logger, skipPaths ...string) fiber.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	skipped := make(map[string]struct{}, len(skipPaths))
	for _, path := range skipPaths {
		if path != "" {
			skipped[path] = struct{}{}
		}
	}
	return func(c fiber.Ctx) error {
		path := c.Path()
		if _, skip := skipped[path]; skip {
			return c.Next()
		}
		startedAt := time.Now()
		err := c.Next()
		status := responseStatus(c, err)
		var level slog.Level
		switch {
		case status >= fiber.StatusInternalServerError:
			level = slog.LevelError
		case status >= fiber.StatusBadRequest:
			level = slog.LevelWarn
		default:
			level = slog.LevelInfo
		}
		logContext := requestContext(c)
		if !logger.Enabled(logContext, level) {
			return err
		}
		attributes := [...]slog.Attr{
			slog.String("request_id", requestid.FromContext(c)),
			slog.String("method", c.Method()),
			slog.String("path", path),
			slog.String("route", routePath(c)),
			slog.Int("status", status),
			slog.Float64("duration_ms", float64(time.Since(startedAt).Microseconds())/1000),
			slog.Int("response_bytes", responseBytes(c)),
			slog.String("client_ip", c.IP()),
			{},
			{},
			{},
			{},
		}
		attributeCount := 8
		if trace, ok := FromContext(c.Context()); ok {
			attributes[attributeCount] = slog.String("trace_id", trace.TraceID)
			attributeCount++
			attributes[attributeCount] = slog.String("span_id", trace.SpanID)
			attributeCount++
			if trace.ParentSpanID != "" {
				attributes[attributeCount] = slog.String("parent_span_id", trace.ParentSpanID)
				attributeCount++
			}
		}
		if err != nil {
			attributes[attributeCount] = slog.String("error", err.Error())
			attributeCount++
		}

		logger.LogAttrs(logContext, level, "http_request", attributes[:attributeCount]...)
		return err
	}
}

func responseBytes(c fiber.Ctx) int {
	if c.Response().IsBodyStream() {
		return c.Response().Header.ContentLength()
	}
	return len(c.Response().Body())
}

func requestContext(c fiber.Ctx) context.Context {
	if ctx := c.Context(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func parseLevel(value string) slog.Level {
	switch value {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
