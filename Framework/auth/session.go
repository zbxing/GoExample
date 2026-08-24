package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
)

const (
	refreshTokenRandomBytes   = 32
	maxRefreshTokenBytes      = 128
	maxSessionFamilies        = 10000
	maxSessionTokensPerFamily = 1024
)

var (
	// ErrSessionInvalid indicates an unknown or malformed refresh token.
	ErrSessionInvalid = errors.New("invalid refresh session")
	// ErrSessionExpired indicates that the token or its family lifetime ended.
	ErrSessionExpired = errors.New("refresh session expired")
	// ErrSessionRevoked indicates that the family was centrally revoked.
	ErrSessionRevoked = errors.New("refresh session revoked")
	// ErrSessionReuse indicates replay of a refresh token that was already rotated.
	ErrSessionReuse = errors.New("refresh token reuse detected")
	// ErrSessionLimit indicates that the configured family bound is exhausted.
	ErrSessionLimit = errors.New("refresh session family limit reached")
)

// SessionConfig bounds refresh-session lifetime and local or persisted state.
// AbsoluteTTL must be at least RefreshTTL. Now is injectable for deterministic tests.
type SessionConfig struct {
	RefreshTTL  time.Duration
	AbsoluteTTL time.Duration
	MaxFamilies int
	Now         func() time.Time
	Store       SessionStore
}

// SessionStore is the atomic persistence contract for refresh-token families.
// Implementations must never persist raw refresh tokens and must make Rotate
// linearizable across all callers sharing the store. Backend errors must fail
// closed; the manager never falls back to local state when Store is configured.
type SessionStore interface {
	CreateSession(ctx context.Context, userID, familyID string, tokenHash [sha256.Size]byte, now, absoluteExpiresAt, currentExpiresAt time.Time, maxFamilies int) error
	RotateSession(ctx context.Context, tokenHash, newHash [sha256.Size]byte, now time.Time, refreshTTL time.Duration, historyLimit int) (time.Time, error)
	RevokeFamily(ctx context.Context, tokenHash [sha256.Size]byte, now time.Time) error
	RevokeUser(ctx context.Context, userID string, now time.Time) (int, error)
	ActiveFamilies(ctx context.Context, userID string, now time.Time) (int, error)
}

// SessionManager provides transport-neutral refresh-token family management.
// It stores only SHA-256 token hashes; callers receive the raw token once from Start or Rotate.
type SessionManager struct {
	mu       sync.Mutex
	config   SessionConfig
	now      func() time.Time
	store    SessionStore
	families map[string]*sessionFamily
	tokens   map[[sha256.Size]byte]*sessionFamily
}

type sessionFamily struct {
	id                string
	userID            string
	absoluteExpiresAt time.Time
	currentHash       [sha256.Size]byte
	currentExpiresAt  time.Time
	used              map[[sha256.Size]byte]struct{}
	revoked           bool
	expired           bool
}

// NewSessionManager validates configuration and creates a bounded manager.
func NewSessionManager(config SessionConfig) (*SessionManager, error) {
	if config.RefreshTTL <= 0 {
		return nil, errors.New("refresh session TTL must be greater than zero")
	}
	if config.AbsoluteTTL < config.RefreshTTL {
		return nil, errors.New("refresh session absolute TTL must be at least refresh TTL")
	}
	if config.MaxFamilies <= 0 || config.MaxFamilies > maxSessionFamilies {
		return nil, errors.New("refresh session max families must be between 1 and 10000")
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &SessionManager{
		config:   config,
		now:      config.Now,
		store:    config.Store,
		families: make(map[string]*sessionFamily),
		tokens:   make(map[[sha256.Size]byte]*sessionFamily),
	}, nil
}

// Start creates a refresh-token family for userID and returns its raw token once.
func (manager *SessionManager) Start(userID string) (string, time.Time, error) {
	if manager == nil || !validSessionUserID(userID) {
		return "", time.Time{}, ErrSessionInvalid
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now().UTC()
	if manager.store != nil {
		familyID, err := randomID()
		if err != nil {
			return "", time.Time{}, err
		}
		rawToken, tokenHash, err := newRefreshToken()
		if err != nil {
			return "", time.Time{}, err
		}
		absoluteExpiresAt := now.Add(manager.config.AbsoluteTTL)
		expiresAt := now.Add(manager.config.RefreshTTL)
		if expiresAt.After(absoluteExpiresAt) {
			expiresAt = absoluteExpiresAt
		}
		if err := manager.store.CreateSession(context.Background(), userID, familyID, tokenHash, now, absoluteExpiresAt, expiresAt, manager.config.MaxFamilies); err != nil {
			return "", time.Time{}, err
		}
		return rawToken, expiresAt, nil
	}
	manager.cleanupLocked(now)
	if len(manager.families) >= manager.config.MaxFamilies {
		return "", time.Time{}, ErrSessionLimit
	}
	familyID, err := randomID()
	if err != nil {
		return "", time.Time{}, err
	}
	rawToken, tokenHash, err := newRefreshToken()
	if err != nil {
		return "", time.Time{}, err
	}
	absoluteExpiresAt := now.Add(manager.config.AbsoluteTTL)
	expiresAt := now.Add(manager.config.RefreshTTL)
	if expiresAt.After(absoluteExpiresAt) {
		expiresAt = absoluteExpiresAt
	}
	family := &sessionFamily{
		id:                familyID,
		userID:            userID,
		absoluteExpiresAt: absoluteExpiresAt,
		currentHash:       tokenHash,
		currentExpiresAt:  expiresAt,
		used:              make(map[[sha256.Size]byte]struct{}),
	}
	manager.families[familyID] = family
	manager.tokens[tokenHash] = family
	return rawToken, expiresAt, nil
}

// Rotate atomically rotates a current refresh token. Replaying a rotated token revokes its family.
func (manager *SessionManager) Rotate(refreshToken string) (string, time.Time, error) {
	if manager == nil {
		return "", time.Time{}, ErrSessionInvalid
	}
	tokenHash, ok := hashRefreshToken(refreshToken)
	if !ok {
		return "", time.Time{}, ErrSessionInvalid
	}
	if manager.store != nil {
		now := manager.now().UTC()
		rawToken, newHash, err := newRefreshToken()
		if err != nil {
			return "", time.Time{}, err
		}
		expiresAt, err := manager.store.RotateSession(context.Background(), tokenHash, newHash, now, manager.config.RefreshTTL, maxSessionTokensPerFamily)
		if err != nil {
			return "", time.Time{}, err
		}
		return rawToken, expiresAt, nil
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now().UTC()
	family, exists := manager.tokens[tokenHash]
	if exists && !family.absoluteExpiresAt.After(now) {
		family.revoked = true
		family.expired = true
		return "", time.Time{}, ErrSessionExpired
	}
	manager.cleanupLocked(now)
	family, exists = manager.tokens[tokenHash]
	if !exists {
		return "", time.Time{}, ErrSessionInvalid
	}
	if family.revoked {
		if _, reused := family.used[tokenHash]; reused {
			return "", time.Time{}, ErrSessionReuse
		}
		if family.expired {
			return "", time.Time{}, ErrSessionExpired
		}
		return "", time.Time{}, ErrSessionRevoked
	}
	if !family.absoluteExpiresAt.After(now) || !family.currentExpiresAt.After(now) {
		family.revoked = true
		family.expired = true
		return "", time.Time{}, ErrSessionExpired
	}
	if tokenHash != family.currentHash {
		family.revoked = true
		return "", time.Time{}, ErrSessionReuse
	}
	if len(family.used) >= maxSessionTokensPerFamily {
		family.revoked = true
		return "", time.Time{}, ErrSessionLimit
	}
	rawToken, newHash, err := newRefreshToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt := now.Add(manager.config.RefreshTTL)
	if expiresAt.After(family.absoluteExpiresAt) {
		expiresAt = family.absoluteExpiresAt
	}
	family.used[tokenHash] = struct{}{}
	family.currentHash = newHash
	family.currentExpiresAt = expiresAt
	manager.tokens[newHash] = family
	return rawToken, expiresAt, nil
}

// RevokeFamily revokes the family associated with refreshToken.
func (manager *SessionManager) RevokeFamily(refreshToken string) error {
	if manager == nil {
		return ErrSessionInvalid
	}
	tokenHash, ok := hashRefreshToken(refreshToken)
	if !ok {
		return ErrSessionInvalid
	}
	if manager.store != nil {
		return manager.store.RevokeFamily(context.Background(), tokenHash, manager.now().UTC())
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now().UTC()
	family, exists := manager.tokens[tokenHash]
	if exists && !family.absoluteExpiresAt.After(now) {
		family.revoked = true
		family.expired = true
		return ErrSessionExpired
	}
	manager.cleanupLocked(now)
	family, exists = manager.tokens[tokenHash]
	if !exists {
		return ErrSessionInvalid
	}
	if !family.absoluteExpiresAt.After(now) || family.expired {
		return ErrSessionExpired
	}
	family.revoked = true
	return nil
}

// RevokeUser revokes all active families for userID and returns the number changed.
func (manager *SessionManager) RevokeUser(userID string) int {
	if manager == nil || !validSessionUserID(userID) {
		return 0
	}
	if manager.store != nil {
		count, err := manager.store.RevokeUser(context.Background(), userID, manager.now().UTC())
		if err != nil {
			return 0
		}
		return count
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now().UTC()
	manager.cleanupLocked(now)
	count := 0
	for _, family := range manager.families {
		if family.userID == userID && !family.revoked && family.currentExpiresAt.After(now) {
			family.revoked = true
			count++
		}
	}
	return count
}

// ActiveFamilies returns the number of non-revoked, non-expired families for userID.
func (manager *SessionManager) ActiveFamilies(userID string) int {
	if manager == nil || !validSessionUserID(userID) {
		return 0
	}
	if manager.store != nil {
		count, err := manager.store.ActiveFamilies(context.Background(), userID, manager.now().UTC())
		if err != nil {
			return 0
		}
		return count
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now().UTC()
	manager.cleanupLocked(now)
	count := 0
	for _, family := range manager.families {
		if family.userID == userID && !family.revoked && family.currentExpiresAt.After(now) && family.absoluteExpiresAt.After(now) {
			count++
		}
	}
	return count
}

func (manager *SessionManager) cleanupLocked(now time.Time) {
	for familyID, family := range manager.families {
		if family.absoluteExpiresAt.After(now) {
			continue
		}
		delete(manager.tokens, family.currentHash)
		for usedHash := range family.used {
			delete(manager.tokens, usedHash)
		}
		delete(manager.families, familyID)
	}
}

func validSessionUserID(userID string) bool {
	return strings.TrimSpace(userID) == userID && boundedNonEmpty(userID)
}

func newRefreshToken() (string, [sha256.Size]byte, error) {
	buffer := make([]byte, refreshTokenRandomBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", [sha256.Size]byte{}, err
	}
	rawToken := base64.RawURLEncoding.EncodeToString(buffer)
	return rawToken, sha256.Sum256([]byte(rawToken)), nil
}

func hashRefreshToken(rawToken string) ([sha256.Size]byte, bool) {
	if len(rawToken) == 0 || len(rawToken) > maxRefreshTokenBytes {
		return [sha256.Size]byte{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil || len(decoded) != refreshTokenRandomBytes {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256([]byte(rawToken)), true
}
