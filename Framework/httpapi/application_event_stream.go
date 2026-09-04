package httpapi

import (
	"fmt"

	"github.com/gofiber/fiber/v3"
)

// ApplicationEventStream exposes a server-sent event source without leaking
// Fiber request or response types into application code. Streams use GET and
// static paths under /api/v1.
type ApplicationEventStream struct {
	Path string

	source                ServerSentEventSource
	options               ServerSentEventOptions
	authenticated         bool
	authorizationRequired bool
	requiredRoleIDs       []string
}

// NewEventStream creates a public transport-neutral server-sent event route.
func NewEventStream(
	routePath string,
	source ServerSentEventSource,
	options ServerSentEventOptions,
) ApplicationEventStream {
	return ApplicationEventStream{
		Path:    routePath,
		source:  source,
		options: options,
	}
}

// NewAuthenticatedEventStream is NewEventStream with a verified application
// principal kept inside the Framework boundary.
func NewAuthenticatedEventStream(
	routePath string,
	source ServerSentEventSource,
	options ServerSentEventOptions,
) ApplicationEventStream {
	stream := NewEventStream(routePath, source, options)
	stream.authenticated = true
	return stream
}

// NewAuthorizedEventStream is NewAuthenticatedEventStream with an any-of role
// gate. Role IDs are copied on construction and validated at startup.
func NewAuthorizedEventStream(
	routePath string,
	anyOfRoleIDs []string,
	source ServerSentEventSource,
	options ServerSentEventOptions,
) ApplicationEventStream {
	stream := NewAuthenticatedEventStream(routePath, source, options)
	stream.authorizationRequired = true
	stream.requiredRoleIDs = append([]string(nil), anyOfRoleIDs...)
	return stream
}

func registerApplicationEventStreams(
	router fiber.Router,
	streams []ApplicationEventStream,
	options Options,
) {
	for _, stream := range streams {
		stream := stream
		handler := func(c fiber.Ctx) error {
			if stream.authorizationRequired {
				principal, ok := applicationPrincipalFromContext(c)
				if !ok {
					return fiber.ErrUnauthorized
				}
				allowed, err := authorizeApplicationRoles(
					c,
					options,
					principal.RoleIDs,
					stream.requiredRoleIDs,
					"application_event_stream",
				)
				if err != nil || !allowed {
					return err
				}
			}
			return SendServerSentEventsFromSource(c, stream.source, stream.options)
		}
		if stream.authenticated {
			router.Get(stream.Path, requireAuth(options), handler)
			continue
		}
		router.Get(stream.Path, handler)
	}
}

func validateApplicationEventStreams(
	streams []ApplicationEventStream,
	queries []ApplicationQuery,
	authEnabled bool,
	oidcBrowserEnabled bool,
) {
	reservedPaths := defaultApplicationRoutePaths(fiber.MethodGet, authEnabled, oidcBrowserEnabled)
	for index, stream := range streams {
		segments, validPath := parseApplicationQueryRoutePath(stream.Path, false)
		if !validPath {
			panic(fmt.Sprintf("invalid application event stream at index %d: path must be canonical and static", index))
		}
		if stream.source == nil {
			panic(fmt.Sprintf("invalid application event stream %q: source is required", stream.Path))
		}
		if stream.options.Events != nil {
			panic(fmt.Sprintf("invalid application event stream %q: options must not include a channel", stream.Path))
		}
		if _, err := prepareServerSentEventOptions(stream.options); err != nil {
			panic(fmt.Sprintf("invalid application event stream %q: %v", stream.Path, err))
		}
		if stream.authenticated && !authEnabled {
			panic(fmt.Sprintf("invalid application event stream %q: authentication must be enabled", stream.Path))
		}
		if stream.authorizationRequired {
			if !stream.authenticated {
				panic(fmt.Sprintf("invalid application event stream %q: authorization requires authentication", stream.Path))
			}
			validateApplicationRoleRequirements("application event stream", stream.Path, stream.requiredRoleIDs)
		}
		for reservedPath := range reservedPaths {
			reservedSegments, _ := parseApplicationQueryRoutePath(reservedPath, false)
			if applicationQueryRoutesOverlap(segments, reservedSegments) {
				panic(fmt.Sprintf("application event stream path %q conflicts with a default route", stream.Path))
			}
		}
		for previousIndex := 0; previousIndex < index; previousIndex++ {
			previousSegments, _ := parseApplicationQueryRoutePath(streams[previousIndex].Path, false)
			if applicationQueryRoutesOverlap(segments, previousSegments) {
				panic(fmt.Sprintf("application event stream path %q overlaps %q", stream.Path, streams[previousIndex].Path))
			}
		}
		for _, query := range queries {
			queryMethod, _ := applicationQueryMethod(query.method)
			if queryMethod != fiber.MethodGet && queryMethod != fiber.MethodHead {
				continue
			}
			querySegments, _ := parseApplicationQueryRoutePath(query.Path, query.requestType != nil)
			if applicationQueryRoutesOverlap(segments, querySegments) {
				panic(fmt.Sprintf("application event stream path %q overlaps application query %q", stream.Path, query.Path))
			}
		}
	}
}
