package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/zbxing/goexample/Framework/auth"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
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

func TestRedisBrowserSessionInventoryUsesOneAtomicSnapshotCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-inventory-snapshot:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)
	for range 3 {
		if _, err := manager.Start(context.Background(), redisBrowserClaims(now)); err != nil {
			t.Fatalf("Start() error = %v", err)
		}
		now = now.Add(time.Millisecond)
	}
	// Prime the script cache so the measured call is one EVALSHA span rather
	// than the initial EVALSHA/NOSCRIPT plus EVAL fallback pair.
	if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); err != nil {
		t.Fatalf("warm ListForSubject() error = %v", err)
	}
	before := len(recorder.Ended())
	items, err := manager.ListForSubject(context.Background(), "browser-user-1")
	if err != nil {
		t.Fatalf("ListForSubject() error = %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("inventory length = %d, want 3", len(items))
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("inventory Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisBrowserSessionInventoryRejectsOversizedIndexBeforeCleanup(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-inventory-bound:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	subjectHash := sha256.Sum256([]byte("browser-user-1"))
	subjectHex := hex.EncodeToString(subjectHash[:])
	indexKey := state.browserSubjectSessionsKey(subjectHex)
	members := make([]redis.Z, maxBrowserSessionInventory+1)
	for index := range members {
		members[index] = redis.Z{Score: float64(now.Add(-time.Hour).UnixMilli()), Member: fmt.Sprintf("%064x", index+1)}
	}
	if err := state.client.ZAdd(context.Background(), indexKey, members...).Err(); err != nil {
		t.Fatalf("seed oversized browser-session inventory: %v", err)
	}
	if _, err := state.ListBrowserSessions(context.Background(), subjectHash, now, 1); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("oversized ListBrowserSessions() error = %v", err)
	}
	if size, err := state.client.ZCard(context.Background(), indexKey).Result(); err != nil || size != maxBrowserSessionInventory+1 {
		t.Fatalf("oversized inventory size after rejection = %d, %v", size, err)
	}
}

func TestRedisBrowserSessionInventoryValidatesMappingsIndexesTTLAndPayload(t *testing.T) {
	tests := []struct {
		name   string
		tamper func(*testing.T, *Redis, auth.BrowserSessionCredentials, string, string, string)
	}{
		{
			name: "missing global index",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.ZRem(context.Background(), state.browserSessionsKey(), tokenHex).Err())
			},
		},
		{
			name: "mismatched global score",
			tamper: func(t *testing.T, state *Redis, credentials auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.ZAdd(context.Background(), state.browserSessionsKey(), redis.Z{
					Score: float64(credentials.ExpiresAt.Add(time.Second).UnixMilli()), Member: tokenHex,
				}).Err())
			},
		},
		{
			name: "fractional subject score",
			tamper: func(t *testing.T, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.ZAdd(context.Background(), state.browserSubjectSessionsKey(subjectHex), redis.Z{
					Score: float64(credentials.ExpiresAt.UnixMilli()) + 0.5, Member: tokenHex,
				}).Err())
			},
		},
		{
			name: "missing metadata",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.Del(context.Background(), state.browserSessionMetadataKey(tokenHex)).Err())
			},
		},
		{
			name: "missing public ID mapping",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, _, sessionIDHex string) {
				requireRedisBrowserMutation(t, state.client.Del(context.Background(), state.browserSessionIDKey(sessionIDHex)).Err())
			},
		},
		{
			name: "mismatched metadata",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, subjectHex, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.SetArgs(context.Background(), state.browserSessionMetadataKey(tokenHex), subjectHex+":"+strings.Repeat("f", sha256.Size*2), redis.SetArgs{KeepTTL: true}).Err())
			},
		},
		{
			name: "mismatched public ID mapping",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, subjectHex, _, sessionIDHex string) {
				requireRedisBrowserMutation(t, state.client.SetArgs(context.Background(), state.browserSessionIDKey(sessionIDHex), subjectHex+":"+strings.Repeat("f", sha256.Size*2), redis.SetArgs{KeepTTL: true}).Err())
			},
		},
		{
			name: "persistent payload",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.Persist(context.Background(), state.browserSessionKey(tokenHex)).Err())
			},
		},
		{
			name: "persistent metadata",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				requireRedisBrowserMutation(t, state.client.Persist(context.Background(), state.browserSessionMetadataKey(tokenHex)).Err())
			},
		},
		{
			name: "persistent public ID mapping",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, _, sessionIDHex string) {
				requireRedisBrowserMutation(t, state.client.Persist(context.Background(), state.browserSessionIDKey(sessionIDHex)).Err())
			},
		},
		{
			name: "unknown payload field",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				key := state.browserSessionKey(tokenHex)
				raw, err := state.client.Get(context.Background(), key).Result()
				requireRedisBrowserMutation(t, err)
				requireRedisBrowserMutation(t, state.client.SetArgs(context.Background(), key, strings.TrimSuffix(raw, "}")+`,"unexpected":true}`, redis.SetArgs{KeepTTL: true}).Err())
			},
		},
		{
			name: "trailing payload JSON",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				key := state.browserSessionKey(tokenHex)
				raw, err := state.client.Get(context.Background(), key).Result()
				requireRedisBrowserMutation(t, err)
				requireRedisBrowserMutation(t, state.client.SetArgs(context.Background(), key, raw+` {}`, redis.SetArgs{KeepTTL: true}).Err())
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-inventory-integrity:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, state)
			target, err := manager.Start(context.Background(), redisBrowserClaims(now))
			if err != nil {
				t.Fatalf("target Start() error = %v", err)
			}
			otherClaims := redisBrowserClaims(now)
			otherClaims.Subject = "browser-user-2"
			other, err := manager.Start(context.Background(), otherClaims)
			if err != nil {
				t.Fatalf("other Start() error = %v", err)
			}
			subjectHash := sha256.Sum256([]byte("browser-user-1"))
			tokenHash := sha256.Sum256([]byte(target.SessionToken))
			sessionIDHash := sha256.Sum256([]byte(target.SessionID))
			subjectHex := hex.EncodeToString(subjectHash[:])
			tokenHex := hex.EncodeToString(tokenHash[:])
			sessionIDHex := hex.EncodeToString(sessionIDHash[:])
			test.tamper(t, state, target, subjectHex, tokenHex, sessionIDHex)

			if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("tampered ListForSubject() error = %v", err)
			}
			if _, err := manager.Verify(context.Background(), other.SessionToken, "", false); err != nil {
				t.Fatalf("tampered inventory changed other subject: %v", err)
			}
		})
	}
}

func TestRedisBrowserSessionCreateAndReadUseOneAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-create-read:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, state)

	warm, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("warm Start() error = %v", err)
	}
	if _, err := manager.Verify(context.Background(), warm.SessionToken, "", false); err != nil {
		t.Fatalf("warm Verify() error = %v", err)
	}

	before := len(recorder.Ended())
	credentials, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("measured Start() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("browser create Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}

	before = len(recorder.Ended())
	if _, err := manager.Verify(context.Background(), credentials.SessionToken, "", false); err != nil {
		t.Fatalf("measured Verify() error = %v", err)
	}
	spans = recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("browser read Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisBrowserSessionExpiredReadDoesNotDetachCanceledCleanup(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-expired-context:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 2, 2, state)
	credentials, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	tokenHash := sha256.Sum256([]byte(credentials.SessionToken))
	if _, err := state.ReadBrowserSession(context.Background(), tokenHash, now); err != nil {
		t.Fatalf("warm ReadBrowserSession() error = %v", err)
	}
	readContext := &lateCancelContext{Context: context.Background()}
	state.client.AddHook(&afterFirstEvalSHAHook{after: func() { readContext.canceled.Store(true) }})
	before := len(recorder.Ended())
	if _, err := state.ReadBrowserSession(readContext, tokenHash, now.Add(time.Hour)); !errors.Is(err, auth.ErrBrowserSessionExpired) {
		t.Fatalf("expired ReadBrowserSession() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("expired canceled cleanup Redis spans = %v, want one read span", spanNames(spans))
	}
	if exists, err := state.client.Exists(context.Background(), state.browserSessionKey(hex.EncodeToString(tokenHash[:]))).Result(); err != nil || exists != 1 {
		t.Fatalf("expired session cleanup state = %d, %v; canceled caller must not detach cleanup", exists, err)
	}
}

func TestRedisBrowserSessionCreateAndReadRejectInvalidInputsBeforeRedis(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-invalid-input:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	record := newRedisBrowserSessionRecord(now)
	tokenHash := sha256.Sum256([]byte("browser-token"))
	subjectHash := record.SubjectHash
	sessionIDHash := sha256.Sum256([]byte(record.SessionID))
	subMillisecond := record
	subMillisecond.ExpiresAt = now.Add(500 * time.Microsecond)
	zeroCSRF := record
	zeroCSRF.CSRFHash = [sha256.Size]byte{}

	calls := []struct {
		name string
		run  func() error
	}{
		{name: "nil create context", run: func() error { return state.CreateBrowserSessionWithInventory(nil, tokenHash, record, now, 2, 1) }},
		{name: "zero create hash", run: func() error {
			return state.CreateBrowserSessionWithInventory(context.Background(), [sha256.Size]byte{}, record, now, 2, 1)
		}},
		{name: "zero CSRF hash", run: func() error {
			return state.CreateBrowserSessionWithInventory(context.Background(), tokenHash, zeroCSRF, now, 2, 1)
		}},
		{name: "oversized global maximum", run: func() error {
			return state.CreateBrowserSessionWithInventory(context.Background(), tokenHash, record, now, maxBrowserSessionInventory+1, 1)
		}},
		{name: "sub-millisecond lifetime", run: func() error {
			return state.CreateBrowserSessionWithInventory(context.Background(), tokenHash, subMillisecond, now, 2, 1)
		}},
		{name: "nil read context", run: func() error { _, err := state.ReadBrowserSession(nil, tokenHash, now); return err }},
		{name: "zero read hash", run: func() error {
			_, err := state.ReadBrowserSession(context.Background(), [sha256.Size]byte{}, now)
			return err
		}},
		{name: "non-positive read time", run: func() error {
			_, err := state.ReadBrowserSession(context.Background(), tokenHash, time.UnixMilli(0))
			return err
		}},
		{name: "nil inventory context", run: func() error {
			_, err := state.ListBrowserSessions(nil, subjectHash, now, 1)
			return err
		}},
		{name: "zero inventory subject hash", run: func() error {
			_, err := state.ListBrowserSessions(context.Background(), [sha256.Size]byte{}, now, 1)
			return err
		}},
		{name: "non-positive inventory time", run: func() error {
			_, err := state.ListBrowserSessions(context.Background(), subjectHash, time.UnixMilli(0), 1)
			return err
		}},
		{name: "oversized inventory limit", run: func() error {
			_, err := state.ListBrowserSessions(context.Background(), subjectHash, now, maxBrowserSessionInventory+1)
			return err
		}},
		{name: "nil device update context", run: func() error {
			return state.UpdateBrowserSessionDeviceName(nil, subjectHash, sessionIDHash, "workstation", now)
		}},
		{name: "zero device update subject hash", run: func() error {
			return state.UpdateBrowserSessionDeviceName(context.Background(), [sha256.Size]byte{}, sessionIDHash, "workstation", now)
		}},
		{name: "zero device update session ID hash", run: func() error {
			return state.UpdateBrowserSessionDeviceName(context.Background(), subjectHash, [sha256.Size]byte{}, "workstation", now)
		}},
		{name: "non-positive device update time", run: func() error {
			return state.UpdateBrowserSessionDeviceName(context.Background(), subjectHash, sessionIDHash, "workstation", time.UnixMilli(0))
		}},
		{name: "invalid device update name", run: func() error {
			return state.UpdateBrowserSessionDeviceName(context.Background(), subjectHash, sessionIDHash, " workstation", now)
		}},
	}
	before := len(recorder.Ended())
	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			if err := call.run(); err == nil {
				t.Fatal("invalid browser-session request succeeded")
			}
		})
	}
	if spans := recorder.Ended()[before:]; len(spans) != 0 {
		t.Fatalf("invalid browser-session requests emitted Redis spans = %v", spanNames(spans))
	}
}

func TestRedisBrowserSessionCreateRejectsOversizedOrOrphanedIndexes(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	record := newRedisBrowserSessionRecord(now)
	tokenHash := sha256.Sum256([]byte("browser-token"))
	tokenHex := hex.EncodeToString(tokenHash[:])
	subjectHex := hex.EncodeToString(record.SubjectHash[:])

	for _, index := range []struct {
		name string
		key  func(*Redis) string
	}{
		{name: "global", key: func(state *Redis) string { return state.browserSessionsKey() }},
		{name: "subject", key: func(state *Redis) string { return state.browserSubjectSessionsKey(subjectHex) }},
	} {
		t.Run("oversized "+index.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-create-oversized:")
			defer state.Close()
			members := make([]redis.Z, maxBrowserSessionInventory+1)
			for memberIndex := range members {
				members[memberIndex] = redis.Z{Score: float64(now.Add(-time.Hour).UnixMilli()), Member: fmt.Sprintf("%064x", memberIndex+1)}
			}
			key := index.key(state)
			if err := state.client.ZAdd(context.Background(), key, members...).Err(); err != nil {
				t.Fatalf("seed oversized %s index: %v", index.name, err)
			}
			if err := state.CreateBrowserSessionWithInventory(context.Background(), tokenHash, record, now, 1, 1); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("oversized %s create error = %v", index.name, err)
			}
			if size, err := state.client.ZCard(context.Background(), key).Result(); err != nil || size != maxBrowserSessionInventory+1 {
				t.Fatalf("oversized %s index size after rejection = %d, %v", index.name, size, err)
			}
		})

		t.Run("orphaned "+index.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-create-orphan:")
			defer state.Close()
			key := index.key(state)
			if err := state.client.ZAdd(context.Background(), key, redis.Z{Score: float64(record.ExpiresAt.UnixMilli()), Member: tokenHex}).Err(); err != nil {
				t.Fatalf("seed orphaned %s member: %v", index.name, err)
			}
			if err := state.CreateBrowserSessionWithInventory(context.Background(), tokenHash, record, now, 2, 1); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("orphaned %s create error = %v", index.name, err)
			}
			if exists, err := state.client.Exists(context.Background(), state.browserSessionKey(tokenHex)).Result(); err != nil || exists != 0 {
				t.Fatalf("payload existence after orphan rejection = %d, %v", exists, err)
			}
		})
	}
}

func TestRedisBrowserSessionReadValidatesPayloadMappingsIndexesAndTTL(t *testing.T) {
	tests := []struct {
		name   string
		tamper func(*testing.T, *Redis, auth.BrowserSessionCredentials, string, string, string)
	}{
		{
			name: "missing global index",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				if err := state.client.ZRem(context.Background(), state.browserSessionsKey(), tokenHex).Err(); err != nil {
					t.Fatalf("remove global index: %v", err)
				}
			},
		},
		{
			name: "missing subject index",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, subjectHex, tokenHex, _ string) {
				t.Helper()
				if err := state.client.ZRem(context.Background(), state.browserSubjectSessionsKey(subjectHex), tokenHex).Err(); err != nil {
					t.Fatalf("remove subject index: %v", err)
				}
			},
		},
		{
			name: "mismatched global score",
			tamper: func(t *testing.T, state *Redis, credentials auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				if err := state.client.ZAdd(context.Background(), state.browserSessionsKey(), redis.Z{Score: float64(credentials.ExpiresAt.Add(time.Second).UnixMilli()), Member: tokenHex}).Err(); err != nil {
					t.Fatalf("change global score: %v", err)
				}
			},
		},
		{
			name: "fractional subject score",
			tamper: func(t *testing.T, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex, _ string) {
				t.Helper()
				if err := state.client.ZAdd(context.Background(), state.browserSubjectSessionsKey(subjectHex), redis.Z{Score: float64(credentials.ExpiresAt.UnixMilli()) + 0.5, Member: tokenHex}).Err(); err != nil {
					t.Fatalf("change subject score: %v", err)
				}
			},
		},
		{
			name: "missing metadata",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				if err := state.client.Del(context.Background(), state.browserSessionMetadataKey(tokenHex)).Err(); err != nil {
					t.Fatalf("remove metadata: %v", err)
				}
			},
		},
		{
			name: "missing public ID mapping",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, _, sessionIDHex string) {
				t.Helper()
				if err := state.client.Del(context.Background(), state.browserSessionIDKey(sessionIDHex)).Err(); err != nil {
					t.Fatalf("remove public ID mapping: %v", err)
				}
			},
		},
		{
			name: "mismatched metadata",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, subjectHex, tokenHex, _ string) {
				t.Helper()
				wrongSessionID := strings.Repeat("f", sha256.Size*2)
				if err := state.client.SetArgs(context.Background(), state.browserSessionMetadataKey(tokenHex), subjectHex+":"+wrongSessionID, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
					t.Fatalf("change metadata: %v", err)
				}
			},
		},
		{
			name: "mismatched public ID mapping",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, subjectHex, _, sessionIDHex string) {
				t.Helper()
				wrongToken := strings.Repeat("f", sha256.Size*2)
				if err := state.client.SetArgs(context.Background(), state.browserSessionIDKey(sessionIDHex), subjectHex+":"+wrongToken, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
					t.Fatalf("change public ID mapping: %v", err)
				}
			},
		},
		{
			name: "persistent payload",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				if err := state.client.Persist(context.Background(), state.browserSessionKey(tokenHex)).Err(); err != nil {
					t.Fatalf("persist payload: %v", err)
				}
			},
		},
		{
			name: "unknown payload field",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				key := state.browserSessionKey(tokenHex)
				raw, err := state.client.Get(context.Background(), key).Result()
				if err != nil {
					t.Fatalf("read payload: %v", err)
				}
				raw = strings.TrimSuffix(raw, "}") + `,"unexpected":true}`
				if err := state.client.SetArgs(context.Background(), key, raw, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
					t.Fatalf("change payload: %v", err)
				}
			},
		},
		{
			name: "trailing payload JSON",
			tamper: func(t *testing.T, state *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _ string) {
				t.Helper()
				key := state.browserSessionKey(tokenHex)
				raw, err := state.client.Get(context.Background(), key).Result()
				if err != nil {
					t.Fatalf("read payload: %v", err)
				}
				if err := state.client.SetArgs(context.Background(), key, raw+` {}`, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
					t.Fatalf("change payload: %v", err)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-read-integrity:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, state)
			target, err := manager.Start(context.Background(), redisBrowserClaims(now))
			if err != nil {
				t.Fatalf("target Start() error = %v", err)
			}
			otherClaims := redisBrowserClaims(now)
			otherClaims.Subject = "browser-user-2"
			other, err := manager.Start(context.Background(), otherClaims)
			if err != nil {
				t.Fatalf("other Start() error = %v", err)
			}

			tokenHash := sha256.Sum256([]byte(target.SessionToken))
			tokenHex := hex.EncodeToString(tokenHash[:])
			subjectHash := sha256.Sum256([]byte("browser-user-1"))
			subjectHex := hex.EncodeToString(subjectHash[:])
			sessionIDHash := sha256.Sum256([]byte(target.SessionID))
			sessionIDHex := hex.EncodeToString(sessionIDHash[:])
			test.tamper(t, state, target, subjectHex, tokenHex, sessionIDHex)

			if _, err := manager.Verify(context.Background(), target.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("tampered Verify() error = %v", err)
			}
			assertRedisBrowserSessionPayloadExists(t, state, target.SessionToken)
			if _, err := manager.Verify(context.Background(), other.SessionToken, "", false); err != nil {
				t.Fatalf("tampered session changed other session: %v", err)
			}
		})
	}
}

func TestRedisBrowserSessionRevocationsUseOneAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-revoke-snapshot:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)

	warmEnd, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("warm End Start() error = %v", err)
	}
	if err := manager.End(context.Background(), warmEnd.SessionToken); err != nil {
		t.Fatalf("warm End() error = %v", err)
	}
	ended, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("measured End Start() error = %v", err)
	}
	before := len(recorder.Ended())
	if err := manager.End(context.Background(), ended.SessionToken); err != nil {
		t.Fatalf("measured End() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("browser hash revoke Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}

	warmRevoke, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("warm RevokeForSubject Start() error = %v", err)
	}
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", warmRevoke.SessionID); err != nil {
		t.Fatalf("warm RevokeForSubject() error = %v", err)
	}
	revoked, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("measured RevokeForSubject Start() error = %v", err)
	}
	before = len(recorder.Ended())
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", revoked.SessionID); err != nil {
		t.Fatalf("measured RevokeForSubject() error = %v", err)
	}
	spans = recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("browser ID revoke Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisBrowserSessionRevocationsFailClosedForMalformedMappings(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-revoke-malformed:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)

	byToken, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("token revoke Start() error = %v", err)
	}
	var metadataKey string
	for _, key := range server.Keys() {
		if strings.Contains(key, "browser-session:metadata:") {
			metadataKey = key
			break
		}
	}
	if metadataKey == "" {
		t.Fatal("browser session metadata key was not created")
	}
	server.Set(metadataKey, "malformed")
	if err := manager.End(context.Background(), byToken.SessionToken); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("malformed token revoke error = %v", err)
	}
	assertRedisBrowserSessionPayloadExists(t, state, byToken.SessionToken)
	if _, err := manager.Verify(context.Background(), byToken.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("malformed token mapping Verify() error = %v", err)
	}

	byID, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("ID revoke Start() error = %v", err)
	}
	sessionIDHash := sha256.Sum256([]byte(byID.SessionID))
	idKey := state.browserSessionIDKey(hex.EncodeToString(sessionIDHash[:]))
	server.Set(idKey, "malformed")
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", byID.SessionID); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("malformed ID revoke error = %v", err)
	}
	assertRedisBrowserSessionPayloadExists(t, state, byID.SessionToken)
	if _, err := manager.Verify(context.Background(), byID.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("malformed ID mapping Verify() error = %v", err)
	}
}

func TestRedisBrowserSessionRevocationsFailClosedForInconsistentMappings(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-revoke-inconsistent:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)
	subjectHash := sha256.Sum256([]byte("browser-user-1"))
	subjectHex := hex.EncodeToString(subjectHash[:])

	byToken, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("token revoke Start() error = %v", err)
	}
	byTokenIDHash := sha256.Sum256([]byte(byToken.SessionID))
	byTokenIDKey := state.browserSessionIDKey(hex.EncodeToString(byTokenIDHash[:]))
	server.Set(byTokenIDKey, subjectHex+":"+strings.Repeat("a", sha256.Size*2))
	if err := manager.End(context.Background(), byToken.SessionToken); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("inconsistent token revoke error = %v", err)
	}
	assertRedisBrowserSessionPayloadExists(t, state, byToken.SessionToken)
	if _, err := manager.Verify(context.Background(), byToken.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("inconsistent token mapping Verify() error = %v", err)
	}

	byID, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("ID revoke Start() error = %v", err)
	}
	byIDTokenHash := sha256.Sum256([]byte(byID.SessionToken))
	byIDMetadataKey := state.browserSessionMetadataKey(hex.EncodeToString(byIDTokenHash[:]))
	server.Set(byIDMetadataKey, subjectHex+":"+strings.Repeat("b", sha256.Size*2))
	if err := manager.RevokeForSubject(context.Background(), "browser-user-1", byID.SessionID); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("inconsistent ID revoke error = %v", err)
	}
	assertRedisBrowserSessionPayloadExists(t, state, byID.SessionToken)
	if _, err := manager.Verify(context.Background(), byID.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("inconsistent ID mapping Verify() error = %v", err)
	}
}

func TestRedisBrowserSessionRevokeAllUsesOneBoundedAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-revoke-all-atomic:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)

	warmClaims := redisBrowserClaims(now)
	warmClaims.Subject = "warm-browser-user"
	if _, err := manager.Start(context.Background(), warmClaims); err != nil {
		t.Fatalf("warm Start() error = %v", err)
	}
	if deleted, err := manager.RevokeAllForSubject(context.Background(), warmClaims.Subject); err != nil || deleted != 1 {
		t.Fatalf("warm RevokeAllForSubject() = %d, %v", deleted, err)
	}
	for range 2 {
		if _, err := manager.Start(context.Background(), redisBrowserClaims(now)); err != nil {
			t.Fatalf("measured Start() error = %v", err)
		}
	}
	before := len(recorder.Ended())
	deleted, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1")
	if err != nil || deleted != 2 {
		t.Fatalf("measured RevokeAllForSubject() = %d, %v", deleted, err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("browser revoke-all Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisBrowserSessionRevokeAllValidatesEveryMappingBeforeDelete(t *testing.T) {
	tests := []struct {
		name   string
		tamper func(*miniredis.Miniredis, *Redis, auth.BrowserSessionCredentials, string, string)
	}{
		{
			name: "malformed session ID",
			tamper: func(server *miniredis.Miniredis, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex string) {
				server.Set(state.browserSessionMetadataKey(tokenHex), subjectHex+":"+strings.Repeat("g", sha256.Size*2))
			},
		},
		{
			name: "missing metadata",
			tamper: func(server *miniredis.Miniredis, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex string) {
				server.Del(state.browserSessionMetadataKey(tokenHex))
			},
		},
		{
			name: "missing reverse mapping",
			tamper: func(server *miniredis.Miniredis, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex string) {
				sessionIDHash := sha256.Sum256([]byte(credentials.SessionID))
				server.Del(state.browserSessionIDKey(hex.EncodeToString(sessionIDHash[:])))
			},
		},
		{
			name: "inconsistent reverse mapping",
			tamper: func(server *miniredis.Miniredis, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex string) {
				sessionIDHash := sha256.Sum256([]byte(credentials.SessionID))
				wrongToken := strings.Repeat("0", sha256.Size*2)
				if wrongToken == tokenHex {
					wrongToken = strings.Repeat("1", sha256.Size*2)
				}
				server.Set(state.browserSessionIDKey(hex.EncodeToString(sessionIDHash[:])), subjectHex+":"+wrongToken)
			},
		},
		{
			name: "cross-subject reverse mapping",
			tamper: func(server *miniredis.Miniredis, state *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex string) {
				sessionIDHash := sha256.Sum256([]byte(credentials.SessionID))
				otherSubjectHash := sha256.Sum256([]byte("browser-user-2"))
				server.Set(state.browserSessionIDKey(hex.EncodeToString(sessionIDHash[:])), hex.EncodeToString(otherSubjectHash[:])+":"+tokenHex)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-revoke-all-validation:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 4, state)
			first, err := manager.Start(context.Background(), redisBrowserClaims(now))
			if err != nil {
				t.Fatalf("first Start() error = %v", err)
			}
			second, err := manager.Start(context.Background(), redisBrowserClaims(now))
			if err != nil {
				t.Fatalf("second Start() error = %v", err)
			}
			subjectHash := sha256.Sum256([]byte("browser-user-1"))
			subjectHex := hex.EncodeToString(subjectHash[:])
			firstTokenHash := sha256.Sum256([]byte(first.SessionToken))
			firstTokenHex := hex.EncodeToString(firstTokenHash[:])
			test.tamper(server, state, first, subjectHex, firstTokenHex)

			if deleted, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1"); deleted != 0 || !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("RevokeAllForSubject() = %d, %v", deleted, err)
			}
			assertRedisBrowserSessionPayloadExists(t, state, first.SessionToken)
			if _, err := manager.Verify(context.Background(), first.SessionToken, "", false); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("Verify(tampered session) after rejected revoke-all error = %v", err)
			}
			if _, err := manager.Verify(context.Background(), second.SessionToken, "", false); err != nil {
				t.Fatalf("Verify(untampered session) after rejected revoke-all error = %v", err)
			}
			indexKey := state.browserSubjectSessionsKey(subjectHex)
			if size, err := state.client.ZCard(context.Background(), indexKey).Result(); err != nil || size != 2 {
				t.Fatalf("subject index size after rejected revoke-all = %d, %v", size, err)
			}
		})
	}
}

func TestRedisBrowserSessionRevokeAllRejectsOversizedIndexBeforeCleanup(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-revoke-all-bound:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 1, 1, state)
	subjectHash := sha256.Sum256([]byte("browser-user-1"))
	indexKey := state.browserSubjectSessionsKey(hex.EncodeToString(subjectHash[:]))
	members := make([]redis.Z, maxBrowserSessionInventory+1)
	for index := range members {
		members[index] = redis.Z{Score: float64(now.Add(-time.Hour).UnixMilli()), Member: fmt.Sprintf("%064x", index+1)}
	}
	if err := state.client.ZAdd(context.Background(), indexKey, members...).Err(); err != nil {
		t.Fatalf("seed oversized browser-session index: %v", err)
	}

	if deleted, err := manager.RevokeAllForSubject(context.Background(), "browser-user-1"); deleted != 0 || !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("RevokeAllForSubject() = %d, %v", deleted, err)
	}
	if size, err := state.client.ZCard(context.Background(), indexKey).Result(); err != nil || size != maxBrowserSessionInventory+1 {
		t.Fatalf("oversized index size after rejection = %d, %v", size, err)
	}
}

func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	names := make([]string, len(spans))
	for index, span := range spans {
		names[index] = span.Name()
	}
	return names
}

type afterFirstEvalSHAHook struct {
	once  sync.Once
	after func()
}

type lateCancelContext struct {
	context.Context
	canceled atomic.Bool
}

func (ctx *lateCancelContext) Err() error {
	if ctx.canceled.Load() {
		return context.Canceled
	}
	return ctx.Context.Err()
}

func (hook *afterFirstEvalSHAHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		return next(ctx, network, addr)
	}
}

func (hook *afterFirstEvalSHAHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		if strings.EqualFold(cmd.Name(), "evalsha") {
			hook.once.Do(hook.after)
		}
		return err
	}
}

func (hook *afterFirstEvalSHAHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		return next(ctx, cmds)
	}
}

func requireRedisBrowserMutation(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("mutate browser-session fixture: %v", err)
	}
}

func TestRedisBrowserSessionInventoryFailsClosedForMissingPayloadInSnapshot(t *testing.T) {
	server := miniredis.RunT(t)
	state := newTestRedis(t, server, "goexample:browser-inventory-snapshot-invalid:")
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 2, 2, state)
	_, err := manager.Start(context.Background(), redisBrowserClaims(now))
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
	server.Del(payloadKey)
	if _, err := manager.ListForSubject(context.Background(), "browser-user-1"); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
		t.Fatalf("missing inventory ListForSubject() error = %v", err)
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

func TestRedisBrowserSessionDeviceNameUpdateUsesTwoAtomicScriptCommands(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:browser-device-command:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 4, 2, state)
	credentials, err := manager.Start(context.Background(), redisBrowserClaims(now))
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "warm"); err != nil {
		t.Fatalf("warm SetDeviceNameForSubject() error = %v", err)
	}

	before := len(recorder.Ended())
	if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "measured"); err != nil {
		t.Fatalf("measured SetDeviceNameForSubject() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 2 || spans[0].Name() != "redis.evalsha" || spans[1].Name() != "redis.evalsha" {
		t.Fatalf("device update Redis spans = %v, want two redis.evalsha spans", spanNames(spans))
	}
}

func TestRedisBrowserSessionDeviceNameUpdateRejectsStateChangesAfterSnapshot(t *testing.T) {
	tests := []struct {
		name   string
		tamper func(*testing.T, *Redis, *Redis, auth.BrowserSessionCredentials, string, string, string, string) string
	}{
		{
			name: "payload",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _, baseline string) string {
				tampered := strings.Replace(baseline, `"deviceName":"baseline"`, `"deviceName":"raced"`, 1)
				if tampered == baseline {
					t.Fatal("baseline payload did not contain the device name")
				}
				requireRedisBrowserMutation(t, mutator.client.SetArgs(context.Background(), state.browserSessionKey(tokenHex), tampered, redis.SetArgs{KeepTTL: true}).Err())
				return tampered
			},
		},
		{
			name: "public ID mapping",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, subjectHex, _, sessionIDHex, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.SetArgs(context.Background(), state.browserSessionIDKey(sessionIDHex), subjectHex+":"+strings.Repeat("f", sha256.Size*2), redis.SetArgs{KeepTTL: true}).Err())
				return baseline
			},
		},
		{
			name: "metadata",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, subjectHex, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.SetArgs(context.Background(), state.browserSessionMetadataKey(tokenHex), subjectHex+":"+strings.Repeat("f", sha256.Size*2), redis.SetArgs{KeepTTL: true}).Err())
				return baseline
			},
		},
		{
			name: "global member",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.ZRem(context.Background(), state.browserSessionsKey(), tokenHex).Err())
				return baseline
			},
		},
		{
			name: "subject member",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, subjectHex, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.ZRem(context.Background(), state.browserSubjectSessionsKey(subjectHex), tokenHex).Err())
				return baseline
			},
		},
		{
			name: "global score",
			tamper: func(t *testing.T, state, mutator *Redis, credentials auth.BrowserSessionCredentials, _, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.ZAdd(context.Background(), state.browserSessionsKey(), redis.Z{
					Score: float64(credentials.ExpiresAt.Add(time.Second).UnixMilli()), Member: tokenHex,
				}).Err())
				return baseline
			},
		},
		{
			name: "subject score",
			tamper: func(t *testing.T, state, mutator *Redis, credentials auth.BrowserSessionCredentials, subjectHex, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.ZAdd(context.Background(), state.browserSubjectSessionsKey(subjectHex), redis.Z{
					Score: float64(credentials.ExpiresAt.UnixMilli()) + 0.5, Member: tokenHex,
				}).Err())
				return baseline
			},
		},
		{
			name: "payload TTL",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.Persist(context.Background(), state.browserSessionKey(tokenHex)).Err())
				return baseline
			},
		},
		{
			name: "metadata TTL",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, _, tokenHex, _, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.Persist(context.Background(), state.browserSessionMetadataKey(tokenHex)).Err())
				return baseline
			},
		},
		{
			name: "public ID TTL",
			tamper: func(t *testing.T, state, mutator *Redis, _ auth.BrowserSessionCredentials, _, _, sessionIDHex, baseline string) string {
				requireRedisBrowserMutation(t, mutator.client.Persist(context.Background(), state.browserSessionIDKey(sessionIDHex)).Err())
				return baseline
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:browser-device-cas:")
			mutator := newTestRedis(t, server, "goexample:browser-device-cas:")
			defer state.Close()
			defer mutator.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			manager := newRedisBrowserSessionManagerWithSubjectLimit(t, &now, 5, 2, state)
			credentials, err := manager.Start(context.Background(), redisBrowserClaims(now))
			if err != nil {
				t.Fatalf("target Start() error = %v", err)
			}
			otherClaims := redisBrowserClaims(now)
			otherClaims.Subject = "browser-user-2"
			other, err := manager.Start(context.Background(), otherClaims)
			if err != nil {
				t.Fatalf("other Start() error = %v", err)
			}
			if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "baseline"); err != nil {
				t.Fatalf("warm SetDeviceNameForSubject() error = %v", err)
			}

			subjectHash := sha256.Sum256([]byte("browser-user-1"))
			subjectHex := hex.EncodeToString(subjectHash[:])
			tokenHash := sha256.Sum256([]byte(credentials.SessionToken))
			tokenHex := hex.EncodeToString(tokenHash[:])
			sessionIDHash := sha256.Sum256([]byte(credentials.SessionID))
			sessionIDHex := hex.EncodeToString(sessionIDHash[:])
			baseline, err := state.client.Get(context.Background(), state.browserSessionKey(tokenHex)).Result()
			requireRedisBrowserMutation(t, err)
			expectedPayload := baseline
			state.client.AddHook(&afterFirstEvalSHAHook{after: func() {
				expectedPayload = test.tamper(t, state, mutator, credentials, subjectHex, tokenHex, sessionIDHex, baseline)
			}})

			if err := manager.SetDeviceNameForSubject(context.Background(), "browser-user-1", credentials.SessionID, "replacement"); !errors.Is(err, auth.ErrBrowserSessionInvalid) {
				t.Fatalf("racing SetDeviceNameForSubject() error = %v", err)
			}
			payload, err := state.client.Get(context.Background(), state.browserSessionKey(tokenHex)).Result()
			requireRedisBrowserMutation(t, err)
			if payload != expectedPayload {
				t.Fatalf("payload changed after rejected CAS\n got: %s\nwant: %s", payload, expectedPayload)
			}
			if _, err := manager.Verify(context.Background(), other.SessionToken, "", false); err != nil {
				t.Fatalf("rejected target update changed other subject: %v", err)
			}
		})
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

func assertRedisBrowserSessionPayloadExists(t *testing.T, state *Redis, sessionToken string) {
	t.Helper()
	tokenHash := sha256.Sum256([]byte(sessionToken))
	tokenHex := hex.EncodeToString(tokenHash[:])
	exists, err := state.client.Exists(context.Background(), state.browserSessionKey(tokenHex)).Result()
	if err != nil || exists != 1 {
		t.Fatalf("browser session payload existence = %d, %v", exists, err)
	}
}

func newRedisBrowserSessionRecord(now time.Time) auth.BrowserSessionRecord {
	claims := redisBrowserClaims(now)
	sessionID := base64.RawURLEncoding.EncodeToString(make([]byte, sha256.Size))
	return auth.BrowserSessionRecord{
		SessionID:   sessionID,
		SubjectHash: sha256.Sum256([]byte(claims.Subject)),
		Claims:      claims,
		CSRFHash:    sha256.Sum256([]byte("csrf")),
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
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
