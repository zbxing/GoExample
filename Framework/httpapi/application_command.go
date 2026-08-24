package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/authorization"
)

// ApplicationCommand exposes a typed JSON POST use case without leaking
// Fiber request or response types into project code.
type ApplicationCommand struct {
	Path                          string
	newRequest                    func() any
	handle                        func(context.Context, any, ApplicationPrincipal, ApplicationPrecondition) (applicationCommandResult, error)
	authenticated                 bool
	authorizationRequired         bool
	requiredRoleIDs               []string
	resourceAuthorizationRequired bool
	resourceAuthorizer            authorization.Authorizer
	resolveResource               func(any, ApplicationPrincipal) authorization.Resource
	versioned                     bool
	method                        string
}

type applicationCommandRequestContextKey struct{}

type applicationCommandResult struct {
	data      any
	entityTag string
}

// NewJSONCommand adapts a typed application handler to the Framework HTTP
// boundary. Request binding and validation remain inside the Fiber adapter.
func NewJSONCommand[Request, Response any](
	path string,
	handler func(context.Context, Request) (Response, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	if handler != nil {
		command.handle = func(ctx context.Context, request any, _ ApplicationPrincipal, _ ApplicationPrecondition) (applicationCommandResult, error) {
			response, err := handler(ctx, *request.(*Request))
			return applicationCommandResult{data: response}, err
		}
	}
	return command
}

// NewAuthenticatedJSONCommand is NewJSONCommand with a verified, minimized
// application principal. Registration fails when authentication is disabled.
func NewAuthenticatedJSONCommand[Request, Response any](
	path string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	command.authenticated = true
	if handler != nil {
		command.handle = func(ctx context.Context, request any, principal ApplicationPrincipal, _ ApplicationPrecondition) (applicationCommandResult, error) {
			response, err := handler(ctx, *request.(*Request), principal)
			return applicationCommandResult{data: response}, err
		}
	}
	return command
}

// NewAuthorizedJSONCommand is NewAuthenticatedJSONCommand with an any-of role
// gate. Role IDs are matched exactly, copied on construction, and validated at
// startup.
func NewAuthorizedJSONCommand[Request, Response any](
	path string,
	anyOfRoleIDs []string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	command.authenticated = true
	command.authorizationRequired = true
	command.requiredRoleIDs = append([]string(nil), anyOfRoleIDs...)
	if handler != nil {
		command.handle = func(ctx context.Context, request any, principal ApplicationPrincipal, _ ApplicationPrecondition) (applicationCommandResult, error) {
			response, err := handler(ctx, *request.(*Request), principal)
			return applicationCommandResult{data: response}, err
		}
	}
	return command
}

// NewResourceAuthorizedJSONCommand adds a bounded tenant/resource policy after
// authentication, role checks, media-type validation, and body binding. The
// policy runs before idempotency state and the application handler.
func NewResourceAuthorizedJSONCommand[Request, Response any](
	path string,
	anyOfRoleIDs []string,
	authorizer authorization.Authorizer,
	resource func(Request, ApplicationPrincipal) authorization.Resource,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationCommand {
	command := NewAuthorizedJSONCommand(path, anyOfRoleIDs, handler)
	command.resourceAuthorizationRequired = true
	command.resourceAuthorizer = authorizer
	if resource != nil {
		command.resolveResource = func(request any, principal ApplicationPrincipal) authorization.Resource {
			return resource(*request.(*Request), principal)
		}
	}
	return command
}

// NewVersionedJSONCommand adapts an optimistic JSON mutation that requires one
// strong If-Match entity tag and returns the new unquoted entity tag after a
// successful update.
func NewVersionedJSONCommand[Request, Response any](
	path string,
	handler func(context.Context, Request, ApplicationPrecondition) (Response, string, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	command.versioned = true
	if handler != nil {
		command.handle = func(ctx context.Context, request any, _ ApplicationPrincipal, precondition ApplicationPrecondition) (applicationCommandResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request), precondition)
			return applicationCommandResult{data: response, entityTag: entityTag}, err
		}
	}
	return command
}

// NewAuthenticatedVersionedJSONCommand is NewVersionedJSONCommand with a
// verified, minimized application principal.
func NewAuthenticatedVersionedJSONCommand[Request, Response any](
	path string,
	handler func(context.Context, Request, ApplicationPrincipal, ApplicationPrecondition) (Response, string, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	command.authenticated = true
	command.versioned = true
	if handler != nil {
		command.handle = func(ctx context.Context, request any, principal ApplicationPrincipal, precondition ApplicationPrecondition) (applicationCommandResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request), principal, precondition)
			return applicationCommandResult{data: response, entityTag: entityTag}, err
		}
	}
	return command
}

// NewAuthorizedVersionedJSONCommand adds an any-of role gate to
// NewAuthenticatedVersionedJSONCommand.
func NewAuthorizedVersionedJSONCommand[Request, Response any](
	path string,
	anyOfRoleIDs []string,
	handler func(context.Context, Request, ApplicationPrincipal, ApplicationPrecondition) (Response, string, error),
) ApplicationCommand {
	command := newApplicationCommand[Request](path)
	command.authenticated = true
	command.authorizationRequired = true
	command.requiredRoleIDs = append([]string(nil), anyOfRoleIDs...)
	command.versioned = true
	if handler != nil {
		command.handle = func(ctx context.Context, request any, principal ApplicationPrincipal, precondition ApplicationPrecondition) (applicationCommandResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request), principal, precondition)
			return applicationCommandResult{data: response, entityTag: entityTag}, err
		}
	}
	return command
}

// NewResourceAuthorizedVersionedJSONCommand is
// NewAuthorizedVersionedJSONCommand with the same bounded tenant/resource
// policy used by NewResourceAuthorizedJSONCommand.
func NewResourceAuthorizedVersionedJSONCommand[Request, Response any](
	path string,
	anyOfRoleIDs []string,
	authorizer authorization.Authorizer,
	resource func(Request, ApplicationPrincipal) authorization.Resource,
	handler func(context.Context, Request, ApplicationPrincipal, ApplicationPrecondition) (Response, string, error),
) ApplicationCommand {
	command := NewAuthorizedVersionedJSONCommand(path, anyOfRoleIDs, handler)
	command.resourceAuthorizationRequired = true
	command.resourceAuthorizer = authorizer
	if resource != nil {
		command.resolveResource = func(request any, principal ApplicationPrincipal) authorization.Resource {
			return resource(*request.(*Request), principal)
		}
	}
	return command
}

// WithMethod changes the HTTP method used by a typed JSON command. Commands
// default to POST; PUT, PATCH, and DELETE are also supported and remain
// subject to the same media type, authorization, idempotency, and validation
// boundary.
func (command ApplicationCommand) WithMethod(method string) ApplicationCommand {
	command.method = method
	return command
}

func newApplicationCommand[Request any](path string) ApplicationCommand {
	return ApplicationCommand{
		Path:       path,
		method:     http.MethodPost,
		newRequest: func() any { return new(Request) },
	}
}

func registerApplicationCommands(router fiber.Router, commands []ApplicationCommand, options Options) {
	for _, command := range commands {
		command := command
		method, validMethod := applicationCommandMethod(command.method)
		if !validMethod {
			panic(fmt.Sprintf("invalid application command %q: method must be POST, PUT, PATCH, or DELETE", command.Path))
		}
		command.method = method
		handlers := make([]any, 0, 8)
		if command.authenticated {
			handlers = append(handlers, requireAuth(options))
		}
		if command.authorizationRequired {
			handlers = append(handlers, func(c fiber.Ctx) error {
				principal, ok := applicationPrincipalFromContext(c)
				if !ok {
					return fiber.ErrUnauthorized
				}
				allowed, err := authorizeApplicationRoles(c, options, principal.RoleIDs, command.requiredRoleIDs, "application_command")
				if err != nil || !allowed {
					return err
				}
				return c.Next()
			})
		}
		if command.resourceAuthorizationRequired {
			handlers = append(handlers, requireJSON)
			handlers = append(handlers, func(c fiber.Ctx) error {
				principal, ok := applicationPrincipalFromContext(c)
				if !ok {
					return fiber.ErrUnauthorized
				}
				request := command.newRequest()
				if err := bindBody(c, request); err != nil {
					return err
				}
				resource, resolved := resolveApplicationResource(command.resolveResource, request, principal)
				if !resolved {
					recordSecurityAudit(c, options, securityEventAuthorization, securityOutcomeFailure, "resource_denied", "application_command", "")
					return failure(c, fiber.StatusForbidden, "access is forbidden")
				}
				allowed, err := authorizeApplicationResource(c, options, principal, command.resourceAuthorizer, resource, "application_command")
				if err != nil || !allowed {
					return err
				}
				c.Locals(applicationCommandRequestContextKey{}, request)
				return c.Next()
			})
		}
		if command.versioned {
			handlers = append(handlers, requireApplicationPrecondition)
		}
		if !command.resourceAuthorizationRequired {
			handlers = append(handlers, requireJSON)
		}
		if options.IdempotencyEnabled {
			fingerprintHeaders := []string(nil)
			if command.versioned {
				fingerprintHeaders = []string{fiber.HeaderIfMatch}
			}
			handlers = append(handlers, idempotencyMiddleware(
				command.Path,
				options.IdempotencyLifetime,
				options.SharedStorage,
				options.IdempotencyLock,
				fingerprintHeaders...,
			))
		}
		handlers = append(handlers, func(c fiber.Ctx) error {
			principal := ApplicationPrincipal{}
			if command.authenticated {
				var ok bool
				principal, ok = applicationPrincipalFromContext(c)
				if !ok {
					return fiber.ErrUnauthorized
				}
			}
			request := any(nil)
			if command.resourceAuthorizationRequired {
				request = c.Locals(applicationCommandRequestContextKey{})
				if request == nil {
					return errApplicationAuthorizationFailure
				}
			} else {
				request = command.newRequest()
				if err := bindBody(c, request); err != nil {
					return err
				}
			}
			precondition := ApplicationPrecondition{}
			if command.versioned {
				var ok bool
				precondition, ok = applicationPreconditionFromContext(c.Context())
				if !ok {
					return errInvalidApplicationPrecondition
				}
			}
			result, err := command.handle(c.Context(), request, principal, precondition)
			if err != nil {
				return err
			}
			if command.versioned {
				if !validApplicationEntityTag(result.entityTag) {
					return errInvalidApplicationResponseEntityTag
				}
				setNoStoreHeaders(c)
				c.Set(fiber.HeaderETag, quoteApplicationEntityTag(result.entityTag))
			}
			return success(c, result.data)
		})
		router.Add([]string{command.method}, command.Path, handlers[0], handlers[1:]...)
	}
}

func validateApplicationCommands(commands []ApplicationCommand, authEnabled, oidcBrowserSessionsEnabled bool) {
	paths := make(map[string]struct{}, len(commands))
	for index, command := range commands {
		method, validMethod := applicationCommandMethod(command.method)
		if !validMethod {
			panic(fmt.Sprintf("invalid application command at index %d: method must be POST, PUT, PATCH, or DELETE", index))
		}
		if !validApplicationRoutePath(command.Path) {
			panic(fmt.Sprintf("invalid application command at index %d: path must be a canonical static path without whitespace, parameters, wildcard, encoding, query, or fragment", index))
		}
		if command.newRequest == nil || command.handle == nil {
			panic(fmt.Sprintf("invalid application command %q: handler is required", command.Path))
		}
		normalizedPath := strings.ToLower(command.Path)
		pathKey := method + " " + normalizedPath
		if _, exists := paths[pathKey]; exists {
			panic(fmt.Sprintf("duplicate application command path %q", command.Path))
		}
		reservedPaths := defaultApplicationRoutePaths(method, authEnabled, oidcBrowserSessionsEnabled)
		if _, reserved := reservedPaths[normalizedPath]; reserved {
			panic(fmt.Sprintf("application command path %q conflicts with a default POST route", command.Path))
		}
		if command.authenticated && !authEnabled {
			panic(fmt.Sprintf("invalid application command %q: authentication must be enabled", command.Path))
		}
		if command.authorizationRequired {
			if !command.authenticated {
				panic(fmt.Sprintf("invalid application command %q: authorization requires authentication", command.Path))
			}
			validateApplicationRoleRequirements("application command", command.Path, command.requiredRoleIDs)
		}
		if command.resourceAuthorizationRequired {
			if !command.authorizationRequired {
				panic(fmt.Sprintf("invalid application command %q: resource authorization requires role authorization", command.Path))
			}
			validateApplicationResourceAuthorization("application command", command.Path, command.resourceAuthorizer, command.resolveResource)
		}
		paths[pathKey] = struct{}{}
	}
}

func applicationCommandMethod(method string) (string, bool) {
	if method == "" {
		return http.MethodPost, true
	}
	if method != strings.TrimSpace(method) {
		return "", false
	}
	normalized := strings.ToUpper(method)
	switch normalized {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return normalized, true
	default:
		return "", false
	}
}
