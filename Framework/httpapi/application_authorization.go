package httpapi

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/authorization"
)

const (
	maxApplicationRequiredRoles = 32
	maxApplicationRoleIDLen     = 128
)

var errApplicationAuthorizationFailure = errors.New("application resource authorization failed")

// ApplicationPrincipal is the minimum authenticated identity exposed to an
// application adapter. Tokens and transport-specific claims stay internal.
type ApplicationPrincipal struct {
	Subject  string
	Username string
	RoleIDs  []string
}

func applicationPrincipalFromContext(c fiber.Ctx) (ApplicationPrincipal, bool) {
	claims, ok := currentClaims(c)
	if !ok {
		return ApplicationPrincipal{}, false
	}
	return ApplicationPrincipal{
		Subject:  claims.Subject,
		Username: claims.Username,
		RoleIDs:  append([]string(nil), claims.RoleIDs...),
	}, true
}

func authorizeApplicationRoles(
	c fiber.Ctx,
	options Options,
	principalRoleIDs, requiredRoleIDs []string,
	target string,
) (bool, error) {
	for _, required := range requiredRoleIDs {
		if slices.Contains(principalRoleIDs, required) {
			return true, nil
		}
	}
	recordSecurityAudit(c, options, securityEventAuthorization, securityOutcomeFailure, "role_required", target, "")
	return false, failure(c, fiber.StatusForbidden, "access is forbidden")
}

func authorizeApplicationResource(
	c fiber.Ctx,
	options Options,
	principal ApplicationPrincipal,
	authorizer authorization.Authorizer,
	resource authorization.Resource,
	target string,
) (bool, error) {
	request := authorization.Request{
		Principal: authorization.Principal{
			Subject:  principal.Subject,
			Username: principal.Username,
			RoleIDs:  append([]string(nil), principal.RoleIDs...),
		},
		Resource: cloneAuthorizationResource(resource),
	}
	if err := authorization.ValidateRequest(request); err != nil {
		recordSecurityAudit(c, options, securityEventAuthorization, securityOutcomeFailure, "resource_invalid", target, "")
		return false, fiber.NewError(fiber.StatusBadRequest, "request resource is invalid")
	}

	policyContext, cancel := context.WithTimeout(c.Context(), options.ResourceAuthorizationTimeout)
	defer cancel()
	decision, policyErr := evaluateApplicationAuthorization(policyContext, authorizer, request)
	allowed := policyErr == nil && policyContext.Err() == nil && decision == authorization.DecisionAllow
	if allowed {
		return true, nil
	}
	recordSecurityAudit(c, options, securityEventAuthorization, securityOutcomeFailure, "resource_denied", target, "")
	return false, failure(c, fiber.StatusForbidden, "access is forbidden")
}

func evaluateApplicationAuthorization(
	ctx context.Context,
	authorizer authorization.Authorizer,
	request authorization.Request,
) (decision authorization.Decision, err error) {
	defer func() {
		if recover() != nil {
			decision = authorization.DecisionDeny
			err = errApplicationAuthorizationFailure
		}
	}()
	return authorizer.Authorize(ctx, request)
}

func resolveApplicationResource(
	resolver func(any, ApplicationPrincipal) authorization.Resource,
	request any,
	principal ApplicationPrincipal,
) (resource authorization.Resource, ok bool) {
	defer func() {
		if recover() != nil {
			resource = authorization.Resource{}
			ok = false
		}
	}()
	resolverPrincipal := principal
	resolverPrincipal.RoleIDs = append([]string(nil), principal.RoleIDs...)
	return resolver(request, resolverPrincipal), true
}

func cloneAuthorizationResource(resource authorization.Resource) authorization.Resource {
	cloned := resource
	if resource.Attributes != nil {
		cloned.Attributes = make(map[string]string, len(resource.Attributes))
		for key, value := range resource.Attributes {
			cloned.Attributes[key] = value
		}
	}
	return cloned
}

func validateApplicationResourceAuthorization(kind, routePath string, authorizer authorization.Authorizer, resolver func(any, ApplicationPrincipal) authorization.Resource) {
	if authorizer == nil || resolver == nil {
		panic(fmt.Sprintf("invalid %s %q: resource authorizer and resolver are required", kind, routePath))
	}
}

func validResourceAuthorizationTimeout(timeout time.Duration) bool {
	return timeout > 0 && timeout <= time.Second
}

func validateApplicationRoleRequirements(kind, routePath string, roleIDs []string) {
	if len(roleIDs) == 0 || len(roleIDs) > maxApplicationRequiredRoles {
		panic(fmt.Sprintf("invalid %s %q: authorized routes require between 1 and %d role IDs", kind, routePath, maxApplicationRequiredRoles))
	}
	seen := make(map[string]struct{}, len(roleIDs))
	for _, roleID := range roleIDs {
		if !validApplicationRoleID(roleID) {
			panic(fmt.Sprintf("invalid %s %q: required role ID is invalid", kind, routePath))
		}
		if _, duplicate := seen[roleID]; duplicate {
			panic(fmt.Sprintf("invalid %s %q: required role IDs must be unique", kind, routePath))
		}
		seen[roleID] = struct{}{}
	}
}

func validApplicationRoleID(roleID string) bool {
	if len(roleID) == 0 || len(roleID) > maxApplicationRoleIDLen || roleID != strings.TrimSpace(roleID) {
		return false
	}
	for index, current := range roleID {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') ||
			(current >= '0' && current <= '9') || (index > 0 && strings.ContainsRune("_-.:/@", current)) {
			continue
		}
		return false
	}
	return true
}
