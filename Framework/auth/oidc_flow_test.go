package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAuthorizationRequestManagerBuildsSingleUsePKCERequest(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager, err := NewAuthorizationRequestManager(AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize?fixed=1",
		ClientID:         "web-client",
		RedirectURL:      "https://app.example.test/callback",
		Scopes:           []string{"openid", "profile"},
		ACRValues:        []string{"urn:example:assurance:mfa", "urn:example:assurance:phishing-resistant"},
		TTL:              2 * time.Minute,
		MaxPending:       2,
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
	}
	request, err := manager.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if request.State == "" || request.Nonce == "" || request.ExpiresAt != now.Add(2*time.Minute) {
		t.Fatalf("request metadata = %#v", request)
	}
	parsed, err := url.Parse(request.URL)
	if err != nil {
		t.Fatalf("authorization URL parse: %v", err)
	}
	query := parsed.Query()
	for key, want := range map[string]string{
		"response_type": "code", "client_id": "web-client", "redirect_uri": "https://app.example.test/callback",
		"scope": "openid profile", "acr_values": "urn:example:assurance:mfa urn:example:assurance:phishing-resistant", "state": request.State, "nonce": request.Nonce, "code_challenge_method": "S256",
	} {
		if query.Get(key) != want {
			t.Fatalf("query[%q] = %q, want %q", key, query.Get(key), want)
		}
	}
	if len(query.Get("code_challenge")) != 43 || strings.Contains(query.Get("code_challenge"), "=") {
		t.Fatalf("code challenge = %q", query.Get("code_challenge"))
	}
	completed, err := manager.Complete(request.State, "authorization-code")
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if completed.Code != "authorization-code" || completed.CodeVerifier == "" || completed.Nonce != request.Nonce {
		t.Fatalf("completed code = %#v", completed)
	}
	if _, err := manager.Complete(request.State, "replay"); !errors.Is(err, ErrAuthorizationRequestInvalid) {
		t.Fatalf("replayed Complete() error = %v", err)
	}
	if err := ValidateAuthorizationNonce(request.Nonce, completed.Nonce); err != nil {
		t.Fatalf("ValidateAuthorizationNonce() error = %v", err)
	}
	if err := ValidateAuthorizationNonce(request.Nonce, "wrong"); !errors.Is(err, ErrAuthorizationNonceMismatch) {
		t.Fatalf("wrong nonce error = %v", err)
	}
}

func TestAuthorizationRequestStoreSharesHashOnlyStateAcrossManagers(t *testing.T) {
	now := time.Date(2026, time.August, 24, 8, 0, 0, 0, time.UTC)
	store := &testAuthorizationRequestStore{records: make(map[[sha256.Size]byte]AuthorizationRequestRecord)}
	newManager := func() *AuthorizationRequestManager {
		manager, err := NewAuthorizationRequestManager(AuthorizationRequestConfig{
			AuthorizationURL: "https://issuer.example/authorize",
			ClientID:         "shared-client",
			RedirectURL:      "https://app.example.test/callback",
			TTL:              time.Minute,
			MaxPending:       2,
			Now:              func() time.Time { return now },
			Store:            store,
		})
		if err != nil {
			t.Fatalf("NewAuthorizationRequestManager() error = %v", err)
		}
		return manager
	}
	first := newManager()
	second := newManager()
	request, err := first.StartContext(context.Background())
	if err != nil {
		t.Fatalf("StartContext() error = %v", err)
	}
	wantHash := sha256.Sum256([]byte(request.State))
	if store.lastHash != wantHash {
		t.Fatalf("store state hash = %x, want %x", store.lastHash, wantHash)
	}
	completed, err := second.CompleteContext(context.Background(), request.State, "shared-code")
	if err != nil {
		t.Fatalf("cross-manager CompleteContext() error = %v", err)
	}
	if completed.Nonce != request.Nonce || completed.CodeVerifier == "" {
		t.Fatalf("completed authorization = %#v", completed)
	}
	if _, err := first.Complete(request.State, "replay"); !errors.Is(err, ErrAuthorizationRequestInvalid) {
		t.Fatalf("replayed Complete() error = %v", err)
	}

	consumedOnInvalidCode, err := first.Start()
	if err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	if _, err := second.Complete(consumedOnInvalidCode.State, " invalid "); !errors.Is(err, ErrAuthorizationRequestInvalid) {
		t.Fatalf("invalid code error = %v", err)
	}
	if _, err := first.Complete(consumedOnInvalidCode.State, "valid-after-invalid"); !errors.Is(err, ErrAuthorizationRequestInvalid) {
		t.Fatalf("state survived invalid code: %v", err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := first.StartContext(canceled); !errors.Is(err, ErrAuthorizationRequestInvalid) {
		t.Fatalf("canceled StartContext() error = %v", err)
	}
}

func TestAuthorizationRequestManagerExpiresAndBoundsPendingState(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	manager, err := NewAuthorizationRequestManager(AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize",
		ClientID:         "client",
		RedirectURL:      "https://app.example.test/callback",
		TTL:              time.Minute,
		MaxPending:       1,
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	request, err := manager.Start()
	if err != nil {
		t.Fatalf("first Start() error = %v", err)
	}
	if _, err := manager.Start(); !errors.Is(err, ErrAuthorizationRequestLimit) {
		t.Fatalf("pending limit error = %v", err)
	}
	now = now.Add(time.Minute)
	if _, err := manager.Complete(request.State, "code"); !errors.Is(err, ErrAuthorizationRequestExpired) {
		t.Fatalf("expired Complete() error = %v", err)
	}
	if _, err := manager.Start(); err != nil {
		t.Fatalf("Start() after expiry error = %v", err)
	}
}

func TestNewAuthorizationRequestManagerRejectsUnsafeConfiguration(t *testing.T) {
	base := AuthorizationRequestConfig{
		AuthorizationURL: "https://issuer.example/authorize",
		ClientID:         "client",
		RedirectURL:      "https://app.example.test/callback",
		TTL:              time.Minute,
		MaxPending:       1,
	}
	configs := []AuthorizationRequestConfig{
		{AuthorizationURL: "http://issuer.example/authorize", ClientID: base.ClientID, RedirectURL: base.RedirectURL},
		{AuthorizationURL: base.AuthorizationURL, ClientID: "", RedirectURL: base.RedirectURL},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: "https://app.example.test/callback#fragment"},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: base.RedirectURL, TTL: 16 * time.Minute, MaxPending: 1},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: base.RedirectURL, TTL: time.Minute, MaxPending: maxAuthorizationRequests + 1},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: base.RedirectURL, TTL: time.Minute, MaxPending: 1, Scopes: []string{"openid", "openid"}},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: base.RedirectURL, TTL: time.Minute, MaxPending: 1, ACRValues: []string{"urn:example:mfa", "urn:example:mfa"}},
		{AuthorizationURL: base.AuthorizationURL, ClientID: base.ClientID, RedirectURL: base.RedirectURL, TTL: time.Minute, MaxPending: 1, ACRValues: []string{" invalid"}},
	}
	for index, config := range configs {
		if _, err := NewAuthorizationRequestManager(config); err == nil {
			t.Fatalf("config %d unexpectedly accepted", index)
		}
	}
}

type testAuthorizationRequestStore struct {
	mu       sync.Mutex
	records  map[[sha256.Size]byte]AuthorizationRequestRecord
	lastHash [sha256.Size]byte
}

func (store *testAuthorizationRequestStore) CreateAuthorizationRequest(_ context.Context, stateHash [sha256.Size]byte, record AuthorizationRequestRecord, now time.Time, maximum int) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	for existingHash, existing := range store.records {
		if !existing.ExpiresAt.After(now) {
			delete(store.records, existingHash)
		}
	}
	if len(store.records) >= maximum {
		return ErrAuthorizationRequestLimit
	}
	if _, exists := store.records[stateHash]; exists {
		return ErrAuthorizationRequestInvalid
	}
	store.lastHash = stateHash
	store.records[stateHash] = record
	return nil
}

func (store *testAuthorizationRequestStore) ConsumeAuthorizationRequest(_ context.Context, stateHash [sha256.Size]byte, now time.Time) (AuthorizationRequestRecord, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	record, exists := store.records[stateHash]
	if !exists {
		return AuthorizationRequestRecord{}, ErrAuthorizationRequestInvalid
	}
	delete(store.records, stateHash)
	if !record.ExpiresAt.After(now) {
		return AuthorizationRequestRecord{}, ErrAuthorizationRequestExpired
	}
	return record, nil
}
