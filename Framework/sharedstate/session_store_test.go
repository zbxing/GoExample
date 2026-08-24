package sharedstate

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/zbxing/goexample/Framework/auth"
)

func TestRedisSessionStoreRotatesAcrossClientsAndDetectsReuse(t *testing.T) {
	server := miniredis.RunT(t)
	first := newTestRedis(t, server, "goexample:session-store:")
	second := newTestRedis(t, server, "goexample:session-store:")
	defer first.Close()
	defer second.Close()

	config := auth.SessionConfig{RefreshTTL: time.Hour, AbsoluteTTL: 24 * time.Hour, MaxFamilies: 4}
	firstManager, err := auth.NewSessionManager(configWithStore(config, first))
	if err != nil {
		t.Fatalf("first manager: %v", err)
	}
	secondManager, err := auth.NewSessionManager(configWithStore(config, second))
	if err != nil {
		t.Fatalf("second manager: %v", err)
	}
	firstToken, _, err := firstManager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	for _, key := range server.Keys() {
		if strings.Contains(key, firstToken) {
			t.Fatalf("raw refresh token appeared in Redis key %q", key)
		}
		if value, getErr := server.Get(key); getErr == nil && strings.Contains(value, firstToken) {
			t.Fatalf("raw refresh token appeared in Redis value for %q", key)
		}
	}
	rotatedToken, _, err := secondManager.Rotate(firstToken)
	if err != nil {
		t.Fatalf("cross-client Rotate() error = %v", err)
	}
	if _, _, err := firstManager.Rotate(firstToken); !errors.Is(err, auth.ErrSessionReuse) {
		t.Fatalf("replayed Rotate() error = %v", err)
	}
	if _, _, err := secondManager.Rotate(rotatedToken); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("rotated token after reuse error = %v", err)
	}
	if got := firstManager.ActiveFamilies("user-1"); got != 0 {
		t.Fatalf("ActiveFamilies() after reuse = %d", got)
	}
}

func TestRedisSessionStoreCentralUserRevokeAndFamilyLimit(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:session-revoke:")
	defer state.Close()
	config := auth.SessionConfig{RefreshTTL: time.Hour, AbsoluteTTL: 24 * time.Hour, MaxFamilies: 1}
	manager, err := auth.NewSessionManager(configWithStore(config, state))
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	token, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, _, err := manager.Start("user-2"); !errors.Is(err, auth.ErrSessionLimit) {
		t.Fatalf("family limit error = %v", err)
	}
	if count := manager.RevokeUser("user-1"); count != 1 {
		t.Fatalf("RevokeUser() = %d", count)
	}
	if _, _, err := manager.Rotate(token); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked Rotate() error = %v", err)
	}
	if _, _, err := manager.Start("user-2"); !errors.Is(err, auth.ErrSessionLimit) {
		t.Fatalf("revoked family retained limit error = %v", err)
	}
}

func TestRedisSessionStoreFailsClosedWhenBackendStops(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:session-outage:")
	defer state.Close()
	manager, err := auth.NewSessionManager(configWithStore(auth.SessionConfig{
		RefreshTTL: time.Hour, AbsoluteTTL: 24 * time.Hour, MaxFamilies: 2,
	}, state))
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	token, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	server.Close()
	if _, _, err := manager.Rotate(token); err == nil {
		t.Fatal("Rotate() succeeded after Redis stopped")
	}
	if count := manager.RevokeUser("user-1"); count != 0 {
		t.Fatalf("RevokeUser() after outage = %d", count)
	}
	if count := manager.ActiveFamilies("user-1"); count != 0 {
		t.Fatalf("ActiveFamilies() after outage = %d", count)
	}
}

func configWithStore(config auth.SessionConfig, store *Redis) auth.SessionConfig {
	config.Store = store
	config.Now = time.Now
	return config
}
