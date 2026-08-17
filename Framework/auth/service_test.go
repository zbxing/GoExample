package auth

import (
	"errors"
	"testing"
	"time"
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
	if claims.Subject != user.ID || claims.Username != user.Username {
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

func newTestService(now func() time.Time) *Service {
	return NewService(Config{
		Enabled:  true,
		Username: "demo",
		Password: "demo123",
		Secret:   "01234567890123456789012345678901",
		Issuer:   "test",
		TTL:      time.Hour,
		Now:      now,
	})
}
