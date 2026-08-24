package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
)

const maxApplicationEntityTagLength = 128

var (
	errApplicationPreconditionRequired     = errors.New("application precondition is required")
	errInvalidApplicationPrecondition      = errors.New("application precondition is invalid")
	errInvalidApplicationResponseEntityTag = errors.New("application response entity tag is invalid")
)

// ErrPreconditionFailed maps an application or persistence version conflict
// to a fixed HTTP 412 response at the Framework boundary.
var ErrPreconditionFailed = errors.New("application precondition failed")

// ApplicationPrecondition is the validated, transport-neutral version token
// extracted from one strong If-Match entity tag. EntityTag is unquoted.
type ApplicationPrecondition struct {
	EntityTag string
}

type applicationPreconditionContextKey struct{}

func requireApplicationPrecondition(c fiber.Ctx) error {
	precondition, err := parseApplicationPrecondition(c.Get(fiber.HeaderIfMatch))
	if err != nil {
		switch {
		case errors.Is(err, errApplicationPreconditionRequired):
			return failure(c, fiber.StatusPreconditionRequired, "If-Match header is required")
		default:
			return failure(c, fiber.StatusBadRequest, "If-Match must contain one strong version tag")
		}
	}
	ctx := c.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	c.SetContext(context.WithValue(ctx, applicationPreconditionContextKey{}, precondition))
	return c.Next()
}

func applicationPreconditionFromContext(ctx context.Context) (ApplicationPrecondition, bool) {
	if ctx == nil {
		return ApplicationPrecondition{}, false
	}
	precondition, ok := ctx.Value(applicationPreconditionContextKey{}).(ApplicationPrecondition)
	return precondition, ok
}

func parseApplicationPrecondition(value string) (ApplicationPrecondition, error) {
	if value == "" {
		return ApplicationPrecondition{}, errApplicationPreconditionRequired
	}
	if value != strings.TrimSpace(value) || len(value) < 3 || value[0] != '"' || value[len(value)-1] != '"' {
		return ApplicationPrecondition{}, errInvalidApplicationPrecondition
	}
	entityTag := value[1 : len(value)-1]
	if !validApplicationEntityTag(entityTag) {
		return ApplicationPrecondition{}, errInvalidApplicationPrecondition
	}
	return ApplicationPrecondition{EntityTag: entityTag}, nil
}

func validApplicationEntityTag(value string) bool {
	if len(value) == 0 || len(value) > maxApplicationEntityTagLength {
		return false
	}
	for index := 0; index < len(value); index++ {
		current := value[index]
		if current >= 'a' && current <= 'z' || current >= 'A' && current <= 'Z' || current >= '0' && current <= '9' ||
			index > 0 && (current == '-' || current == '_' || current == '.' || current == ':') {
			continue
		}
		return false
	}
	return true
}

func quoteApplicationEntityTag(value string) string {
	return `"` + value + `"`
}
