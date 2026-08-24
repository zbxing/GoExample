// Package authorization defines a transport-neutral resource authorization
// contract for application adapters and policy implementations.
package authorization

import (
	"context"
	"errors"
	"strings"
	"unicode"
)

const (
	maxPrincipalRoles       = 100
	maxIdentifierLength     = 128
	maxAttributeCount       = 16
	maxAttributeKeyLength   = 64
	maxAttributeValueLength = 256
)

// Decision is the only result accepted from an Authorizer. The zero value is
// deliberately a denial so incomplete policy implementations fail closed.
type Decision uint8

const (
	DecisionDeny Decision = iota
	DecisionAllow
)

// Principal is the minimum authenticated identity available to a policy.
type Principal struct {
	Subject  string
	Username string
	RoleIDs  []string
}

// Resource describes the tenant-scoped object and action being requested.
// Attributes must contain policy inputs only, never request bodies or secrets.
type Resource struct {
	TenantID   string
	Type       string
	ID         string
	Action     string
	Attributes map[string]string
}

// Request is the complete bounded input passed to an Authorizer.
type Request struct {
	Principal Principal
	Resource  Resource
}

// Authorizer decides whether a principal may perform an action on a resource.
// Implementations must honor context cancellation and return stable errors.
type Authorizer interface {
	Authorize(context.Context, Request) (Decision, error)
}

// AuthorizerFunc adapts a function to Authorizer.
type AuthorizerFunc func(context.Context, Request) (Decision, error)

func (authorize AuthorizerFunc) Authorize(ctx context.Context, request Request) (Decision, error) {
	return authorize(ctx, request)
}

// ValidateRequest rejects empty, excessive, or control-bearing policy input.
func ValidateRequest(request Request) error {
	if !boundedValue(request.Principal.Subject, maxIdentifierLength) ||
		!optionalBoundedValue(request.Principal.Username, maxIdentifierLength) ||
		len(request.Principal.RoleIDs) == 0 || len(request.Principal.RoleIDs) > maxPrincipalRoles {
		return errors.New("authorization principal is invalid")
	}
	for _, roleID := range request.Principal.RoleIDs {
		if !validIdentifier(roleID, maxIdentifierLength) {
			return errors.New("authorization principal is invalid")
		}
	}
	resource := request.Resource
	if !validIdentifier(resource.TenantID, maxIdentifierLength) ||
		!validIdentifier(resource.Type, maxIdentifierLength) ||
		!validIdentifier(resource.ID, maxIdentifierLength) ||
		!validIdentifier(resource.Action, maxIdentifierLength) ||
		len(resource.Attributes) > maxAttributeCount {
		return errors.New("authorization resource is invalid")
	}
	for key, value := range resource.Attributes {
		if !validIdentifier(key, maxAttributeKeyLength) || !boundedValue(value, maxAttributeValueLength) {
			return errors.New("authorization resource is invalid")
		}
	}
	return nil
}

func validIdentifier(value string, maximum int) bool {
	if !boundedValue(value, maximum) {
		return false
	}
	for index, current := range value {
		if current >= 'a' && current <= 'z' || current >= 'A' && current <= 'Z' ||
			current >= '0' && current <= '9' || index > 0 && strings.ContainsRune("_-.@:/|", current) {
			continue
		}
		return false
	}
	return true
}

func optionalBoundedValue(value string, maximum int) bool {
	return value == "" || boundedValue(value, maximum)
}

func boundedValue(value string, maximum int) bool {
	return value != "" && len(value) <= maximum && value == strings.TrimSpace(value) &&
		strings.IndexFunc(value, unicode.IsControl) < 0
}
