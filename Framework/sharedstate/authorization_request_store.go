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
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/zbxing/goexample/Framework/auth"
)

const (
	authorizationRequestKeyNamespace = "authorization-request:"
	maxAuthorizationRequestPayload   = 4 << 10
	maxAuthorizationRequestEntries   = 10000
	maxAuthorizationRequestTTL       = 15 * time.Minute
)

var (
	createAuthorizationRequestScript = redis.NewScript(`
local function isPositiveInteger(value)
  return value and value > 0 and value == math.floor(value)
end

local function isLowerHex(value, length)
  return string.len(value) == length and string.match(value, "^[0-9a-f]+$") ~= nil
end

local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local absoluteMaximum = tonumber(ARGV[6])
local maximumTTL = tonumber(ARGV[7])
if not isPositiveInteger(now) or not isPositiveInteger(expires) or expires <= now or
   not isPositiveInteger(maximum) or not isPositiveInteger(absoluteMaximum) or maximum > absoluteMaximum or
   not isPositiveInteger(maximumTTL) or expires - now > maximumTTL or
   string.len(ARGV[4]) < 1 or string.len(ARGV[4]) > 4096 or not isLowerHex(ARGV[5], 64) then
  return 5
end
if redis.call("ZCARD", KEYS[2]) > absoluteMaximum then return 4 end
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("ZSCORE", KEYS[2], ARGV[5]) then return 2 end
if redis.call("ZCARD", KEYS[2]) >= maximum then return 1 end
local ttl = expires - now
redis.call("SET", KEYS[1], ARGV[4], "PX", ttl)
redis.call("ZADD", KEYS[2], expires, ARGV[5])
return 0
`)
	consumeAuthorizationRequestScript = redis.NewScript(`
local payload = redis.call("GET", KEYS[1])
local score = redis.call("ZSCORE", KEYS[2], ARGV[1])
if not payload then
  redis.call("ZREM", KEYS[2], ARGV[1])
  return {0}
end
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[1])
if not score then return {1} end
return {2, payload, score}
`)
)

type authorizationRequestPayload struct {
	CodeVerifier    string `json:"codeVerifier"`
	Nonce           string `json:"nonce"`
	ExpiresAtMillis int64  `json:"expiresAtMillis"`
}

// CreateAuthorizationRequest persists a bounded payload under only the state
// hash. A Lua gate applies one global pending-request limit across replicas.
func (s *Redis) CreateAuthorizationRequest(ctx context.Context, stateHash [sha256.Size]byte, record auth.AuthorizationRequestRecord, now time.Time, maxPending int) error {
	nowMillis := now.UTC().UnixMilli()
	expiresMillis := record.ExpiresAt.UTC().UnixMilli()
	if s == nil || ctx == nil || stateHash == ([sha256.Size]byte{}) || maxPending < 1 || maxPending > maxAuthorizationRequestEntries || nowMillis < 1 ||
		!record.ExpiresAt.After(now) || record.ExpiresAt.Sub(now) > maxAuthorizationRequestTTL || expiresMillis <= nowMillis ||
		!validAuthorizationRequestSecret(record.CodeVerifier) || !validAuthorizationRequestSecret(record.Nonce) {
		return auth.ErrAuthorizationRequestInvalid
	}
	stateHex := hex.EncodeToString(stateHash[:])
	payload, err := json.Marshal(authorizationRequestPayload{
		CodeVerifier:    record.CodeVerifier,
		Nonce:           record.Nonce,
		ExpiresAtMillis: expiresMillis,
	})
	if err != nil || len(payload) == 0 || len(payload) > maxAuthorizationRequestPayload {
		return auth.ErrAuthorizationRequestInvalid
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := createAuthorizationRequestScript.Run(operationCtx, s.client, []string{
		s.authorizationRequestKey(stateHex),
		s.authorizationRequestsKey(),
	}, nowMillis, expiresMillis, maxPending, payload, stateHex, maxAuthorizationRequestEntries, maxAuthorizationRequestTTL.Milliseconds()).Int()
	if err != nil {
		return errors.New("authorization request store unavailable")
	}
	switch result {
	case 0:
		return nil
	case 1:
		return auth.ErrAuthorizationRequestLimit
	case 2:
		return auth.ErrAuthorizationRequestInvalid
	case 3:
		return auth.ErrAuthorizationRequestExpired
	case 4, 5:
		return auth.ErrAuthorizationRequestInvalid
	default:
		return auth.ErrAuthorizationRequestInvalid
	}
}

// ConsumeAuthorizationRequest atomically reads and removes one hash-keyed
// request. Malformed or expired state remains consumed and fails closed.
func (s *Redis) ConsumeAuthorizationRequest(ctx context.Context, stateHash [sha256.Size]byte, now time.Time) (auth.AuthorizationRequestRecord, error) {
	nowMillis := now.UTC().UnixMilli()
	if s == nil || ctx == nil || stateHash == ([sha256.Size]byte{}) || nowMillis < 1 {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	stateHex := hex.EncodeToString(stateHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := consumeAuthorizationRequestScript.Run(operationCtx, s.client, []string{
		s.authorizationRequestKey(stateHex),
		s.authorizationRequestsKey(),
	}, stateHex).Slice()
	if err != nil {
		return auth.AuthorizationRequestRecord{}, errors.New("authorization request store unavailable")
	}
	if len(result) != 3 {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	status, statusOK := result[0].(int64)
	rawText, payloadOK := result[1].(string)
	scoreText, scoreOK := result[2].(string)
	if !statusOK || status != 2 || !payloadOK || !scoreOK {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	indexExpiresAtMillis, err := strconv.ParseInt(scoreText, 10, 64)
	if err != nil {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	rawPayload := []byte(rawText)
	if len(rawPayload) == 0 || len(rawPayload) > maxAuthorizationRequestPayload {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	var payload authorizationRequestPayload
	decoder := json.NewDecoder(bytes.NewReader(rawPayload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || decoder.Decode(&struct{}{}) != io.EOF ||
		payload.ExpiresAtMillis < 1 || payload.ExpiresAtMillis != indexExpiresAtMillis ||
		!validAuthorizationRequestSecret(payload.CodeVerifier) || !validAuthorizationRequestSecret(payload.Nonce) {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	record := auth.AuthorizationRequestRecord{
		CodeVerifier: payload.CodeVerifier,
		Nonce:        payload.Nonce,
		ExpiresAt:    time.UnixMilli(payload.ExpiresAtMillis).UTC(),
	}
	if !record.ExpiresAt.After(time.UnixMilli(nowMillis).UTC()) {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestExpired
	}
	return record, nil
}

func validAuthorizationRequestSecret(value string) bool {
	if len(value) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func (s *Redis) authorizationRequestKey(stateHex string) string {
	return s.key(authorizationRequestKeyNamespace + "state:" + stateHex)
}

func (s *Redis) authorizationRequestsKey() string {
	return s.key(authorizationRequestKeyNamespace + "requests")
}

var _ auth.AuthorizationRequestStore = (*Redis)(nil)
