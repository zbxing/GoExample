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
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
if redis.call("ZCARD", KEYS[2]) >= maximum then return 1 end
if redis.call("EXISTS", KEYS[1]) == 1 then return 2 end
local ttl = expires - now
if ttl < 1 then return 3 end
redis.call("SET", KEYS[1], ARGV[4], "PX", ttl)
redis.call("ZADD", KEYS[2], expires, ARGV[5])
return 0
`)
	consumeAuthorizationRequestScript = redis.NewScript(`
local payload = redis.call("GET", KEYS[1])
if not payload then
  redis.call("ZREM", KEYS[2], ARGV[1])
  return false
end
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[1])
return payload
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
	if s == nil || ctx == nil || stateHash == ([sha256.Size]byte{}) || maxPending < 1 || maxPending > maxAuthorizationRequestEntries ||
		!record.ExpiresAt.After(now) || record.ExpiresAt.Sub(now) > maxAuthorizationRequestTTL ||
		!validAuthorizationRequestSecret(record.CodeVerifier) || !validAuthorizationRequestSecret(record.Nonce) {
		return auth.ErrAuthorizationRequestInvalid
	}
	stateHex := hex.EncodeToString(stateHash[:])
	payload, err := json.Marshal(authorizationRequestPayload{
		CodeVerifier:    record.CodeVerifier,
		Nonce:           record.Nonce,
		ExpiresAtMillis: record.ExpiresAt.UTC().UnixMilli(),
	})
	if err != nil || len(payload) == 0 || len(payload) > maxAuthorizationRequestPayload {
		return auth.ErrAuthorizationRequestInvalid
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := createAuthorizationRequestScript.Run(operationCtx, s.client, []string{
		s.authorizationRequestKey(stateHex),
		s.authorizationRequestsKey(),
	}, now.UTC().UnixMilli(), record.ExpiresAt.UTC().UnixMilli(), maxPending, payload, stateHex).Int()
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
	default:
		return auth.ErrAuthorizationRequestInvalid
	}
}

// ConsumeAuthorizationRequest atomically reads and removes one hash-keyed
// request. Malformed or expired state remains consumed and fails closed.
func (s *Redis) ConsumeAuthorizationRequest(ctx context.Context, stateHash [sha256.Size]byte, now time.Time) (auth.AuthorizationRequestRecord, error) {
	if s == nil || ctx == nil || stateHash == ([sha256.Size]byte{}) {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	stateHex := hex.EncodeToString(stateHash[:])
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	result, err := consumeAuthorizationRequestScript.Run(operationCtx, s.client, []string{
		s.authorizationRequestKey(stateHex),
		s.authorizationRequestsKey(),
	}, stateHex).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
		}
		return auth.AuthorizationRequestRecord{}, errors.New("authorization request store unavailable")
	}
	rawText, ok := result.(string)
	if !ok {
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
		!validAuthorizationRequestSecret(payload.CodeVerifier) || !validAuthorizationRequestSecret(payload.Nonce) {
		return auth.AuthorizationRequestRecord{}, auth.ErrAuthorizationRequestInvalid
	}
	record := auth.AuthorizationRequestRecord{
		CodeVerifier: payload.CodeVerifier,
		Nonce:        payload.Nonce,
		ExpiresAt:    time.UnixMilli(payload.ExpiresAtMillis).UTC(),
	}
	if !record.ExpiresAt.After(now.UTC()) {
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
