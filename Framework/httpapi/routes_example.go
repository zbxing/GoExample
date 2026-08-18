package httpapi

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
)

type profileRequest struct {
	Name  string `json:"name" validate:"required,min=2,max=80"`
	Email string `json:"email" validate:"required,email,max=254"`
	Age   int    `json:"age" validate:"min=18,max=130"`
}

func registerExampleRoutes(v1 fiber.Router, options Options) {
	example := v1.Group("/example")
	registerMutation := func(path string, handler fiber.Handler) {
		if options.IdempotencyEnabled {
			example.Post(path, requireJSON, idempotencyMiddleware(path, options.IdempotencyLifetime, options.SharedStorage, options.IdempotencyLock), handler)
			return
		}
		example.Post(path, requireJSON, handler)
	}
	example.Get("/hello", func(c fiber.Ctx) error {
		name := strings.TrimSpace(c.Query("name", "Fiber"))
		if name == "" {
			name = "Fiber"
		}
		return success(c, fiber.Map{"message": "Hello, " + name + "!"})
	})
	registerMutation("/echo", func(c fiber.Ctx) error {
		body := make(map[string]any)
		if err := c.Bind().Body(&body); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "request body must be valid JSON")
		}
		return success(c, body)
	})
	registerMutation("/validate", func(c fiber.Ctx) error {
		var request profileRequest
		if err := bindBody(c, &request); err != nil {
			return err
		}
		return success(c, request)
	})
	example.Get("/delay", func(c fiber.Ctx) error {
		milliseconds, err := strconv.Atoi(c.Query("ms", "0"))
		if err != nil || milliseconds < 0 || milliseconds > 5000 {
			return fiber.NewError(fiber.StatusBadRequest, "ms must be an integer between 0 and 5000")
		}
		timer := time.NewTimer(time.Duration(milliseconds) * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
			return success(c, fiber.Map{"delayedMs": milliseconds})
		case <-c.Context().Done():
			return context.DeadlineExceeded
		}
	})
	if options.Auth.Enabled() {
		example.Get("/private", requireAuth(options.Auth), func(c fiber.Ctx) error {
			claims, _ := currentClaims(c)
			return success(c, fiber.Map{
				"message": "authenticated request succeeded",
				"subject": claims.Subject,
			})
		})
	}
}
