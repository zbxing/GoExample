package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gofiber/fiber/v3"
)

const (
	maximumApplicationRouteResponseBodyBytes = 1 << 20
	maximumApplicationRouteHeaders           = 64
	maximumApplicationRouteHeaderValues      = 16
	maximumApplicationRouteHeaderValueBytes  = 8192
)

// ApplicationRouteRequest is a transport-neutral snapshot of one custom
// application route request. The maps and body are defensive copies.
type ApplicationRouteRequest struct {
	Method  string
	Path    string
	Query   url.Values
	Params  map[string]string
	Headers http.Header
	Body    []byte
}

// ApplicationRouteResponse is the bounded wire response for a custom route.
// A zero StatusCode means 200. The body is capped at one megabyte.
type ApplicationRouteResponse struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

// ApplicationRouteHandler handles a transport-neutral custom route.
type ApplicationRouteHandler func(context.Context, ApplicationRouteRequest) (ApplicationRouteResponse, error)

// ApplicationRoute describes one static /api/v1 route. Exactly one of Handler
// and Stream must be configured. Stream reuses the existing bounded SSE source
// and request lifetime implementation.
type ApplicationRoute struct {
	Method        string
	Path          string
	Handler       ApplicationRouteHandler
	Stream        ServerSentEventSource
	StreamOptions ServerSentEventOptions
}

func registerApplicationRoutes(router fiber.Router, routes []ApplicationRoute) {
	for _, route := range routes {
		route := route
		route.Method, _ = applicationRouteMethod(route.Method)
		handler := func(c fiber.Ctx) error {
			if route.Stream != nil {
				return SendServerSentEventsFromSource(c, route.Stream, route.StreamOptions)
			}
			response, err := route.Handler(c.Context(), applicationRouteRequest(c))
			if err != nil {
				return err
			}
			if err := validateApplicationRouteResponse(response); err != nil {
				return err
			}
			for name, values := range response.Headers {
				for _, value := range values {
					c.Append(name, value)
				}
			}
			status := response.StatusCode
			if status == 0 {
				status = fiber.StatusOK
			}
			return c.Status(status).Send(response.Body)
		}
		router.Add([]string{route.Method}, route.Path, handler)
	}
}

func applicationRouteRequest(c fiber.Ctx) ApplicationRouteRequest {
	query := make(url.Values)
	c.RequestCtx().QueryArgs().VisitAll(func(key, value []byte) {
		query.Add(string(key), string(value))
	})
	headers := make(http.Header)
	c.Request().Header.VisitAll(func(key, value []byte) {
		headers.Add(string(key), string(value))
	})
	return ApplicationRouteRequest{
		Method:  c.Method(),
		Path:    c.Path(),
		Query:   query,
		Params:  make(map[string]string),
		Headers: headers,
		Body:    append([]byte(nil), c.Body()...),
	}
}

func validateApplicationRoutes(routes []ApplicationRoute, queries []ApplicationQuery, commands []ApplicationCommand, streams []ApplicationEventStream, authEnabled, oidcBrowserEnabled bool) {
	seen := make(map[string]struct{}, len(routes))
	for index, route := range routes {
		method, validMethod := applicationRouteMethod(route.Method)
		if !validMethod {
			panic(fmt.Sprintf("invalid application route at index %d: method must be a standard HTTP method", index))
		}
		if !validApplicationRoutePath(route.Path) {
			panic(fmt.Sprintf("invalid application route at index %d: path must be a canonical static path", index))
		}
		if (route.Handler == nil) == (route.Stream == nil) {
			panic(fmt.Sprintf("invalid application route %q: exactly one handler or stream is required", route.Path))
		}
		if route.Stream != nil {
			if method != http.MethodGet {
				panic(fmt.Sprintf("invalid application route %q: stream method must be GET", route.Path))
			}
			if route.StreamOptions.Events != nil {
				panic(fmt.Sprintf("invalid application route %q: stream options must not include a channel", route.Path))
			}
			if _, err := prepareServerSentEventOptions(route.StreamOptions); err != nil {
				panic(fmt.Sprintf("invalid application route %q: %v", route.Path, err))
			}
		}
		key := method + " " + strings.ToLower(route.Path)
		if _, exists := seen[key]; exists {
			panic(fmt.Sprintf("duplicate application route %q", route.Path))
		}
		seen[key] = struct{}{}
		reserved := defaultApplicationRoutePaths(method, authEnabled, oidcBrowserEnabled)
		if _, exists := reserved[strings.ToLower(route.Path)]; exists {
			panic(fmt.Sprintf("application route path %q conflicts with a default route", route.Path))
		}
		for _, query := range queries {
			queryMethod, _ := applicationQueryMethod(query.method)
			if !applicationRouteMethodsOverlap(method, queryMethod) {
				continue
			}
			querySegments, _ := parseApplicationQueryRoutePath(query.Path, query.requestType != nil)
			staticSegments, _ := parseApplicationQueryRoutePath(route.Path, false)
			if applicationQueryRoutesOverlap(staticSegments, querySegments) {
				panic(fmt.Sprintf("application route path %q overlaps application query %q", route.Path, query.Path))
			}
		}
		for _, command := range commands {
			commandMethod, _ := applicationCommandMethod(command.method)
			if commandMethod == method && strings.EqualFold(command.Path, route.Path) {
				panic(fmt.Sprintf("application route path %q overlaps application command %q", route.Path, command.Path))
			}
		}
		for _, stream := range streams {
			if applicationRouteMethodsOverlap(method, fiber.MethodGet) && strings.EqualFold(stream.Path, route.Path) {
				panic(fmt.Sprintf("application route path %q overlaps application event stream %q", route.Path, stream.Path))
			}
		}
	}
}

func applicationRouteMethodsOverlap(left, right string) bool {
	if left == right {
		return true
	}
	return (left == http.MethodGet || left == http.MethodHead) &&
		(right == http.MethodGet || right == http.MethodHead)
}

func applicationRouteMethod(method string) (string, bool) {
	if method == "" {
		return http.MethodGet, true
	}
	if method != strings.TrimSpace(method) {
		return "", false
	}
	normalized := strings.ToUpper(method)
	switch normalized {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodTrace,
		http.MethodConnect:
		return normalized, true
	default:
		return "", false
	}
}

func validateApplicationRouteResponse(response ApplicationRouteResponse) error {
	status := response.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	if status < 100 || status > 599 {
		return errors.New("application route response status must be between 100 and 599")
	}
	if len(response.Body) > maximumApplicationRouteResponseBodyBytes {
		return errors.New("application route response body exceeds 1048576 bytes")
	}
	if (status >= 100 && status < 200) || status == http.StatusNoContent || status == http.StatusNotModified {
		if len(response.Body) != 0 {
			return errors.New("application route response body is not allowed for this status")
		}
	}
	if len(response.Headers) > maximumApplicationRouteHeaders {
		return errors.New("application route response contains too many headers")
	}
	for name, values := range response.Headers {
		if !validApplicationRouteHeaderName(name) || len(values) > maximumApplicationRouteHeaderValues {
			return errors.New("application route response contains an invalid header")
		}
		for _, value := range values {
			if len(value) > maximumApplicationRouteHeaderValueBytes || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\x00") {
				return errors.New("application route response contains an invalid header")
			}
			for _, current := range value {
				if unicode.IsControl(current) && current != '\t' {
					return errors.New("application route response contains an invalid header")
				}
			}
		}
	}
	return nil
}

func validApplicationRouteHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for _, current := range name {
		if current <= 0x20 || current >= 0x7f || strings.ContainsRune("()<>@,;:\\\"/[]?={} \t", current) {
			return false
		}
	}
	return true
}
