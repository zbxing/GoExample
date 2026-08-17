package server

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/health"
)

func TestRunServesDrainsAndStops(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release port: %v", err)
	}

	checker := health.New(time.Second)
	app := fiber.New()
	app.Get("/livez", func(c fiber.Ctx) error {
		return c.SendStatus(fiber.StatusOK)
	})
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	ctx, cancel := context.WithCancel(context.Background())
	errors := make(chan error, 1)
	go func() {
		errors <- Run(ctx, Options{
			App:             app,
			Health:          checker,
			Logger:          logger,
			Name:            "test",
			Version:         "test",
			Environment:     "test",
			Address:         address,
			ShutdownTimeout: 2 * time.Second,
		})
	}()

	client := &http.Client{Timeout: 200 * time.Millisecond}
	deadline := time.Now().Add(3 * time.Second)
	for {
		response, requestErr := client.Get("http://" + address + "/livez")
		if requestErr == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("livez status = %d", response.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not become ready: %v", requestErr)
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	select {
	case err := <-errors:
		if err != nil {
			t.Fatalf("Run() error = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not stop")
	}
	if checker.Readiness(context.Background()).Ready {
		t.Fatal("health checker is ready after draining")
	}
	if logs := output.String(); !strings.Contains(logs, "server_started") || !strings.Contains(logs, "server_stopped") {
		t.Fatalf("lifecycle logs = %s", logs)
	}
}

func TestRunValidatesOptions(t *testing.T) {
	tests := []struct {
		name    string
		options Options
	}{
		{name: "missing app", options: Options{Address: "127.0.0.1:0"}},
		{name: "missing address", options: Options{App: fiber.New()}},
		{name: "negative drain", options: Options{App: fiber.New(), Address: "127.0.0.1:0", DrainDelay: -time.Second}},
		{name: "drain exceeds shutdown", options: Options{App: fiber.New(), Address: "127.0.0.1:0", DrainDelay: time.Second, ShutdownTimeout: time.Second}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := Run(context.Background(), test.options); err == nil {
				t.Fatal("Run() error = nil")
			}
		})
	}
}

func TestRunReturnsListenErrorBeforeStartedLog(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy address: %v", err)
	}
	defer listener.Close()

	var output bytes.Buffer
	err = Run(context.Background(), Options{
		App:     fiber.New(),
		Address: listener.Addr().String(),
		Logger:  slog.New(slog.NewJSONHandler(&output, nil)),
	})
	if err == nil || !strings.Contains(err.Error(), "listen:") {
		t.Fatalf("Run() error = %v", err)
	}
	if strings.Contains(output.String(), "server_started") {
		t.Fatalf("unexpected startup log = %s", output.String())
	}
}
