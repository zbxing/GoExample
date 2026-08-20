package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
)

type Envelope struct {
	Code int    `json:"code"`
	Data any    `json:"data"`
	Msg  string `json:"msg"`
}

func success(c fiber.Ctx, data any) error {
	return c.JSON(Envelope{Code: 0, Data: data, Msg: "success"})
}

func Success(c fiber.Ctx, data any) error {
	return success(c, data)
}

func setNoStoreHeaders(c fiber.Ctx) {
	c.Set(fiber.HeaderCacheControl, "no-store, no-transform")
	c.Set(fiber.HeaderPragma, "no-cache")
}

func hasCacheControlDirective(value, directive string) bool {
	for part := range strings.SplitSeq(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), directive) {
			return true
		}
	}
	return false
}

func failure(c fiber.Ctx, status int, message string) error {
	setNoStoreHeaders(c)
	return c.Status(status).JSON(Envelope{Code: status, Data: nil, Msg: message})
}

func Failure(c fiber.Ctx, status int, message string) error {
	return failure(c, status, message)
}

func errorHandler(c fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	message := "internal server error"

	if errors.Is(err, context.DeadlineExceeded) {
		status = fiber.StatusRequestTimeout
		message = "request timed out"
	}
	if errors.Is(err, idempotency.ErrInvalidIdempotencyKey) {
		status = fiber.StatusBadRequest
		message = "X-Idempotency-Key must contain 36 characters"
	}
	if errors.Is(err, errIdempotencyFingerprintConflict) {
		status = fiber.StatusConflict
		message = "X-Idempotency-Key is already bound to a different request"
	}
	var fiberError *fiber.Error
	if errors.As(err, &fiberError) {
		status = fiberError.Code
		message = fiberError.Message
	}

	return failure(c, status, message)
}
