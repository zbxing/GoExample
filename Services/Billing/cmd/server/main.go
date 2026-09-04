package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/zbxing/goexample/Framework/config"
	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/server"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapi"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapp"
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
		slog.Error("billing_server_stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, output io.Writer) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	logger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel, output)
	slog.SetDefault(logger)
	checker := health.New(cfg.HealthCheckTimeout, cfg.HealthCacheTTL)
	metrics := observability.NewMetrics()
	service := billingapp.NewService("GoExample Billing", cfg.Environment, version, nil)
	options := httpapi.Options{
		Name:               "GoExample Billing",
		Environment:        cfg.Environment,
		Version:            version,
		Commit:             commit,
		BuildTime:          buildTime,
		Health:             checker,
		Metrics:            metrics,
		Logger:             logger,
		ApplicationQueries: billingapi.Queries(service),
		Endpoints:          append(httpapi.DefaultEndpoints(false), "GET /api/v1/billing/summary"),
	}
	application, err := httpapi.NewHTTPApplication(options)
	if err != nil {
		return fmt.Errorf("initialize standard HTTP application: %w", err)
	}
	return server.RunHTTP(ctx, server.HTTPOptions{
		Handler:             application,
		ApplicationShutdown: application.Shutdown,
		ConnectionObserver:  metrics,
		Health:              checker,
		Logger:              logger,
		Name:                cfg.Name,
		Version:             version,
		Environment:         cfg.Environment,
		Address:             cfg.Address(),
		ShutdownTimeout:     cfg.ShutdownTimeout,
		DrainDelay:          cfg.ShutdownDrainDelay,
		ReadHeaderTimeout:   cfg.ReadTimeout,
		ReadTimeout:         cfg.ReadTimeout,
		WriteTimeout:        cfg.WriteTimeout,
		IdleTimeout:         cfg.IdleTimeout,
		MaxHeaderBytes:      cfg.ReadBufferSize,
		MaxConnections:      cfg.MaxConnections,
	})
}
