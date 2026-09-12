package sharedstate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/zbxing/goexample/Framework/auth"
)

const (
	sessionKeyNamespace              = "auth-session:"
	refreshSessionFamilyIDLength     = 32
	maxRefreshSessionFamilyInventory = 10000
	maxRefreshSessionHistory         = 1024
)

var (
	createSessionScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local absolute = tonumber(ARGV[2])
local expires = tonumber(ARGV[3])
local maxFamilies = tonumber(ARGV[4])
redis.call("ZREMRANGEBYSCORE", KEYS[4], "-inf", now)
if redis.call("ZCARD", KEYS[4]) >= maxFamilies then
  return 5
end
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 6
end
local ttl = absolute - now
if ttl < 1 then
  return 2
end
redis.call("HSET", KEYS[1], "user_hash", ARGV[5], "absolute", absolute, "expires", expires, "current", ARGV[7], "revoked", "0", "expired", "0")
redis.call("PEXPIRE", KEYS[1], ttl)
redis.call("SET", KEYS[2], ARGV[6], "PX", ttl)
redis.call("ZADD", KEYS[3], absolute, ARGV[6])
redis.call("ZADD", KEYS[4], absolute, ARGV[6])
return 0
`)

	// rotateSessionScript derives the family key from the hash-only token
	// mapping inside Redis. Keeping lookup and mutation in one script removes
	// the GET/EVAL window while preserving replay detection via the old token
	// mapping's TTL.
	rotateSessionScript = redis.NewScript(`
local function lowerHex(value, length)
  return type(value) == "string" and string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end
local function positiveInteger(value)
  local number = tonumber(value)
  if not number or number < 1 or number ~= math.floor(number) then return nil end
  return number
end
local now = positiveInteger(ARGV[1])
local refreshTTL = positiveInteger(ARGV[3])
local maximum = positiveInteger(ARGV[4])
if not now or not refreshTTL or not maximum or maximum > 1024 or
   not lowerHex(ARGV[2], 64) or not lowerHex(ARGV[5], 64) or
   KEYS[1] ~= ARGV[8] .. ARGV[2] or KEYS[2] ~= ARGV[8] .. ARGV[5] then
  return {1}
end
local familyID = redis.call("GET", KEYS[1])
if not familyID then return {1} end
if not lowerHex(familyID, 32) then return {1} end
local familyKey = ARGV[6] .. familyID
local usedKey = ARGV[7] .. familyID
if redis.call("EXISTS", familyKey) == 0 then
  return {2}
end
local fields = redis.call("HMGET", familyKey, "user_hash", "absolute", "expires", "current", "revoked", "expired")
local userHash = fields[1]
local absolute = positiveInteger(fields[2])
local currentExpires = positiveInteger(fields[3])
local current = fields[4]
local revoked = fields[5]
local expired = fields[6]
if not lowerHex(userHash, 64) or not absolute or not currentExpires or currentExpires > absolute or
   not lowerHex(current, 64) or (revoked ~= "0" and revoked ~= "1") or
   (expired ~= "0" and expired ~= "1") or (expired == "1" and revoked ~= "1") then
  return {1}
end
local usedCount = redis.call("SCARD", usedKey)
if usedCount > maximum then return {1} end
local usedTokens = redis.call("SMEMBERS", usedKey)
for _, usedToken in ipairs(usedTokens) do
  if not lowerHex(usedToken, 64) or usedToken == current or
     redis.call("GET", ARGV[8] .. usedToken) ~= familyID then
    return {1}
  end
end
if redis.call("GET", ARGV[8] .. current) ~= familyID then return {1} end
if ARGV[2] ~= current and redis.call("SISMEMBER", usedKey, ARGV[2]) ~= 1 then return {1} end
if absolute > now then
  local globalScore = tonumber(redis.call("ZSCORE", KEYS[3], familyID))
  local userScore = tonumber(redis.call("ZSCORE", ARGV[9] .. userHash, familyID))
  if not globalScore or globalScore ~= absolute or not userScore or userScore ~= absolute then return {1} end
end
if absolute <= now then return {2} end
if revoked == "1" then
  if current ~= ARGV[2] then return {4} end
  return {3}
end
if current ~= ARGV[2] then
  redis.call("HSET", familyKey, "revoked", "1")
  return {4}
end
if currentExpires <= now then
  redis.call("HSET", familyKey, "revoked", "1", "expired", "1")
  return {2}
end
if usedCount >= maximum then
  redis.call("HSET", familyKey, "revoked", "1")
  return {5}
end
if redis.call("EXISTS", KEYS[2]) == 1 then return {1} end
local nextExpires = now + refreshTTL
if nextExpires > absolute then nextExpires = absolute end
local ttl = absolute - now
redis.call("SADD", usedKey, ARGV[2])
redis.call("PEXPIRE", usedKey, ttl)
redis.call("HSET", familyKey, "current", ARGV[5], "expires", nextExpires)
redis.call("SET", KEYS[2], familyID, "PX", ttl)
return {0, nextExpires}
`)

	// revokeSessionFamilyScript uses the same single-command lookup boundary
	// for family revocation.
	revokeSessionFamilyScript = redis.NewScript(`
local function lowerHex(value, length)
  return type(value) == "string" and string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end
local function positiveInteger(value)
  local number = tonumber(value)
  if not number or number < 1 or number ~= math.floor(number) then return nil end
  return number
end
local now = positiveInteger(ARGV[1])
local maximum = positiveInteger(ARGV[7])
if not now or not maximum or maximum > 1024 or not lowerHex(ARGV[2], 64) or
   KEYS[1] ~= ARGV[5] .. ARGV[2] then
  return 1
end
local familyID = redis.call("GET", KEYS[1])
if not familyID then return 1 end
if not lowerHex(familyID, 32) then return 1 end
local familyKey = ARGV[3] .. familyID
local usedKey = ARGV[4] .. familyID
if redis.call("EXISTS", familyKey) == 0 then return 2 end
local fields = redis.call("HMGET", familyKey, "user_hash", "absolute", "expires", "current", "revoked", "expired")
local userHash = fields[1]
local absolute = positiveInteger(fields[2])
local currentExpires = positiveInteger(fields[3])
local current = fields[4]
local revoked = fields[5]
local expired = fields[6]
if not lowerHex(userHash, 64) or not absolute or not currentExpires or currentExpires > absolute or
   not lowerHex(current, 64) or (revoked ~= "0" and revoked ~= "1") or
   (expired ~= "0" and expired ~= "1") or (expired == "1" and revoked ~= "1") then
  return 1
end
local usedCount = redis.call("SCARD", usedKey)
if usedCount > maximum then return 1 end
local usedTokens = redis.call("SMEMBERS", usedKey)
for _, usedToken in ipairs(usedTokens) do
  if not lowerHex(usedToken, 64) or usedToken == current or
     redis.call("GET", ARGV[5] .. usedToken) ~= familyID then
    return 1
  end
end
if redis.call("GET", ARGV[5] .. current) ~= familyID then return 1 end
if ARGV[2] ~= current and redis.call("SISMEMBER", usedKey, ARGV[2]) ~= 1 then return 1 end
if absolute > now then
  local globalScore = tonumber(redis.call("ZSCORE", KEYS[2], familyID))
  local userScore = tonumber(redis.call("ZSCORE", ARGV[6] .. userHash, familyID))
  if not globalScore or globalScore ~= absolute or not userScore or userScore ~= absolute then return 1 end
end
if absolute <= now then return 2 end
if revoked == "1" then return 3 end
redis.call("HSET", familyKey, "revoked", "1")
return 0
`)

	revokeSessionUserScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local familyPrefix = ARGV[2]
local userHash = ARGV[3]
local maximum = tonumber(ARGV[4])
if not now or not maximum or maximum < 1 or maximum > 10000 or
   string.len(userHash) ~= 64 or not string.match(userHash, "^[0-9a-f]+$") then
  return -1
end
if redis.call("ZCARD", KEYS[1]) > maximum then return -1 end
local count = 0
local ids = redis.call("ZRANGE", KEYS[1], 0, -1)
local states = {}
for index, familyID in ipairs(ids) do
  if string.len(familyID) ~= 32 or not string.match(familyID, "^[0-9a-f]+$") then return -1 end
  local familyKey = familyPrefix .. familyID
  local exists = redis.call("EXISTS", familyKey) == 1
  if not exists then
    states[index] = {id = familyID, exists = false}
  else
    local owner = redis.call("HGET", familyKey, "user_hash")
    local absolute = tonumber(redis.call("HGET", familyKey, "absolute"))
    local expires = tonumber(redis.call("HGET", familyKey, "expires"))
    local revoked = redis.call("HGET", familyKey, "revoked")
    local userScore = tonumber(redis.call("ZSCORE", KEYS[1], familyID))
    if owner ~= userHash or not absolute or absolute < 1 or not expires or expires < 1 or
       expires > absolute or (revoked ~= "0" and revoked ~= "1") or
       not userScore or userScore ~= absolute then
      return -1
    end
    if absolute > now then
      local globalScore = tonumber(redis.call("ZSCORE", KEYS[2], familyID))
      if not globalScore or globalScore ~= absolute then return -1 end
    end
    states[index] = {id = familyID, key = familyKey, exists = true, absolute = absolute, expires = expires, revoked = revoked}
  end
end
for _, state in ipairs(states) do
  if not state.exists or state.absolute <= now then
    redis.call("ZREM", KEYS[1], state.id)
    redis.call("ZREM", KEYS[2], state.id)
  elseif state.revoked ~= "1" and state.expires > now then
    redis.call("HSET", state.key, "revoked", "1")
    count = count + 1
  end
end
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
return count
`)

	activeSessionFamiliesScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local familyPrefix = ARGV[2]
local userHash = ARGV[3]
local maximum = tonumber(ARGV[4])
if not now or not maximum or maximum < 1 or maximum > 10000 or
   string.len(userHash) ~= 64 or not string.match(userHash, "^[0-9a-f]+$") then
  return -1
end
if redis.call("ZCARD", KEYS[1]) > maximum then return -1 end
local count = 0
local ids = redis.call("ZRANGE", KEYS[1], 0, -1)
local states = {}
for index, familyID in ipairs(ids) do
  if string.len(familyID) ~= 32 or not string.match(familyID, "^[0-9a-f]+$") then return -1 end
  local familyKey = familyPrefix .. familyID
  local exists = redis.call("EXISTS", familyKey) == 1
  if not exists then
    states[index] = {id = familyID, exists = false}
  else
    local owner = redis.call("HGET", familyKey, "user_hash")
    local absolute = tonumber(redis.call("HGET", familyKey, "absolute"))
    local expires = tonumber(redis.call("HGET", familyKey, "expires"))
    local revoked = redis.call("HGET", familyKey, "revoked")
    local userScore = tonumber(redis.call("ZSCORE", KEYS[1], familyID))
    if owner ~= userHash or not absolute or absolute < 1 or not expires or expires < 1 or
       expires > absolute or (revoked ~= "0" and revoked ~= "1") or
       not userScore or userScore ~= absolute then
      return -1
    end
    if absolute > now then
      local globalScore = tonumber(redis.call("ZSCORE", KEYS[2], familyID))
      if not globalScore or globalScore ~= absolute then return -1 end
    end
    states[index] = {id = familyID, exists = true, absolute = absolute, expires = expires, revoked = revoked}
  end
end
for _, state in ipairs(states) do
  if not state.exists or state.absolute <= now then
    redis.call("ZREM", KEYS[1], state.id)
    redis.call("ZREM", KEYS[2], state.id)
  elseif state.revoked ~= "1" and state.expires > now then
      count = count + 1
  end
end
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
return count
`)
)

// CreateSession persists one bounded refresh family. It is implemented by
// Redis Lua so the global family limit and all indexes are updated atomically.
func (s *Redis) CreateSession(ctx context.Context, userID, familyID string, tokenHash [sha256.Size]byte, now, absoluteExpiresAt, currentExpiresAt time.Time, maxFamilies int) error {
	if s == nil || ctx == nil || userID == "" || !validRefreshSessionFamilyID(familyID) ||
		maxFamilies <= 0 || maxFamilies > maxRefreshSessionFamilyInventory || absoluteExpiresAt.Before(currentExpiresAt) {
		return errors.New("invalid session store create request")
	}
	now = now.UTC()
	if !absoluteExpiresAt.After(now) || !currentExpiresAt.After(now) {
		return auth.ErrSessionExpired
	}
	userHash := sha256.Sum256([]byte(userID))
	tokenHex := hex.EncodeToString(tokenHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := createSessionScript.Run(operationCtx, s.client, []string{
		s.sessionFamilyKey(familyID),
		s.sessionTokenKey(tokenHex),
		s.sessionUserKey(userHash),
		s.sessionFamiliesKey(),
	}, now.UnixMilli(), absoluteExpiresAt.UnixMilli(), currentExpiresAt.UnixMilli(), maxFamilies, hex.EncodeToString(userHash[:]), familyID, tokenHex).Int()
	if err != nil {
		return sessionRedisFailure("create refresh session", err)
	}
	switch result {
	case 0:
		return nil
	case 2:
		return auth.ErrSessionExpired
	case 5:
		return auth.ErrSessionLimit
	case 6:
		return errors.New("refresh session family collision")
	default:
		return errors.New("refresh session store rejected create")
	}
}

// RotateSession atomically validates and rotates a refresh token hash. Raw
// tokens never cross this package boundary or enter Redis; all Redis indexes
// are hash-only. Token lookup and family mutation happen in one Lua command.
func (s *Redis) RotateSession(ctx context.Context, tokenHash, newHash [sha256.Size]byte, now time.Time, refreshTTL time.Duration, historyLimit int) (time.Time, error) {
	if s == nil || ctx == nil || tokenHash == newHash || refreshTTL.Milliseconds() <= 0 ||
		historyLimit <= 0 || historyLimit > maxRefreshSessionHistory {
		return time.Time{}, errors.New("invalid session store rotate request")
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	newTokenHex := hex.EncodeToString(newHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	values, err := rotateSessionScript.Run(operationCtx, s.client, []string{
		s.sessionTokenKey(tokenHex),
		s.sessionTokenKey(newTokenHex),
		s.sessionFamiliesKey(),
	}, now.UTC().UnixMilli(), tokenHex, refreshTTL.Milliseconds(), historyLimit, newTokenHex,
		s.sessionFamilyKeyPrefix(), s.sessionUsedKeyPrefix(), s.sessionTokenKeyPrefix(), s.sessionUserKeyPrefix()).Int64Slice()
	if err != nil {
		return time.Time{}, sessionRedisFailure("rotate refresh session", err)
	}
	if len(values) == 0 {
		return time.Time{}, errors.New("refresh session store returned an invalid result")
	}
	switch values[0] {
	case 0:
		if len(values) != 2 {
			return time.Time{}, errors.New("refresh session store returned an invalid expiry")
		}
		return time.UnixMilli(values[1]).UTC(), nil
	case 1:
		return time.Time{}, auth.ErrSessionInvalid
	case 2:
		return time.Time{}, auth.ErrSessionExpired
	case 3:
		return time.Time{}, auth.ErrSessionRevoked
	case 4:
		return time.Time{}, auth.ErrSessionReuse
	case 5:
		return time.Time{}, auth.ErrSessionLimit
	default:
		return time.Time{}, errors.New("refresh session store rejected rotation")
	}
}

func (s *Redis) RevokeFamily(ctx context.Context, tokenHash [sha256.Size]byte, now time.Time) error {
	if s == nil || ctx == nil {
		return errors.New("invalid session store")
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	// The script reads the token mapping and revokes its family atomically.
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := revokeSessionFamilyScript.Run(operationCtx, s.client, []string{
		s.sessionTokenKey(tokenHex),
		s.sessionFamiliesKey(),
	}, now.UTC().UnixMilli(), tokenHex, s.sessionFamilyKeyPrefix(), s.sessionUsedKeyPrefix(),
		s.sessionTokenKeyPrefix(), s.sessionUserKeyPrefix(), maxRefreshSessionHistory).Int()
	if err != nil {
		return sessionRedisFailure("revoke refresh session", err)
	}
	switch result {
	case 0:
		return nil
	case 1:
		return auth.ErrSessionInvalid
	case 2:
		return auth.ErrSessionExpired
	case 3:
		return auth.ErrSessionRevoked
	default:
		return errors.New("refresh session store rejected revoke")
	}
}

func (s *Redis) RevokeUser(ctx context.Context, userID string, now time.Time) (int, error) {
	if s == nil || ctx == nil || userID == "" {
		return 0, errors.New("invalid session store user")
	}
	userHash := sha256.Sum256([]byte(userID))
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	count, err := revokeSessionUserScript.Run(operationCtx, s.client, []string{
		s.sessionUserKey(userHash),
		s.sessionFamiliesKey(),
	}, now.UTC().UnixMilli(), s.sessionFamilyKeyPrefix(), hex.EncodeToString(userHash[:]), maxRefreshSessionFamilyInventory).Int()
	if err != nil {
		return 0, sessionRedisFailure("revoke user refresh sessions", err)
	}
	if count < 0 || count > maxRefreshSessionFamilyInventory {
		return 0, auth.ErrSessionInvalid
	}
	return count, nil
}

func (s *Redis) ActiveFamilies(ctx context.Context, userID string, now time.Time) (int, error) {
	if s == nil || ctx == nil || userID == "" {
		return 0, errors.New("invalid session store user")
	}
	userHash := sha256.Sum256([]byte(userID))
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	count, err := activeSessionFamiliesScript.Run(operationCtx, s.client, []string{
		s.sessionUserKey(userHash),
		s.sessionFamiliesKey(),
	}, now.UTC().UnixMilli(), s.sessionFamilyKeyPrefix(), hex.EncodeToString(userHash[:]), maxRefreshSessionFamilyInventory).Int()
	if err != nil {
		return 0, sessionRedisFailure("count active refresh sessions", err)
	}
	if count < 0 || count > maxRefreshSessionFamilyInventory {
		return 0, auth.ErrSessionInvalid
	}
	return count, nil
}

func validRefreshSessionFamilyID(value string) bool {
	if len(value) != refreshSessionFamilyIDLength {
		return false
	}
	for index := range value {
		character := value[index]
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (s *Redis) sessionFamilyKey(familyID string) string {
	return s.key(sessionKeyNamespace + "family:" + familyID)
}

func (s *Redis) sessionFamilyKeyPrefix() string {
	return s.key(sessionKeyNamespace + "family:")
}

func (s *Redis) sessionTokenKey(tokenHex string) string {
	return s.key(sessionKeyNamespace + "token:" + tokenHex)
}

func (s *Redis) sessionTokenKeyPrefix() string {
	return s.key(sessionKeyNamespace + "token:")
}

func (s *Redis) sessionUsedKey(familyID string) string {
	return s.key(sessionKeyNamespace + "used:" + familyID)
}

func (s *Redis) sessionUsedKeyPrefix() string {
	return s.key(sessionKeyNamespace + "used:")
}

func (s *Redis) sessionUserKey(userHash [sha256.Size]byte) string {
	return s.key(sessionKeyNamespace + "user:" + hex.EncodeToString(userHash[:]))
}

func (s *Redis) sessionUserKeyPrefix() string {
	return s.key(sessionKeyNamespace + "user:")
}

func (s *Redis) sessionFamiliesKey() string {
	return s.key(sessionKeyNamespace + "families")
}

func sessionRedisFailure(operation string, err error) error {
	if err == nil {
		return errors.New(operation)
	}
	return fmt.Errorf("%s: %v", operation, err)
}

var _ auth.SessionStore = (*Redis)(nil)
