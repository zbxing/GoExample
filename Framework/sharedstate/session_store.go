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

const sessionKeyNamespace = "auth-session:"

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

	rotateSessionScript = redis.NewScript(`
if redis.call("EXISTS", KEYS[2]) == 0 then
  if redis.call("EXISTS", KEYS[1]) == 1 then return {2} end
  return {1}
end
local absolute = tonumber(redis.call("HGET", KEYS[2], "absolute"))
local now = tonumber(ARGV[1])
if not absolute or absolute <= now then
  redis.call("HSET", KEYS[2], "revoked", "1", "expired", "1")
  return {2}
end
local current = redis.call("HGET", KEYS[2], "current")
local revoked = redis.call("HGET", KEYS[2], "revoked")
	if revoked == "1" then
	  if current ~= ARGV[2] then return {4} end
	  return {3}
end
if current ~= ARGV[2] then
  redis.call("HSET", KEYS[2], "revoked", "1")
	return {4}
end
local currentExpires = tonumber(redis.call("HGET", KEYS[2], "expires"))
if not currentExpires or currentExpires <= now then
  redis.call("HSET", KEYS[2], "revoked", "1", "expired", "1")
	return {2}
end
if redis.call("SCARD", KEYS[3]) >= tonumber(ARGV[4]) then
  redis.call("HSET", KEYS[2], "revoked", "1")
	return {5}
end
local nextExpires = now + tonumber(ARGV[3])
if nextExpires > absolute then nextExpires = absolute end
local ttl = absolute - now
redis.call("SADD", KEYS[3], ARGV[2])
redis.call("PEXPIRE", KEYS[3], ttl)
redis.call("HSET", KEYS[2], "current", ARGV[5], "expires", nextExpires)
redis.call("SET", KEYS[4], ARGV[6], "PX", ttl)
return {0, nextExpires}
`)

	revokeSessionFamilyScript = redis.NewScript(`
if redis.call("EXISTS", KEYS[1]) == 0 then return 1 end
if redis.call("EXISTS", KEYS[2]) == 0 then return 2 end
local now = tonumber(ARGV[1])
local absolute = tonumber(redis.call("HGET", KEYS[2], "absolute"))
if not absolute or absolute <= now then return 2 end
if redis.call("HGET", KEYS[2], "revoked") == "1" then return 3 end
redis.call("HSET", KEYS[2], "revoked", "1")
return 0
`)

	revokeSessionUserScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local familyPrefix = ARGV[2]
local count = 0
local ids = redis.call("ZRANGE", KEYS[1], 0, -1)
for _, familyID in ipairs(ids) do
  local familyKey = familyPrefix .. familyID
  if redis.call("EXISTS", familyKey) == 0 then
    redis.call("ZREM", KEYS[1], familyID)
    redis.call("ZREM", KEYS[2], familyID)
  else
    local absolute = tonumber(redis.call("HGET", familyKey, "absolute"))
    if not absolute or absolute <= now then
      redis.call("ZREM", KEYS[1], familyID)
      redis.call("ZREM", KEYS[2], familyID)
    elseif redis.call("HGET", familyKey, "revoked") ~= "1" and tonumber(redis.call("HGET", familyKey, "expires")) > now then
      redis.call("HSET", familyKey, "revoked", "1")
      count = count + 1
    end
  end
end
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
return count
`)

	activeSessionFamiliesScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local familyPrefix = ARGV[2]
local count = 0
local ids = redis.call("ZRANGE", KEYS[1], 0, -1)
for _, familyID in ipairs(ids) do
  local familyKey = familyPrefix .. familyID
  if redis.call("EXISTS", familyKey) == 0 then
    redis.call("ZREM", KEYS[1], familyID)
    redis.call("ZREM", KEYS[2], familyID)
  else
    local absolute = tonumber(redis.call("HGET", familyKey, "absolute"))
    local expires = tonumber(redis.call("HGET", familyKey, "expires"))
    if not absolute or absolute <= now then
      redis.call("ZREM", KEYS[1], familyID)
      redis.call("ZREM", KEYS[2], familyID)
    elseif redis.call("HGET", familyKey, "revoked") ~= "1" and expires and expires > now then
      count = count + 1
    end
  end
end
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
return count
`)
)

// CreateSession persists one bounded refresh family. It is implemented by
// Redis Lua so the global family limit and all indexes are updated atomically.
func (s *Redis) CreateSession(ctx context.Context, userID, familyID string, tokenHash [sha256.Size]byte, now, absoluteExpiresAt, currentExpiresAt time.Time, maxFamilies int) error {
	if s == nil || userID == "" || familyID == "" || maxFamilies <= 0 || absoluteExpiresAt.Before(currentExpiresAt) {
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
// are hash-only.
func (s *Redis) RotateSession(ctx context.Context, tokenHash, newHash [sha256.Size]byte, now time.Time, refreshTTL time.Duration, historyLimit int) (time.Time, error) {
	if s == nil || refreshTTL <= 0 || historyLimit <= 0 {
		return time.Time{}, errors.New("invalid session store rotate request")
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	newTokenHex := hex.EncodeToString(newHash[:])
	familyID, err := s.lookupSessionFamily(ctx, tokenHex)
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return time.Time{}, auth.ErrSessionInvalid
		}
		return time.Time{}, sessionRedisFailure("lookup refresh session", err)
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	values, err := rotateSessionScript.Run(operationCtx, s.client, []string{
		s.sessionTokenKey(tokenHex),
		s.sessionFamilyKey(familyID),
		s.sessionUsedKey(familyID),
		s.sessionTokenKey(newTokenHex),
	}, now.UnixMilli(), tokenHex, refreshTTL.Milliseconds(), historyLimit, newTokenHex, familyID).Int64Slice()
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
	if s == nil {
		return errors.New("invalid session store")
	}
	tokenHex := hex.EncodeToString(tokenHash[:])
	familyID, err := s.lookupSessionFamily(ctx, tokenHex)
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.ErrSessionInvalid
		}
		return sessionRedisFailure("lookup refresh session", err)
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := revokeSessionFamilyScript.Run(operationCtx, s.client, []string{
		s.sessionTokenKey(tokenHex),
		s.sessionFamilyKey(familyID),
	}, now.UnixMilli()).Int()
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
	if s == nil || userID == "" {
		return 0, errors.New("invalid session store user")
	}
	userHash := sha256.Sum256([]byte(userID))
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	count, err := revokeSessionUserScript.Run(operationCtx, s.client, []string{
		s.sessionUserKey(userHash),
		s.sessionFamiliesKey(),
	}, now.UnixMilli(), s.key(sessionKeyNamespace+"family:")).Int()
	if err != nil {
		return 0, sessionRedisFailure("revoke user refresh sessions", err)
	}
	return count, nil
}

func (s *Redis) ActiveFamilies(ctx context.Context, userID string, now time.Time) (int, error) {
	if s == nil || userID == "" {
		return 0, errors.New("invalid session store user")
	}
	userHash := sha256.Sum256([]byte(userID))
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	count, err := activeSessionFamiliesScript.Run(operationCtx, s.client, []string{
		s.sessionUserKey(userHash),
		s.sessionFamiliesKey(),
	}, now.UnixMilli(), s.key(sessionKeyNamespace+"family:")).Int()
	if err != nil {
		return 0, sessionRedisFailure("count active refresh sessions", err)
	}
	return count, nil
}

func (s *Redis) lookupSessionFamily(ctx context.Context, tokenHex string) (string, error) {
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	return s.client.Get(operationCtx, s.sessionTokenKey(tokenHex)).Result()
}

func (s *Redis) sessionFamilyKey(familyID string) string {
	return s.key(sessionKeyNamespace + "family:" + familyID)
}

func (s *Redis) sessionTokenKey(tokenHex string) string {
	return s.key(sessionKeyNamespace + "token:" + tokenHex)
}

func (s *Redis) sessionUsedKey(familyID string) string {
	return s.key(sessionKeyNamespace + "used:" + familyID)
}

func (s *Redis) sessionUserKey(userHash [sha256.Size]byte) string {
	return s.key(sessionKeyNamespace + "user:" + hex.EncodeToString(userHash[:]))
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
