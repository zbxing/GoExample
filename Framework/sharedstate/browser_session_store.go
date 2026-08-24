package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	"github.com/zbxing/goexample/Framework/auth"
)

const (
	browserSessionKeyNamespace = "browser-session:"
	maxBrowserSessionPayload   = 64 << 10
	maxBrowserSessionInventory = 10000
)

var (
	createBrowserSessionScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local subjectMaximum = tonumber(ARGV[4])
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
if redis.call("ZCARD", KEYS[2]) >= maximum then return 1 end
if redis.call("ZCARD", KEYS[3]) >= subjectMaximum then return 4 end
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[4]) == 1 or redis.call("EXISTS", KEYS[5]) == 1 then return 2 end
local ttl = expires - now
if ttl < 1 then return 3 end
redis.call("SET", KEYS[1], ARGV[5], "PX", ttl)
redis.call("SET", KEYS[4], ARGV[6], "PX", ttl)
redis.call("SET", KEYS[5], ARGV[7], "PX", ttl)
redis.call("ZADD", KEYS[2], expires, ARGV[8])
redis.call("ZADD", KEYS[3], expires, ARGV[8])
return 0
`)
	deleteBrowserSessionScript = redis.NewScript(`
if redis.call("GET", KEYS[5]) ~= ARGV[1] then return 0 end
local deleted = redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[4], KEYS[5])
redis.call("ZREM", KEYS[2], ARGV[2])
redis.call("ZREM", KEYS[3], ARGV[2])
return deleted
`)
	deleteBrowserSessionByIDScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call("GET", KEYS[5]) ~= ARGV[2] then return 0 end
local deleted = redis.call("DEL", KEYS[2])
redis.call("DEL", KEYS[1], KEYS[5])
redis.call("ZREM", KEYS[3], ARGV[3])
redis.call("ZREM", KEYS[4], ARGV[3])
return deleted
`)
	updateBrowserSessionDeviceNameScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call("GET", KEYS[3]) ~= ARGV[2] then return 0 end
if redis.call("GET", KEYS[2]) ~= ARGV[3] then return 0 end
local ttl = redis.call("PTTL", KEYS[2])
if ttl <= 0 then return 0 end
redis.call("SET", KEYS[2], ARGV[4], "PX", ttl)
return 1
`)
	deleteBrowserSessionsForSubjectScript = redis.NewScript(`
local now = tonumber(ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
local tokens = redis.call("ZRANGE", KEYS[1], 0, -1)
for _, token in ipairs(tokens) do
  if string.len(token) ~= 64 or not string.match(token, "^[0-9a-f]+$") then return -1 end
  local metadata = redis.call("GET", ARGV[5] .. token)
  if not metadata then return -1 end
  local owner, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
  if owner ~= ARGV[2] or not sessionID or string.len(sessionID) ~= 64 then return -1 end
end
for _, token in ipairs(tokens) do
  local metadata = redis.call("GET", ARGV[5] .. token)
  local _, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
  redis.call("DEL", ARGV[3] .. token, ARGV[4] .. sessionID, ARGV[5] .. token)
  redis.call("ZREM", KEYS[2], token)
end
redis.call("DEL", KEYS[1])
return #tokens
`)
)

type browserSessionPayload struct {
	Claims          auth.Claims `json:"claims"`
	CSRFHash        string      `json:"csrfHash"`
	DeviceName      string      `json:"deviceName,omitempty"`
	SessionID       string      `json:"sessionId"`
	SubjectHash     string      `json:"subjectHash"`
	CreatedAtMillis int64       `json:"createdAtMillis"`
	ExpiresAtMillis int64       `json:"expiresAtMillis"`
}

// CreateBrowserSession stores only the session hash key, CSRF hash, bounded
// claims, and expiry. A Lua gate makes the global session limit atomic.
func (s *Redis) CreateBrowserSession(ctx context.Context, tokenHash [sha256.Size]byte, record auth.BrowserSessionRecord, now time.Time, maxSessions int) error {
	return s.CreateBrowserSessionWithInventory(ctx, tokenHash, record, now, maxSessions, maxSessions)
}

// CreateBrowserSessionWithInventory atomically enforces global and per-subject
// bounds while creating payload, subject, public-ID, and token metadata indexes.
func (s *Redis) CreateBrowserSessionWithInventory(ctx context.Context, tokenHash [sha256.Size]byte, record auth.BrowserSessionRecord, now time.Time, maxSessions, maxSessionsPerSubject int) error {
	if s == nil || ctx == nil || maxSessions <= 0 || maxSessionsPerSubject <= 0 || maxSessionsPerSubject > maxSessions ||
		!validBrowserSessionPublicID(record.SessionID) || !validBrowserSessionDeviceName(record.DeviceName) || !record.ExpiresAt.After(now) || record.CreatedAt.IsZero() || record.CreatedAt.After(now) || !record.ExpiresAt.After(record.CreatedAt) ||
		record.SubjectHash != sha256.Sum256([]byte(record.Claims.Subject)) || !validBrowserSessionStoredSubject(record.Claims.Subject) {
		return errors.New("invalid browser session store create request")
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	sessionIDHash := sha256.Sum256([]byte(record.SessionID))
	sessionIDHex := hex.EncodeToString(sessionIDHash[:])
	subjectHex := hex.EncodeToString(record.SubjectHash[:])
	payload, err := json.Marshal(browserSessionPayload{
		Claims:          record.Claims,
		CSRFHash:        hex.EncodeToString(record.CSRFHash[:]),
		DeviceName:      record.DeviceName,
		SessionID:       record.SessionID,
		SubjectHash:     subjectHex,
		CreatedAtMillis: record.CreatedAt.UTC().UnixMilli(),
		ExpiresAtMillis: record.ExpiresAt.UTC().UnixMilli(),
	})
	if err != nil || len(payload) == 0 || len(payload) > maxBrowserSessionPayload {
		return errors.New("browser session payload is invalid or too large")
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := createBrowserSessionScript.Run(operationCtx, s.client, []string{
		s.browserSessionKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionMetadataKey(tokenHex),
	}, now.UTC().UnixMilli(), record.ExpiresAt.UTC().UnixMilli(), maxSessions, maxSessionsPerSubject, payload,
		subjectHex+":"+tokenHex, subjectHex+":"+sessionIDHex, tokenHex).Int()
	if err != nil {
		return sessionRedisFailure("create browser session", err)
	}
	switch result {
	case 0:
		return nil
	case 1:
		return auth.ErrBrowserSessionLimit
	case 2:
		return auth.ErrBrowserSessionInvalid
	case 3:
		return auth.ErrBrowserSessionExpired
	case 4:
		return auth.ErrBrowserSessionSubjectLimit
	default:
		return errors.New("browser session store rejected create")
	}
}

// ReadBrowserSession resolves a hash-keyed session and rejects malformed or
// expired backend state without returning Redis details.
func (s *Redis) ReadBrowserSession(ctx context.Context, tokenHash [sha256.Size]byte, now time.Time) (auth.BrowserSessionRecord, error) {
	if s == nil || ctx == nil {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	rawPayload, err := s.client.Get(operationCtx, s.browserSessionKey(tokenHex)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
		}
		return auth.BrowserSessionRecord{}, sessionRedisFailure("read browser session", err)
	}
	if len(rawPayload) == 0 || len(rawPayload) > maxBrowserSessionPayload {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	record, err := decodeBrowserSessionPayload(rawPayload)
	if err != nil {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	if !record.ExpiresAt.After(now.UTC()) {
		_ = s.deleteBrowserSessionByHash(context.Background(), tokenHex)
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionExpired
	}
	return record, nil
}

// DeleteBrowserSession immediately revokes one hash-keyed session.
func (s *Redis) DeleteBrowserSession(ctx context.Context, tokenHash [sha256.Size]byte) error {
	if s == nil || ctx == nil {
		return auth.ErrBrowserSessionInvalid
	}
	return s.deleteBrowserSessionByHash(ctx, hex.EncodeToString(tokenHash[:]))
}

func (s *Redis) deleteBrowserSessionByHash(ctx context.Context, tokenHex string) error {
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	metadata, err := s.client.Get(operationCtx, s.browserSessionMetadataKey(tokenHex)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.ErrBrowserSessionInvalid
		}
		return sessionRedisFailure("read browser session metadata", err)
	}
	subjectHex, sessionIDHex, valid := parseBrowserSessionMetadata(metadata)
	if !valid {
		return auth.ErrBrowserSessionInvalid
	}
	deleted, err := deleteBrowserSessionScript.Run(operationCtx, s.client, []string{
		s.browserSessionKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionMetadataKey(tokenHex),
	}, metadata, tokenHex).Int()
	if err != nil {
		return sessionRedisFailure("delete browser session", err)
	}
	if deleted != 1 {
		return auth.ErrBrowserSessionInvalid
	}
	return nil
}

// ListBrowserSessions returns a bounded active-session inventory for one hashed subject.
func (s *Redis) ListBrowserSessions(ctx context.Context, subjectHash [sha256.Size]byte, now time.Time, limit int) ([]auth.BrowserSessionInfo, error) {
	if s == nil || ctx == nil || limit <= 0 || limit > maxBrowserSessionInventory {
		return nil, auth.ErrBrowserSessionInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	if err := s.client.ZRemRangeByScore(operationCtx, s.browserSubjectSessionsKey(subjectHex), "-inf", formatRedisMillis(now.UTC().UnixMilli())).Err(); err != nil {
		return nil, sessionRedisFailure("clean browser session inventory", err)
	}
	tokens, err := s.client.ZRange(operationCtx, s.browserSubjectSessionsKey(subjectHex), 0, int64(limit)).Result()
	if err != nil {
		return nil, sessionRedisFailure("list browser sessions", err)
	}
	if len(tokens) > limit {
		return nil, auth.ErrBrowserSessionInvalid
	}
	items := make([]auth.BrowserSessionInfo, 0, len(tokens))
	for _, tokenHex := range tokens {
		if !validSHA256Hex(tokenHex) {
			return nil, auth.ErrBrowserSessionInvalid
		}
		rawPayload, getErr := s.client.Get(operationCtx, s.browserSessionKey(tokenHex)).Bytes()
		if getErr != nil {
			if errors.Is(getErr, redis.Nil) {
				return nil, auth.ErrBrowserSessionInvalid
			}
			return nil, sessionRedisFailure("read browser session inventory", getErr)
		}
		record, decodeErr := decodeBrowserSessionPayload(rawPayload)
		if decodeErr != nil || record.SubjectHash != subjectHash || !record.ExpiresAt.After(now.UTC()) {
			return nil, auth.ErrBrowserSessionInvalid
		}
		items = append(items, auth.BrowserSessionInfo{SessionID: record.SessionID, CreatedAt: record.CreatedAt, ExpiresAt: record.ExpiresAt, DeviceName: record.DeviceName})
	}
	return items, nil
}

// DeleteBrowserSessionByID atomically revokes one session only for its hashed owner.
func (s *Redis) DeleteBrowserSessionByID(ctx context.Context, subjectHash, sessionIDHash [sha256.Size]byte) error {
	if s == nil || ctx == nil {
		return auth.ErrBrowserSessionInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	sessionIDHex := hex.EncodeToString(sessionIDHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	mapping, err := s.client.Get(operationCtx, s.browserSessionIDKey(sessionIDHex)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.ErrBrowserSessionInvalid
		}
		return sessionRedisFailure("read browser session ID", err)
	}
	ownerHex, tokenHex, valid := parseBrowserSessionMetadata(mapping)
	if !valid || ownerHex != subjectHex {
		return auth.ErrBrowserSessionInvalid
	}
	metadata := subjectHex + ":" + sessionIDHex
	deleted, err := deleteBrowserSessionByIDScript.Run(operationCtx, s.client, []string{
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
		s.browserSessionMetadataKey(tokenHex),
	}, mapping, metadata, tokenHex).Int()
	if err != nil {
		return sessionRedisFailure("delete browser session by ID", err)
	}
	if deleted != 1 {
		return auth.ErrBrowserSessionInvalid
	}
	return nil
}

// UpdateBrowserSessionDeviceName atomically changes one subject-owned device
// name. The compare-and-swap payload check keeps concurrent revoke/update
// operations from resurrecting a session or losing a newer update, while the
// existing Redis TTL is preserved.
func (s *Redis) UpdateBrowserSessionDeviceName(ctx context.Context, subjectHash, sessionIDHash [sha256.Size]byte, deviceName string, now time.Time) error {
	if s == nil || ctx == nil {
		return auth.ErrBrowserSessionInvalid
	}
	if !validBrowserSessionDeviceName(deviceName) {
		return auth.ErrBrowserSessionDeviceNameInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	sessionIDHex := hex.EncodeToString(sessionIDHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	mapping, err := s.client.Get(operationCtx, s.browserSessionIDKey(sessionIDHex)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.ErrBrowserSessionInvalid
		}
		return sessionRedisFailure("read browser session device metadata", err)
	}
	ownerHex, tokenHex, valid := parseBrowserSessionMetadata(mapping)
	if !valid || ownerHex != subjectHex {
		return auth.ErrBrowserSessionInvalid
	}
	payloadKey := s.browserSessionKey(tokenHex)
	rawPayload, err := s.client.Get(operationCtx, payloadKey).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.ErrBrowserSessionInvalid
		}
		return sessionRedisFailure("read browser session device payload", err)
	}
	record, err := decodeBrowserSessionPayload(rawPayload)
	if err != nil || record.SubjectHash != subjectHash || sha256.Sum256([]byte(record.SessionID)) != sessionIDHash ||
		!record.ExpiresAt.After(now.UTC()) || record.CreatedAt.IsZero() || record.CreatedAt.After(now.UTC()) ||
		record.SubjectHash != sha256.Sum256([]byte(record.Claims.Subject)) {
		return auth.ErrBrowserSessionInvalid
	}
	record.DeviceName = deviceName
	updatedPayload, err := json.Marshal(browserSessionPayload{
		Claims:          record.Claims,
		CSRFHash:        hex.EncodeToString(record.CSRFHash[:]),
		DeviceName:      record.DeviceName,
		SessionID:       record.SessionID,
		SubjectHash:     subjectHex,
		CreatedAtMillis: record.CreatedAt.UTC().UnixMilli(),
		ExpiresAtMillis: record.ExpiresAt.UTC().UnixMilli(),
	})
	if err != nil || len(updatedPayload) == 0 || len(updatedPayload) > maxBrowserSessionPayload {
		return auth.ErrBrowserSessionInvalid
	}
	metadata := subjectHex + ":" + sessionIDHex
	result, err := updateBrowserSessionDeviceNameScript.Run(operationCtx, s.client, []string{
		s.browserSessionIDKey(sessionIDHex), payloadKey, s.browserSessionMetadataKey(tokenHex),
	}, mapping, metadata, string(rawPayload), string(updatedPayload)).Int()
	if err != nil {
		return sessionRedisFailure("update browser session device metadata", err)
	}
	if result != 1 {
		return auth.ErrBrowserSessionInvalid
	}
	return nil
}

// DeleteBrowserSessionsForSubject atomically revokes every active session for a hashed subject.
func (s *Redis) DeleteBrowserSessionsForSubject(ctx context.Context, subjectHash [sha256.Size]byte, now time.Time) (int, error) {
	if s == nil || ctx == nil {
		return 0, auth.ErrBrowserSessionInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	deleted, err := deleteBrowserSessionsForSubjectScript.Run(operationCtx, s.client, []string{
		s.browserSubjectSessionsKey(subjectHex),
		s.browserSessionsKey(),
	}, now.UTC().UnixMilli(), subjectHex, s.browserSessionTokenKeyPrefix(), s.browserSessionIDKeyPrefix(), s.browserSessionMetadataKeyPrefix()).Int()
	if err != nil {
		return 0, sessionRedisFailure("delete browser sessions for subject", err)
	}
	if deleted < 0 || deleted > maxBrowserSessionInventory {
		return 0, auth.ErrBrowserSessionInvalid
	}
	return deleted, nil
}

func decodeBrowserSessionPayload(rawPayload []byte) (auth.BrowserSessionRecord, error) {
	if len(rawPayload) == 0 || len(rawPayload) > maxBrowserSessionPayload {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session payload")
	}
	var payload browserSessionPayload
	if err := json.Unmarshal(rawPayload, &payload); err != nil || len(payload.CSRFHash) != sha256.Size*2 ||
		!validSHA256Hex(payload.SubjectHash) || !validBrowserSessionPublicID(payload.SessionID) {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session payload")
	}
	csrfBytes, err := hex.DecodeString(payload.CSRFHash)
	if err != nil || len(csrfBytes) != sha256.Size {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session payload")
	}
	subjectBytes, err := hex.DecodeString(payload.SubjectHash)
	if err != nil || len(subjectBytes) != sha256.Size {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session payload")
	}
	record := auth.BrowserSessionRecord{
		SessionID:  payload.SessionID,
		Claims:     payload.Claims,
		DeviceName: payload.DeviceName,
		CreatedAt:  time.UnixMilli(payload.CreatedAtMillis).UTC(),
		ExpiresAt:  time.UnixMilli(payload.ExpiresAtMillis).UTC(),
	}
	copy(record.CSRFHash[:], csrfBytes)
	copy(record.SubjectHash[:], subjectBytes)
	return record, nil
}

func parseBrowserSessionMetadata(metadata string) (string, string, bool) {
	separator := strings.IndexByte(metadata, ':')
	if separator != sha256.Size*2 || len(metadata) != sha256.Size*4+1 {
		return "", "", false
	}
	left, right := metadata[:separator], metadata[separator+1:]
	return left, right, validSHA256Hex(left) && validSHA256Hex(right)
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func validBrowserSessionPublicID(value string) bool {
	if len(value) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func validBrowserSessionStoredSubject(value string) bool {
	return strings.TrimSpace(value) != "" && len(value) <= 128 && strings.IndexFunc(value, unicode.IsControl) < 0
}

func validBrowserSessionDeviceName(value string) bool {
	if value == "" {
		return true
	}
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= 64 &&
		strings.TrimSpace(value) == value && strings.IndexFunc(value, unicode.IsControl) < 0
}

func formatRedisMillis(value int64) string {
	return strconv.FormatInt(value, 10)
}

func (s *Redis) browserSessionKey(tokenHex string) string {
	return s.browserSessionTokenKeyPrefix() + tokenHex
}

func (s *Redis) browserSessionsKey() string {
	return s.key(browserSessionKeyNamespace + "sessions")
}

func (s *Redis) browserSubjectSessionsKey(subjectHex string) string {
	return s.key(browserSessionKeyNamespace + "subject:" + subjectHex)
}

func (s *Redis) browserSessionIDKey(sessionIDHex string) string {
	return s.browserSessionIDKeyPrefix() + sessionIDHex
}

func (s *Redis) browserSessionMetadataKey(tokenHex string) string {
	return s.browserSessionMetadataKeyPrefix() + tokenHex
}

func (s *Redis) browserSessionTokenKeyPrefix() string {
	return s.key(browserSessionKeyNamespace + "token:")
}

func (s *Redis) browserSessionIDKeyPrefix() string {
	return s.key(browserSessionKeyNamespace + "id:")
}

func (s *Redis) browserSessionMetadataKeyPrefix() string {
	return s.key(browserSessionKeyNamespace + "metadata:")
}

var _ auth.BrowserSessionStore = (*Redis)(nil)
var _ auth.BrowserSessionInventoryStore = (*Redis)(nil)
var _ auth.BrowserSessionMetadataStore = (*Redis)(nil)
