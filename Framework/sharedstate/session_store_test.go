package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/zbxing/goexample/Framework/auth"
)

func TestRedisRefreshSessionRotationUsesOneAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:session-rotation-snapshot:", provider)
	defer state.Close()

	config := auth.SessionConfig{RefreshTTL: time.Hour, AbsoluteTTL: 24 * time.Hour, MaxFamilies: 4}
	manager, err := auth.NewSessionManager(configWithStore(config, state))
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	token, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	// The first rotation loads the script; measure only the warm EVALSHA path.
	rotated, _, err := manager.Rotate(token)
	if err != nil {
		t.Fatalf("warm Rotate() error = %v", err)
	}
	before := len(recorder.Ended())
	if _, _, err := manager.Rotate(rotated); err != nil {
		t.Fatalf("measured Rotate() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("refresh rotation Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisRefreshSessionRevokeUsesOneAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:session-revoke-snapshot:", provider)
	defer state.Close()

	config := auth.SessionConfig{RefreshTTL: time.Hour, AbsoluteTTL: 24 * time.Hour, MaxFamilies: 4}
	manager, err := auth.NewSessionManager(configWithStore(config, state))
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	token, _, err := manager.Start("user-1")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := manager.RevokeFamily(token); err != nil {
		t.Fatalf("warm RevokeFamily() error = %v", err)
	}
	// A second revoke is still handled by the same atomic script and must not
	// perform a separate token lookup before the script runs.
	before := len(recorder.Ended())
	if err := manager.RevokeFamily(token); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("measured RevokeFamily() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("refresh revoke Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisRefreshSessionRejectsMalformedFamilyMapping(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:session-malformed-family:")
	defer state.Close()

	tokenHash := sha256.Sum256([]byte("synthetic-refresh-token"))
	ctx := context.Background()
	operationCtx, cancel := state.operationContext(ctx)
	defer cancel()
	if err := state.client.Set(operationCtx, state.sessionTokenKey(hex.EncodeToString(tokenHash[:])), "not-a-family-id", time.Minute).Err(); err != nil {
		t.Fatalf("seed malformed family mapping: %v", err)
	}
	now := time.Now().UTC()
	if _, err := state.RotateSession(ctx, tokenHash, sha256.Sum256([]byte("next")), now, time.Hour, 4); !errors.Is(err, auth.ErrSessionInvalid) {
		t.Fatalf("RotateSession() malformed mapping error = %v", err)
	}
	if err := state.RevokeFamily(ctx, tokenHash, now); !errors.Is(err, auth.ErrSessionInvalid) {
		t.Fatalf("RevokeFamily() malformed mapping error = %v", err)
	}
}

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
