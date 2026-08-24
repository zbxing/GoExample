package sharedstate

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/zbxing/goexample/Framework/auth"
)

func TestRedisBrowserSessionStoreSharesAndRevokesHashOnlySession(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:browser-session:")
	secondState := newTestRedis(t, server, "goexample:browser-session:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisBrowserSessionManager(t, &now, 2, firstState)
	second := newRedisBrowserSessionManager(t, &now, 2, secondState)
	credentials, err := first.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	for _, key := range server.Keys() {
		if strings.Contains(key, credentials.SessionToken) || strings.Contains(key, credentials.CSRFToken) || strings.Contains(key, "browser-user-1") {
			t.Fatalf("raw browser credential appeared in Redis key %q", key)
		}
		if value, getErr := server.Get(key); getErr == nil &&
			(strings.Contains(value, credentials.SessionToken) || strings.Contains(value, credentials.CSRFToken)) {
			t.Fatalf("raw browser credential appeared in Redis value for %q", key)
		}
	}
	claims, err := second.Verify(context.Background(), credentials.SessionToken, credentials.CSRFToken, true)
	if err != nil || claims.Subject != "browser-user-1" {
		t.Fatalf("cross-client Verify() = %#v, %v", claims, err)
	}
	if err := second.End(context.Background(), credentials.SessionToken); err != nil {
		t.Fatalf("End() error = %v", err)
	}
	if _, err := first.Verify(context.Background(), credentials.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("revoked Verify() error = %v", err)
	}
}

func TestRedisBrowserSessionInventoryCrossClientLimitsAndScopesRevocation(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:browser-inventory:")
	secondState := newTestRedis(t, server, "goexample:browser-inventory:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 5, 2, firstState)
	second := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 5, 2, secondState)
	firstSession, err := first.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("first Start() error = %v", err)
	}
	now = now.Add(time.Millisecond)
	secondSession, err := second.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	if _, err := first.Start(context.Background(), redisBrowserClaims(now)); !errors.Is(err, auth.ErrBrowserSessionSubjectLimit) {
		t.Fatalf("subject-limited Start() error = %v", err)
	}
	otherClaims := redisBrowserClaims(now)
	otherClaims.Subject = "browser-user-2"
	otherSession, err := first.Start(context.Background(), otherClaims)
	if err != nil {
		t.Fatalf("other-subject Start() error = %v", err)
	}
	items, err := second.ListForSubject(context.Background(), "browser-user-1")
	if err != nil {
		t.Fatalf("cross-client ListForSubject() error = %v", err)
	}
	if len(items) != 2 || items[0].SessionID != secondSession.SessionID || items[1].SessionID != firstSession.SessionID {
		t.Fatalf("inventory = %#v", items)
	}
	if err := second.RevokeForSubject(context.Background(), "browser-user-2", firstSession.SessionID); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("cross-subject RevokeForSubject() error = %v", err)
	}
	if _, err := first.Verify(context.Background(), firstSession.SessionToken, "", false); err != nil {
		t.Fatalf("cross-subject revoke changed session: %v", err)
	}
	if err := second.RevokeForSubject(context.Background(), "browser-user-1", firstSession.SessionID); err != nil {
		t.Fatalf("cross-client RevokeForSubject() error = %v", err)
	}
	if _, err := first.Verify(context.Background(), firstSession.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("revoked Verify() error = %v", err)
	}
	deleted, err := first.RevokeAllForSubject(context.Background(), "browser-user-1")
	if err != nil || deleted != 1 {
		t.Fatalf("cross-client RevokeAllForSubject() = %d, %v", deleted, err)
	}
	if _, err := second.Verify(context.Background(), secondSession.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("revoke-all Verify() error = %v", err)
	}
	if _, err := second.Verify(context.Background(), otherSession.SessionToken, "", false); err != nil {
		t.Fatalf("revoke-all changed other subject: %v", err)
	}
	for _, key := range server.Keys() {
		if strings.Contains(key, "browser-user-1") || strings.Contains(key, firstSession.SessionID) ||
			strings.Contains(key, firstSession.SessionToken) || strings.Contains(key, firstSession.CSRFToken) {
			t.Fatalf("raw inventory identifier appeared in Redis key %q", key)
		}
	}
}

func TestRedisBrowserSessionDeviceNameUpdateIsAtomicAndPreservesSession(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:browser-device:")
	secondState := newTestRedis(t, server, "goexample:browser-device:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, firstState)
	second := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, secondState)
	credentials, err := first.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := second.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "Workstation"); err != nil {
		t.Fatalf("cross-client SetDeviceNameForSubject() error = %v", err)
	}
	items, err := first.ListForSubject(context.Background(), "browser-user-1")
	if err != nil || len(items) != 1 || items[0].DeviceName != "Workstation" {
		t.Fatalf("updated inventory = %#v, %v", items, err)
	}
	if err := first.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, ""); err != nil {
		t.Fatalf("clear device name error = %v", err)
	}
	items, err = second.ListForSubject(context.Background(), "browser-user-1")
	if err != nil || len(items) != 1 || items[0].DeviceName != "" {
		t.Fatalf("cleared inventory = %#v, %v", items, err)
	}
	if err := second.SetDeviceNameForSubject(context.Background(), "browser-user-2", credentials.SessionID, "foreign"); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("cross-subject SetDeviceNameForSubject() error = %v", err)
	}
	if err := second.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, strings.Repeat("x", 65)); !errors.Is(err, auth.ErrBrowserSessionDeviceNameInvalid) {
		t.Fatalf("oversized device name error = %v", err)
	}
	server.Close()
	if err := second.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "offline"); err == nil {
		t.Fatal("SetDeviceNameForSubject() succeeded after Redis stopped")
	}
}

func TestRedisBrowserSessionInventoryRejectsTamperAndOutage(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-inventory-failure:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 3, 2, state)
	credentials, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	var payloadKey string
	for _, key := range server.Keys() {
		if strings.Contains(key, "browser-session:token:") {
			payloadKey = key
			break
		}
	}
	if payloadKey == "" {
		t.Fatal("browser session payload key was not created")
	}
	server.Set(payloadKey, `{"claims":{},"csrfHash":"tampered"}`)
	if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("tampered ListForSubject() error = %v", err)
	}
	server.Close()
	if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); err == nil {
		t.Fatal("ListForSubject() succeeded after Redis stopped")
	}
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", credentials.SessionID); err == nil {
		t.Fatal("RevokeForSubject() succeeded after Redis stopped")
	}
	if _, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1"); err == nil {
		t.Fatal("RevokeAllForSubject() succeeded after Redis stopped")
	}
}

func TestRedisBrowserSessionSubjectLimitIsAtomicAcrossClients(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:browser-inventory-atomic:")
	secondState := newTestRedis(t, server, "goexample:browser-inventory-atomic:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 10, 1, firstState)
	second := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 10, 1, secondState)
	start := make(chan struct{})
	errorsByStart := make(chan error, 2)
	var wait sync.WaitGroup
	for _, manager := range []*auth.BrowserSessionManager{first, second} {
		wait.Add(1)
		go func(candidate *auth.BrowserSessionManager) {
			defer wait.Done()
			<-start
			_, err := candidate.Start(context.Background(), redisBrowserClaims(now))
			errorsByStart <- err
		}(manager)
	}
	close(start)
	wait.Wait()
	close(errorsByStart)
	succeeded, limited := 0, 0
	for err := range errorsByStart {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, auth.ErrBrowserSessionSubjectLimit):
			limited++
		default:
			t.Fatalf("concurrent Start() error = %v", err)
		}
	}
	if succeeded != 1 || limited != 1 {
		t.Fatalf("concurrent Start() results = success %d, limited %d", succeeded, limited)
	}
}

func TestRedisBrowserSessionStoreEnforcesLimitExpiryAndOutage(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-session-limit:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManager(t, &now, 1, state)
	first, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, err := manager.Start(context.Background(), redisBrowserClaims(now)); !errors.Is(err, auth.ErrBrowserSessionLimit) {
		t.Fatalf("limited Start() error = %v", err)
	}
	now = now.Add(time.Hour)
	if _, err := manager.Verify(context.Background(), first.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionExpired) {
		t.Fatalf("expired Verify() error = %v", err)
	}
	if _, err := manager.Start(context.Background(), redisBrowserClaims(now)); err != nil {
		t.Fatalf("Start() after expiry error = %v", err)
	}
	server.Close()
	if _, err := manager.Start(context.Background(), redisBrowserClaims(now)); err == nil {
		t.Fatal("Start() succeeded after Redis stopped")
	}
}

func newRedisBrowserSessionManager(t *testing.T, now *time.Time, max int, store auth.BrowserSessionStore) *auth.BrowserSessionManager {
	return newRedisBrowserSessionManagerWithSubjectLimit(t, now, max, 0, store)
}

func newRedisBrowserSessionManagerWithSubjectLimit(t *testing.T, now *time.Time, max, maxPerSubject int, store auth.BrowserSessionStore) *auth.BrowserSessionManager {
	t.Helper()
	manager, err := auth.NewBrowserSessionManager(auth.BrowserSessionConfig{
		TTL: time.Hour, MaxSessions: max, MaxSessionsPerSubject: maxPerSubject, Now: func() time.Time { return *now }, Store: store,
	})
	if err != nil {
		t.Fatalf("NewBrowserSessionManager() error = %v", err)
	}
	return manager
}

func redisBrowserClaims(now time.Time) auth.Claims {
	claims := auth.Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"operator"}, RoleNames: []string{"Operator"},
	}
	claims.Issuer = "https://identity.example"
	claims.Subject = "browser-user-1"
	claims.Audience = []string{"browser-api"}
	claims.ID = "access-token-id"
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.NotBefore = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(now.Add(time.Hour))
	return claims
}
