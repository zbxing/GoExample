package httpapi

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v3"
)

// ApplicationQuery exposes a bodyless GET use case without leaking Fiber
// request or response types into project code.
type ApplicationQuery struct {
	Path    string
	Handler func(context.Context) (any, error)
}

func registerApplicationQueries(router fiber.Router, queries []ApplicationQuery) {
	paths := make(map[string]struct{}, len(queries))
	for index, query := range queries {
		if query.Path == "" || query.Path != strings.TrimSpace(query.Path) || !strings.HasPrefix(query.Path, "/") ||
			strings.ContainsAny(query.Path, "?#") || strings.IndexFunc(query.Path, unicode.IsSpace) >= 0 {
			panic(fmt.Sprintf("invalid application query at index %d: path must start with / and must not contain whitespace, query, or fragment", index))
		}
		if query.Handler == nil {
			panic(fmt.Sprintf("invalid application query %q: handler is required", query.Path))
		}
		if _, exists := paths[query.Path]; exists {
			panic(fmt.Sprintf("duplicate application query path %q", query.Path))
		}
		paths[query.Path] = struct{}{}

		handler := query.Handler
		router.Get(query.Path, func(c fiber.Ctx) error {
			data, err := handler(c.Context())
			if err != nil {
				return err
			}
			return success(c, data)
		})
	}
}
