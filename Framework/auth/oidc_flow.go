package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	defaultAuthorizationRequestTTL = 5 * time.Minute
	maxAuthorizationRequests       = 10000
	maxAuthorizationCodeBytes      = 8 << 10
	maxAuthorizationScopeCount     = 32
)

var (
	// ErrAuthorizationRequestInvalid indicates an unknown, malformed, or already-consumed state.
	ErrAuthorizationRequestInvalid = errors.New("invalid authorization request")
	// ErrAuthorizationRequestExpired indicates that the state lifetime ended.
	ErrAuthorizationRequestExpired = errors.New("authorization request expired")
	// ErrAuthorizationRequestLimit indicates that pending authorization state is bounded.
	ErrAuthorizationRequestLimit = errors.New("authorization request limit reached")
	// ErrAuthorizationNonceMismatch indicates that an ID token nonce did not match the request.
	ErrAuthorizationNonceMismatch = errors.New("authorization nonce mismatch")
)

// AuthorizationRequestConfig defines a bounded OIDC Authorization Code + PKCE request builder.
type AuthorizationRequestConfig struct {
	AuthorizationURL string
	ClientID         string
	RedirectURL      string
	Scopes           []string
	ACRValues        []string
	TTL              time.Duration
	MaxPending       int
	Now              func() time.Time
	Store            AuthorizationRequestStore
}

// AuthorizationRequest is the browser redirect input. State and nonce are
// returned for correlation only; callers must not log either value.
type AuthorizationRequest struct {
	URL       string
	State     string
	Nonce     string
	ExpiresAt time.Time
}

// AuthorizationCode contains the one-time callback values needed by a token
// exchange. CodeVerifier is returned exactly once and must be sent only to the
// configured token endpoint over TLS.
type AuthorizationCode struct {
	Code         string
	CodeVerifier string
	Nonce        string
}

// AuthorizationRequestRecord is the sensitive server-side payload associated
// with a hash-keyed state. Store implementations must not persist the raw state.
type AuthorizationRequestRecord struct {
	CodeVerifier string
	Nonce        string
	ExpiresAt    time.Time
}

// AuthorizationRequestStore atomically creates and consumes one-time OIDC
// authorization requests. Implementations must key records only by stateHash.
type AuthorizationRequestStore interface {
	CreateAuthorizationRequest(context.Context, [sha256.Size]byte, AuthorizationRequestRecord, time.Time, int) error
	ConsumeAuthorizationRequest(context.Context, [sha256.Size]byte, time.Time) (AuthorizationRequestRecord, error)
}

// AuthorizationRequestManager builds and consumes bounded, single-use PKCE
// authorization requests. State remains process-local unless Store is supplied;
// raw state is never retained by the manager or passed to the store.
type AuthorizationRequestManager struct {
	mu      sync.Mutex
	config  AuthorizationRequestConfig
	now     func() time.Time
	store   AuthorizationRequestStore
	pending map[[sha256.Size]byte]AuthorizationRequestRecord
}

// NewAuthorizationRequestManager validates configuration and creates a manager.
func NewAuthorizationRequestManager(config AuthorizationRequestConfig) (*AuthorizationRequestManager, error) {
	config, err := normalizeAuthorizationRequestConfig(config)
	if err != nil {
		return nil, err
	}
	return &AuthorizationRequestManager{
		config:  config,
		now:     config.Now,
		store:   config.Store,
		pending: make(map[[sha256.Size]byte]AuthorizationRequestRecord),
	}, nil
}

// Start creates a one-time authorization URL with state, nonce, and S256 PKCE.
func (manager *AuthorizationRequestManager) Start() (AuthorizationRequest, error) {
	return manager.StartContext(context.Background())
}

// StartContext creates a one-time request using the caller's bounded context.
func (manager *AuthorizationRequestManager) StartContext(ctx context.Context) (AuthorizationRequest, error) {
	if manager == nil || ctx == nil || ctx.Err() != nil {
		return AuthorizationRequest{}, ErrAuthorizationRequestInvalid
	}
	now := manager.now().UTC()
	state, err := newAuthorizationSecret()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	nonce, err := newAuthorizationSecret()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	codeVerifier, err := newAuthorizationSecret()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	expiresAt := now.Add(manager.config.TTL)
	stateHash := sha256.Sum256([]byte(state))
	record := AuthorizationRequestRecord{
		CodeVerifier: codeVerifier,
		Nonce:        nonce,
		ExpiresAt:    expiresAt,
	}
	if manager.store != nil {
		if err := manager.store.CreateAuthorizationRequest(ctx, stateHash, record, now, manager.config.MaxPending); err != nil {
			return AuthorizationRequest{}, err
		}
	} else {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		manager.cleanupLocked(now)
		if len(manager.pending) >= manager.config.MaxPending {
			return AuthorizationRequest{}, ErrAuthorizationRequestLimit
		}
		if _, exists := manager.pending[stateHash]; exists {
			return AuthorizationRequest{}, ErrAuthorizationRequestInvalid
		}
		manager.pending[stateHash] = record
	}
	return AuthorizationRequest{
		URL:       buildAuthorizationURL(manager.config, state, nonce, codeVerifier),
		State:     state,
		Nonce:     nonce,
		ExpiresAt: expiresAt,
	}, nil
}

// Complete consumes state exactly once and returns the code-exchange verifier.
func (manager *AuthorizationRequestManager) Complete(state, code string) (AuthorizationCode, error) {
	return manager.CompleteContext(context.Background(), state, code)
}

// CompleteContext atomically consumes state using the caller's bounded context.
func (manager *AuthorizationRequestManager) CompleteContext(ctx context.Context, state, code string) (AuthorizationCode, error) {
	if manager == nil || ctx == nil || ctx.Err() != nil {
		return AuthorizationCode{}, ErrAuthorizationRequestInvalid
	}
	stateHash, valid := hashAuthorizationState(state)
	if !valid {
		return AuthorizationCode{}, ErrAuthorizationRequestInvalid
	}
	now := manager.now().UTC()
	var request AuthorizationRequestRecord
	var err error
	if manager.store != nil {
		request, err = manager.store.ConsumeAuthorizationRequest(ctx, stateHash, now)
		if err != nil {
			return AuthorizationCode{}, err
		}
	} else {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		var exists bool
		request, exists = manager.pending[stateHash]
		if !exists {
			return AuthorizationCode{}, ErrAuthorizationRequestInvalid
		}
		delete(manager.pending, stateHash)
	}
	if !request.ExpiresAt.After(now) {
		return AuthorizationCode{}, ErrAuthorizationRequestExpired
	}
	if !validAuthorizationSecret(request.CodeVerifier) || !validAuthorizationSecret(request.Nonce) {
		return AuthorizationCode{}, ErrAuthorizationRequestInvalid
	}
	if code == "" || len(code) > maxAuthorizationCodeBytes || strings.TrimSpace(code) != code {
		return AuthorizationCode{}, ErrAuthorizationRequestInvalid
	}
	return AuthorizationCode{Code: code, CodeVerifier: request.CodeVerifier, Nonce: request.Nonce}, nil
}

// ValidateAuthorizationNonce compares an ID token nonce without leaking
// whether a candidate was close to the expected value.
func ValidateAuthorizationNonce(expected, actual string) error {
	if expected == "" || actual == "" || len(expected) != len(actual) || subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) != 1 {
		return ErrAuthorizationNonceMismatch
	}
	return nil
}

func (manager *AuthorizationRequestManager) cleanupLocked(now time.Time) {
	for stateHash, request := range manager.pending {
		if !request.ExpiresAt.After(now) {
			delete(manager.pending, stateHash)
		}
	}
}

func hashAuthorizationState(state string) ([sha256.Size]byte, bool) {
	if !validAuthorizationSecret(state) {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256([]byte(state)), true
}

func validAuthorizationSecret(value string) bool {
	if len(value) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func normalizeAuthorizationRequestConfig(config AuthorizationRequestConfig) (AuthorizationRequestConfig, error) {
	if config.TTL == 0 {
		config.TTL = defaultAuthorizationRequestTTL
	}
	if config.MaxPending == 0 {
		config.MaxPending = maxAuthorizationRequests
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if err := validateAuthorizationEndpoint(config.AuthorizationURL, "authorization URL"); err != nil {
		return AuthorizationRequestConfig{}, err
	}
	if !boundedNonEmpty(config.ClientID) {
		return AuthorizationRequestConfig{}, errors.New("OIDC client ID must be non-empty and bounded")
	}
	if err := validateAuthorizationEndpoint(config.RedirectURL, "redirect URL"); err != nil {
		return AuthorizationRequestConfig{}, err
	}
	if config.TTL <= 0 || config.TTL > 15*time.Minute {
		return AuthorizationRequestConfig{}, errors.New("OIDC authorization request TTL must be greater than zero and at most 15 minutes")
	}
	if config.MaxPending <= 0 || config.MaxPending > maxAuthorizationRequests {
		return AuthorizationRequestConfig{}, errors.New("OIDC authorization request max pending must be between 1 and 10000")
	}
	if len(config.Scopes) == 0 {
		config.Scopes = []string{"openid"}
	}
	if len(config.Scopes) > maxAuthorizationScopeCount {
		return AuthorizationRequestConfig{}, errors.New("OIDC authorization scope count is too large")
	}
	scopes := make([]string, len(config.Scopes))
	seen := make(map[string]struct{}, len(config.Scopes))
	for index, scope := range config.Scopes {
		if scope == "" || scope != strings.TrimSpace(scope) || strings.ContainsAny(scope, "\t\r\n") || len(scope) > maxClaimStringLength {
			return AuthorizationRequestConfig{}, errors.New("OIDC authorization scope is invalid")
		}
		if _, exists := seen[scope]; exists {
			return AuthorizationRequestConfig{}, errors.New("OIDC authorization scopes must be unique")
		}
		seen[scope] = struct{}{}
		scopes[index] = scope
	}
	config.Scopes = scopes
	if len(config.ACRValues) > maxOIDCAssuranceValues {
		return AuthorizationRequestConfig{}, errors.New("OIDC authorization ACR value count is too large")
	}
	acrValues := make([]string, len(config.ACRValues))
	seenACRValues := make(map[string]struct{}, len(config.ACRValues))
	for index, value := range config.ACRValues {
		if !validOIDCAssuranceValue(value) {
			return AuthorizationRequestConfig{}, errors.New("OIDC authorization ACR value is invalid")
		}
		if _, exists := seenACRValues[value]; exists {
			return AuthorizationRequestConfig{}, errors.New("OIDC authorization ACR values must be unique")
		}
		seenACRValues[value] = struct{}{}
		acrValues[index] = value
	}
	config.ACRValues = acrValues
	return config, nil
}

func validateAuthorizationEndpoint(raw, name string) error {
	if !boundedNonEmpty(raw) {
		return errors.New("OIDC " + name + " must be non-empty and bounded")
	}
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || endpoint.User != nil || endpoint.Fragment != "" {
		return errors.New("OIDC " + name + " must be an absolute HTTPS URL without credentials or fragment")
	}
	return nil
}

func buildAuthorizationURL(config AuthorizationRequestConfig, state, nonce, codeVerifier string) string {
	endpoint, _ := url.Parse(config.AuthorizationURL)
	query := endpoint.Query()
	query.Set("response_type", "code")
	query.Set("client_id", config.ClientID)
	query.Set("redirect_uri", config.RedirectURL)
	query.Set("scope", strings.Join(config.Scopes, " "))
	if len(config.ACRValues) > 0 {
		query.Set("acr_values", strings.Join(config.ACRValues, " "))
	}
	query.Set("state", state)
	query.Set("nonce", nonce)
	query.Set("code_challenge", authorizationCodeChallenge(codeVerifier))
	query.Set("code_challenge_method", "S256")
	endpoint.RawQuery = query.Encode()
	return endpoint.String()
}

func authorizationCodeChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func newAuthorizationSecret() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}
