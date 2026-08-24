package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	maxBrowserSessions          = 10000
	maxBrowserSessionDeviceName = 64
)

var (
	// ErrBrowserSessionInvalid indicates a malformed, unknown, or CSRF-invalid session.
	ErrBrowserSessionInvalid = errors.New("invalid browser session")
	// ErrBrowserSessionExpired indicates that the application or source access-token lifetime ended.
	ErrBrowserSessionExpired = errors.New("browser session expired")
	// ErrBrowserSessionLimit indicates that the configured global session bound is exhausted.
	ErrBrowserSessionLimit = errors.New("browser session limit reached")
	// ErrBrowserSessionSubjectLimit indicates that one subject reached its configured session bound.
	ErrBrowserSessionSubjectLimit = errors.New("browser session subject limit reached")
	// ErrBrowserSessionInventoryUnavailable indicates that a legacy external store cannot list or centrally revoke sessions.
	ErrBrowserSessionInventoryUnavailable = errors.New("browser session inventory unavailable")
	// ErrBrowserSessionDeviceNameInvalid indicates a missing, oversized, or unsafe device name.
	ErrBrowserSessionDeviceNameInvalid = errors.New("browser session device name is invalid")
)

// BrowserSessionConfig bounds server-side application sessions established by
// a verified browser OIDC callback. TTL is always capped by the source access
// token expiry. Store may provide atomic cross-process persistence.
type BrowserSessionConfig struct {
	TTL                   time.Duration
	MaxSessions           int
	MaxSessionsPerSubject int
	Now                   func() time.Time
	Store                 BrowserSessionStore
}

// BrowserSessionRecord is the persistence value for an application session.
// Session and CSRF credentials never cross the store boundary in raw form.
type BrowserSessionRecord struct {
	SessionID   string
	SubjectHash [sha256.Size]byte
	Claims      Claims
	CSRFHash    [sha256.Size]byte
	DeviceName  string
	CreatedAt   time.Time
	ExpiresAt   time.Time
}

// BrowserSessionStore atomically persists, reads, and deletes browser sessions.
// Implementations must key records only by the supplied session hash and fail
// closed on backend errors.
type BrowserSessionStore interface {
	CreateBrowserSession(context.Context, [sha256.Size]byte, BrowserSessionRecord, time.Time, int) error
	ReadBrowserSession(context.Context, [sha256.Size]byte, time.Time) (BrowserSessionRecord, error)
	DeleteBrowserSession(context.Context, [sha256.Size]byte) error
}

// BrowserSessionInventoryStore is an optional extension for stores that can
// enforce per-subject limits and atomically list or centrally revoke sessions.
// Subject and session identifiers are supplied only as SHA-256 values.
type BrowserSessionInventoryStore interface {
	BrowserSessionStore
	CreateBrowserSessionWithInventory(context.Context, [sha256.Size]byte, BrowserSessionRecord, time.Time, int, int) error
	ListBrowserSessions(context.Context, [sha256.Size]byte, time.Time, int) ([]BrowserSessionInfo, error)
	DeleteBrowserSessionByID(context.Context, [sha256.Size]byte, [sha256.Size]byte) error
	DeleteBrowserSessionsForSubject(context.Context, [sha256.Size]byte, time.Time) (int, error)
}

// BrowserSessionMetadataStore is an optional inventory-store extension for
// atomically updating bounded, caller-supplied device metadata. Keeping this
// separate preserves compatibility with existing inventory implementations.
type BrowserSessionMetadataStore interface {
	BrowserSessionInventoryStore
	UpdateBrowserSessionDeviceName(context.Context, [sha256.Size]byte, [sha256.Size]byte, string, time.Time) error
}

// BrowserSessionCredentials contains the two raw credentials returned exactly
// once plus a public inventory identifier. SessionToken belongs in an HttpOnly
// cookie; CSRFToken belongs in a readable __Host- cookie and must be echoed in a
// request header.
type BrowserSessionCredentials struct {
	SessionToken string
	CSRFToken    string
	SessionID    string
	ExpiresAt    time.Time
}

// BrowserSessionInfo is the bounded, low-sensitivity session inventory view.
type BrowserSessionInfo struct {
	SessionID  string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	DeviceName string
}

// BrowserSessionManager creates and verifies bounded opaque application sessions.
type BrowserSessionManager struct {
	mu            sync.Mutex
	ttl           time.Duration
	max           int
	maxPerSubject int
	now           func() time.Time
	store         BrowserSessionStore
	sessions      map[[sha256.Size]byte]BrowserSessionRecord
}

// NewBrowserSessionManager validates configuration and creates a manager.
func NewBrowserSessionManager(config BrowserSessionConfig) (*BrowserSessionManager, error) {
	if config.TTL <= 0 || config.TTL > 24*time.Hour {
		return nil, errors.New("browser session TTL must be greater than zero and at most 24 hours")
	}
	if config.MaxSessions <= 0 || config.MaxSessions > maxBrowserSessions {
		return nil, errors.New("browser session max sessions must be between 1 and 10000")
	}
	if config.MaxSessionsPerSubject == 0 {
		config.MaxSessionsPerSubject = config.MaxSessions
	}
	if config.MaxSessionsPerSubject < 1 || config.MaxSessionsPerSubject > config.MaxSessions {
		return nil, errors.New("browser session max sessions per subject must be between 1 and max sessions")
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &BrowserSessionManager{
		ttl:           config.TTL,
		max:           config.MaxSessions,
		maxPerSubject: config.MaxSessionsPerSubject,
		now:           config.Now,
		store:         config.Store,
		sessions:      make(map[[sha256.Size]byte]BrowserSessionRecord),
	}, nil
}

// Enabled reports whether the manager has valid runtime state.
func (manager *BrowserSessionManager) Enabled() bool {
	return manager != nil && manager.ttl > 0 && manager.max > 0 && manager.maxPerSubject > 0 && manager.now != nil
}

// Start creates one opaque session from already verified access-token claims.
func (manager *BrowserSessionManager) Start(ctx context.Context, claims Claims) (BrowserSessionCredentials, error) {
	if !manager.Enabled() || ctx == nil {
		return BrowserSessionCredentials{}, ErrBrowserSessionInvalid
	}
	now := manager.now().UTC()
	if !validBrowserSessionClaims(claims, now) || !validBrowserSessionSubject(claims.Subject) {
		return BrowserSessionCredentials{}, ErrBrowserSessionInvalid
	}
	expiresAt := now.Add(manager.ttl)
	if expiresAt.After(claims.ExpiresAt.Time) {
		expiresAt = claims.ExpiresAt.Time.UTC()
	}
	if !expiresAt.After(now) {
		return BrowserSessionCredentials{}, ErrBrowserSessionExpired
	}
	sessionToken, err := newAuthorizationSecret()
	if err != nil {
		return BrowserSessionCredentials{}, err
	}
	csrfToken, err := newAuthorizationSecret()
	if err != nil {
		return BrowserSessionCredentials{}, err
	}
	sessionID, err := newAuthorizationSecret()
	if err != nil {
		return BrowserSessionCredentials{}, err
	}
	sessionHash := sha256.Sum256([]byte(sessionToken))
	record := BrowserSessionRecord{
		SessionID:   sessionID,
		SubjectHash: sha256.Sum256([]byte(claims.Subject)),
		Claims:      cloneClaims(claims),
		CSRFHash:    sha256.Sum256([]byte(csrfToken)),
		CreatedAt:   now,
		ExpiresAt:   expiresAt,
	}
	if manager.store != nil {
		var err error
		if inventory, ok := manager.store.(BrowserSessionInventoryStore); ok {
			err = inventory.CreateBrowserSessionWithInventory(ctx, sessionHash, record, now, manager.max, manager.maxPerSubject)
		} else {
			err = manager.store.CreateBrowserSession(ctx, sessionHash, record, now, manager.max)
		}
		if err != nil {
			return BrowserSessionCredentials{}, err
		}
	} else {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		manager.cleanupLocked(now)
		if len(manager.sessions) >= manager.max {
			return BrowserSessionCredentials{}, ErrBrowserSessionLimit
		}
		if manager.subjectSessionCountLocked(record.SubjectHash) >= manager.maxPerSubject {
			return BrowserSessionCredentials{}, ErrBrowserSessionSubjectLimit
		}
		if _, exists := manager.sessions[sessionHash]; exists {
			return BrowserSessionCredentials{}, ErrBrowserSessionInvalid
		}
		manager.sessions[sessionHash] = record
	}
	return BrowserSessionCredentials{SessionToken: sessionToken, CSRFToken: csrfToken, SessionID: sessionID, ExpiresAt: expiresAt}, nil
}

// Verify resolves an opaque session and optionally requires its bound CSRF token.
func (manager *BrowserSessionManager) Verify(ctx context.Context, sessionToken, csrfToken string, requireCSRF bool) (Claims, error) {
	if !manager.Enabled() || ctx == nil {
		return Claims{}, ErrBrowserSessionInvalid
	}
	sessionHash, ok := hashBrowserSecret(sessionToken)
	if !ok {
		return Claims{}, ErrBrowserSessionInvalid
	}
	now := manager.now().UTC()
	var record BrowserSessionRecord
	var err error
	if manager.store != nil {
		record, err = manager.store.ReadBrowserSession(ctx, sessionHash, now)
		if err != nil {
			return Claims{}, err
		}
	} else {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		record, ok = manager.sessions[sessionHash]
		if !ok {
			return Claims{}, ErrBrowserSessionInvalid
		}
		if !record.ExpiresAt.After(now) {
			delete(manager.sessions, sessionHash)
			return Claims{}, ErrBrowserSessionExpired
		}
	}
	if !validBrowserSessionRecord(record, now) {
		return Claims{}, ErrBrowserSessionExpired
	}
	if requireCSRF {
		csrfHash, valid := hashBrowserSecret(csrfToken)
		if !valid || subtle.ConstantTimeCompare(csrfHash[:], record.CSRFHash[:]) != 1 {
			return Claims{}, ErrBrowserSessionInvalid
		}
	}
	return cloneClaims(record.Claims), nil
}

// ListForSubject returns active sessions newest first for a trusted subject boundary.
func (manager *BrowserSessionManager) ListForSubject(ctx context.Context, subject string) ([]BrowserSessionInfo, error) {
	if !manager.Enabled() || ctx == nil || !validBrowserSessionSubject(subject) {
		return nil, ErrBrowserSessionInvalid
	}
	now := manager.now().UTC()
	subjectHash := sha256.Sum256([]byte(subject))
	if manager.store != nil {
		inventory, ok := manager.store.(BrowserSessionInventoryStore)
		if !ok {
			return nil, ErrBrowserSessionInventoryUnavailable
		}
		items, err := inventory.ListBrowserSessions(ctx, subjectHash, now, manager.maxPerSubject)
		if err != nil {
			return nil, err
		}
		if len(items) > manager.maxPerSubject || !validBrowserSessionInventory(items, now) {
			return nil, ErrBrowserSessionInvalid
		}
		sortBrowserSessionInfo(items)
		return items, nil
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.cleanupLocked(now)
	items := make([]BrowserSessionInfo, 0, manager.maxPerSubject)
	for _, record := range manager.sessions {
		if record.SubjectHash == subjectHash {
			items = append(items, browserSessionInfo(record))
		}
	}
	sortBrowserSessionInfo(items)
	return items, nil
}

// RevokeForSubject revokes one public session identifier only when it belongs to subject.
func (manager *BrowserSessionManager) RevokeForSubject(ctx context.Context, subject, sessionID string) error {
	if !manager.Enabled() || ctx == nil || !validBrowserSessionSubject(subject) {
		return ErrBrowserSessionInvalid
	}
	sessionIDHash, ok := hashBrowserSecret(sessionID)
	if !ok {
		return ErrBrowserSessionInvalid
	}
	subjectHash := sha256.Sum256([]byte(subject))
	if manager.store != nil {
		inventory, ok := manager.store.(BrowserSessionInventoryStore)
		if !ok {
			return ErrBrowserSessionInventoryUnavailable
		}
		return inventory.DeleteBrowserSessionByID(ctx, subjectHash, sessionIDHash)
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.cleanupLocked(manager.now().UTC())
	for tokenHash, record := range manager.sessions {
		if record.SubjectHash == subjectHash && sha256.Sum256([]byte(record.SessionID)) == sessionIDHash {
			delete(manager.sessions, tokenHash)
			return nil
		}
	}
	return ErrBrowserSessionInvalid
}

// RevokeAllForSubject atomically revokes all sessions for a trusted subject boundary.
func (manager *BrowserSessionManager) RevokeAllForSubject(ctx context.Context, subject string) (int, error) {
	if !manager.Enabled() || ctx == nil || !validBrowserSessionSubject(subject) {
		return 0, ErrBrowserSessionInvalid
	}
	subjectHash := sha256.Sum256([]byte(subject))
	if manager.store != nil {
		inventory, ok := manager.store.(BrowserSessionInventoryStore)
		if !ok {
			return 0, ErrBrowserSessionInventoryUnavailable
		}
		return inventory.DeleteBrowserSessionsForSubject(ctx, subjectHash, manager.now().UTC())
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.cleanupLocked(manager.now().UTC())
	deleted := 0
	for tokenHash, record := range manager.sessions {
		if record.SubjectHash == subjectHash {
			delete(manager.sessions, tokenHash)
			deleted++
		}
	}
	return deleted, nil
}

// SetDeviceNameForSubject updates one subject-owned session's bounded device
// name. External stores must implement BrowserSessionMetadataStore so the
// ownership check and update remain atomic across processes.
func (manager *BrowserSessionManager) SetDeviceNameForSubject(ctx context.Context, subject, sessionID, deviceName string) error {
	if !manager.Enabled() || ctx == nil || !validBrowserSessionSubject(subject) {
		return ErrBrowserSessionInvalid
	}
	if !validBrowserSessionDeviceName(deviceName) {
		return ErrBrowserSessionDeviceNameInvalid
	}
	sessionIDHash, ok := hashBrowserSecret(sessionID)
	if !ok {
		return ErrBrowserSessionInvalid
	}
	subjectHash := sha256.Sum256([]byte(subject))
	now := manager.now().UTC()
	if manager.store != nil {
		metadata, ok := manager.store.(BrowserSessionMetadataStore)
		if !ok {
			return ErrBrowserSessionInventoryUnavailable
		}
		return metadata.UpdateBrowserSessionDeviceName(ctx, subjectHash, sessionIDHash, deviceName, now)
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.cleanupLocked(now)
	for tokenHash, record := range manager.sessions {
		if record.SubjectHash != subjectHash || sha256.Sum256([]byte(record.SessionID)) != sessionIDHash {
			continue
		}
		record.DeviceName = deviceName
		manager.sessions[tokenHash] = record
		return nil
	}
	return ErrBrowserSessionInvalid
}

// End revokes one opaque session immediately.
func (manager *BrowserSessionManager) End(ctx context.Context, sessionToken string) error {
	if !manager.Enabled() || ctx == nil {
		return ErrBrowserSessionInvalid
	}
	sessionHash, ok := hashBrowserSecret(sessionToken)
	if !ok {
		return ErrBrowserSessionInvalid
	}
	if manager.store != nil {
		return manager.store.DeleteBrowserSession(ctx, sessionHash)
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if _, exists := manager.sessions[sessionHash]; !exists {
		return ErrBrowserSessionInvalid
	}
	delete(manager.sessions, sessionHash)
	return nil
}

func (manager *BrowserSessionManager) cleanupLocked(now time.Time) {
	for sessionHash, record := range manager.sessions {
		if !record.ExpiresAt.After(now) {
			delete(manager.sessions, sessionHash)
		}
	}
}

func (manager *BrowserSessionManager) subjectSessionCountLocked(subjectHash [sha256.Size]byte) int {
	count := 0
	for _, record := range manager.sessions {
		if record.SubjectHash == subjectHash {
			count++
		}
	}
	return count
}

func validBrowserSessionRecord(record BrowserSessionRecord, now time.Time) bool {
	_, validSessionID := hashBrowserSecret(record.SessionID)
	return validSessionID && record.SubjectHash == sha256.Sum256([]byte(record.Claims.Subject)) &&
		!record.CreatedAt.IsZero() && !record.CreatedAt.After(now) && record.ExpiresAt.After(record.CreatedAt) && record.ExpiresAt.After(now) &&
		validBrowserSessionDeviceName(record.DeviceName) && validBrowserSessionClaims(record.Claims, now) && !record.ExpiresAt.After(record.Claims.ExpiresAt.Time)
}

func validBrowserSessionInventory(items []BrowserSessionInfo, now time.Time) bool {
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, valid := hashBrowserSecret(item.SessionID); !valid || !validBrowserSessionDeviceName(item.DeviceName) || item.CreatedAt.IsZero() || item.CreatedAt.After(now) || !item.ExpiresAt.After(item.CreatedAt) || !item.ExpiresAt.After(now) {
			return false
		}
		if _, exists := seen[item.SessionID]; exists {
			return false
		}
		seen[item.SessionID] = struct{}{}
	}
	return true
}

func browserSessionInfo(record BrowserSessionRecord) BrowserSessionInfo {
	return BrowserSessionInfo{SessionID: record.SessionID, CreatedAt: record.CreatedAt, ExpiresAt: record.ExpiresAt, DeviceName: record.DeviceName}
}

func sortBrowserSessionInfo(items []BrowserSessionInfo) {
	sort.Slice(items, func(left, right int) bool {
		if !items[left].CreatedAt.Equal(items[right].CreatedAt) {
			return items[left].CreatedAt.After(items[right].CreatedAt)
		}
		return items[left].SessionID < items[right].SessionID
	})
}

func validBrowserSessionSubject(subject string) bool {
	return boundedNonEmpty(subject) && strings.IndexFunc(subject, unicode.IsControl) < 0
}

func validBrowserSessionDeviceName(value string) bool {
	if value == "" {
		return true
	}
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= maxBrowserSessionDeviceName &&
		strings.TrimSpace(value) == value && strings.IndexFunc(value, unicode.IsControl) < 0
}

func validBrowserSessionClaims(claims Claims, now time.Time) bool {
	if claims.IssuedAt == nil || claims.ExpiresAt == nil || !claims.ExpiresAt.Time.After(now) || !claims.ExpiresAt.Time.After(claims.IssuedAt.Time) {
		return false
	}
	return validClaims(claims, now, claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time))
}

func hashBrowserSecret(raw string) ([sha256.Size]byte, bool) {
	if len(raw) != 43 {
		return [sha256.Size]byte{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(decoded) != 32 {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256([]byte(raw)), true
}

func cloneClaims(claims Claims) Claims {
	clone := claims
	clone.RoleIDs = append([]string(nil), claims.RoleIDs...)
	clone.RoleNames = append([]string(nil), claims.RoleNames...)
	clone.Audience = append(claims.Audience[:0:0], claims.Audience...)
	return clone
}
