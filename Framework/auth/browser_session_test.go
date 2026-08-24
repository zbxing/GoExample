package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestBrowserSessionCapsLifetimeBindsCSRFAndCopiesClaims(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	manager := newTestBrowserSessionManager(t, &now, 10, nil)
	claims := testBrowserSessionClaims(now, 5*time.Minute)
	credentials, err := manager.Start(context.Background(), claims)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if len(credentials.SessionToken) != 43 || len(credentials.CSRFToken) != 43 || len(credentials.SessionID) != 43 ||
		credentials.SessionToken == credentials.CSRFToken || credentials.SessionToken == credentials.SessionID ||
		credentials.CSRFToken == credentials.SessionID || credentials.ExpiresAt != now.Add(5*time.Minute) {
		t.Fatalf("credentials = %#v", credentials)
	}
	claims.RoleIDs[0] = "mutated"
	verified, err := manager.Verify(context.Background(), credentials.SessionToken, "", false)
	if err != nil {
		t.Fatalf("safe Verify() error = %v", err)
	}
	if verified.RoleIDs[0] != "operator" {
		t.Fatalf("stored claims were mutated: %#v", verified)
	}
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, "", true); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("missing CSRF Verify() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, credentials.SessionToken, true); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("wrong CSRF Verify() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, credentials.CSRFToken, true); err != nil {
		t.Fatalf("bound CSRF Verify() error = %v", err)
	}
	now = now.Add(5 * time.Minute)
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, credentials.CSRFToken, true); !errors.Is(err, ErrBrowserSessionExpired) {
		t.Fatalf("expired Verify() error = %v", err)
	}
}

func TestBrowserSessionInventoryEnforcesSubjectLimitAndScopesRevocation(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	manager, err := NewBrowserSessionManager(BrowserSessionConfig{
		TTL: time.Hour, MaxSessions: 4, MaxSessionsPerSubject: 2, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewBrowserSessionManager() error = %v", err)
	}
	first, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil {
		t.Fatalf("first Start() error = %v", err)
	}
	now = now.Add(time.Minute)
	second, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	if _, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour)); !errors.Is(err, ErrBrowserSessionSubjectLimit) {
		t.Fatalf("subject-limited Start() error = %v", err)
	}
	otherClaims := testBrowserSessionClaims(now, time.Hour)
	otherClaims.Subject = "browser-user-2"
	other, err := manager.Start(context.Background(), otherClaims)
	if err != nil {
		t.Fatalf("other-subject Start() error = %v", err)
	}
	items, err := manager.ListForSubject(context.Background(), "browser-user-1")
	if err != nil {
		t.Fatalf("ListForSubject() error = %v", err)
	}
	if len(items) != 2 || items[0].SessionID != second.SessionID || items[1].SessionID != first.SessionID {
		t.Fatalf("inventory = %#v", items)
	}
	if err := manager.RevokeForSubject(context.Background(), "browser-user-2", first.SessionID); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("cross-subject RevokeForSubject() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), first.SessionToken, "", false); err != nil {
		t.Fatalf("cross-subject revoke changed session: %v", err)
	}
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", second.SessionID); err != nil {
		t.Fatalf("RevokeForSubject() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), second.SessionToken, "", false); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("revoked Verify() error = %v", err)
	}
	deleted, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1")
	if err != nil || deleted != 1 {
		t.Fatalf("RevokeAllForSubject() = %d, %v", deleted, err)
	}
	if _, err := manager.Verify(context.Background(), first.SessionToken, "", false); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("revoke-all Verify() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), other.SessionToken, "", false); err != nil {
		t.Fatalf("revoke-all changed other subject: %v", err)
	}
	items, err = manager.ListForSubject(context.Background(), "browser-user-1")
	if err != nil || len(items) != 0 {
		t.Fatalf("empty inventory = %#v, %v", items, err)
	}
}

func TestBrowserSessionLegacyStoreKeepsStartCompatibilityWithoutInventory(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	store := &testBrowserSessionStore{records: make(map[[sha256.Size]byte]BrowserSessionRecord)}
	manager := newTestBrowserSessionManager(t, &now, 2, store)
	credentials, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil || credentials.SessionID == "" {
		t.Fatalf("legacy Start() = %#v, %v", credentials, err)
	}
	if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); !errors.Is(err, ErrBrowserSessionInventoryUnavailable) {
		t.Fatalf("legacy ListForSubject() error = %v", err)
	}
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", credentials.SessionID); !errors.Is(err, ErrBrowserSessionInventoryUnavailable) {
		t.Fatalf("legacy RevokeForSubject() error = %v", err)
	}
	if _, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1"); !errors.Is(err, ErrBrowserSessionInventoryUnavailable) {
		t.Fatalf("legacy RevokeAllForSubject() error = %v", err)
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "laptop"); !errors.Is(err, ErrBrowserSessionInventoryUnavailable) {
		t.Fatalf("legacy SetDeviceNameForSubject() error = %v", err)
	}
}

func TestBrowserSessionDeviceNameLocalUpdateClearAndValidation(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	manager := newTestBrowserSessionManager(t, &now, 4, nil)
	credentials, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "My laptop"); err != nil {
		t.Fatalf("SetDeviceNameForSubject() error = %v", err)
	}
	items, err := manager.ListForSubject(context.Background(), "browser-user-1")
	if err != nil || len(items) != 1 || items[0].DeviceName != "My laptop" {
		t.Fatalf("device inventory = %#v, %v", items, err)
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, ""); err != nil {
		t.Fatalf("clear device name error = %v", err)
	}
	items, err = manager.ListForSubject(context.Background(), "browser-user-1")
	if err != nil || len(items) != 1 || items[0].DeviceName != "" {
		t.Fatalf("cleared device inventory = %#v, %v", items, err)
	}
	for index, deviceName := range []string{
		" leading-space",
		"trailing-space ",
		string([]rune{'l', 'a', 'p', 't', 'o', 'p', '\n'}),
		string(make([]rune, maxBrowserSessionDeviceName+1)),
	} {
		if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, deviceName); !errors.Is(err, ErrBrowserSessionDeviceNameInvalid) {
			t.Fatalf("invalid device name %d error = %v", index, err)
		}
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-2", credentials.SessionID, "other"); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("cross-subject device update error = %v", err)
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", strings.Repeat("x", 43), "unknown"); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("unknown device update error = %v", err)
	}
	now = now.Add(time.Hour)
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "expired"); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("expired device update error = %v", err)
	}
}

func TestBrowserSessionLimitEndAndInputValidation(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	manager := newTestBrowserSessionManager(t, &now, 1, nil)
	credentials, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, err := manager.Start(context.Background(), testBrowserSessionClaims(now, time.Hour)); !errors.Is(err, ErrBrowserSessionLimit) {
		t.Fatalf("limited Start() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), "not-a-session", "", false); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("malformed Verify() error = %v", err)
	}
	if err := manager.End(context.Background(), credentials.SessionToken); err != nil {
		t.Fatalf("End() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, "", false); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("ended Verify() error = %v", err)
	}
	if err := manager.End(context.Background(), credentials.SessionToken); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("second End() error = %v", err)
	}
	if _, err := manager.Start(nil, testBrowserSessionClaims(now, time.Hour)); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("nil context Start() error = %v", err)
	}
}

func TestBrowserSessionStoreSharesHashOnlyStateAcrossManagers(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	store := &testBrowserSessionStore{records: make(map[[sha256.Size]byte]BrowserSessionRecord)}
	first := newTestBrowserSessionManager(t, &now, 2, store)
	second := newTestBrowserSessionManager(t, &now, 2, store)
	credentials, err := first.Start(context.Background(), testBrowserSessionClaims(now, time.Hour))
	if err != nil {
		t.Fatalf("shared Start() error = %v", err)
	}
	if len(store.records) != 1 {
		t.Fatalf("stored record count = %d", len(store.records))
	}
	for tokenHash := range store.records {
		if tokenHash == sha256.Sum256([]byte(credentials.CSRFToken)) {
			t.Fatal("store was keyed by CSRF token")
		}
	}
	if _, err := second.Verify(context.Background(), credentials.SessionToken, credentials.CSRFToken, true); err != nil {
		t.Fatalf("cross-manager Verify() error = %v", err)
	}
	if err := second.End(context.Background(), credentials.SessionToken); err != nil {
		t.Fatalf("cross-manager End() error = %v", err)
	}
	if _, err := first.Verify(context.Background(), credentials.SessionToken, "", false); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("cross-manager revoked Verify() error = %v", err)
	}
}

func TestNewBrowserSessionManagerRejectsUnsafeConfigurationAndClaims(t *testing.T) {
	for index, config := range []BrowserSessionConfig{
		{TTL: 0, MaxSessions: 1},
		{TTL: 25 * time.Hour, MaxSessions: 1},
		{TTL: time.Hour, MaxSessions: 0},
		{TTL: time.Hour, MaxSessions: maxBrowserSessions + 1},
		{TTL: time.Hour, MaxSessions: 2, MaxSessionsPerSubject: 3},
	} {
		if _, err := NewBrowserSessionManager(config); err == nil {
			t.Fatalf("config %d unexpectedly accepted", index)
		}
	}
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	manager := newTestBrowserSessionManager(t, &now, 1, nil)
	claims := testBrowserSessionClaims(now, time.Hour)
	claims.Subject = ""
	if _, err := manager.Start(context.Background(), claims); !errors.Is(err, ErrBrowserSessionInvalid) {
		t.Fatalf("invalid claims Start() error = %v", err)
	}
}

func newTestBrowserSessionManager(t *testing.T, now *time.Time, max int, store BrowserSessionStore) *BrowserSessionManager {
	t.Helper()
	manager, err := NewBrowserSessionManager(BrowserSessionConfig{
		TTL: time.Hour, MaxSessions: max, Now: func() time.Time { return *now }, Store: store,
	})
	if err != nil {
		t.Fatalf("NewBrowserSessionManager() error = %v", err)
	}
	return manager
}

func testBrowserSessionClaims(now time.Time, lifetime time.Duration) Claims {
	return Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"operator"}, RoleNames: []string{"Operator"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "https://identity.example", Subject: "browser-user-1", Audience: jwt.ClaimStrings{"browser-api"}, ID: "access-token-id",
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(lifetime)),
		},
	}
}

type testBrowserSessionStore struct {
	mu      sync.Mutex
	records map[[sha256.Size]byte]BrowserSessionRecord
}

func (store *testBrowserSessionStore) CreateBrowserSession(_ context.Context, tokenHash [sha256.Size]byte, record BrowserSessionRecord, now time.Time, max int) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	for hash, candidate := range store.records {
		if !candidate.ExpiresAt.After(now) {
			delete(store.records, hash)
		}
	}
	if len(store.records) >= max {
		return ErrBrowserSessionLimit
	}
	store.records[tokenHash] = record
	return nil
}

func (store *testBrowserSessionStore) ReadBrowserSession(_ context.Context, tokenHash [sha256.Size]byte, now time.Time) (BrowserSessionRecord, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	record, exists := store.records[tokenHash]
	if !exists {
		return BrowserSessionRecord{}, ErrBrowserSessionInvalid
	}
	if !record.ExpiresAt.After(now) {
		delete(store.records, tokenHash)
		return BrowserSessionRecord{}, ErrBrowserSessionExpired
	}
	return record, nil
}

func (store *testBrowserSessionStore) DeleteBrowserSession(_ context.Context, tokenHash [sha256.Size]byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.records[tokenHash]; !exists {
		return ErrBrowserSessionInvalid
	}
	delete(store.records, tokenHash)
	return nil
}
