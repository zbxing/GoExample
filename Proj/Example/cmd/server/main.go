package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

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

func run(ctx context.Context, output io.Writer) (runErr error) {
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
		Audience: cfg.JWTAudience,
		TTL:      cfg.JWTTTL,
	})
	healthChecker := health.New(cfg.HealthCheckTimeout, cfg.HealthCacheTTL)
	tracerProvider, err := observability.NewTracerProvider(ctx, observability.TracingConfig{
		ServiceName:        cfg.Name,
		ServiceVersion:     version,
		Environment:        cfg.Environment,
		Exporter:           cfg.TraceExporter,
		Endpoint:           cfg.OTLPEndpoint,
		SampleRatio:        cfg.TraceSampleRatio,
		ExportTimeout:      cfg.TraceExportTimeout,
		BatchTimeout:       cfg.TraceBatchTimeout,
		MaxQueueSize:       cfg.TraceMaxQueueSize,
		MaxExportBatchSize: cfg.TraceMaxExportBatchSize,
	})
	if err != nil {
		return fmt.Errorf("initialize tracing: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.TraceExportTimeout)
		defer cancel()
		if err := tracerProvider.Shutdown(shutdownCtx); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown tracing: %w", err))
		}
	}()

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
		ReadBufferSize:      cfg.ReadBufferSize,
		ReadTimeout:         cfg.ReadTimeout,
		WriteTimeout:        cfg.WriteTimeout,
		IdleTimeout:         cfg.IdleTimeout,
		MaxConnections:      cfg.MaxConnections,
		RequestTimeout:      cfg.RequestTimeout,
		MaxInFlight:         cfg.MaxInFlight,
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
		TracerProvider:      tracerProvider,
		Validator:           validation.New(),
		Logger:              logger,
	}
	apiOptions.Endpoints = projectapi.Endpoints(authService.Enabled())
	apiOptions.ApplicationQueries = projectapi.Queries(apiOptions)
	if err := httpapi.ValidateSharedState(
		cfg.Environment,
		cfg.SharedStateMode,
		cfg.AllowInMemorySharedState,
		cfg.IdempotencyEnabled,
		apiOptions.SharedStorage,
		apiOptions.IdempotencyLock,
	); err != nil {
		return fmt.Errorf("validate shared state: %w", err)
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
		Attributes:      []any{"demo_auth_enabled", cfg.DemoAuthEnabled, "trace_exporter", cfg.TraceExporter},
	})
}
