package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/zbxing/goexample/Framework/auth"
)

func TestRedisAuthorizationRequestStoreUsesOneAtomicScriptCommand(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:authorization-request-command:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	record := redisAuthorizationRequestRecord(now)

	warmHash := sha256.Sum256([]byte("warm-authorization-state"))
	if err := state.CreateAuthorizationRequest(context.Background(), warmHash, record, now, 4); err != nil {
		t.Fatalf("warm CreateAuthorizationRequest() error = %v", err)
	}
	measuredHash := sha256.Sum256([]byte("measured-authorization-state"))
	before := len(recorder.Ended())
	if err := state.CreateAuthorizationRequest(context.Background(), measuredHash, record, now, 4); err != nil {
		t.Fatalf("measured CreateAuthorizationRequest() error = %v", err)
	}
	spans := recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("authorization request create Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}

	if _, err := state.ConsumeAuthorizationRequest(context.Background(), warmHash, now); err != nil {
		t.Fatalf("warm ConsumeAuthorizationRequest() error = %v", err)
	}
	before = len(recorder.Ended())
	consumed, err := state.ConsumeAuthorizationRequest(context.Background(), measuredHash, now)
	if err != nil || consumed != record {
		t.Fatalf("measured ConsumeAuthorizationRequest() = %#v, %v", consumed, err)
	}
	spans = recorder.Ended()[before:]
	if len(spans) != 1 || spans[0].Name() != "redis.evalsha" {
		t.Fatalf("authorization request consume Redis spans = %v, want one redis.evalsha span", spanNames(spans))
	}
}

func TestRedisAuthorizationRequestStoreRejectsInvalidInputsBeforeRedis(t *testing.T) {
	server := miniredis.RunT(t)
	recorder, provider := newRedisTestTracerProvider(t)
	state := newTestRedisWithProvider(t, context.Background(), server, "goexample:authorization-request-input:", provider)
	defer state.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	stateHash := sha256.Sum256([]byte("authorization-state"))
	record := redisAuthorizationRequestRecord(now)

	createCases := []struct {
		name    string
		ctx     context.Context
		hash    [sha256.Size]byte
		record  auth.AuthorizationRequestRecord
		now     time.Time
		maximum int
	}{
		{name: "nil context", hash: stateHash, record: record, now: now, maximum: 1},
		{name: "zero state hash", ctx: context.Background(), record: record, now: now, maximum: 1},
		{name: "expired", ctx: context.Background(), hash: stateHash, record: auth.AuthorizationRequestRecord{CodeVerifier: record.CodeVerifier, Nonce: record.Nonce, ExpiresAt: now}, now: now, maximum: 1},
		{name: "sub-millisecond TTL", ctx: context.Background(), hash: stateHash, record: auth.AuthorizationRequestRecord{CodeVerifier: record.CodeVerifier, Nonce: record.Nonce, ExpiresAt: now.Add(time.Nanosecond)}, now: now, maximum: 1},
		{name: "zero maximum", ctx: context.Background(), hash: stateHash, record: record, now: now},
		{name: "excessive maximum", ctx: context.Background(), hash: stateHash, record: record, now: now, maximum: maxAuthorizationRequestEntries + 1},
		{name: "invalid verifier", ctx: context.Background(), hash: stateHash, record: auth.AuthorizationRequestRecord{CodeVerifier: "invalid", Nonce: record.Nonce, ExpiresAt: record.ExpiresAt}, now: now, maximum: 1},
		{name: "non-positive milliseconds", ctx: context.Background(), hash: stateHash, record: redisAuthorizationRequestRecord(time.Time{}), now: time.Time{}, maximum: 1},
	}
	for _, test := range createCases {
		t.Run("create "+test.name, func(t *testing.T) {
			before := len(recorder.Ended())
			if err := state.CreateAuthorizationRequest(test.ctx, test.hash, test.record, test.now, test.maximum); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
				t.Fatalf("CreateAuthorizationRequest() error = %v", err)
			}
			if spans := recorder.Ended()[before:]; len(spans) != 0 {
				t.Fatalf("CreateAuthorizationRequest() reached Redis: %v", spanNames(spans))
			}
		})
	}

	consumeCases := []struct {
		name string
		ctx  context.Context
		hash [sha256.Size]byte
		now  time.Time
	}{
		{name: "nil context", hash: stateHash, now: now},
		{name: "zero state hash", ctx: context.Background(), now: now},
		{name: "non-positive milliseconds", ctx: context.Background(), hash: stateHash, now: time.Time{}},
	}
	for _, test := range consumeCases {
		t.Run("consume "+test.name, func(t *testing.T) {
			before := len(recorder.Ended())
			if _, err := state.ConsumeAuthorizationRequest(test.ctx, test.hash, test.now); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
				t.Fatalf("ConsumeAuthorizationRequest() error = %v", err)
			}
			if spans := recorder.Ended()[before:]; len(spans) != 0 {
				t.Fatalf("ConsumeAuthorizationRequest() reached Redis: %v", spanNames(spans))
			}
		})
	}
	if keys := server.Keys(); len(keys) != 0 {
		t.Fatalf("invalid authorization requests wrote Redis keys: %v", keys)
	}
}

func TestRedisAuthorizationRequestCreateRejectsOversizedOrOrphanedIndex(t *testing.T) {
	t.Run("oversized before cleanup", func(t *testing.T) {
		server := miniredis.RunT(t)
		state := newTestRedis(t, server, "goexample:authorization-request-oversized:")
		defer state.Close()
		now := time.Now().UTC().Truncate(time.Millisecond)
		members := make([]redis.Z, maxAuthorizationRequestEntries+1)
		for index := range members {
			members[index] = redis.Z{Score: float64(now.Add(-time.Minute).UnixMilli()), Member: fmt.Sprintf("%064x", index+1)}
		}
		if err := state.client.ZAdd(context.Background(), state.authorizationRequestsKey(), members...).Err(); err != nil {
			t.Fatalf("seed oversized authorization request index: %v", err)
		}

		stateHash := sha256.Sum256([]byte("new-authorization-state"))
		if err := state.CreateAuthorizationRequest(context.Background(), stateHash, redisAuthorizationRequestRecord(now), now, maxAuthorizationRequestEntries); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
			t.Fatalf("CreateAuthorizationRequest() error = %v", err)
		}
		if size, err := state.client.ZCard(context.Background(), state.authorizationRequestsKey()).Result(); err != nil || size != maxAuthorizationRequestEntries+1 {
			t.Fatalf("oversized index after rejection = %d, %v", size, err)
		}
		if exists, err := state.client.Exists(context.Background(), state.authorizationRequestKey(hex.EncodeToString(stateHash[:]))).Result(); err != nil || exists != 0 {
			t.Fatalf("payload exists after oversized rejection = %d, %v", exists, err)
		}
	})

	t.Run("active orphan member", func(t *testing.T) {
		server := miniredis.RunT(t)
		state := newTestRedis(t, server, "goexample:authorization-request-orphan:")
		defer state.Close()
		now := time.Now().UTC().Truncate(time.Millisecond)
		record := redisAuthorizationRequestRecord(now)
		stateHash := sha256.Sum256([]byte("orphaned-authorization-state"))
		stateHex := hex.EncodeToString(stateHash[:])
		if err := state.client.ZAdd(context.Background(), state.authorizationRequestsKey(), redis.Z{Score: float64(record.ExpiresAt.UnixMilli()), Member: stateHex}).Err(); err != nil {
			t.Fatalf("seed orphan authorization request index: %v", err)
		}

		if err := state.CreateAuthorizationRequest(context.Background(), stateHash, record, now, 4); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
			t.Fatalf("CreateAuthorizationRequest() error = %v", err)
		}
		if exists, err := state.client.Exists(context.Background(), state.authorizationRequestKey(stateHex)).Result(); err != nil || exists != 0 {
			t.Fatalf("payload exists after orphan rejection = %d, %v", exists, err)
		}
		if score, err := state.client.ZScore(context.Background(), state.authorizationRequestsKey(), stateHex).Result(); err != nil || int64(score) != record.ExpiresAt.UnixMilli() {
			t.Fatalf("orphan index score after rejection = %v, %v", score, err)
		}
	})
}

func TestRedisAuthorizationRequestConsumeValidatesPayloadIndexExpiry(t *testing.T) {
	type tamperCase struct {
		name    string
		prepare func(*testing.T, *Redis, string, auth.AuthorizationRequestRecord)
	}
	tampers := []tamperCase{
		{
			name: "missing index",
			prepare: func(t *testing.T, state *Redis, stateHex string, _ auth.AuthorizationRequestRecord) {
				t.Helper()
				if err := state.client.ZRem(context.Background(), state.authorizationRequestsKey(), stateHex).Err(); err != nil {
					t.Fatalf("remove authorization request index: %v", err)
				}
			},
		},
		{
			name: "mismatched index score",
			prepare: func(t *testing.T, state *Redis, stateHex string, record auth.AuthorizationRequestRecord) {
				t.Helper()
				if err := state.client.ZAdd(context.Background(), state.authorizationRequestsKey(), redis.Z{Score: float64(record.ExpiresAt.Add(time.Second).UnixMilli()), Member: stateHex}).Err(); err != nil {
					t.Fatalf("tamper authorization request score: %v", err)
				}
			},
		},
		{
			name: "fractional index score",
			prepare: func(t *testing.T, state *Redis, stateHex string, record auth.AuthorizationRequestRecord) {
				t.Helper()
				if err := state.client.ZAdd(context.Background(), state.authorizationRequestsKey(), redis.Z{Score: float64(record.ExpiresAt.UnixMilli()) + 0.5, Member: stateHex}).Err(); err != nil {
					t.Fatalf("tamper authorization request fractional score: %v", err)
				}
			},
		},
		{
			name: "payload expiry mismatch",
			prepare: func(t *testing.T, state *Redis, stateHex string, record auth.AuthorizationRequestRecord) {
				t.Helper()
				payload, err := json.Marshal(authorizationRequestPayload{
					CodeVerifier:    record.CodeVerifier,
					Nonce:           record.Nonce,
					ExpiresAtMillis: record.ExpiresAt.Add(time.Second).UnixMilli(),
				})
				if err != nil {
					t.Fatalf("marshal tampered authorization request payload: %v", err)
				}
				if err := state.client.Set(context.Background(), state.authorizationRequestKey(stateHex), payload, time.Minute).Err(); err != nil {
					t.Fatalf("tamper authorization request payload expiry: %v", err)
				}
			},
		},
	}
	for _, tamper := range tampers {
		t.Run(tamper.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			state := newTestRedis(t, server, "goexample:authorization-request-integrity:")
			defer state.Close()
			now := time.Now().UTC().Truncate(time.Millisecond)
			record := redisAuthorizationRequestRecord(now)
			stateHash := sha256.Sum256([]byte("tampered-authorization-state"))
			stateHex := hex.EncodeToString(stateHash[:])
			otherHash := sha256.Sum256([]byte("other-authorization-state"))
			otherHex := hex.EncodeToString(otherHash[:])
			if err := state.CreateAuthorizationRequest(context.Background(), stateHash, record, now, 4); err != nil {
				t.Fatalf("create target authorization request: %v", err)
			}
			if err := state.CreateAuthorizationRequest(context.Background(), otherHash, record, now, 4); err != nil {
				t.Fatalf("create other authorization request: %v", err)
			}
			tamper.prepare(t, state, stateHex, record)

			if _, err := state.ConsumeAuthorizationRequest(context.Background(), stateHash, now); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
				t.Fatalf("ConsumeAuthorizationRequest() error = %v", err)
			}
			if _, err := state.ConsumeAuthorizationRequest(context.Background(), stateHash, now); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
				t.Fatalf("ConsumeAuthorizationRequest() replay error = %v", err)
			}
			if exists, err := state.client.Exists(context.Background(), state.authorizationRequestKey(stateHex)).Result(); err != nil || exists != 0 {
				t.Fatalf("target payload after rejection = %d, %v", exists, err)
			}
			if _, err := state.client.ZScore(context.Background(), state.authorizationRequestsKey(), stateHex).Result(); !errors.Is(err, redis.Nil) {
				t.Fatalf("target index after rejection error = %v", err)
			}
			if exists, err := state.client.Exists(context.Background(), state.authorizationRequestKey(otherHex)).Result(); err != nil || exists != 1 {
				t.Fatalf("other payload after target rejection = %d, %v", exists, err)
			}
			if score, err := state.client.ZScore(context.Background(), state.authorizationRequestsKey(), otherHex).Result(); err != nil || int64(score) != record.ExpiresAt.UnixMilli() {
				t.Fatalf("other index after target rejection = %v, %v", score, err)
			}
		})
	}
}

func TestRedisAuthorizationRequestStoreConsumesAcrossClientsExactlyOnce(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:authorization-request:")
	secondState := newTestRedis(t, server, "goexample:authorization-request:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisAuthorizationRequestManager(t, &now, 2, firstState)
	second := newRedisAuthorizationRequestManager(t, &now, 2, secondState)
	request, err := first.StartContext(context.Background())
	if err != nil {
		t.Fatalf("StartContext() error = %v", err)
	}
	for _, key := range server.Keys() {
		if strings.Contains(key, request.State) {
			t.Fatalf("raw authorization state appeared in Redis key %q", key)
		}
		if value, getErr := server.Get(key); getErr == nil && strings.Contains(value, request.State) {
			t.Fatalf("raw authorization state appeared in Redis value for %q", key)
		}
	}

	type result struct {
		authorization auth.AuthorizationCode
		err           error
	}
	results := make(chan result, 2)
	var wait sync.WaitGroup
	for _, manager := range []*auth.AuthorizationRequestManager{first, second} {
		wait.Add(1)
		go func(manager *auth.AuthorizationRequestManager) {
			defer wait.Done()
			authorization, completeErr := manager.CompleteContext(context.Background(), request.State, "authorization-code")
			results <- result{authorization: authorization, err: completeErr}
		}(manager)
	}
	wait.Wait()
	close(results)
	succeeded := 0
	rejected := 0
	for result := range results {
		switch {
		case result.err == nil:
			succeeded++
			if result.authorization.Nonce != request.Nonce || result.authorization.CodeVerifier == "" {
				t.Fatalf("completed authorization = %#v", result.authorization)
			}
		case errors.Is(result.err, auth.ErrAuthorizationRequestInvalid):
			rejected++
		default:
			t.Fatalf("unexpected CompleteContext() error = %v", result.err)
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("atomic consume results = success %d, rejected %d", succeeded, rejected)
	}
}

func TestRedisAuthorizationRequestStoreEnforcesGlobalLimitExpiryTamperAndOutage(t *testing.T) {
	server := miniredis.RunT(t)
	firstState := newTestRedis(t, server, "goexample:authorization-request-limit:")
	secondState := newTestRedis(t, server, "goexample:authorization-request-limit:")
	defer firstState.Close()
	defer secondState.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	first := newRedisAuthorizationRequestManager(t, &now, 1, firstState)
	second := newRedisAuthorizationRequestManager(t, &now, 1, secondState)

	starts := make(chan auth.AuthorizationRequest, 2)
	errorsFound := make(chan error, 2)
	var wait sync.WaitGroup
	for _, manager := range []*auth.AuthorizationRequestManager{first, second} {
		wait.Add(1)
		go func(manager *auth.AuthorizationRequestManager) {
			defer wait.Done()
			request, startErr := manager.StartContext(context.Background())
			if startErr != nil {
				errorsFound <- startErr
				return
			}
			starts <- request
		}(manager)
	}
	wait.Wait()
	close(starts)
	close(errorsFound)
	if len(starts) != 1 || len(errorsFound) != 1 {
		t.Fatalf("global limit results = %d starts, %d errors", len(starts), len(errorsFound))
	}
	var request auth.AuthorizationRequest
	for request = range starts {
	}
	for startErr := range errorsFound {
		if !errors.Is(startErr, auth.ErrAuthorizationRequestLimit) {
			t.Fatalf("limited StartContext() error = %v", startErr)
		}
	}

	now = now.Add(time.Minute)
	if _, err := second.CompleteContext(context.Background(), request.State, "expired-code"); !errors.Is(err, auth.ErrAuthorizationRequestExpired) {
		t.Fatalf("expired CompleteContext() error = %v", err)
	}
	tampered, err := first.Start()
	if err != nil {
		t.Fatalf("Start() after expiry error = %v", err)
	}
	tamperedHash := sha256.Sum256([]byte(tampered.State))
	if err := server.Set(firstState.authorizationRequestKey(hex.EncodeToString(tamperedHash[:])), `{"unexpected":true}`); err != nil {
		t.Fatalf("tamper Redis payload: %v", err)
	}
	if _, err := second.Complete(tampered.State, "code"); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
		t.Fatalf("tampered Complete() error = %v", err)
	}
	if _, err := first.Complete(tampered.State, "replay"); !errors.Is(err, auth.ErrAuthorizationRequestInvalid) {
		t.Fatalf("tampered state replay error = %v", err)
	}

	outageRequest, err := first.Start()
	if err != nil {
		t.Fatalf("Start() before outage error = %v", err)
	}
	server.Close()
	if _, err := second.Complete(outageRequest.State, "code"); err == nil || strings.Contains(err.Error(), outageRequest.State) {
		t.Fatalf("outage Complete() error = %v", err)
	}
}

func newRedisAuthorizationRequestManager(t *testing.T, now *time.Time, maximum int, store auth.AuthorizationRequestStore) *auth.AuthorizationRequestManager {
	t.Helper()
	manager, err := auth.NewAuthorizationRequestManager(auth.AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize",
		ClientID:         "shared-client",
		RedirectURL:      "https://app.example.test/callback",
		TTL:              time.Minute,
		MaxPending:       maximum,
		Now:              func() time.Time { return *now },
		Store:            store,
	})
	if err != nil {
		t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
	}
	return manager
}

func redisAuthorizationRequestRecord(now time.Time) auth.AuthorizationRequestRecord {
	return auth.AuthorizationRequestRecord{
		CodeVerifier: strings.Repeat("A", 43),
		Nonce:        strings.Repeat("B", 43),
		ExpiresAt:    now.Add(time.Minute),
	}
}
