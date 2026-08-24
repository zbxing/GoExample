package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/zbxing/goexample/Framework/auth"
)

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
