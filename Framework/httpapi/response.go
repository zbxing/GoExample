package httpapi

import (
	"context"
	"errors"

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

func failure(c fiber.Ctx, status int, message string) error {
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
	var fiberError *fiber.Error
	if errors.As(err, &fiberError) {
		status = fiberError.Code
		message = fiberError.Message
	}

	return failure(c, status, message)
}
