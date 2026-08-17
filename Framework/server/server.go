package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/health"
)

const defaultShutdownTimeout = 20 * time.Second

type Options struct {
	App             *fiber.App
	Health          *health.Checker
	Logger          *slog.Logger
	Name            string
	Version         string
	Environment     string
	Address         string
	ShutdownTimeout time.Duration
	DrainDelay      time.Duration
	Attributes      []any
}

func Run(ctx context.Context, options Options) error {
	if options.App == nil {
		return errors.New("server app is required")
	}
	if strings.TrimSpace(options.Address) == "" {
		return errors.New("server address is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.ShutdownTimeout <= 0 {
		options.ShutdownTimeout = defaultShutdownTimeout
	}
	if options.DrainDelay < 0 || options.DrainDelay >= options.ShutdownTimeout {
		return errors.New("server drain delay must be non-negative and less than shutdown timeout")
	}

	listener, err := net.Listen("tcp", options.Address)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- options.App.Listener(
			listener,
			fiber.ListenConfig{DisableStartupMessage: true},
		)
	}()

	attributes := []any{
		"name", options.Name,
		"version", options.Version,
		"environment", options.Environment,
		"address", listener.Addr().String(),
	}
	attributes = append(attributes, options.Attributes...)
	options.Logger.Info("server_started", attributes...)

	select {
	case err := <-serverErr:
		if err != nil && !errors.Is(err, net.ErrClosed) {
			return fmt.Errorf("listen: %w", err)
		}
		return nil
	case <-ctx.Done():
		if options.Health != nil {
			options.Health.SetDraining(true)
		}
		options.Logger.Info("shutdown_signal_received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), options.ShutdownTimeout)
	defer cancel()
	if options.DrainDelay > 0 {
		options.Logger.Info("shutdown_draining", "delay", options.DrainDelay)
		timer := time.NewTimer(options.DrainDelay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-shutdownCtx.Done():
		}
	}
	if err := options.App.ShutdownWithContext(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serverErr; err != nil && !errors.Is(err, net.ErrClosed) {
		return fmt.Errorf("listen after shutdown: %w", err)
	}

	options.Logger.Info("server_stopped")
	return nil
}
