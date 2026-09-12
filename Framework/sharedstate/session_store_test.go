package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
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

func TestRedisRefreshSessionSingleFamilyRejectsInvalidInputsBeforeRedis(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:session-input-boundary:", provider)
	defer state.Close()

	oldHash := sha256.Sum256([]byte("old-token"))
	newHash := sha256.Sum256([]byte("new-token"))
	now := time.Now().UTC()
	tests := []struct {
		name         string
		ctx          context.Context
		oldHash      [sha256.Size]byte
		newHash      [sha256.Size]byte
		refreshTTL   time.Duration
		historyLimit int
	}{
		{name: "nil context", oldHash: oldHash, newHash: newHash, refreshTTL: time.Hour, historyLimit: 1},
		{name: "same token hashes", ctx: context.Background(), oldHash: oldHash, newHash: oldHash, refreshTTL: time.Hour, historyLimit: 1},
		{name: "sub-millisecond refresh TTL", ctx: context.Background(), oldHash: oldHash, newHash: newHash, refreshTTL: time.Nanosecond, historyLimit: 1},
		{name: "zero history limit", ctx: context.Background(), oldHash: oldHash, newHash: newHash, refreshTTL: time.Hour},
		{name: "excessive history limit", ctx: context.Background(), oldHash: oldHash, newHash: newHash, refreshTTL: time.Hour, historyLimit: maxRefreshSessionHistory + 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			before := len(recorder.Ended())
			if _, err := state.RotateSession(test.ctx, test.oldHash, test.newHash, now, test.refreshTTL, test.historyLimit); err == nil {
				t.Fatal("RotateSession() succeeded")
			}
			if spans := recorder.Ended()[before:]; len(spans) != 0 {
				t.Fatalf("RotateSession() reached Redis: %v", spanNames(spans))
			}
		})
	}

	before := len(recorder.Ended())
	if err := state.RevokeFamily(nil, oldHash, now); err == nil {
		t.Fatal("RevokeFamily() succeeded with nil context")
	}
	if spans := recorder.Ended()[before:]; len(spans) != 0 {
		t.Fatalf("RevokeFamily() reached Redis: %v", spanNames(spans))
	}
	if keys := server.Keys(); len(keys) != 0 {
		t.Fatalf("invalid requests wrote Redis keys: %v", keys)
	}

	before = len(recorder.Ended())
	if _, err := state.RevokeUser(nil, "user-1", now); err == nil {
		t.Fatal("RevokeUser() succeeded with nil context")
	}
	if _, err := state.ActiveFamilies(nil, "user-1", now); err == nil {
		t.Fatal("ActiveFamilies() succeeded with nil context")
	}
	if spans := recorder.Ended()[before:]; len(spans) != 0 {
		t.Fatalf("nil user session contexts reached Redis: %v", spanNames(spans))
	}
}

func TestRedisRefreshSessionSingleFamilyValidatesStateBeforeMutation(t *testing.T) {
	type operation struct {
		name string
		run  func(*Redis, [sha256.Size]byte, time.Time) error
	}
	operations := []operation{
		{
			name: "rotate",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				_, err := state.RotateSession(context.Background(), tokenHash, sha256.Sum256([]byte("next-token")), now, time.Hour, maxRefreshSessionHistory)
				return err
			},
		},
		{
			name: "revoke",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				return state.RevokeFamily(context.Background(), tokenHash, now)
			},
		},
	}
	type tamperCase struct {
		name    string
		prepare func(*testing.T, *Redis, string, time.Time)
	}
	tampers := []tamperCase{
		{
			name: "malformed owner",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "user_hash", strings.Repeat("A", sha256.Size*2)).Err(); err != nil {
					t.Fatalf("tamper owner: %v", err)
				}
			},
		},
		{
			name: "malformed absolute expiry",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "absolute", "not-a-number").Err(); err != nil {
					t.Fatalf("tamper absolute expiry: %v", err)
				}
			},
		},
		{
			name: "malformed current expiry",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "expires", "1.5").Err(); err != nil {
					t.Fatalf("tamper current expiry: %v", err)
				}
			},
		},
		{
			name: "current expiry after absolute expiry",
			prepare: func(t *testing.T, state *Redis, familyID string, now time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "expires", now.Add(25*time.Hour).UnixMilli()).Err(); err != nil {
					t.Fatalf("tamper expiry order: %v", err)
				}
			},
		},
		{
			name: "malformed current token",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "current", strings.Repeat("g", sha256.Size*2)).Err(); err != nil {
					t.Fatalf("tamper current token: %v", err)
				}
			},
		},
		{
			name: "invalid revoked state",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "revoked", "2").Err(); err != nil {
					t.Fatalf("tamper revoked state: %v", err)
				}
			},
		},
		{
			name: "invalid expired state",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "expired", "2").Err(); err != nil {
					t.Fatalf("tamper expired state: %v", err)
				}
			},
		},
		{
			name: "expired but not revoked",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(familyID), "expired", "1").Err(); err != nil {
					t.Fatalf("tamper expired relationship: %v", err)
				}
			},
		},
		{
			name: "missing user index",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				userHash := sha256.Sum256([]byte("user-1"))
				if err := state.client.ZRem(context.Background(), state.sessionUserKey(userHash), familyID).Err(); err != nil {
					t.Fatalf("remove user index: %v", err)
				}
			},
		},
		{
			name: "user index score mismatch",
			prepare: func(t *testing.T, state *Redis, familyID string, now time.Time) {
				t.Helper()
				userHash := sha256.Sum256([]byte("user-1"))
				if err := state.client.ZAdd(context.Background(), state.sessionUserKey(userHash), redis.Z{Score: float64(now.Add(24*time.Hour).UnixMilli() + 1), Member: familyID}).Err(); err != nil {
					t.Fatalf("tamper user index score: %v", err)
				}
			},
		},
		{
			name: "missing global index",
			prepare: func(t *testing.T, state *Redis, familyID string, _ time.Time) {
				t.Helper()
				if err := state.client.ZRem(context.Background(), state.sessionFamiliesKey(), familyID).Err(); err != nil {
					t.Fatalf("remove global index: %v", err)
				}
			},
		},
		{
			name: "global index score mismatch",
			prepare: func(t *testing.T, state *Redis, familyID string, now time.Time) {
				t.Helper()
				if err := state.client.ZAdd(context.Background(), state.sessionFamiliesKey(), redis.Z{Score: float64(now.Add(24*time.Hour).UnixMilli() + 1), Member: familyID}).Err(); err != nil {
					t.Fatalf("tamper global index score: %v", err)
				}
			},
		},
	}

	for _, operation := range operations {
		for _, tamper := range tampers {
			t.Run(operation.name+"/"+tamper.name, func(t *testing.T) {
				server := miniredis.RunT(t)
				state := newTestRedis(t, server, "goexample:session-family-state:")
				defer state.Close()
				now := time.Now().UTC().Truncate(time.Millisecond)
				familyID := strings.Repeat("a", refreshSessionFamilyIDLength)
				tokenHash := sha256.Sum256([]byte("current-token"))
				createRedisRefreshSessionFamily(t, state, "user-1", familyID, "current-token", now)
				tamper.prepare(t, state, familyID, now)

				before, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
				if err != nil {
					t.Fatalf("read family before operation: %v", err)
				}
				if err := operation.run(state, tokenHash, now); !errors.Is(err, auth.ErrSessionInvalid) {
					t.Fatalf("operation error = %v", err)
				}
				after, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
				if err != nil {
					t.Fatalf("read family after operation: %v", err)
				}
				if !reflect.DeepEqual(after, before) {
					t.Fatalf("family changed after rejected operation: before=%v after=%v", before, after)
				}
			})
		}
	}
}

func TestRedisRefreshSessionSingleFamilyValidatesBidirectionalTokenMappings(t *testing.T) {
	type operation struct {
		name string
		run  func(*Redis, [sha256.Size]byte, time.Time) error
	}
	operations := []operation{
		{
			name: "rotate",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				_, err := state.RotateSession(context.Background(), tokenHash, sha256.Sum256([]byte("third-token")), now, time.Hour, maxRefreshSessionHistory)
				return err
			},
		},
		{
			name: "revoke",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				return state.RevokeFamily(context.Background(), tokenHash, now)
			},
		},
	}
	type tamperCase struct {
		name    string
		prepare func(*testing.T, *Redis, string, [sha256.Size]byte, [sha256.Size]byte) [sha256.Size]byte
	}
	tampers := []tamperCase{
		{
			name: "missing current reverse mapping",
			prepare: func(t *testing.T, state *Redis, _ string, originalHash, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.Del(context.Background(), state.sessionTokenKey(hex.EncodeToString(currentHash[:]))).Err(); err != nil {
					t.Fatalf("remove current mapping: %v", err)
				}
				return originalHash
			},
		},
		{
			name: "wrong current reverse mapping",
			prepare: func(t *testing.T, state *Redis, _ string, originalHash, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.Set(context.Background(), state.sessionTokenKey(hex.EncodeToString(currentHash[:])), strings.Repeat("b", refreshSessionFamilyIDLength), time.Hour).Err(); err != nil {
					t.Fatalf("tamper current mapping: %v", err)
				}
				return originalHash
			},
		},
		{
			name: "malformed used token",
			prepare: func(t *testing.T, state *Redis, familyID string, _ [sha256.Size]byte, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.SAdd(context.Background(), state.sessionUsedKey(familyID), "not-a-token-hash").Err(); err != nil {
					t.Fatalf("add malformed used token: %v", err)
				}
				return currentHash
			},
		},
		{
			name: "missing used reverse mapping",
			prepare: func(t *testing.T, state *Redis, _ string, originalHash, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.Del(context.Background(), state.sessionTokenKey(hex.EncodeToString(originalHash[:]))).Err(); err != nil {
					t.Fatalf("remove used mapping: %v", err)
				}
				return currentHash
			},
		},
		{
			name: "wrong used reverse mapping",
			prepare: func(t *testing.T, state *Redis, _ string, originalHash, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.Set(context.Background(), state.sessionTokenKey(hex.EncodeToString(originalHash[:])), strings.Repeat("b", refreshSessionFamilyIDLength), time.Hour).Err(); err != nil {
					t.Fatalf("tamper used mapping: %v", err)
				}
				return currentHash
			},
		},
		{
			name: "current token also marked used",
			prepare: func(t *testing.T, state *Redis, familyID string, _ [sha256.Size]byte, currentHash [sha256.Size]byte) [sha256.Size]byte {
				t.Helper()
				if err := state.client.SAdd(context.Background(), state.sessionUsedKey(familyID), hex.EncodeToString(currentHash[:])).Err(); err != nil {
					t.Fatalf("duplicate current token in history: %v", err)
				}
				return currentHash
			},
		},
	}

	for _, operation := range operations {
		for _, tamper := range tampers {
			t.Run(operation.name+"/"+tamper.name, func(t *testing.T) {
				server := miniredis.RunT(t)
				state := newTestRedis(t, server, "goexample:session-token-index:")
				defer state.Close()
				now := time.Now().UTC().Truncate(time.Millisecond)
				familyID := strings.Repeat("a", refreshSessionFamilyIDLength)
				originalHash := sha256.Sum256([]byte("original-token"))
				currentHash := sha256.Sum256([]byte("current-token"))
				createRedisRefreshSessionFamily(t, state, "user-1", familyID, "original-token", now)
				if _, err := state.RotateSession(context.Background(), originalHash, currentHash, now, time.Hour, maxRefreshSessionHistory); err != nil {
					t.Fatalf("prepare rotation: %v", err)
				}
				invokeHash := tamper.prepare(t, state, familyID, originalHash, currentHash)
				before, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
				if err != nil {
					t.Fatalf("read family before operation: %v", err)
				}

				if err := operation.run(state, invokeHash, now); !errors.Is(err, auth.ErrSessionInvalid) {
					t.Fatalf("operation error = %v", err)
				}
				after, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
				if err != nil {
					t.Fatalf("read family after operation: %v", err)
				}
				if !reflect.DeepEqual(after, before) {
					t.Fatalf("family changed after rejected operation: before=%v after=%v", before, after)
				}
			})
		}
	}
}

func TestRedisRefreshSessionForgedMappingCannotRevokeValidFamily(t *testing.T) {
	operations := []struct {
		name string
		run  func(*Redis, [sha256.Size]byte, time.Time) error
	}{
		{
			name: "rotate",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				_, err := state.RotateSession(context.Background(), tokenHash, sha256.Sum256([]byte("next-token")), now, time.Hour, maxRefreshSessionHistory)
				return err
			},
		},
		{
			name: "revoke",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				return state.RevokeFamily(context.Background(), tokenHash, now)
			},
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:session-forged-mapping:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			familyID := strings.Repeat("a", refreshSessionFamilyIDLength)
			forgedHash := sha256.Sum256([]byte("forged-token"))
			createRedisRefreshSessionFamily(t, state, "user-1", familyID, "current-token", now)
			if err := state.client.Set(context.Background(), state.sessionTokenKey(hex.EncodeToString(forgedHash[:])), familyID, time.Hour).Err(); err != nil {
				t.Fatalf("seed forged mapping: %v", err)
			}

			if err := operation.run(state, forgedHash, now); !errors.Is(err, auth.ErrSessionInvalid) {
				t.Fatalf("operation error = %v", err)
			}
			if revoked, err := state.client.HGet(context.Background(), state.sessionFamilyKey(familyID), "revoked").Result(); err != nil || revoked != "0" {
				t.Fatalf("valid family revoked by forged mapping = %q, %v", revoked, err)
			}
		})
	}
}

func TestRedisRefreshSessionRotationRejectsMappedNewTokenBeforeMutation(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:session-new-token-collision:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	firstFamilyID := strings.Repeat("a", refreshSessionFamilyIDLength)
	secondFamilyID := strings.Repeat("b", refreshSessionFamilyIDLength)
	firstHash := sha256.Sum256([]byte("first-token"))
	secondHash := sha256.Sum256([]byte("second-token"))
	createRedisRefreshSessionFamily(t, state, "user-1", firstFamilyID, "first-token", now)
	createRedisRefreshSessionFamily(t, state, "user-2", secondFamilyID, "second-token", now)
	before, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(firstFamilyID)).Result()
	if err != nil {
		t.Fatalf("read first family before rotation: %v", err)
	}

	if _, err := state.RotateSession(context.Background(), firstHash, secondHash, now, time.Hour, maxRefreshSessionHistory); !errors.Is(err, auth.ErrSessionInvalid) {
		t.Fatalf("RotateSession() collision error = %v", err)
	}
	after, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(firstFamilyID)).Result()
	if err != nil {
		t.Fatalf("read first family after rotation: %v", err)
	}
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("first family changed after collision: before=%v after=%v", before, after)
	}
	if mappedFamily, err := state.client.Get(context.Background(), state.sessionTokenKey(hex.EncodeToString(secondHash[:]))).Result(); err != nil || mappedFamily != secondFamilyID {
		t.Fatalf("second token mapping after collision = %q, %v", mappedFamily, err)
	}
}

func TestRedisRefreshSessionSingleFamilyRejectsOversizedUsedIndexBeforeMutation(t *testing.T) {
	operations := []struct {
		name string
		run  func(*Redis, [sha256.Size]byte, time.Time) error
	}{
		{
			name: "rotate",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				_, err := state.RotateSession(context.Background(), tokenHash, sha256.Sum256([]byte("next-token")), now, time.Hour, maxRefreshSessionHistory)
				return err
			},
		},
		{
			name: "revoke",
			run: func(state *Redis, tokenHash [sha256.Size]byte, now time.Time) error {
				return state.RevokeFamily(context.Background(), tokenHash, now)
			},
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:session-history-bound:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			familyID := strings.Repeat("a", refreshSessionFamilyIDLength)
			currentHash := sha256.Sum256([]byte("current-token"))
			createRedisRefreshSessionFamily(t, state, "user-1", familyID, "current-token", now)
			members := make([]interface{}, maxRefreshSessionHistory+1)
			for index := range members {
				members[index] = fmt.Sprintf("%064x", index+1)
			}
			if err := state.client.SAdd(context.Background(), state.sessionUsedKey(familyID), members...).Err(); err != nil {
				t.Fatalf("seed oversized used index: %v", err)
			}

			before, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
			if err != nil {
				t.Fatalf("read family before operation: %v", err)
			}
			if err := operation.run(state, currentHash, now); !errors.Is(err, auth.ErrSessionInvalid) {
				t.Fatalf("operation error = %v", err)
			}
			after, err := state.client.HGetAll(context.Background(), state.sessionFamilyKey(familyID)).Result()
			if err != nil {
				t.Fatalf("read family after operation: %v", err)
			}
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("family changed after oversized history rejection: before=%v after=%v", before, after)
			}
			if size, err := state.client.SCard(context.Background(), state.sessionUsedKey(familyID)).Result(); err != nil || size != maxRefreshSessionHistory+1 {
				t.Fatalf("used index size after rejection = %d, %v", size, err)
			}
		})
	}
}

func TestRedisRefreshSessionUserScriptsUseOneBoundedAtomicCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:session-user-script-atomic:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	createRedisRefreshSessionFamily(t, state, "warm-user", strings.Repeat("a", refreshSessionFamilyIDLength), "warm-token", now)
	createRedisRefreshSessionFamily(t, state, "user-1", strings.Repeat("b", refreshSessionFamilyIDLength), "measured-token", now)

	if count, err := state.ActiveFamilies(context.Background(), "warm-user", now); err != nil || count != 1 {
		t.Fatalf("warm ActiveFamilies() = %d, %v", count, err)
	}
	before := len(recorder.Ended())
	if count, err := state.ActiveFamilies(context.Background(), "user-1", now); err != nil || count != 1 {
		t.Fatalf("measured ActiveFamilies() = %d, %v", count, err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("active-family Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}

	if count, err := state.RevokeUser(context.Background(), "warm-user", now); err != nil || count != 1 {
		t.Fatalf("warm RevokeUser() = %d, %v", count, err)
	}
	before = len(recorder.Ended())
	if count, err := state.RevokeUser(context.Background(), "user-1", now); err != nil || count != 1 {
		t.Fatalf("measured RevokeUser() = %d, %v", count, err)
	}
	spans = recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("user revoke Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisRefreshSessionCreateRejectsInvalidFamilyBoundaryBeforeRedis(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:session-create-boundary:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	validFamilyID := strings.Repeat("a", refreshSessionFamilyIDLength)
	tests := []struct {
		name        string
		familyID    string
		maxFamilies int
	}{
		{name: "short family ID", familyID: validFamilyID[:len(validFamilyID)-1], maxFamilies: 1},
		{name: "uppercase family ID", familyID: strings.ToUpper(validFamilyID), maxFamilies: 1},
		{name: "non-hex family ID", familyID: strings.Repeat("g", refreshSessionFamilyIDLength), maxFamilies: 1},
		{name: "excessive maximum", familyID: validFamilyID, maxFamilies: maxRefreshSessionFamilyInventory + 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			before := len(recorder.Ended())
			err := state.CreateSession(
				context.Background(),
				"user-1",
				test.familyID,
				sha256.Sum256([]byte(test.name)),
				now,
				now.Add(24*time.Hour),
				now.Add(time.Hour),
				test.maxFamilies,
			)
			if err == nil {
				t.Fatal("CreateSession() succeeded")
			}
			if spans := recorder.Ended()[before:]; len(spans) != 0 {
				t.Fatalf("CreateSession() reached Redis: %v", spanNames(spans))
			}
		})
	}
	if keys := server.Keys(); len(keys) != 0 {
		t.Fatalf("invalid creates wrote Redis keys: %v", keys)
	}
}

func TestRedisRefreshSessionUserScriptsValidateAllFamiliesBeforeMutation(t *testing.T) {
	type operation struct {
		name string
		run  func(*Redis, time.Time) (int, error)
	}
	operations := []operation{
		{
			name: "revoke user",
			run: func(state *Redis, now time.Time) (int, error) {
				return state.RevokeUser(context.Background(), "user-1", now)
			},
		},
		{
			name: "count active families",
			run: func(state *Redis, now time.Time) (int, error) {
				return state.ActiveFamilies(context.Background(), "user-1", now)
			},
		},
	}
	type tamperCase struct {
		name               string
		prepare            func(*testing.T, *Redis, time.Time, string)
		wantGlobalFamilies int64
	}
	tampers := []tamperCase{
		{
			name: "malformed family ID",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				userHash := sha256.Sum256([]byte("user-1"))
				if err := state.client.ZAdd(context.Background(), state.sessionUserKey(userHash), redis.Z{
					Score:  float64(now.Add(24 * time.Hour).UnixMilli()),
					Member: strings.Repeat("g", refreshSessionFamilyIDLength),
				}).Err(); err != nil {
					t.Fatalf("seed malformed family ID: %v", err)
				}
			},
			wantGlobalFamilies: 1,
		},
		{
			name: "cross-user owner",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-2", secondFamilyID, "second-token", now)
				userHash := sha256.Sum256([]byte("user-1"))
				if err := state.client.ZAdd(context.Background(), state.sessionUserKey(userHash), redis.Z{
					Score:  float64(now.Add(24 * time.Hour).UnixMilli()),
					Member: secondFamilyID,
				}).Err(); err != nil {
					t.Fatalf("seed cross-user family: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
		{
			name: "missing active global member",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				if err := state.client.ZRem(context.Background(), state.sessionFamiliesKey(), secondFamilyID).Err(); err != nil {
					t.Fatalf("remove active global member: %v", err)
				}
			},
			wantGlobalFamilies: 1,
		},
		{
			name: "malformed expiry",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(secondFamilyID), "expires", "not-a-number").Err(); err != nil {
					t.Fatalf("tamper family expiry: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
		{
			name: "malformed absolute expiry",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(secondFamilyID), "absolute", "not-a-number").Err(); err != nil {
					t.Fatalf("tamper family absolute expiry: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
		{
			name: "invalid revoked state",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				if err := state.client.HSet(context.Background(), state.sessionFamilyKey(secondFamilyID), "revoked", "2").Err(); err != nil {
					t.Fatalf("tamper family revoked state: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
		{
			name: "user index score mismatch",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				userHash := sha256.Sum256([]byte("user-1"))
				if err := state.client.ZAdd(context.Background(), state.sessionUserKey(userHash), redis.Z{
					Score:  float64(now.Add(24*time.Hour).UnixMilli() + 1),
					Member: secondFamilyID,
				}).Err(); err != nil {
					t.Fatalf("tamper user index score: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
		{
			name: "global index score mismatch",
			prepare: func(t *testing.T, state *Redis, now time.Time, secondFamilyID string) {
				t.Helper()
				createRedisRefreshSessionFamily(t, state, "user-1", secondFamilyID, "second-token", now)
				if err := state.client.ZAdd(context.Background(), state.sessionFamiliesKey(), redis.Z{
					Score:  float64(now.Add(24*time.Hour).UnixMilli() + 1),
					Member: secondFamilyID,
				}).Err(); err != nil {
					t.Fatalf("tamper global index score: %v", err)
				}
			},
			wantGlobalFamilies: 2,
		},
	}
	for _, operation := range operations {
		for _, tamper := range tampers {
			t.Run(operation.name+"/"+tamper.name, func(t *testing.T) {
				server := miniredis.RunT(t)
				state := newTestRedis(t, server, "goexample:session-user-script-validation:")
				defer state.Close()
				now := time.Now().UTC().Truncate(time.Millisecond)
				firstFamilyID := strings.Repeat("1", refreshSessionFamilyIDLength)
				secondFamilyID := strings.Repeat("2", refreshSessionFamilyIDLength)
				createRedisRefreshSessionFamily(t, state, "user-1", firstFamilyID, "first-token", now)
				tamper.prepare(t, state, now, secondFamilyID)

				if count, err := operation.run(state, now); count != 0 || !errors.Is(err, auth.ErrSessionInvalid) {
					t.Fatalf("operation = %d, %v", count, err)
				}
				if revoked, err := state.client.HGet(context.Background(), state.sessionFamilyKey(firstFamilyID), "revoked").Result(); err != nil || revoked != "0" {
					t.Fatalf("first family revoked after rejected operation = %q, %v", revoked, err)
				}
				userHash := sha256.Sum256([]byte("user-1"))
				if size, err := state.client.ZCard(context.Background(), state.sessionUserKey(userHash)).Result(); err != nil || size != 2 {
					t.Fatalf("user index size after rejected operation = %d, %v", size, err)
				}
				if size, err := state.client.ZCard(context.Background(), state.sessionFamiliesKey()).Result(); err != nil || size != tamper.wantGlobalFamilies {
					t.Fatalf("global index size after rejected operation = %d, %v", size, err)
				}
			})
		}
	}
}

func TestRedisRefreshSessionUserScriptsRejectOversizedIndexBeforeCleanup(t *testing.T) {
	operations := []struct {
		name string
		run  func(*Redis, time.Time) (int, error)
	}{
		{
			name: "revoke user",
			run: func(state *Redis, now time.Time) (int, error) {
				return state.RevokeUser(context.Background(), "user-1", now)
			},
		},
		{
			name: "count active families",
			run: func(state *Redis, now time.Time) (int, error) {
				return state.ActiveFamilies(context.Background(), "user-1", now)
			},
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:session-user-script-bound:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			userHash := sha256.Sum256([]byte("user-1"))
			indexKey := state.sessionUserKey(userHash)
			members := make([]redis.Z, maxRefreshSessionFamilyInventory+1)
			for index := range members {
				members[index] = redis.Z{
					Score:  float64(now.Add(-time.Hour).UnixMilli()),
					Member: fmt.Sprintf("%032x", index+1),
				}
			}
			if err := state.client.ZAdd(context.Background(), indexKey, members...).Err(); err != nil {
				t.Fatalf("seed oversized refresh-family index: %v", err)
			}

			if count, err := operation.run(state, now); count != 0 || !errors.Is(err, auth.ErrSessionInvalid) {
				t.Fatalf("operation = %d, %v", count, err)
			}
			if size, err := state.client.ZCard(context.Background(), indexKey).Result(); err != nil || size != maxRefreshSessionFamilyInventory+1 {
				t.Fatalf("oversized user index size after rejection = %d, %v", size, err)
			}
		})
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

func createRedisRefreshSessionFamily(t *testing.T, state *Redis, userID, familyID, tokenSeed string, now time.Time) {
	t.Helper()
	if err := state.CreateSession(
		context.Background(),
		userID,
		familyID,
		sha256.Sum256([]byte(tokenSeed)),
		now,
		now.Add(24*time.Hour),
		now.Add(time.Hour),
		maxRefreshSessionFamilyInventory,
	); err != nil {
		t.Fatalf("CreateSession(%q, %q): %v", userID, familyID, err)
	}
}
