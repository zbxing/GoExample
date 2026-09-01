package httpapi

import (
	"bytes"
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

type helloResponse struct {
	Message string `json:"message"`
}

const (
	defaultHelloMessage  = "Hello, Fiber!"
	defaultHelloEnvelope = `{"code":0,"data":{"message":"` + defaultHelloMessage + `"},"msg":"success"}`
)

type delayedResponse struct {
	DelayedMilliseconds int `json:"delayedMs"`
}

type privateResponse struct {
	Message string `json:"message"`
	Subject string `json:"subject"`
}

func helloMessage(name []byte) string {
	var message strings.Builder
	message.Grow(len("Hello, ") + len(name) + 1)
	message.WriteString("Hello, ")
	message.Write(name)
	message.WriteByte('!')
	return message.String()
}

func sendHello(c fiber.Ctx, rawName []byte) error {
	name := bytes.TrimSpace(rawName)
	if len(name) == 0 || bytes.Equal(name, []byte("Fiber")) {
		response := c.Response()
		response.Header.SetContentType(fiber.MIMEApplicationJSONCharsetUTF8)
		response.SetBodyString(defaultHelloEnvelope)
		return nil
	}
	return success(c, helloResponse{Message: helloMessage(name)})
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
		return sendHello(c, c.RequestCtx().QueryArgs().Peek("name"))
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
			return success(c, delayedResponse{DelayedMilliseconds: milliseconds})
		case <-c.Context().Done():
			return context.DeadlineExceeded
		}
	})
	if AuthenticationEnabled(options) {
		example.Get("/private", requireAuth(options), func(c fiber.Ctx) error {
			claims, _ := currentClaims(c)
			return success(c, privateResponse{
				Message: "authenticated request succeeded",
				Subject: claims.Subject,
			})
		})
	}
}
