package httpapi

import (
	"mime"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/validation"
)

func requireJSON(c fiber.Ctx) error {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(c.Get(fiber.HeaderContentType)))
	if err != nil || (mediaType != fiber.MIMEApplicationJSON && !(strings.HasPrefix(mediaType, "application/") && strings.HasSuffix(mediaType, "+json"))) {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}
	return c.Next()
}

func bindBody(c fiber.Ctx, destination any) error {
	if err := c.Bind().Body(destination); err != nil {
		message := validation.Message(err)
		if message == "request validation failed" {
			message = "request body is invalid"
		}
		return fiber.NewError(fiber.StatusBadRequest, message)
	}
	return nil
}
