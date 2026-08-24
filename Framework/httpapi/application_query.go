package httpapi

import (
	"context"
	"fmt"
	"path"
	"reflect"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/binder"

	"github.com/zbxing/goexample/Framework/authorization"
	"github.com/zbxing/goexample/Framework/validation"
)

// ApplicationQuery exposes a bodyless query use case without leaking Fiber
// request or response types into project code. GET is the default method.
type ApplicationQuery struct {
	Path    string
	Handler func(context.Context) (any, error)
	method  string

	requestType                   reflect.Type
	newRequest                    func() any
	handle                        func(context.Context, any, ApplicationPrincipal) (applicationQueryResult, error)
	authenticated                 bool
	authorizationRequired         bool
	requiredRoleIDs               []string
	resourceAuthorizationRequired bool
	resourceAuthorizer            authorization.Authorizer
	resolveResource               func(any, ApplicationPrincipal) authorization.Resource
	versioned                     bool
}

// WithMethod changes the HTTP method used by a bodyless application query.
// Queries default to GET; HEAD is also supported and uses the same bounded
// binding, authorization, and response contract.
func (query ApplicationQuery) WithMethod(method string) ApplicationQuery {
	query.method = method
	return query
}

type applicationQueryResult struct {
	data      any
	entityTag string
}

// NewQuery adapts a typed URI/query/header bodyless request to an application
// handler. Every exported request field must declare exactly one of the uri,
// query, or header tags so one source cannot override another.
func NewQuery[Request, Response any](
	routePath string,
	handler func(context.Context, Request) (Response, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	if handler != nil {
		query.handle = func(ctx context.Context, request any, _ ApplicationPrincipal) (applicationQueryResult, error) {
			response, err := handler(ctx, *request.(*Request))
			return applicationQueryResult{data: response}, err
		}
	}
	return query
}

// NewAuthenticatedQuery is NewQuery with a verified, minimized application
// principal. Registration fails when authentication is disabled.
func NewAuthenticatedQuery[Request, Response any](
	routePath string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	query.authenticated = true
	if handler != nil {
		query.handle = func(ctx context.Context, request any, principal ApplicationPrincipal) (applicationQueryResult, error) {
			response, err := handler(ctx, *request.(*Request), principal)
			return applicationQueryResult{data: response}, err
		}
	}
	return query
}

// NewAuthorizedQuery is NewAuthenticatedQuery with an any-of role gate. Role
// IDs are matched exactly, copied on construction, and validated at startup.
func NewAuthorizedQuery[Request, Response any](
	routePath string,
	anyOfRoleIDs []string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	query.authenticated = true
	query.authorizationRequired = true
	query.requiredRoleIDs = append([]string(nil), anyOfRoleIDs...)
	if handler != nil {
		query.handle = func(ctx context.Context, request any, principal ApplicationPrincipal) (applicationQueryResult, error) {
			response, err := handler(ctx, *request.(*Request), principal)
			return applicationQueryResult{data: response}, err
		}
	}
	return query
}

// NewResourceAuthorizedQuery adds a bounded tenant/resource policy after
// authentication, role checks, and request binding but before the application
// handler. Policy failures are returned as a fixed forbidden response.
func NewResourceAuthorizedQuery[Request, Response any](
	routePath string,
	anyOfRoleIDs []string,
	authorizer authorization.Authorizer,
	resource func(Request, ApplicationPrincipal) authorization.Resource,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, error),
) ApplicationQuery {
	query := NewAuthorizedQuery(routePath, anyOfRoleIDs, handler)
	query.resourceAuthorizationRequired = true
	query.resourceAuthorizer = authorizer
	if resource != nil {
		query.resolveResource = func(request any, principal ApplicationPrincipal) authorization.Resource {
			return resource(*request.(*Request), principal)
		}
	}
	return query
}

// NewVersionedQuery adapts a typed bodyless query whose handler returns a trusted,
// unquoted resource version. The Framework validates and emits a strong ETag
// and returns 304 when If-None-Match weakly matches that current version.
func NewVersionedQuery[Request, Response any](
	routePath string,
	handler func(context.Context, Request) (Response, string, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	query.versioned = true
	if handler != nil {
		query.handle = func(ctx context.Context, request any, _ ApplicationPrincipal) (applicationQueryResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request))
			return applicationQueryResult{data: response, entityTag: entityTag}, err
		}
	}
	return query
}

// NewAuthenticatedVersionedQuery is NewVersionedQuery with a verified,
// minimized application principal.
func NewAuthenticatedVersionedQuery[Request, Response any](
	routePath string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, string, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	query.authenticated = true
	query.versioned = true
	if handler != nil {
		query.handle = func(ctx context.Context, request any, principal ApplicationPrincipal) (applicationQueryResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request), principal)
			return applicationQueryResult{data: response, entityTag: entityTag}, err
		}
	}
	return query
}

// NewAuthorizedVersionedQuery adds an any-of role gate to
// NewAuthenticatedVersionedQuery.
func NewAuthorizedVersionedQuery[Request, Response any](
	routePath string,
	anyOfRoleIDs []string,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, string, error),
) ApplicationQuery {
	query := newTypedQuery[Request](routePath)
	query.authenticated = true
	query.authorizationRequired = true
	query.requiredRoleIDs = append([]string(nil), anyOfRoleIDs...)
	query.versioned = true
	if handler != nil {
		query.handle = func(ctx context.Context, request any, principal ApplicationPrincipal) (applicationQueryResult, error) {
			response, entityTag, err := handler(ctx, *request.(*Request), principal)
			return applicationQueryResult{data: response, entityTag: entityTag}, err
		}
	}
	return query
}

// NewResourceAuthorizedVersionedQuery is NewAuthorizedVersionedQuery with the
// same bounded tenant/resource policy used by NewResourceAuthorizedQuery.
func NewResourceAuthorizedVersionedQuery[Request, Response any](
	routePath string,
	anyOfRoleIDs []string,
	authorizer authorization.Authorizer,
	resource func(Request, ApplicationPrincipal) authorization.Resource,
	handler func(context.Context, Request, ApplicationPrincipal) (Response, string, error),
) ApplicationQuery {
	query := NewAuthorizedVersionedQuery(routePath, anyOfRoleIDs, handler)
	query.resourceAuthorizationRequired = true
	query.resourceAuthorizer = authorizer
	if resource != nil {
		query.resolveResource = func(request any, principal ApplicationPrincipal) authorization.Resource {
			return resource(*request.(*Request), principal)
		}
	}
	return query
}

func newTypedQuery[Request any](routePath string) ApplicationQuery {
	return ApplicationQuery{
		Path:        routePath,
		method:      fiber.MethodGet,
		requestType: reflect.TypeFor[Request](),
		newRequest:  func() any { return new(Request) },
	}
}

func registerApplicationQueries(router fiber.Router, queries []ApplicationQuery, options Options) {
	for _, query := range queries {
		query := query
		method, validMethod := applicationQueryMethod(query.method)
		if !validMethod {
			panic(fmt.Sprintf("invalid application query %q: method must be GET or HEAD", query.Path))
		}
		query.method = method
		handler := func(c fiber.Ctx) error {
			principal := ApplicationPrincipal{}
			if query.authenticated {
				var ok bool
				principal, ok = applicationPrincipalFromContext(c)
				if !ok {
					return fiber.ErrUnauthorized
				}
				if query.authorizationRequired {
					allowed, err := authorizeApplicationRoles(c, options, principal.RoleIDs, query.requiredRoleIDs, "application_query")
					if err != nil || !allowed {
						return err
					}
				}
			}

			var result applicationQueryResult
			if query.newRequest == nil {
				data, err := query.Handler(c.Context())
				if err != nil {
					return err
				}
				result.data = data
			} else {
				request := query.newRequest()
				if err := bindApplicationQuery(c, request, options.Validator); err != nil {
					return err
				}
				if query.resourceAuthorizationRequired {
					resource, ok := resolveApplicationResource(query.resolveResource, request, principal)
					if !ok {
						recordSecurityAudit(c, options, securityEventAuthorization, securityOutcomeFailure, "resource_denied", "application_query", "")
						return failure(c, fiber.StatusForbidden, "access is forbidden")
					}
					allowed, err := authorizeApplicationResource(c, options, principal, query.resourceAuthorizer, resource, "application_query")
					if err != nil || !allowed {
						return err
					}
				}
				var err error
				result, err = query.handle(c.Context(), request, principal)
				if err != nil {
					return err
				}
			}
			if query.versioned {
				if !validApplicationEntityTag(result.entityTag) {
					return errInvalidApplicationResponseEntityTag
				}
				entityTag := quoteApplicationEntityTag(result.entityTag)
				setNoStoreHeaders(c)
				c.Set(fiber.HeaderETag, entityTag)
				if weakETagMatches(c.Get(fiber.HeaderIfNoneMatch), entityTag) {
					c.RequestCtx().ResetBody()
					return c.SendStatus(fiber.StatusNotModified)
				}
			}
			return success(c, result.data)
		}
		handlers := []any{handler}
		if query.authenticated {
			handlers = append([]any{requireAuth(options)}, handlers...)
		}
		router.Add([]string{query.method}, query.Path, handlers[0], handlers[1:]...)
	}
}

func validateApplicationQueries(queries []ApplicationQuery, authEnabled, oidcBrowserEnabled bool) {
	reservedPaths := defaultApplicationRoutePaths(fiber.MethodGet, authEnabled, oidcBrowserEnabled)
	for index, query := range queries {
		method, validMethod := applicationQueryMethod(query.method)
		if !validMethod {
			panic(fmt.Sprintf("invalid application query at index %d: method must be GET or HEAD", index))
		}
		typed := query.requestType != nil
		segments, validPath := parseApplicationQueryRoutePath(query.Path, typed)
		if !validPath {
			panic(fmt.Sprintf("invalid application query at index %d: path must be canonical and may contain only named parameters on typed queries", index))
		}
		if typed {
			if query.Handler != nil || query.newRequest == nil || query.handle == nil {
				panic(fmt.Sprintf("invalid application query %q: typed handler is required", query.Path))
			}
			validateApplicationQueryRequest(query.Path, query.requestType, segments)
		} else if query.Handler == nil {
			panic(fmt.Sprintf("invalid application query %q: handler is required", query.Path))
		}
		if query.authenticated && !authEnabled {
			panic(fmt.Sprintf("invalid application query %q: authentication must be enabled", query.Path))
		}
		if query.authorizationRequired {
			if !query.authenticated {
				panic(fmt.Sprintf("invalid application query %q: authorization requires authentication", query.Path))
			}
			validateApplicationRoleRequirements("application query", query.Path, query.requiredRoleIDs)
		}
		if query.resourceAuthorizationRequired {
			if !query.authorizationRequired {
				panic(fmt.Sprintf("invalid application query %q: resource authorization requires role authorization", query.Path))
			}
			validateApplicationResourceAuthorization("application query", query.Path, query.resourceAuthorizer, query.resolveResource)
		}
		reservedPaths = defaultApplicationRoutePaths(method, authEnabled, oidcBrowserEnabled)
		for reservedPath := range reservedPaths {
			reservedSegments, _ := parseApplicationQueryRoutePath(reservedPath, false)
			if applicationQueryRoutesOverlap(segments, reservedSegments) {
				panic(fmt.Sprintf("application query path %q conflicts with a default route", query.Path))
			}
		}
		for previousIndex := 0; previousIndex < index; previousIndex++ {
			previousSegments, _ := parseApplicationQueryRoutePath(queries[previousIndex].Path, queries[previousIndex].requestType != nil)
			previousMethod, _ := applicationQueryMethod(queries[previousIndex].method)
			if method == previousMethod && applicationQueryRoutesOverlap(segments, previousSegments) {
				panic(fmt.Sprintf("application query path %q overlaps %q", query.Path, queries[previousIndex].Path))
			}
		}
	}
}

func applicationQueryMethod(method string) (string, bool) {
	if method == "" {
		return fiber.MethodGet, true
	}
	if method != strings.TrimSpace(method) {
		return "", false
	}
	normalized := strings.ToUpper(method)
	switch normalized {
	case fiber.MethodGet, fiber.MethodHead:
		return normalized, true
	default:
		return "", false
	}
}

func validApplicationRoutePath(routePath string) bool {
	_, valid := parseApplicationQueryRoutePath(routePath, false)
	return valid
}

type applicationQueryRouteSegment struct {
	value     string
	parameter bool
}

func parseApplicationQueryRoutePath(routePath string, allowParameters bool) ([]applicationQueryRouteSegment, bool) {
	if routePath == "" || routePath != strings.TrimSpace(routePath) || !strings.HasPrefix(routePath, "/") ||
		path.Clean(routePath) != routePath || strings.ContainsAny(routePath, "\\?#%*+") ||
		strings.IndexFunc(routePath, func(current rune) bool { return unicode.IsSpace(current) || unicode.IsControl(current) }) >= 0 {
		return nil, false
	}
	if routePath == "/" {
		return []applicationQueryRouteSegment{}, true
	}

	rawSegments := strings.Split(strings.TrimPrefix(routePath, "/"), "/")
	segments := make([]applicationQueryRouteSegment, 0, len(rawSegments))
	parameterNames := make(map[string]struct{})
	for _, segment := range rawSegments {
		if strings.HasPrefix(segment, ":") {
			name := strings.TrimPrefix(segment, ":")
			if !allowParameters || !validApplicationParameterName(name) {
				return nil, false
			}
			normalized := strings.ToLower(name)
			if _, duplicate := parameterNames[normalized]; duplicate {
				return nil, false
			}
			parameterNames[normalized] = struct{}{}
			segments = append(segments, applicationQueryRouteSegment{value: normalized, parameter: true})
			continue
		}
		if segment == "" || strings.Contains(segment, ":") {
			return nil, false
		}
		segments = append(segments, applicationQueryRouteSegment{value: strings.ToLower(segment)})
	}
	return segments, true
}

func validApplicationParameterName(name string) bool {
	for index, current := range name {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || current == '_' || (index > 0 && current >= '0' && current <= '9') {
			continue
		}
		return false
	}
	return name != ""
}

func applicationQueryRoutesOverlap(left, right []applicationQueryRouteSegment) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if !left[index].parameter && !right[index].parameter && left[index].value != right[index].value {
			return false
		}
	}
	return true
}

func validateApplicationQueryRequest(routePath string, requestType reflect.Type, segments []applicationQueryRouteSegment) {
	if requestType.Kind() != reflect.Struct {
		panic(fmt.Sprintf("invalid application query %q: request type must be a struct", routePath))
	}
	aliases := map[string]map[string]struct{}{
		"uri":    {},
		"query":  {},
		"header": {},
	}
	for index := range requestType.NumField() {
		field := requestType.Field(index)
		if field.PkgPath != "" || field.Anonymous {
			panic(fmt.Sprintf("invalid application query %q: request fields must be exported and non-anonymous", routePath))
		}
		sourceCount := 0
		for _, source := range []string{"uri", "query", "header"} {
			alias, exists := applicationBindingAlias(field, source)
			if !exists {
				continue
			}
			sourceCount++
			if !validApplicationBindingName(alias) {
				panic(fmt.Sprintf("invalid application query %q: field %s has an invalid %s binding", routePath, field.Name, source))
			}
			normalized := strings.ToLower(alias)
			if _, duplicate := aliases[source][normalized]; duplicate {
				panic(fmt.Sprintf("invalid application query %q: duplicate %s binding %q", routePath, source, alias))
			}
			aliases[source][normalized] = struct{}{}
		}
		if sourceCount != 1 {
			panic(fmt.Sprintf("invalid application query %q: field %s must declare exactly one uri, query, or header binding", routePath, field.Name))
		}
	}

	pathParameters := make(map[string]struct{})
	for _, segment := range segments {
		if segment.parameter {
			pathParameters[segment.value] = struct{}{}
		}
	}
	if len(pathParameters) != len(aliases["uri"]) {
		panic(fmt.Sprintf("invalid application query %q: URI bindings must match path parameters", routePath))
	}
	for name := range pathParameters {
		if _, exists := aliases["uri"][name]; !exists {
			panic(fmt.Sprintf("invalid application query %q: URI bindings must match path parameters", routePath))
		}
	}
}

func applicationBindingAlias(field reflect.StructField, source string) (string, bool) {
	raw, exists := field.Tag.Lookup(source)
	if !exists {
		return "", false
	}
	alias, _, _ := strings.Cut(raw, ",")
	alias = strings.TrimSpace(alias)
	return alias, alias != "" && alias != "-"
}

func validApplicationBindingName(name string) bool {
	for index, current := range name {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (index > 0 && current >= '0' && current <= '9') || (index > 0 && strings.ContainsRune("_-.", current)) {
			continue
		}
		return false
	}
	return name != ""
}

func bindApplicationQuery(c fiber.Ctx, destination any, validator fiber.StructValidator) error {
	target := reflect.ValueOf(destination).Elem()
	bindSource := func(source string) error {
		temporary := reflect.New(target.Type())
		var err error
		switch source {
		case "uri":
			err = (&binder.URIBinding{}).Bind(c.Route().Params, c.Params, temporary.Interface())
		case "query":
			err = (&binder.QueryBinding{EnableSplitting: c.App().Config().EnableSplittingOnParsers}).Bind(&c.RequestCtx().Request, temporary.Interface())
		case "header":
			err = (&binder.HeaderBinding{EnableSplitting: c.App().Config().EnableSplittingOnParsers}).Bind(&c.RequestCtx().Request, temporary.Interface())
		}
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "request parameters are invalid")
		}
		for index := range target.NumField() {
			if _, matches := applicationBindingAlias(target.Type().Field(index), source); matches {
				target.Field(index).Set(temporary.Elem().Field(index))
			}
		}
		return nil
	}
	for _, source := range []string{"uri", "query", "header"} {
		if err := bindSource(source); err != nil {
			return err
		}
	}
	if validator != nil {
		if err := validator.Validate(destination); err != nil {
			message := validation.Message(err)
			if message == "request validation failed" {
				message = "request parameters are invalid"
			}
			return fiber.NewError(fiber.StatusBadRequest, message)
		}
	}
	return nil
}

func defaultApplicationRoutePaths(method string, authEnabled, oidcBrowserEnabled bool) map[string]struct{} {
	lookupMethod := method
	if method == fiber.MethodHead {
		// Fiber automatically mirrors every GET route as HEAD unless an
		// explicit HEAD route replaces it, so reserve the same paths.
		lookupMethod = fiber.MethodGet
	}
	prefix := lookupMethod + " /api/v1"
	paths := make(map[string]struct{})
	for _, endpoint := range DefaultEndpoints(authEnabled) {
		if strings.HasPrefix(endpoint, prefix+"/") {
			paths[strings.ToLower(strings.TrimPrefix(endpoint, prefix))] = struct{}{}
		}
	}
	if oidcBrowserEnabled && lookupMethod == fiber.MethodGet {
		paths["/auth"+oidcStartPath] = struct{}{}
		paths["/auth"+oidcCallbackPath] = struct{}{}
		paths["/auth"+oidcSessionsPath] = struct{}{}
	}
	if oidcBrowserEnabled && lookupMethod == fiber.MethodPost {
		paths["/auth"+oidcLogoutPath] = struct{}{}
	}
	if oidcBrowserEnabled && lookupMethod == fiber.MethodDelete {
		paths["/auth"+oidcSessionsPath] = struct{}{}
		paths["/auth"+oidcSessionsPath+"/:sessionId"] = struct{}{}
	}
	if oidcBrowserEnabled && lookupMethod == fiber.MethodPatch {
		paths["/auth"+oidcSessionsPath+"/:sessionId"] = struct{}{}
	}
	return paths
}
