package sharedstate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
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
	maxBrowserSessionTTL       = 24 * time.Hour
)

var (
	createBrowserSessionScript = redis.NewScript(`
local function isPositiveInteger(value)
  return value and value > 0 and value == math.floor(value)
end

local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local subjectMaximum = tonumber(ARGV[4])
local token = ARGV[6]
local subject = ARGV[7]
local sessionID = ARGV[8]
local absoluteMaximum = tonumber(ARGV[9])
local maximumTTL = tonumber(ARGV[10])
if not isPositiveInteger(now) or not isPositiveInteger(expires) or expires <= now or
   not isPositiveInteger(maximum) or not isPositiveInteger(subjectMaximum) or subjectMaximum > maximum or
   not isPositiveInteger(absoluteMaximum) or maximum > absoluteMaximum or
   not isPositiveInteger(maximumTTL) or expires - now > maximumTTL or
   string.len(ARGV[5]) < 1 or string.len(ARGV[5]) > 65536 or
   not isLowerHex(token, 64) or not isLowerHex(subject, 64) or not isLowerHex(sessionID, 64) then
  return 5
end
if redis.call("ZCARD", KEYS[2]) > absoluteMaximum or redis.call("ZCARD", KEYS[3]) > absoluteMaximum then
  return 5
end
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[4]) == 1 or
   redis.call("EXISTS", KEYS[5]) == 1 or redis.call("ZSCORE", KEYS[2], token) or
   redis.call("ZSCORE", KEYS[3], token) then
  return 2
end
if redis.call("ZCARD", KEYS[2]) >= maximum then return 1 end
if redis.call("ZCARD", KEYS[3]) >= subjectMaximum then return 4 end
local ttl = expires - now
redis.call("SET", KEYS[1], ARGV[5], "PX", ttl)
redis.call("SET", KEYS[4], subject .. ":" .. token, "PX", ttl)
redis.call("SET", KEYS[5], subject .. ":" .. sessionID, "PX", ttl)
redis.call("ZADD", KEYS[2], expires, token)
redis.call("ZADD", KEYS[3], expires, token)
return 0
`)
	readBrowserSessionScript = redis.NewScript(`
local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local invalid = "__goexample_browser_session_invalid__"
local token = ARGV[1]
if not isLowerHex(token, 64) then return {invalid} end
local payloadLength = redis.call("STRLEN", KEYS[1])
local metadataLength = redis.call("STRLEN", KEYS[3])
if payloadLength < 1 or payloadLength > 65536 or metadataLength ~= 129 or
   redis.call("PTTL", KEYS[1]) <= 0 or redis.call("PTTL", KEYS[3]) <= 0 then
  return {invalid}
end
local payload = redis.call("GET", KEYS[1])
local metadata = redis.call("GET", KEYS[3])
local owner, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
if not owner or not isLowerHex(owner, 64) or not sessionID or not isLowerHex(sessionID, 64) then
  return {invalid}
end
local idKey = ARGV[3] .. sessionID
if redis.call("STRLEN", idKey) ~= 129 or redis.call("GET", idKey) ~= owner .. ":" .. token or
   redis.call("PTTL", idKey) <= 0 then
  return {invalid}
end
local globalScore = redis.call("ZSCORE", KEYS[2], token)
local subjectScore = redis.call("ZSCORE", ARGV[2] .. owner, token)
if not globalScore or not subjectScore then return {invalid} end
return {payload, owner, sessionID, globalScore, subjectScore}
`)
	deleteBrowserSessionScript = redis.NewScript(`
local metadata = redis.call("GET", KEYS[3])
if not metadata then return 0 end
local owner, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
local token = ARGV[1]
if not owner or string.len(owner) ~= 64 or not string.match(owner, "^[0-9a-f]+$") or
   not sessionID or string.len(sessionID) ~= 64 or not string.match(sessionID, "^[0-9a-f]+$") or
   string.len(token) ~= 64 or not string.match(token, "^[0-9a-f]+$") then
  return 0
end
local idKey = ARGV[3] .. sessionID
if redis.call("GET", idKey) ~= owner .. ":" .. token then return 0 end
local deleted = redis.call("DEL", KEYS[1])
redis.call("DEL", idKey, KEYS[3])
redis.call("ZREM", KEYS[2], token)
redis.call("ZREM", ARGV[2] .. owner, token)
return deleted
`)
	deleteBrowserSessionByIDScript = redis.NewScript(`
local mapping = redis.call("GET", KEYS[1])
if not mapping then return 0 end
local owner, token = string.match(mapping, "^([0-9a-f]+):([0-9a-f]+)$")
local subject = ARGV[1]
local sessionID = ARGV[2]
if not owner or string.len(owner) ~= 64 or not string.match(owner, "^[0-9a-f]+$") or
   not token or string.len(token) ~= 64 or not string.match(token, "^[0-9a-f]+$") or
   string.len(subject) ~= 64 or not string.match(subject, "^[0-9a-f]+$") or
   string.len(sessionID) ~= 64 or not string.match(sessionID, "^[0-9a-f]+$") or
   owner ~= subject then
  return 0
end
local metadataKey = ARGV[4] .. token
if redis.call("GET", metadataKey) ~= subject .. ":" .. sessionID then return 0 end
local deleted = redis.call("DEL", ARGV[3] .. token)
redis.call("DEL", KEYS[1], metadataKey)
redis.call("ZREM", KEYS[2], token)
redis.call("ZREM", KEYS[3], token)
return deleted
`)
	readBrowserSessionForDeviceUpdateScript = redis.NewScript(`
local function isPositiveInteger(value)
  return value and value > 0 and value == math.floor(value)
end

local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local invalid = "__goexample_browser_device_update_invalid__"
local now = tonumber(ARGV[1])
local subject = ARGV[2]
local sessionID = ARGV[3]
if not isPositiveInteger(now) or not isLowerHex(subject, 64) or not isLowerHex(sessionID, 64) or
   string.len(ARGV[4]) < 1 or string.len(ARGV[5]) < 1 then
  return {invalid}
end
if redis.call("STRLEN", KEYS[1]) ~= 129 or redis.call("PTTL", KEYS[1]) <= 0 then
  return {invalid}
end
local mapping = redis.call("GET", KEYS[1])
local owner, token = string.match(mapping, "^([0-9a-f]+):([0-9a-f]+)$")
if not owner or owner ~= subject or not isLowerHex(token, 64) then return {invalid} end
local payloadKey = ARGV[4] .. token
local metadataKey = ARGV[5] .. token
if redis.call("STRLEN", payloadKey) < 1 or redis.call("STRLEN", payloadKey) > 65536 or
   redis.call("STRLEN", metadataKey) ~= 129 or redis.call("PTTL", payloadKey) <= 0 or
   redis.call("PTTL", metadataKey) <= 0 then
  return {invalid}
end
local payload = redis.call("GET", payloadKey)
if redis.call("GET", metadataKey) ~= subject .. ":" .. sessionID then return {invalid} end
local globalScore = redis.call("ZSCORE", KEYS[2], token)
local subjectScore = redis.call("ZSCORE", KEYS[3], token)
if not globalScore or not subjectScore then return {invalid} end
return {payload, token, globalScore, subjectScore}
`)
	updateBrowserSessionDeviceNameScript = redis.NewScript(`
local function isPositiveInteger(value)
  return value and value > 0 and value == math.floor(value)
end

local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local now = tonumber(ARGV[1])
local subject = ARGV[2]
local sessionID = ARGV[3]
local token = ARGV[4]
local globalScore = tonumber(ARGV[7])
local subjectScore = tonumber(ARGV[8])
if not isPositiveInteger(now) or not isLowerHex(subject, 64) or not isLowerHex(sessionID, 64) or
   not isLowerHex(token, 64) or string.len(ARGV[5]) < 1 or string.len(ARGV[5]) > 65536 or
   string.len(ARGV[6]) < 1 or string.len(ARGV[6]) > 65536 or
   not isPositiveInteger(globalScore) or not isPositiveInteger(subjectScore) or
   globalScore ~= subjectScore or globalScore <= now then
  return 0
end
if redis.call("GET", KEYS[1]) ~= subject .. ":" .. token or redis.call("PTTL", KEYS[1]) <= 0 then return 0 end
if redis.call("GET", KEYS[3]) ~= subject .. ":" .. sessionID or redis.call("PTTL", KEYS[3]) <= 0 then return 0 end
if redis.call("GET", KEYS[2]) ~= ARGV[5] then return 0 end
local ttl = redis.call("PTTL", KEYS[2])
if ttl <= 0 then return 0 end
if redis.call("ZSCORE", KEYS[4], token) ~= ARGV[7] or redis.call("ZSCORE", KEYS[5], token) ~= ARGV[8] then return 0 end
redis.call("SET", KEYS[2], ARGV[6], "PX", ttl)
return 1
`)
	deleteBrowserSessionsForSubjectScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local subject = ARGV[2]
local maximum = tonumber(ARGV[6])
if not now or not maximum or maximum < 1 or
   string.len(subject) ~= 64 or not string.match(subject, "^[0-9a-f]+$") then
  return -1
end
if redis.call("ZCARD", KEYS[1]) > maximum then return -1 end
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
local tokens = redis.call("ZRANGE", KEYS[1], 0, -1)
local sessionIDs = {}
for index, token in ipairs(tokens) do
  if string.len(token) ~= 64 or not string.match(token, "^[0-9a-f]+$") then return -1 end
  local metadata = redis.call("GET", ARGV[5] .. token)
  if not metadata then return -1 end
  local owner, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
  if not owner or string.len(owner) ~= 64 or not string.match(owner, "^[0-9a-f]+$") or
     not sessionID or string.len(sessionID) ~= 64 or not string.match(sessionID, "^[0-9a-f]+$") or
     owner ~= subject then
    return -1
  end
  if redis.call("GET", ARGV[4] .. sessionID) ~= subject .. ":" .. token then return -1 end
  sessionIDs[index] = sessionID
end
for index, token in ipairs(tokens) do
  local sessionID = sessionIDs[index]
  redis.call("DEL", ARGV[3] .. token, ARGV[4] .. sessionID, ARGV[5] .. token)
  redis.call("ZREM", KEYS[2], token)
end
redis.call("DEL", KEYS[1])
return #tokens
`)
	listBrowserSessionsScript = redis.NewScript(`
local function isPositiveInteger(value)
  return value and value > 0 and value == math.floor(value)
end

local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local absoluteMaximum = tonumber(ARGV[3])
local subject = ARGV[4]
local payloadPrefix = ARGV[5]
local metadataPrefix = ARGV[6]
local idPrefix = ARGV[7]
local invalid = "__goexample_browser_inventory_invalid__"
if not isPositiveInteger(now) or not isPositiveInteger(limit) or
   not isPositiveInteger(absoluteMaximum) or limit > absoluteMaximum or
   not isLowerHex(subject, 64) or string.len(payloadPrefix) < 1 or
   string.len(metadataPrefix) < 1 or string.len(idPrefix) < 1 then
  return {invalid}
end
if redis.call("ZCARD", KEYS[1]) > absoluteMaximum then return {invalid} end
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
local tokens = redis.call("ZRANGE", KEYS[1], 0, limit - 1)
local snapshot = {}
for _, token in ipairs(tokens) do
  if not isLowerHex(token, 64) then return {invalid} end
  local payloadKey = payloadPrefix .. token
  local metadataKey = metadataPrefix .. token
  if redis.call("STRLEN", payloadKey) < 1 or redis.call("STRLEN", payloadKey) > 65536 or
     redis.call("STRLEN", metadataKey) ~= 129 or redis.call("PTTL", payloadKey) <= 0 or
     redis.call("PTTL", metadataKey) <= 0 then
    return {invalid}
  end
  local payload = redis.call("GET", payloadKey)
  local metadata = redis.call("GET", metadataKey)
  local owner, sessionID = string.match(metadata, "^([0-9a-f]+):([0-9a-f]+)$")
  if not owner or owner ~= subject or not isLowerHex(sessionID, 64) then return {invalid} end
  local idKey = idPrefix .. sessionID
  if redis.call("STRLEN", idKey) ~= 129 or redis.call("GET", idKey) ~= subject .. ":" .. token or
     redis.call("PTTL", idKey) <= 0 then
    return {invalid}
  end
  local globalScore = redis.call("ZSCORE", KEYS[2], token)
  local subjectScore = redis.call("ZSCORE", KEYS[1], token)
  if not globalScore or not subjectScore then return {invalid} end
  table.insert(snapshot, payload)
  table.insert(snapshot, sessionID)
  table.insert(snapshot, globalScore)
  table.insert(snapshot, subjectScore)
end
return snapshot
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
	nowMillis := now.UTC().UnixMilli()
	createdMillis := record.CreatedAt.UTC().UnixMilli()
	expiresMillis := record.ExpiresAt.UTC().UnixMilli()
	if s == nil || ctx == nil || tokenHash == ([sha256.Size]byte{}) || record.CSRFHash == ([sha256.Size]byte{}) || maxSessions <= 0 || maxSessions > maxBrowserSessionInventory ||
		maxSessionsPerSubject <= 0 || maxSessionsPerSubject > maxSessions || nowMillis < 1 || createdMillis < 1 || expiresMillis <= nowMillis || expiresMillis <= createdMillis ||
		expiresMillis-nowMillis > maxBrowserSessionTTL.Milliseconds() ||
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
		CreatedAtMillis: createdMillis,
		ExpiresAtMillis: expiresMillis,
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
	}, nowMillis, expiresMillis, maxSessions, maxSessionsPerSubject, payload, tokenHex, subjectHex, sessionIDHex,
		maxBrowserSessionInventory, maxBrowserSessionTTL.Milliseconds()).Int()
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
	case 4:
		return auth.ErrBrowserSessionSubjectLimit
	case 5:
		return auth.ErrBrowserSessionInvalid
	default:
		return errors.New("browser session store rejected create")
	}
}

// ReadBrowserSession resolves a hash-keyed session and rejects malformed or
// expired backend state without returning Redis details.
func (s *Redis) ReadBrowserSession(ctx context.Context, tokenHash [sha256.Size]byte, now time.Time) (auth.BrowserSessionRecord, error) {
	nowMillis := now.UTC().UnixMilli()
	if s == nil || ctx == nil || tokenHash == ([sha256.Size]byte{}) || nowMillis < 1 {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := readBrowserSessionScript.Run(operationCtx, s.client, []string{
		s.browserSessionKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSessionMetadataKey(tokenHex),
	}, tokenHex, s.browserSubjectSessionsKeyPrefix(), s.browserSessionIDKeyPrefix()).StringSlice()
	if err != nil {
		return auth.BrowserSessionRecord{}, sessionRedisFailure("read browser session", err)
	}
	if len(result) != 5 || result[0] == "__goexample_browser_session_invalid__" {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	record, err := decodeBrowserSessionSnapshot([]byte(result[0]), result[1], result[2], result[3], result[4])
	if err != nil {
		return auth.BrowserSessionRecord{}, auth.ErrBrowserSessionInvalid
	}
	if !record.ExpiresAt.After(time.UnixMilli(nowMillis).UTC()) {
		// Expiry cleanup is best effort, but it remains owned by the caller's
		// request. Do not detach a canceled request and issue a background
		// mutation after the read has already observed cancellation.
		if completedRedisContextError(ctx) == nil {
			_ = s.deleteBrowserSessionByHash(ctx, tokenHex)
		}
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
	deleted, err := deleteBrowserSessionScript.Run(operationCtx, s.client, []string{
		s.browserSessionKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSessionMetadataKey(tokenHex),
	}, tokenHex, s.browserSubjectSessionsKeyPrefix(), s.browserSessionIDKeyPrefix()).Int()
	if err != nil {
		return sessionRedisFailure("delete browser session", err)
	}
	if deleted != 1 {
		return auth.ErrBrowserSessionInvalid
	}
	return nil
}

// ListBrowserSessions returns a bounded active-session inventory for one hashed
// subject. Redis performs index cleanup and payload reads in one Lua snapshot so
// concurrent revoke or expiry cannot split the inventory across commands.
func (s *Redis) ListBrowserSessions(ctx context.Context, subjectHash [sha256.Size]byte, now time.Time, limit int) ([]auth.BrowserSessionInfo, error) {
	nowMillis := now.UTC().UnixMilli()
	if s == nil || ctx == nil || subjectHash == ([sha256.Size]byte{}) || nowMillis < 1 || limit <= 0 || limit > maxBrowserSessionInventory {
		return nil, auth.ErrBrowserSessionInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	snapshot, err := listBrowserSessionsScript.Run(operationCtx, s.client, []string{
		s.browserSubjectSessionsKey(subjectHex),
		s.browserSessionsKey(),
	}, nowMillis, limit, maxBrowserSessionInventory, subjectHex, s.browserSessionTokenKeyPrefix(),
		s.browserSessionMetadataKeyPrefix(), s.browserSessionIDKeyPrefix()).StringSlice()
	if err != nil {
		return nil, sessionRedisFailure("list browser sessions", err)
	}
	if len(snapshot) == 1 && snapshot[0] == "__goexample_browser_inventory_invalid__" {
		return nil, auth.ErrBrowserSessionInvalid
	}
	if len(snapshot)%4 != 0 || len(snapshot)/4 > limit {
		return nil, auth.ErrBrowserSessionInvalid
	}
	items := make([]auth.BrowserSessionInfo, 0, len(snapshot)/4)
	for offset := 0; offset < len(snapshot); offset += 4 {
		record, decodeErr := decodeBrowserSessionSnapshot([]byte(snapshot[offset]), subjectHex, snapshot[offset+1], snapshot[offset+2], snapshot[offset+3])
		if decodeErr != nil || !record.ExpiresAt.After(time.UnixMilli(nowMillis).UTC()) {
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
	deleted, err := deleteBrowserSessionByIDScript.Run(operationCtx, s.client, []string{
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
	}, subjectHex, sessionIDHex, s.browserSessionTokenKeyPrefix(), s.browserSessionMetadataKeyPrefix()).Int()
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
	nowMillis := now.UTC().UnixMilli()
	if s == nil || ctx == nil || subjectHash == ([sha256.Size]byte{}) || sessionIDHash == ([sha256.Size]byte{}) || nowMillis < 1 {
		return auth.ErrBrowserSessionInvalid
	}
	if !validBrowserSessionDeviceName(deviceName) {
		return auth.ErrBrowserSessionDeviceNameInvalid
	}
	subjectHex := hex.EncodeToString(subjectHash[:])
	sessionIDHex := hex.EncodeToString(sessionIDHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	snapshot, err := readBrowserSessionForDeviceUpdateScript.Run(operationCtx, s.client, []string{
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
	}, nowMillis, subjectHex, sessionIDHex, s.browserSessionTokenKeyPrefix(), s.browserSessionMetadataKeyPrefix()).StringSlice()
	if err != nil {
		return sessionRedisFailure("read browser session device snapshot", err)
	}
	if len(snapshot) != 4 || snapshot[0] == "__goexample_browser_device_update_invalid__" || !validSHA256Hex(snapshot[1]) {
		return auth.ErrBrowserSessionInvalid
	}
	tokenHex := snapshot[1]
	record, err := decodeBrowserSessionSnapshot([]byte(snapshot[0]), subjectHex, sessionIDHex, snapshot[2], snapshot[3])
	if err != nil || !record.ExpiresAt.After(time.UnixMilli(nowMillis).UTC()) || record.CreatedAt.After(time.UnixMilli(nowMillis).UTC()) {
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
	result, err := updateBrowserSessionDeviceNameScript.Run(operationCtx, s.client, []string{
		s.browserSessionIDKey(sessionIDHex),
		s.browserSessionKey(tokenHex),
		s.browserSessionMetadataKey(tokenHex),
		s.browserSessionsKey(),
		s.browserSubjectSessionsKey(subjectHex),
	}, nowMillis, subjectHex, sessionIDHex, tokenHex, snapshot[0], string(updatedPayload), snapshot[2], snapshot[3]).Int()
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
	}, now.UTC().UnixMilli(), subjectHex, s.browserSessionTokenKeyPrefix(), s.browserSessionIDKeyPrefix(), s.browserSessionMetadataKeyPrefix(), maxBrowserSessionInventory).Int()
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
	decoder := json.NewDecoder(bytes.NewReader(rawPayload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || decoder.Decode(&struct{}{}) != io.EOF || !validSHA256Hex(payload.CSRFHash) ||
		!validSHA256Hex(payload.SubjectHash) || !validBrowserSessionPublicID(payload.SessionID) ||
		!validBrowserSessionDeviceName(payload.DeviceName) || !validBrowserSessionStoredSubject(payload.Claims.Subject) ||
		payload.CreatedAtMillis < 1 || payload.ExpiresAtMillis <= payload.CreatedAtMillis {
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
	if record.CSRFHash == ([sha256.Size]byte{}) || record.SubjectHash == ([sha256.Size]byte{}) ||
		record.SubjectHash != sha256.Sum256([]byte(record.Claims.Subject)) {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session payload")
	}
	return record, nil
}

func decodeBrowserSessionSnapshot(rawPayload []byte, subjectHex, sessionIDHex, globalScore, subjectScore string) (auth.BrowserSessionRecord, error) {
	if !validSHA256Hex(subjectHex) || !validSHA256Hex(sessionIDHex) {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session snapshot")
	}
	record, err := decodeBrowserSessionPayload(rawPayload)
	if err != nil {
		return auth.BrowserSessionRecord{}, err
	}
	globalExpiresMillis, globalErr := strconv.ParseInt(globalScore, 10, 64)
	subjectExpiresMillis, subjectErr := strconv.ParseInt(subjectScore, 10, 64)
	expectedSessionIDHash := sha256.Sum256([]byte(record.SessionID))
	if globalErr != nil || subjectErr != nil || globalExpiresMillis < 1 || globalExpiresMillis != subjectExpiresMillis ||
		globalExpiresMillis != record.ExpiresAt.UnixMilli() || subjectHex != hex.EncodeToString(record.SubjectHash[:]) ||
		sessionIDHex != hex.EncodeToString(expectedSessionIDHash[:]) {
		return auth.BrowserSessionRecord{}, errors.New("invalid browser session snapshot")
	}
	return record, nil
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && hex.EncodeToString(decoded) == value
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
	return s.browserSubjectSessionsKeyPrefix() + subjectHex
}

func (s *Redis) browserSubjectSessionsKeyPrefix() string {
	return s.key(browserSessionKeyNamespace + "subject:")
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
