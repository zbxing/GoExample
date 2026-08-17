package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/config"
	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/server"
	"github.com/zbxing/goexample/Framework/validation"
	"github.com/zbxing/goexample/Proj/Example/internal/projectapi"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Stdout); err != nil {
		slog.Error("server_stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, output io.Writer) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	logger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel, output)
	slog.SetDefault(logger)
	authService := auth.NewService(auth.Config{
		Enabled:  cfg.DemoAuthEnabled,
		Username: cfg.DemoUsername,
		Password: cfg.DemoPassword,
		Secret:   cfg.JWTSecret,
		Issuer:   cfg.JWTIssuer,
		TTL:      cfg.JWTTTL,
	})
	healthChecker := health.New(cfg.HealthCheckTimeout, cfg.HealthCacheTTL)

	apiOptions := httpapi.Options{
		Name:                cfg.Name,
		Environment:         cfg.Environment,
		Version:             version,
		Commit:              commit,
		BuildTime:           buildTime,
		LogSkipPaths:        cfg.LogSkipPaths,
		AllowedOrigins:      cfg.AllowedOrigins,
		AllowCredentials:    cfg.AllowCredentials,
		TrustedProxies:      cfg.TrustedProxies,
		BodyLimit:           cfg.BodyLimit,
		ReadTimeout:         cfg.ReadTimeout,
		WriteTimeout:        cfg.WriteTimeout,
		IdleTimeout:         cfg.IdleTimeout,
		RequestTimeout:      cfg.RequestTimeout,
		HealthCheckTimeout:  cfg.HealthCheckTimeout,
		HealthCacheTTL:      cfg.HealthCacheTTL,
		RateLimitMax:        cfg.RateLimitMax,
		RateLimitWindow:     cfg.RateLimitWindow,
		AuthRateLimitMax:    cfg.AuthRateLimitMax,
		IdempotencyEnabled:  cfg.IdempotencyEnabled,
		IdempotencyLifetime: cfg.IdempotencyLifetime,
		MetricsToken:        cfg.MetricsToken,
		PprofEnabled:        cfg.PprofEnabled,
		PprofToken:          cfg.PprofToken,
		SystemInfoDetailed:  cfg.SystemInfoDetailed,
		Auth:                authService,
		Health:              healthChecker,
		Metrics:             observability.NewMetrics(),
		Validator:           validation.New(),
		Logger:              logger,
	}
	apiOptions.Endpoints = projectapi.Endpoints(authService.Enabled())
	apiOptions.RegisterRoutes = func(v1 fiber.Router) {
		projectapi.Register(v1, apiOptions)
	}
	app := httpapi.New(apiOptions)

	return server.Run(ctx, server.Options{
		App:             app,
		Health:          healthChecker,
		Logger:          logger,
		Name:            cfg.Name,
		Version:         version,
		Environment:     cfg.Environment,
		Address:         cfg.Address(),
		ShutdownTimeout: cfg.ShutdownTimeout,
		DrainDelay:      cfg.ShutdownDrainDelay,
		Attributes:      []any{"demo_auth_enabled", cfg.DemoAuthEnabled},
	})
}
