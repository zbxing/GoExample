package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestServiceIssueAndVerify(t *testing.T) {
	now := time.Date(2026, time.August, 16, 5, 0, 0, 0, time.UTC)
	service := newTestService(func() time.Time { return now })
	user, ok := service.Authenticate("demo", "demo123")
	if !ok {
		t.Fatal("Authenticate() = false")
	}

	rawToken, expiresAt, err := service.Issue(user)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if expiresAt != now.Add(time.Hour) {
		t.Fatalf("expiresAt = %s", expiresAt)
	}

	claims, err := service.Verify(rawToken)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if claims.Subject != user.ID || claims.Username != user.Username || claims.ID == "" ||
		claims.IssuedAt == nil || claims.NotBefore == nil || len(claims.Audience) != 1 || claims.Audience[0] != "test-api" {
		t.Fatalf("claims = %#v", claims)
	}
}

func TestServiceRejectsCredentialsAndExpiredToken(t *testing.T) {
	now := time.Date(2026, time.August, 16, 5, 0, 0, 0, time.UTC)
	service := newTestService(func() time.Time { return now })
	if _, ok := service.Authenticate("demo", "wrong"); ok {
		t.Fatal("Authenticate() = true for invalid password")
	}

	user, _ := service.Authenticate("demo", "demo123")
	rawToken, _, err := service.Issue(user)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	service.now = func() time.Time { return now.Add(2 * time.Hour) }
	if _, err := service.Verify(rawToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify() error = %v", err)
	}
}

func TestDisabledService(t *testing.T) {
	service := NewService(Config{})
	if service.Enabled() {
		t.Fatal("Enabled() = true")
	}
	if _, _, err := service.Issue(User{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("Issue() error = %v", err)
	}
}

func TestServiceRejectsMalformedAndOverageClaims(t *testing.T) {
	now := time.Date(2026, time.August, 16, 5, 0, 0, 0, time.UTC)
	service := newTestService(func() time.Time { return now })
	base := func() Claims {
		return Claims{
			Username:    "demo",
			DisplayName: "Demo User",
			Email:       "demo@example.test",
			RoleIDs:     []string{"demo"},
			RoleNames:   []string{"Demo"},
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test",
				Subject:   "user-1",
				Audience:  jwt.ClaimStrings{"test-api"},
				ID:        "token-1",
				IssuedAt:  jwt.NewNumericDate(now),
				NotBefore: jwt.NewNumericDate(now),
				ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			},
		}
	}

	tests := []struct {
		name   string
		mutate func(*Claims)
	}{
		{name: "missing subject", mutate: func(claims *Claims) { claims.Subject = "" }},
		{name: "missing token id", mutate: func(claims *Claims) { claims.ID = "" }},
		{name: "missing audience", mutate: func(claims *Claims) { claims.Audience = nil }},
		{name: "wrong audience", mutate: func(claims *Claims) { claims.Audience = jwt.ClaimStrings{"other-api"} }},
		{name: "missing not before", mutate: func(claims *Claims) { claims.NotBefore = nil }},
		{name: "missing issued at", mutate: func(claims *Claims) { claims.IssuedAt = nil }},
		{name: "mismatched role claims", mutate: func(claims *Claims) { claims.RoleNames = nil }},
		{name: "overage token", mutate: func(claims *Claims) { claims.IssuedAt = jwt.NewNumericDate(now.Add(-2 * time.Hour)) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := base()
			test.mutate(&claims)
			rawToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(serviceSecret))
			if err != nil {
				t.Fatalf("SignedString() error = %v", err)
			}
			if _, err := service.Verify(rawToken); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("Verify() error = %v", err)
			}
		})
	}
}

const serviceSecret = "01234567890123456789012345678901"

func newTestService(now func() time.Time) *Service {
	return NewService(Config{
		Enabled:  true,
		Username: "demo",
		Password: "demo123",
		Secret:   serviceSecret,
		Issuer:   "test",
		Audience: "test-api",
		TTL:      time.Hour,
		Now:      now,
	})
}
