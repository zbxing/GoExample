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
		if _, skip := skipped[c.Path()]; skip {
			return c.Next()
		}
		startedAt := time.Now()
		err := c.Next()
		status := responseStatus(c, err)
		attributes := []any{
			"request_id", requestid.FromContext(c),
			"method", c.Method(),
			"path", c.Path(),
			"route", routePath(c),
			"status", status,
			"duration_ms", float64(time.Since(startedAt).Microseconds()) / 1000,
			"response_bytes", len(c.Response().Body()),
			"client_ip", c.IP(),
		}
		if err != nil {
			attributes = append(attributes, "error", err.Error())
		}

		switch {
		case status >= fiber.StatusInternalServerError:
			logger.ErrorContext(context.Background(), "http_request", attributes...)
		case status >= fiber.StatusBadRequest:
			logger.WarnContext(context.Background(), "http_request", attributes...)
		default:
			logger.InfoContext(context.Background(), "http_request", attributes...)
		}
		return err
	}
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
