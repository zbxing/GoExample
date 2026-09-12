package sharedstate

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultOperationTimeout = 500 * time.Millisecond
	defaultLockTTL          = 15 * time.Second
	defaultLockWaitTimeout  = 2 * time.Second
	defaultLockRetry        = 25 * time.Millisecond
	defaultPoolSize         = 32
)

// RedisTopology selects the discovery model used by the shared-state client.
type RedisTopology string

const (
	RedisTopologyStandalone RedisTopology = "standalone"
	RedisTopologySentinel   RedisTopology = "sentinel"
)

var (
	errRedisNilContext = errors.New("Redis operation context is nil")

	unlockScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`)
	rateLimitScript = redis.NewScript(`
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`)
)

// RedisConfig defines bounded Redis I/O, connection-pool, and lock budgets.
type RedisConfig struct {
	URL                string
	Topology           RedisTopology
	SentinelAddresses  []string
	SentinelMasterName string
	Username           string
	Password           string
	SentinelUsername   string
	SentinelPassword   string
	Database           int
	TLSConfig          *tls.Config
	KeyPrefix          string
	OperationTimeout   time.Duration
	LockTTL            time.Duration
	LockWaitTimeout    time.Duration
	LockRetryInterval  time.Duration
	PoolSize           int
	MinIdleConnections int
	TracerProvider     trace.TracerProvider
}

// RateLimitResult is the result of one atomic fixed-window admission attempt.
type RateLimitResult struct {
	Allowed    bool
	Remaining  int
	ResetAfter time.Duration
}

// AtomicRateLimiter identifies storage backends that can update a rate-limit
// window atomically across processes.
type AtomicRateLimiter interface {
	Take(context.Context, string, int, time.Duration) (RateLimitResult, error)
}

type localGate struct {
	token chan struct{}
	refs  int
}

type lockOwner struct {
	token   string
	release func()
}

// Redis implements Fiber storage, distributed idempotency locking, readiness
// checks, and an atomic fixed-window limiter over one Redis client.
type Redis struct {
	client            redis.UniversalClient
	prefix            string
	operationTimeout  time.Duration
	lockTTL           time.Duration
	lockWaitTimeout   time.Duration
	lockRetryInterval time.Duration
	gatesMu           sync.Mutex
	gates             map[string]*localGate
	ownersMu          sync.Mutex
	owners            map[string]lockOwner
	closeOnce         sync.Once
	closeErr          error
}

// NewRedis creates and verifies a Redis shared-state backend. Configuration
// errors deliberately do not include the URL, which may contain credentials.
func NewRedis(ctx context.Context, config RedisConfig) (*Redis, error) {
	if ctx == nil {
		return nil, errRedisNilContext
	}
	config = withDefaults(config)
	if err := validateConfig(config); err != nil {
		return nil, err
	}
	client, err := newRedisClient(config)
	if err != nil {
		return nil, err
	}
	client.AddHook(newRedisTracingHook(config.TracerProvider))
	state := &Redis{
		client:            client,
		prefix:            config.KeyPrefix,
		operationTimeout:  config.OperationTimeout,
		lockTTL:           config.LockTTL,
		lockWaitTimeout:   config.LockWaitTimeout,
		lockRetryInterval: config.LockRetryInterval,
		gates:             make(map[string]*localGate),
		owners:            make(map[string]lockOwner),
	}
	if err := state.Check(ctx); err != nil {
		_ = state.Close()
		return nil, fmt.Errorf("Redis startup check failed: %w", err)
	}
	return state, nil
}

func withDefaults(config RedisConfig) RedisConfig {
	if config.Topology == "" {
		config.Topology = RedisTopologyStandalone
	}
	if config.OperationTimeout == 0 {
		config.OperationTimeout = defaultOperationTimeout
	}
	if config.LockTTL == 0 {
		config.LockTTL = defaultLockTTL
	}
	if config.LockWaitTimeout == 0 {
		config.LockWaitTimeout = defaultLockWaitTimeout
	}
	if config.LockRetryInterval == 0 {
		config.LockRetryInterval = defaultLockRetry
	}
	if config.PoolSize == 0 {
		config.PoolSize = defaultPoolSize
	}
	return config
}

func validateConfig(config RedisConfig) error {
	switch config.Topology {
	case RedisTopologyStandalone:
		if strings.TrimSpace(config.URL) == "" {
			return errors.New("REDIS_URL is required for standalone topology")
		}
		if len(config.SentinelAddresses) != 0 || config.SentinelMasterName != "" ||
			config.SentinelUsername != "" || config.SentinelPassword != "" || config.TLSConfig != nil ||
			config.Username != "" || config.Password != "" || config.Database != 0 {
			return errors.New("standalone Redis must use REDIS_URL without Sentinel options")
		}
	case RedisTopologySentinel:
		if strings.TrimSpace(config.URL) != "" {
			return errors.New("REDIS_URL must be empty for Sentinel topology")
		}
		if err := validateSentinelConfig(config); err != nil {
			return err
		}
	default:
		return errors.New("Redis topology must be standalone or sentinel")
	}
	if config.KeyPrefix == "" || config.KeyPrefix != strings.TrimSpace(config.KeyPrefix) || !strings.HasSuffix(config.KeyPrefix, ":") {
		return errors.New("REDIS_KEY_PREFIX must be non-empty, trimmed, and end with a colon")
	}
	if len(config.KeyPrefix) > 128 || strings.IndexFunc(config.KeyPrefix, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return errors.New("REDIS_KEY_PREFIX must contain at most 128 printable characters")
	}
	if config.OperationTimeout <= 0 || config.LockTTL <= 0 || config.LockWaitTimeout <= 0 || config.LockRetryInterval <= 0 {
		return errors.New("Redis operation and lock durations must be greater than zero")
	}
	if config.LockRetryInterval >= config.LockWaitTimeout {
		return errors.New("REDIS_LOCK_RETRY_INTERVAL must be less than REDIS_LOCK_WAIT_TIMEOUT")
	}
	if config.LockWaitTimeout >= config.LockTTL {
		return errors.New("REDIS_LOCK_WAIT_TIMEOUT must be less than REDIS_LOCK_TTL")
	}
	if config.PoolSize < 1 || config.PoolSize > 10000 {
		return errors.New("REDIS_POOL_SIZE must be between 1 and 10000")
	}
	if config.MinIdleConnections < 0 || config.MinIdleConnections > config.PoolSize {
		return errors.New("REDIS_MIN_IDLE_CONNECTIONS must be between 0 and REDIS_POOL_SIZE")
	}
	return nil
}

func validateSentinelConfig(config RedisConfig) error {
	if len(config.SentinelAddresses) < 3 || len(config.SentinelAddresses) > 16 {
		return errors.New("Redis Sentinel requires between 3 and 16 addresses")
	}
	seen := make(map[string]struct{}, len(config.SentinelAddresses))
	for index, address := range config.SentinelAddresses {
		if err := validateRedisAddress(address); err != nil {
			return fmt.Errorf("Redis Sentinel address %d is invalid", index+1)
		}
		normalized := strings.ToLower(address)
		if _, exists := seen[normalized]; exists {
			return errors.New("Redis Sentinel addresses must be unique")
		}
		seen[normalized] = struct{}{}
	}
	if !validSentinelMasterName(config.SentinelMasterName) {
		return errors.New("REDIS_SENTINEL_MASTER_NAME must contain 1 to 128 safe characters")
	}
	if config.Database < 0 || config.Database > 15 {
		return errors.New("REDIS_DATABASE must be between 0 and 15")
	}
	if config.Username != "" && config.Password == "" {
		return errors.New("REDIS_PASSWORD is required when REDIS_USERNAME is set")
	}
	if config.SentinelUsername != "" && config.SentinelPassword == "" {
		return errors.New("REDIS_SENTINEL_PASSWORD is required when REDIS_SENTINEL_USERNAME is set")
	}
	return nil
}

func validateRedisAddress(address string) error {
	if address == "" || address != strings.TrimSpace(address) || len(address) > 261 {
		return errors.New("invalid Redis address")
	}
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil || host == "" {
		return errors.New("invalid Redis address")
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("invalid Redis address")
	}
	if strings.IndexFunc(host, func(character rune) bool {
		return character <= 0x20 || character == 0x7f || character == '/' || character == '@'
	}) >= 0 {
		return errors.New("invalid Redis address")
	}
	return nil
}

func validSentinelMasterName(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '.' || character == '_' || character == '-') {
			return false
		}
	}
	return true
}

func newRedisClient(config RedisConfig) (redis.UniversalClient, error) {
	if config.Topology == RedisTopologyStandalone {
		options, err := redis.ParseURL(config.URL)
		if err != nil {
			return nil, errors.New("REDIS_URL is not a valid Redis URL")
		}
		applyRedisClientBudgets(options, config)
		if options.TLSConfig != nil && options.TLSConfig.MinVersion < tls.VersionTLS12 {
			options.TLSConfig.MinVersion = tls.VersionTLS12
		}
		return redis.NewClient(options), nil
	}
	return redis.NewFailoverClient(redisSentinelOptions(config)), nil
}

func applyRedisClientBudgets(options *redis.Options, config RedisConfig) {
	options.PoolSize = config.PoolSize
	options.MinIdleConns = config.MinIdleConnections
	options.DialTimeout = config.OperationTimeout
	options.ReadTimeout = config.OperationTimeout
	options.WriteTimeout = config.OperationTimeout
	options.PoolTimeout = config.OperationTimeout
	options.ContextTimeoutEnabled = true
}

func redisSentinelOptions(config RedisConfig) *redis.FailoverOptions {
	var tlsConfig *tls.Config
	if config.TLSConfig != nil {
		tlsConfig = config.TLSConfig.Clone()
		if tlsConfig.MinVersion < tls.VersionTLS12 {
			tlsConfig.MinVersion = tls.VersionTLS12
		}
	}
	return &redis.FailoverOptions{
		MasterName:            config.SentinelMasterName,
		SentinelAddrs:         append([]string(nil), config.SentinelAddresses...),
		Username:              config.Username,
		Password:              config.Password,
		SentinelUsername:      config.SentinelUsername,
		SentinelPassword:      config.SentinelPassword,
		DB:                    config.Database,
		PoolSize:              config.PoolSize,
		MinIdleConns:          config.MinIdleConnections,
		DialTimeout:           config.OperationTimeout,
		ReadTimeout:           config.OperationTimeout,
		WriteTimeout:          config.OperationTimeout,
		PoolTimeout:           config.OperationTimeout,
		ContextTimeoutEnabled: true,
		TLSConfig:             tlsConfig,
	}
}

func (s *Redis) key(key string) string { return s.prefix + key }

func (s *Redis) operationContext(parent context.Context) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, s.operationTimeout)
}

func (s *Redis) GetWithContext(ctx context.Context, key string) ([]byte, error) {
	if ctx == nil {
		return nil, errRedisNilContext
	}
	if key == "" {
		return nil, nil
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	value, err := s.client.Get(operationCtx, s.key(key)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, redisFailure("get shared state", err)
	}
	return value, nil
}

func (s *Redis) Get(key string) ([]byte, error) {
	return s.GetWithContext(context.Background(), key)
}

func (s *Redis) SetWithContext(ctx context.Context, key string, value []byte, expiration time.Duration) error {
	if ctx == nil {
		return errRedisNilContext
	}
	if key == "" || len(value) == 0 {
		return nil
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	if err := s.client.Set(operationCtx, s.key(key), value, expiration).Err(); err != nil {
		return redisFailure("set shared state", err)
	}
	return nil
}

func (s *Redis) Set(key string, value []byte, expiration time.Duration) error {
	return s.SetWithContext(context.Background(), key, value, expiration)
}

func (s *Redis) DeleteWithContext(ctx context.Context, key string) error {
	if ctx == nil {
		return errRedisNilContext
	}
	if key == "" {
		return nil
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	if err := s.client.Del(operationCtx, s.key(key)).Err(); err != nil {
		return redisFailure("delete shared state", err)
	}
	return nil
}

func (s *Redis) Delete(key string) error {
	return s.DeleteWithContext(context.Background(), key)
}

// ResetWithContext deletes only this adapter's key prefix; it never flushes
// the Redis database shared with other applications.
func (s *Redis) ResetWithContext(ctx context.Context) error {
	if ctx == nil {
		return errRedisNilContext
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	var cursor uint64
	for {
		keys, next, err := s.client.Scan(operationCtx, cursor, s.prefix+"*", 100).Result()
		if err != nil {
			return redisFailure("scan shared state namespace", err)
		}
		if len(keys) > 0 {
			if err := s.client.Del(operationCtx, keys...).Err(); err != nil {
				return redisFailure("reset shared state namespace", err)
			}
		}
		cursor = next
		if cursor == 0 {
			return nil
		}
	}
}

func (s *Redis) Reset() error {
	return s.ResetWithContext(context.Background())
}

// Check verifies that Redis can serve commands within the caller and adapter
// deadlines. It is suitable for startup and readiness checks.
func (s *Redis) Check(ctx context.Context) error {
	if ctx == nil {
		return errRedisNilContext
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	if err := s.client.Ping(operationCtx).Err(); err != nil {
		return redisFailure("ping Redis", err)
	}
	return nil
}

// Close is safe to call more than once.
func (s *Redis) Close() error {
	s.closeOnce.Do(func() {
		s.closeErr = s.client.Close()
	})
	return s.closeErr
}

// Take atomically increments one fixed-window counter and returns its TTL.
func (s *Redis) Take(ctx context.Context, key string, limit int, window time.Duration) (RateLimitResult, error) {
	if ctx == nil {
		return RateLimitResult{}, errRedisNilContext
	}
	if key == "" || limit <= 0 || window <= 0 {
		return RateLimitResult{}, errors.New("rate limit key, limit, and window must be positive")
	}
	windowMilliseconds := window.Milliseconds()
	if windowMilliseconds < 1 {
		windowMilliseconds = 1
	}
	operationCtx, cancel := s.operationContext(ctx)
	defer cancel()
	values, err := rateLimitScript.Run(operationCtx, s.client, []string{s.key(key)}, windowMilliseconds).Int64Slice()
	if err != nil {
		return RateLimitResult{}, redisFailure("update rate limit", err)
	}
	if len(values) != 2 {
		return RateLimitResult{}, errors.New("update rate limit returned an invalid result")
	}
	count, ttlMilliseconds := values[0], values[1]
	if ttlMilliseconds < 1 {
		ttlMilliseconds = 1
	}
	remaining := int64(limit) - count
	if remaining < 0 {
		remaining = 0
	}
	return RateLimitResult{
		Allowed:    count <= int64(limit),
		Remaining:  int(remaining),
		ResetAfter: time.Duration(ttlMilliseconds) * time.Millisecond,
	}, nil
}

// Lock acquires a local gate and then a Redis lease. The local gate prevents a
// lease that expires in one process from replacing that process's owner token.
func (s *Redis) Lock(key string) error {
	if key == "" {
		return errors.New("lock key cannot be empty")
	}
	deadline := time.Now().Add(s.lockWaitTimeout)
	release, err := s.acquireLocal(key, time.Until(deadline))
	if err != nil {
		return err
	}
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		release()
		return fmt.Errorf("create lock owner token: %w", err)
	}
	ownerToken := hex.EncodeToString(tokenBytes)
	redisKey := s.key(key)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			release()
			return errors.New("timed out waiting for distributed lock")
		}
		attemptTimeout := min(remaining, s.operationTimeout)
		attemptCtx, cancel := context.WithTimeout(context.Background(), attemptTimeout)
		acquired, setErr := s.client.SetNX(attemptCtx, redisKey, ownerToken, s.lockTTL).Result()
		cancel()
		if setErr != nil {
			release()
			return redisFailure("acquire distributed lock", setErr)
		}
		if acquired {
			s.ownersMu.Lock()
			s.owners[key] = lockOwner{token: ownerToken, release: release}
			s.ownersMu.Unlock()
			return nil
		}
		wait := min(s.lockRetryInterval, time.Until(deadline))
		if wait <= 0 {
			continue
		}
		timer := time.NewTimer(wait)
		<-timer.C
	}
}

// Unlock removes a lease only when Redis still contains this owner's token.
func (s *Redis) Unlock(key string) error {
	s.ownersMu.Lock()
	owner, ok := s.owners[key]
	if ok {
		delete(s.owners, key)
	}
	s.ownersMu.Unlock()
	if !ok {
		return nil
	}
	defer owner.release()
	operationCtx, cancel := s.operationContext(context.Background())
	defer cancel()
	if err := unlockScript.Run(operationCtx, s.client, []string{s.key(key)}, owner.token).Err(); err != nil {
		return redisFailure("release distributed lock", err)
	}
	return nil
}

func (s *Redis) acquireLocal(key string, timeout time.Duration) (func(), error) {
	if timeout <= 0 {
		return nil, errors.New("timed out waiting for local lock")
	}
	s.gatesMu.Lock()
	gate := s.gates[key]
	if gate == nil {
		gate = &localGate{token: make(chan struct{}, 1)}
		gate.token <- struct{}{}
		s.gates[key] = gate
	}
	gate.refs++
	s.gatesMu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-gate.token:
		var once sync.Once
		return func() {
			once.Do(func() {
				gate.token <- struct{}{}
				s.releaseGateRef(key, gate)
			})
		}, nil
	case <-timer.C:
		s.releaseGateRef(key, gate)
		return nil, errors.New("timed out waiting for local lock")
	}
}

func (s *Redis) releaseGateRef(key string, gate *localGate) {
	s.gatesMu.Lock()
	gate.refs--
	if gate.refs == 0 && s.gates[key] == gate {
		delete(s.gates, key)
	}
	s.gatesMu.Unlock()
}

// Redis dependency deadlines are server availability failures. Keeping the
// cause out of errors.Is prevents HTTP error handling from reporting them as a
// client request timeout while retaining useful text for internal logs.
func redisFailure(operation string, err error) error {
	return fmt.Errorf("%s: %v", operation, err)
}

var _ AtomicRateLimiter = (*Redis)(nil)
