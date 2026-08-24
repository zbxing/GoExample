package auth

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSessionStartRotateAndReuseRevokesFamily(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 3)
	first, firstExpires, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if len(first) != 43 || strings.Contains(first, "=") {
		t.Fatalf("refresh token format = %q", first)
	}
	if firstExpires != now.Add(time.Hour) {
		t.Fatalf("first expiry = %s", firstExpires)
	}
	second, secondExpires, err := manager.Rotate(first)
	if err != nil {
		t.Fatalf("Rotate() error = %v", err)
	}
	if second == first || secondExpires != now.Add(time.Hour) {
		t.Fatalf("rotated token/expiry = %q, %s", second, secondExpires)
	}
	if manager.ActiveFamilies("user-1") != 1 {
		t.Fatalf("ActiveFamilies() after rotation != 1")
	}
	if _, _, err := manager.Rotate(first); !errors.Is(err, ErrSessionReuse) {
		t.Fatalf("replayed Rotate() error = %v", err)
	}
	if manager.ActiveFamilies("user-1") != 0 {
		t.Fatalf("ActiveFamilies() after reuse != 0")
	}
	if _, _, err := manager.Rotate(second); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("new token after reuse error = %v", err)
	}
}

func TestSessionExpiryAndAbsoluteLifetime(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 3)
	first, expiresAt, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if expiresAt != now.Add(time.Hour) {
		t.Fatalf("expiry = %s", expiresAt)
	}
	now = now.Add(time.Hour)
	if _, _, err := manager.Rotate(first); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expired Rotate() error = %v", err)
	}
	if err := manager.RevokeFamily(first); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expired RevokeFamily() error = %v", err)
	}
	now = now.Add(2 * time.Hour)
	if manager.ActiveFamilies("user-1") != 0 {
		t.Fatalf("ActiveFamilies() after expiry != 0")
	}
	if _, _, err := manager.Start("user-2"); err != nil {
		t.Fatalf("Start() after absolute expiry error = %v", err)
	}
	now = time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	shortManager, err := NewSessionManager(SessionConfig{
		RefreshTTL:  time.Hour,
		AbsoluteTTL: 90 * time.Minute,
		MaxFamilies: 2,
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewSessionManager() error = %v", err)
	}
	shortToken, _, err := shortManager.Start("user-3")
	if err != nil {
		t.Fatalf("short Start() error = %v", err)
	}
	now = time.Date(2026, time.August, 23, 5, 30, 0, 0, time.UTC)
	rotatedToken, rotatedExpiry, err := shortManager.Rotate(shortToken)
	if err != nil {
		t.Fatalf("short Rotate() error = %v", err)
	}
	if rotatedExpiry != time.Date(2026, time.August, 23, 6, 30, 0, 0, time.UTC) {
		t.Fatalf("absolute-capped expiry = %s", rotatedExpiry)
	}
	now = time.Date(2026, time.August, 23, 6, 31, 0, 0, time.UTC)
	if _, _, err := shortManager.Rotate(rotatedToken); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("absolute-expired Rotate() error = %v", err)
	}
}

func TestSessionRevokeFamilyAndUser(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 4)
	first, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, _, err := manager.Start("user-1"); err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	if _, _, err := manager.Start("user-2"); err != nil {
		t.Fatalf("third Start() error = %v", err)
	}
	if manager.ActiveFamilies("user-1") != 2 {
		t.Fatalf("ActiveFamilies(user-1) != 2")
	}
	if err := manager.RevokeFamily(first); err != nil {
		t.Fatalf("RevokeFamily() error = %v", err)
	}
	if _, _, err := manager.Rotate(first); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("revoked Rotate() error = %v", err)
	}
	if count := manager.RevokeUser("user-1"); count != 1 {
		t.Fatalf("RevokeUser() = %d, want 1", count)
	}
	if manager.ActiveFamilies("user-1") != 0 || manager.ActiveFamilies("user-2") != 1 {
		t.Fatalf("active family counts after revoke = %d/%d", manager.ActiveFamilies("user-1"), manager.ActiveFamilies("user-2"))
	}
	if count := manager.RevokeUser("user-1"); count != 0 {
		t.Fatalf("second RevokeUser() = %d, want 0", count)
	}
}

func TestSessionFamilyLimitAndInputValidation(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 1)
	if _, _, err := manager.Start(" "); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("empty user Start() error = %v", err)
	}
	first, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, _, err := manager.Start("user-2"); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("limited Start() error = %v", err)
	}
	if _, _, err := manager.Rotate("not-a-token"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("malformed Rotate() error = %v", err)
	}
	if err := manager.RevokeFamily("not-a-token"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("malformed RevokeFamily() error = %v", err)
	}
	if err := manager.RevokeFamily(first); err != nil {
		t.Fatalf("RevokeFamily() error = %v", err)
	}
	if _, _, err := manager.Start("user-2"); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("retained revoked family Start() error = %v", err)
	}
	now = now.Add(24 * time.Hour)
	if _, _, err := manager.Start("user-2"); err != nil {
		t.Fatalf("Start() after family cleanup error = %v", err)
	}
}

func TestSessionRotationHistoryIsBounded(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 2)
	first, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	family := manager.tokens[hashForTest(first)]
	if family == nil {
		t.Fatal("started family was not indexed")
	}
	family.used = make(map[[32]byte]struct{}, maxSessionTokensPerFamily)
	for index := 0; index < maxSessionTokensPerFamily; index++ {
		family.used[[32]byte{byte(index), byte(index >> 8)}] = struct{}{}
	}
	if _, _, err := manager.Rotate(first); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("bounded Rotate() error = %v", err)
	}
	if manager.ActiveFamilies("user-1") != 0 {
		t.Fatal("history limit did not revoke family")
	}
}

func TestSessionConcurrentRotationDetectsReuse(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager := newTestSessionManager(&now, 2)
	first, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	var waitGroup sync.WaitGroup
	var mu sync.Mutex
	successes := 0
	reuses := 0
	for range 8 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			_, _, rotateErr := manager.Rotate(first)
			mu.Lock()
			defer mu.Unlock()
			if rotateErr == nil {
				successes++
			} else if errors.Is(rotateErr, ErrSessionReuse) {
				reuses++
			}
		}()
	}
	waitGroup.Wait()
	if successes != 1 || reuses != 7 {
		t.Fatalf("concurrent rotations successes/reuses = %d/%d", successes, reuses)
	}
	if manager.ActiveFamilies("user-1") != 0 {
		t.Fatal("concurrent reuse did not revoke family")
	}
}

func TestNewSessionManagerRejectsUnsafeConfig(t *testing.T) {
	tests := []SessionConfig{
		{AbsoluteTTL: time.Hour, MaxFamilies: 1},
		{RefreshTTL: time.Hour, AbsoluteTTL: 30 * time.Minute, MaxFamilies: 1},
		{RefreshTTL: time.Hour, AbsoluteTTL: time.Hour, MaxFamilies: 0},
		{RefreshTTL: time.Hour, AbsoluteTTL: time.Hour, MaxFamilies: maxSessionFamilies + 1},
	}
	for index, config := range tests {
		if _, err := NewSessionManager(config); err == nil {
			t.Fatalf("config %d unexpectedly accepted", index)
		}
	}
}

func newTestSessionManager(now *time.Time, maxFamilies int) *SessionManager {
	manager, err := NewSessionManager(SessionConfig{
		RefreshTTL:  time.Hour,
		AbsoluteTTL: 24 * time.Hour,
		MaxFamilies: maxFamilies,
		Now:         func() time.Time { return *now },
	})
	if err != nil {
		panic(err)
	}
	return manager
}

func hashForTest(rawToken string) [32]byte {
	hash, ok := hashRefreshToken(rawToken)
	if !ok {
		panic("invalid test refresh token")
	}
	return hash
}
