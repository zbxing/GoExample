package config

import (
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	defaultName        = "GoExample API"
	defaultEnvironment = "development"
	defaultHost        = "0.0.0.0"
	defaultPort        = 3001
)

type Config struct {
	Name                             string
	Environment                      string
	LogLevel                         string
	LogFormat                        string
	LogSkipPaths                     []string
	TraceExporter                    string
	OTLPEndpoint                     string
	TraceSampleRatio                 float64
	TraceExportTimeout               time.Duration
	TraceBatchTimeout                time.Duration
	TraceMaxQueueSize                int
	TraceMaxExportBatchSize          int
	Host                             string
	Port                             int
	AllowedOrigins                   []string
	AllowCredentials                 bool
	TrustedProxies                   []string
	BodyLimit                        int
	ReadBufferSize                   int
	ReadTimeout                      time.Duration
	WriteTimeout                     time.Duration
	IdleTimeout                      time.Duration
	MaxConnections                   int
	RequestTimeout                   time.Duration
	MaxInFlight                      int
	HealthCheckTimeout               time.Duration
	HealthCacheTTL                   time.Duration
	ShutdownTimeout                  time.Duration
	ShutdownDrainDelay               time.Duration
	RateLimitMax                     int
	RateLimitWindow                  time.Duration
	AuthRateLimitMax                 int
	IdempotencyEnabled               bool
	IdempotencyLifetime              time.Duration
	SharedStateMode                  string
	AllowInMemorySharedState         bool
	RedisURL                         string
	RedisTopology                    string
	RedisSentinelAddresses           []string
	RedisSentinelMasterName          string
	RedisUsername                    string
	RedisPassword                    string
	RedisSentinelUsername            string
	RedisSentinelPassword            string
	RedisDatabase                    int
	RedisTLSEnabled                  bool
	RedisTLSServerName               string
	RedisTLSCAFile                   string
	RedisKeyPrefix                   string
	RedisOperationTimeout            time.Duration
	RedisLockTTL                     time.Duration
	RedisLockWaitTimeout             time.Duration
	RedisLockRetryInterval           time.Duration
	RedisPoolSize                    int
	RedisMinIdleConnections          int
	MetricsToken                     string
	PprofEnabled                     bool
	PprofToken                       string
	SystemInfoDetailed               bool
	DemoAuthEnabled                  bool
	DemoUsername                     string
	DemoPassword                     string
	JWTSecret                        string
	JWTIssuer                        string
	JWTAudience                      string
	JWTTTL                           time.Duration
	OIDCAuthEnabled                  bool
	OIDCIssuer                       string
	OIDCAudience                     string
	OIDCJWKSURL                      string
	OIDCJWKSHTTPTimeout              time.Duration
	OIDCJWKSRefreshInterval          time.Duration
	OIDCMaxTokenAge                  time.Duration
	OIDCRequiredACR                  string
	OIDCRequiredAMR                  []string
	OIDCMaxAuthAge                   time.Duration
	OIDCBrowserEnabled               bool
	OIDCClientID                     string
	OIDCClientSecret                 string
	OIDCRedirectURL                  string
	OIDCAuthorizationTTL             time.Duration
	OIDCBrowserSessionTTL            time.Duration
	OIDCBrowserMaxSessions           int
	OIDCBrowserMaxSessionsPerSubject int
}

func Load() (Config, error) {
	environment := strings.ToLower(valueOrDefault("APP_ENV", defaultEnvironment))
	if !oneOf(environment, "development", "test", "production") {
		return Config{}, fmt.Errorf("APP_ENV must be one of development, test, production")
	}
	sharedStateMode := "memory"
	if environment == "production" {
		sharedStateMode = "external"
	}
	cfg := Config{
		Name:                             valueOrDefault("APP_NAME", defaultName),
		Environment:                      environment,
		LogLevel:                         strings.ToLower(valueOrDefault("LOG_LEVEL", "info")),
		LogFormat:                        strings.ToLower(valueOrDefault("LOG_FORMAT", "json")),
		LogSkipPaths:                     csvValues("LOG_SKIP_PATHS", []string{"/livez", "/readyz", "/startupz", "/metrics"}),
		TraceExporter:                    strings.ToLower(valueOrDefault("OTEL_TRACES_EXPORTER", "none")),
		OTLPEndpoint:                     strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
		TraceSampleRatio:                 0.1,
		TraceExportTimeout:               3 * time.Second,
		TraceBatchTimeout:                5 * time.Second,
		TraceMaxQueueSize:                2048,
		TraceMaxExportBatchSize:          512,
		Host:                             valueOrDefault("HTTP_HOST", defaultHost),
		AllowedOrigins:                   csvValues("CORS_ALLOW_ORIGINS", []string{"http://localhost:3000"}),
		AllowCredentials:                 false,
		TrustedProxies:                   csvValues("TRUSTED_PROXIES", nil),
		BodyLimit:                        4 * 1024 * 1024,
		ReadBufferSize:                   16 * 1024,
		ReadTimeout:                      10 * time.Second,
		WriteTimeout:                     10 * time.Second,
		IdleTimeout:                      60 * time.Second,
		MaxConnections:                   4096,
		RequestTimeout:                   8 * time.Second,
		MaxInFlight:                      256,
		HealthCheckTimeout:               2 * time.Second,
		HealthCacheTTL:                   time.Second,
		ShutdownTimeout:                  20 * time.Second,
		ShutdownDrainDelay:               0,
		RateLimitMax:                     120,
		RateLimitWindow:                  time.Minute,
		AuthRateLimitMax:                 10,
		IdempotencyEnabled:               true,
		IdempotencyLifetime:              30 * time.Minute,
		SharedStateMode:                  strings.ToLower(valueOrDefault("SHARED_STATE_MODE", sharedStateMode)),
		AllowInMemorySharedState:         false,
		RedisURL:                         strings.TrimSpace(os.Getenv("REDIS_URL")),
		RedisTopology:                    strings.ToLower(valueOrDefault("REDIS_TOPOLOGY", "standalone")),
		RedisSentinelAddresses:           csvValues("REDIS_SENTINEL_ADDRESSES", nil),
		RedisSentinelMasterName:          strings.TrimSpace(os.Getenv("REDIS_SENTINEL_MASTER_NAME")),
		RedisUsername:                    strings.TrimSpace(os.Getenv("REDIS_USERNAME")),
		RedisPassword:                    os.Getenv("REDIS_PASSWORD"),
		RedisSentinelUsername:            strings.TrimSpace(os.Getenv("REDIS_SENTINEL_USERNAME")),
		RedisSentinelPassword:            os.Getenv("REDIS_SENTINEL_PASSWORD"),
		RedisDatabase:                    0,
		RedisTLSEnabled:                  false,
		RedisTLSServerName:               strings.TrimSpace(os.Getenv("REDIS_TLS_SERVER_NAME")),
		RedisTLSCAFile:                   strings.TrimSpace(os.Getenv("REDIS_TLS_CA_FILE")),
		RedisKeyPrefix:                   valueOrDefault("REDIS_KEY_PREFIX", "goexample:example:"),
		RedisOperationTimeout:            500 * time.Millisecond,
		RedisLockTTL:                     15 * time.Second,
		RedisLockWaitTimeout:             2 * time.Second,
		RedisLockRetryInterval:           25 * time.Millisecond,
		RedisPoolSize:                    32,
		RedisMinIdleConnections:          2,
		MetricsToken:                     strings.TrimSpace(os.Getenv("METRICS_TOKEN")),
		PprofEnabled:                     false,
		PprofToken:                       strings.TrimSpace(os.Getenv("PPROF_TOKEN")),
		SystemInfoDetailed:               !strings.EqualFold(environment, "production"),
		DemoAuthEnabled:                  !strings.EqualFold(environment, "production"),
		DemoUsername:                     valueOrDefault("DEMO_USERNAME", "demo"),
		DemoPassword:                     valueOrDefault("DEMO_PASSWORD", "demo123"),
		JWTSecret:                        valueOrDefault("JWT_SECRET", "goexample-development-jwt-secret-change-me"),
		JWTIssuer:                        valueOrDefault("JWT_ISSUER", "goexample"),
		JWTAudience:                      valueOrDefault("JWT_AUDIENCE", "goexample-api"),
		JWTTTL:                           time.Hour,
		OIDCAuthEnabled:                  false,
		OIDCIssuer:                       strings.TrimSpace(os.Getenv("OIDC_ISSUER")),
		OIDCAudience:                     strings.TrimSpace(os.Getenv("OIDC_AUDIENCE")),
		OIDCJWKSURL:                      strings.TrimSpace(os.Getenv("OIDC_JWKS_URL")),
		OIDCJWKSHTTPTimeout:              3 * time.Second,
		OIDCJWKSRefreshInterval:          5 * time.Minute,
		OIDCMaxTokenAge:                  15 * time.Minute,
		OIDCRequiredACR:                  os.Getenv("OIDC_REQUIRED_ACR"),
		OIDCRequiredAMR:                  csvValues("OIDC_REQUIRED_AMR", nil),
		OIDCMaxAuthAge:                   0,
		OIDCBrowserEnabled:               false,
		OIDCClientID:                     strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")),
		OIDCClientSecret:                 os.Getenv("OIDC_CLIENT_SECRET"),
		OIDCRedirectURL:                  strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")),
		OIDCAuthorizationTTL:             5 * time.Minute,
		OIDCBrowserSessionTTL:            15 * time.Minute,
		OIDCBrowserMaxSessions:           10000,
		OIDCBrowserMaxSessionsPerSubject: 10,
	}

	var err error
	if !oneOf(cfg.LogLevel, "debug", "info", "warn", "error") {
		return Config{}, fmt.Errorf("LOG_LEVEL must be one of debug, info, warn, error")
	}
	if !oneOf(cfg.LogFormat, "json", "text") {
		return Config{}, fmt.Errorf("LOG_FORMAT must be either json or text")
	}
	if !oneOf(cfg.TraceExporter, "none", "otlp") {
		return Config{}, fmt.Errorf("OTEL_TRACES_EXPORTER must be either none or otlp")
	}
	if cfg.TraceSampleRatio, err = floatValue("OTEL_TRACES_SAMPLER_ARG", cfg.TraceSampleRatio); err != nil {
		return Config{}, err
	}
	if math.IsNaN(cfg.TraceSampleRatio) || math.IsInf(cfg.TraceSampleRatio, 0) || cfg.TraceSampleRatio < 0 || cfg.TraceSampleRatio > 1 {
		return Config{}, fmt.Errorf("OTEL_TRACES_SAMPLER_ARG must be between 0 and 1")
	}
	if cfg.TraceExportTimeout, err = millisecondDurationValue("OTEL_BSP_EXPORT_TIMEOUT", cfg.TraceExportTimeout); err != nil {
		return Config{}, err
	}
	if cfg.TraceBatchTimeout, err = millisecondDurationValue("OTEL_BSP_SCHEDULE_DELAY", cfg.TraceBatchTimeout); err != nil {
		return Config{}, err
	}
	if cfg.TraceMaxQueueSize, err = intValue("OTEL_BSP_MAX_QUEUE_SIZE", cfg.TraceMaxQueueSize); err != nil {
		return Config{}, err
	}
	if cfg.TraceMaxQueueSize < 1 || cfg.TraceMaxQueueSize > 1000000 {
		return Config{}, fmt.Errorf("OTEL_BSP_MAX_QUEUE_SIZE must be between 1 and 1000000")
	}
	if cfg.TraceMaxExportBatchSize, err = intValue("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", cfg.TraceMaxExportBatchSize); err != nil {
		return Config{}, err
	}
	if cfg.TraceMaxExportBatchSize < 1 || cfg.TraceMaxExportBatchSize > cfg.TraceMaxQueueSize {
		return Config{}, fmt.Errorf("OTEL_BSP_MAX_EXPORT_BATCH_SIZE must be between 1 and OTEL_BSP_MAX_QUEUE_SIZE")
	}
	if cfg.TraceExporter == "otlp" {
		endpoint, parseErr := url.Parse(cfg.OTLPEndpoint)
		if parseErr != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Host == "" {
			return Config{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute http or https URL")
		}
		if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
			return Config{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must not contain credentials, query, or fragment")
		}
	}
	if cfg.Port, err = intValue("HTTP_PORT", defaultPort); err != nil {
		return Config{}, err
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("HTTP_PORT must be between 1 and 65535")
	}
	if cfg.AllowCredentials, err = boolValue("CORS_ALLOW_CREDENTIALS", cfg.AllowCredentials); err != nil {
		return Config{}, err
	}
	for _, origin := range cfg.AllowedOrigins {
		if cfg.AllowCredentials && origin == "*" {
			return Config{}, fmt.Errorf("CORS_ALLOW_ORIGINS cannot contain * when credentialed requests are enabled")
		}
	}
	if err := validateTrustedProxies(cfg.TrustedProxies, cfg.Environment == "production"); err != nil {
		return Config{}, err
	}
	if cfg.BodyLimit, err = intValue("HTTP_BODY_LIMIT", cfg.BodyLimit); err != nil {
		return Config{}, err
	}
	if cfg.BodyLimit < 1024 || cfg.BodyLimit > 64*1024*1024 {
		return Config{}, fmt.Errorf("HTTP_BODY_LIMIT must be between 1024 and 67108864 bytes")
	}
	if cfg.ReadBufferSize, err = intValue("HTTP_READ_BUFFER_SIZE", cfg.ReadBufferSize); err != nil {
		return Config{}, err
	}
	if cfg.ReadBufferSize < 4*1024 || cfg.ReadBufferSize > 1024*1024 {
		return Config{}, fmt.Errorf("HTTP_READ_BUFFER_SIZE must be between 4096 and 1048576 bytes")
	}
	if cfg.ReadTimeout, err = durationValue("HTTP_READ_TIMEOUT", cfg.ReadTimeout); err != nil {
		return Config{}, err
	}
	if cfg.WriteTimeout, err = durationValue("HTTP_WRITE_TIMEOUT", cfg.WriteTimeout); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = durationValue("HTTP_IDLE_TIMEOUT", cfg.IdleTimeout); err != nil {
		return Config{}, err
	}
	if cfg.MaxConnections, err = intValue("HTTP_MAX_CONNECTIONS", cfg.MaxConnections); err != nil {
		return Config{}, err
	}
	if cfg.MaxConnections < 1 || cfg.MaxConnections > 1000000 {
		return Config{}, fmt.Errorf("HTTP_MAX_CONNECTIONS must be between 1 and 1000000")
	}
	if cfg.RequestTimeout, err = durationValue("HTTP_REQUEST_TIMEOUT", cfg.RequestTimeout); err != nil {
		return Config{}, err
	}
	if cfg.RequestTimeout >= cfg.WriteTimeout {
		return Config{}, fmt.Errorf("HTTP_REQUEST_TIMEOUT must be less than HTTP_WRITE_TIMEOUT")
	}
	if cfg.ReadTimeout > cfg.IdleTimeout {
		return Config{}, fmt.Errorf("HTTP_READ_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT")
	}
	if cfg.WriteTimeout > cfg.IdleTimeout {
		return Config{}, fmt.Errorf("HTTP_WRITE_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT")
	}
	if cfg.MaxInFlight, err = intValue("HTTP_MAX_IN_FLIGHT", cfg.MaxInFlight); err != nil {
		return Config{}, err
	}
	if cfg.MaxInFlight < 1 || cfg.MaxInFlight > 100000 {
		return Config{}, fmt.Errorf("HTTP_MAX_IN_FLIGHT must be between 1 and 100000")
	}
	if cfg.HealthCheckTimeout, err = durationValue("HEALTH_CHECK_TIMEOUT", cfg.HealthCheckTimeout); err != nil {
		return Config{}, err
	}
	if cfg.HealthCacheTTL, err = durationValue("HEALTH_CACHE_TTL", cfg.HealthCacheTTL); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = durationValue("SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownDrainDelay, err = nonNegativeDurationValue("SHUTDOWN_DRAIN_DELAY", cfg.ShutdownDrainDelay); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownDrainDelay >= cfg.ShutdownTimeout {
		return Config{}, fmt.Errorf("SHUTDOWN_DRAIN_DELAY must be less than SHUTDOWN_TIMEOUT")
	}
	if cfg.ShutdownDrainDelay+cfg.RequestTimeout >= cfg.ShutdownTimeout {
		return Config{}, fmt.Errorf("SHUTDOWN_DRAIN_DELAY plus HTTP_REQUEST_TIMEOUT must be less than SHUTDOWN_TIMEOUT")
	}
	if cfg.ShutdownDrainDelay+cfg.ReadTimeout >= cfg.ShutdownTimeout {
		return Config{}, fmt.Errorf("SHUTDOWN_DRAIN_DELAY plus HTTP_READ_TIMEOUT must be less than SHUTDOWN_TIMEOUT")
	}
	if cfg.ShutdownDrainDelay+cfg.WriteTimeout >= cfg.ShutdownTimeout {
		return Config{}, fmt.Errorf("SHUTDOWN_DRAIN_DELAY plus HTTP_WRITE_TIMEOUT must be less than SHUTDOWN_TIMEOUT")
	}
	if cfg.RateLimitMax, err = intValue("RATE_LIMIT_MAX", cfg.RateLimitMax); err != nil {
		return Config{}, err
	}
	if cfg.RateLimitMax < 1 {
		return Config{}, fmt.Errorf("RATE_LIMIT_MAX must be greater than zero")
	}
	if cfg.RateLimitWindow, err = durationValue("RATE_LIMIT_WINDOW", cfg.RateLimitWindow); err != nil {
		return Config{}, err
	}
	if cfg.AuthRateLimitMax, err = intValue("AUTH_RATE_LIMIT_MAX", cfg.AuthRateLimitMax); err != nil {
		return Config{}, err
	}
	if cfg.AuthRateLimitMax < 1 {
		return Config{}, fmt.Errorf("AUTH_RATE_LIMIT_MAX must be greater than zero")
	}
	if cfg.IdempotencyEnabled, err = boolValue("IDEMPOTENCY_ENABLED", cfg.IdempotencyEnabled); err != nil {
		return Config{}, err
	}
	if cfg.IdempotencyLifetime, err = durationValue("IDEMPOTENCY_LIFETIME", cfg.IdempotencyLifetime); err != nil {
		return Config{}, err
	}
	if !oneOf(cfg.SharedStateMode, "memory", "external") {
		return Config{}, fmt.Errorf("SHARED_STATE_MODE must be either memory or external")
	}
	if cfg.AllowInMemorySharedState, err = boolValue("ALLOW_IN_MEMORY_SHARED_STATE", cfg.AllowInMemorySharedState); err != nil {
		return Config{}, err
	}
	if err := validateRedisKeyPrefix(cfg.RedisKeyPrefix); err != nil {
		return Config{}, err
	}
	if cfg.RedisOperationTimeout, err = durationValue("REDIS_OPERATION_TIMEOUT", cfg.RedisOperationTimeout); err != nil {
		return Config{}, err
	}
	if cfg.RedisLockTTL, err = durationValue("REDIS_LOCK_TTL", cfg.RedisLockTTL); err != nil {
		return Config{}, err
	}
	if cfg.RedisLockWaitTimeout, err = durationValue("REDIS_LOCK_WAIT_TIMEOUT", cfg.RedisLockWaitTimeout); err != nil {
		return Config{}, err
	}
	if cfg.RedisLockRetryInterval, err = durationValue("REDIS_LOCK_RETRY_INTERVAL", cfg.RedisLockRetryInterval); err != nil {
		return Config{}, err
	}
	if cfg.RedisLockRetryInterval >= cfg.RedisLockWaitTimeout {
		return Config{}, fmt.Errorf("REDIS_LOCK_RETRY_INTERVAL must be less than REDIS_LOCK_WAIT_TIMEOUT")
	}
	if cfg.RedisLockWaitTimeout >= cfg.RedisLockTTL {
		return Config{}, fmt.Errorf("REDIS_LOCK_WAIT_TIMEOUT must be less than REDIS_LOCK_TTL")
	}
	if cfg.RedisPoolSize, err = intValue("REDIS_POOL_SIZE", cfg.RedisPoolSize); err != nil {
		return Config{}, err
	}
	if cfg.RedisPoolSize < 1 || cfg.RedisPoolSize > 10000 {
		return Config{}, fmt.Errorf("REDIS_POOL_SIZE must be between 1 and 10000")
	}
	if cfg.RedisMinIdleConnections, err = intValue("REDIS_MIN_IDLE_CONNECTIONS", cfg.RedisMinIdleConnections); err != nil {
		return Config{}, err
	}
	if cfg.RedisMinIdleConnections < 0 || cfg.RedisMinIdleConnections > cfg.RedisPoolSize {
		return Config{}, fmt.Errorf("REDIS_MIN_IDLE_CONNECTIONS must be between 0 and REDIS_POOL_SIZE")
	}
	if cfg.RedisDatabase, err = intValue("REDIS_DATABASE", cfg.RedisDatabase); err != nil {
		return Config{}, err
	}
	if cfg.RedisDatabase < 0 || cfg.RedisDatabase > 15 {
		return Config{}, fmt.Errorf("REDIS_DATABASE must be between 0 and 15")
	}
	if !oneOf(cfg.RedisTopology, "standalone", "sentinel") {
		return Config{}, fmt.Errorf("REDIS_TOPOLOGY must be standalone or sentinel")
	}
	if cfg.RedisTLSEnabled, err = boolValue("REDIS_TLS_ENABLED", cfg.RedisTLSEnabled); err != nil {
		return Config{}, err
	}
	if !cfg.RedisTLSEnabled && (cfg.RedisTLSServerName != "" || cfg.RedisTLSCAFile != "") {
		return Config{}, fmt.Errorf("REDIS_TLS_ENABLED must be true when Redis TLS server name or CA file is set")
	}
	if len(cfg.RedisTLSServerName) > 253 || strings.IndexFunc(cfg.RedisTLSServerName, unicode.IsSpace) >= 0 {
		return Config{}, fmt.Errorf("REDIS_TLS_SERVER_NAME must be at most 253 characters without whitespace")
	}
	if len(cfg.RedisTLSCAFile) > 1024 || strings.IndexFunc(cfg.RedisTLSCAFile, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
		return Config{}, fmt.Errorf("REDIS_TLS_CA_FILE must be a bounded path without control characters")
	}
	if cfg.Environment == "production" && cfg.SharedStateMode == "memory" && !cfg.AllowInMemorySharedState {
		return Config{}, fmt.Errorf("production SHARED_STATE_MODE=memory requires ALLOW_IN_MEMORY_SHARED_STATE=true")
	}
	if cfg.MetricsToken != "" && len(cfg.MetricsToken) < 32 {
		return Config{}, fmt.Errorf("METRICS_TOKEN must contain at least 32 characters when set")
	}
	if cfg.PprofEnabled, err = boolValue("PPROF_ENABLED", cfg.PprofEnabled); err != nil {
		return Config{}, err
	}
	if cfg.PprofEnabled && len(cfg.PprofToken) < 32 {
		return Config{}, fmt.Errorf("PPROF_TOKEN must contain at least 32 characters when PPROF_ENABLED is true")
	}
	if cfg.SystemInfoDetailed, err = boolValue("SYSTEM_INFO_DETAILED", cfg.SystemInfoDetailed); err != nil {
		return Config{}, err
	}
	if cfg.DemoAuthEnabled, err = boolValue("DEMO_AUTH_ENABLED", cfg.DemoAuthEnabled); err != nil {
		return Config{}, err
	}
	if cfg.OIDCAuthEnabled, err = boolValue("OIDC_AUTH_ENABLED", cfg.OIDCAuthEnabled); err != nil {
		return Config{}, err
	}
	if cfg.OIDCBrowserEnabled, err = boolValue("OIDC_BROWSER_ENABLED", cfg.OIDCBrowserEnabled); err != nil {
		return Config{}, err
	}
	if cfg.DemoAuthEnabled && cfg.OIDCAuthEnabled {
		return Config{}, fmt.Errorf("DEMO_AUTH_ENABLED and OIDC_AUTH_ENABLED cannot both be true")
	}
	if cfg.JWTTTL, err = durationValue("JWT_TTL", cfg.JWTTTL); err != nil {
		return Config{}, err
	}
	if cfg.OIDCJWKSHTTPTimeout, err = durationValue("OIDC_JWKS_HTTP_TIMEOUT", cfg.OIDCJWKSHTTPTimeout); err != nil {
		return Config{}, err
	}
	if cfg.OIDCJWKSRefreshInterval, err = durationValue("OIDC_JWKS_REFRESH_INTERVAL", cfg.OIDCJWKSRefreshInterval); err != nil {
		return Config{}, err
	}
	if cfg.OIDCMaxTokenAge, err = durationValue("OIDC_MAX_TOKEN_AGE", cfg.OIDCMaxTokenAge); err != nil {
		return Config{}, err
	}
	if cfg.OIDCMaxAuthAge, err = nonNegativeDurationValue("OIDC_MAX_AUTH_AGE", cfg.OIDCMaxAuthAge); err != nil {
		return Config{}, err
	}
	if cfg.OIDCAuthorizationTTL, err = durationValue("OIDC_AUTHORIZATION_TTL", cfg.OIDCAuthorizationTTL); err != nil {
		return Config{}, err
	}
	if cfg.OIDCBrowserSessionTTL, err = durationValue("OIDC_BROWSER_SESSION_TTL", cfg.OIDCBrowserSessionTTL); err != nil {
		return Config{}, err
	}
	if cfg.OIDCBrowserMaxSessions, err = intValue("OIDC_BROWSER_MAX_SESSIONS", cfg.OIDCBrowserMaxSessions); err != nil {
		return Config{}, err
	}
	if cfg.OIDCBrowserMaxSessionsPerSubject, err = intValue("OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT", cfg.OIDCBrowserMaxSessionsPerSubject); err != nil {
		return Config{}, err
	}
	if cfg.DemoAuthEnabled && len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must contain at least 32 characters")
	}
	if cfg.OIDCAuthEnabled {
		if err := validateOIDCEndpoint("OIDC_ISSUER", cfg.OIDCIssuer, cfg.Environment == "production"); err != nil {
			return Config{}, err
		}
		if err := validateOIDCEndpoint("OIDC_JWKS_URL", cfg.OIDCJWKSURL, cfg.Environment == "production"); err != nil {
			return Config{}, err
		}
		if cfg.OIDCAudience == "" || len(cfg.OIDCAudience) > 128 {
			return Config{}, fmt.Errorf("OIDC_AUDIENCE must be non-empty and at most 128 characters when OIDC auth is enabled")
		}
		if cfg.OIDCJWKSHTTPTimeout > 10*time.Second {
			return Config{}, fmt.Errorf("OIDC_JWKS_HTTP_TIMEOUT must be at most 10 seconds")
		}
		if cfg.OIDCJWKSRefreshInterval < 30*time.Second || cfg.OIDCJWKSRefreshInterval > 24*time.Hour {
			return Config{}, fmt.Errorf("OIDC_JWKS_REFRESH_INTERVAL must be between 30 seconds and 24 hours")
		}
		if cfg.OIDCMaxTokenAge > 24*time.Hour {
			return Config{}, fmt.Errorf("OIDC_MAX_TOKEN_AGE must be at most 24 hours")
		}
	}
	assuranceConfigured := cfg.OIDCRequiredACR != "" || len(cfg.OIDCRequiredAMR) > 0 || cfg.OIDCMaxAuthAge > 0
	if assuranceConfigured && !cfg.OIDCBrowserEnabled {
		return Config{}, fmt.Errorf("OIDC assurance settings require OIDC_BROWSER_ENABLED=true")
	}
	if cfg.OIDCBrowserEnabled {
		if !cfg.OIDCAuthEnabled {
			return Config{}, fmt.Errorf("OIDC_BROWSER_ENABLED requires OIDC_AUTH_ENABLED=true")
		}
		if cfg.OIDCClientID == "" || len(cfg.OIDCClientID) > 128 || strings.TrimSpace(cfg.OIDCClientID) != cfg.OIDCClientID || strings.ContainsAny(cfg.OIDCClientID, "\x00\r\n") {
			return Config{}, fmt.Errorf("OIDC_CLIENT_ID must be non-empty, trimmed, and at most 128 characters")
		}
		if len(cfg.OIDCClientSecret) > 256 || strings.ContainsAny(cfg.OIDCClientSecret, "\x00\r\n") {
			return Config{}, fmt.Errorf("OIDC_CLIENT_SECRET must be at most 256 characters without control characters")
		}
		if err := validateOIDCRedirectURL(cfg.OIDCRedirectURL); err != nil {
			return Config{}, err
		}
		if cfg.OIDCAuthorizationTTL > 15*time.Minute {
			return Config{}, fmt.Errorf("OIDC_AUTHORIZATION_TTL must be at most 15 minutes")
		}
		if cfg.OIDCBrowserSessionTTL > 24*time.Hour {
			return Config{}, fmt.Errorf("OIDC_BROWSER_SESSION_TTL must be at most 24 hours")
		}
		if cfg.OIDCBrowserMaxSessions < 1 || cfg.OIDCBrowserMaxSessions > 10000 {
			return Config{}, fmt.Errorf("OIDC_BROWSER_MAX_SESSIONS must be between 1 and 10000")
		}
		if cfg.OIDCBrowserMaxSessionsPerSubject < 1 || cfg.OIDCBrowserMaxSessionsPerSubject > cfg.OIDCBrowserMaxSessions {
			return Config{}, fmt.Errorf("OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT must be between 1 and OIDC_BROWSER_MAX_SESSIONS")
		}
		if cfg.OIDCRequiredACR != "" && !validOIDCAssuranceValue(cfg.OIDCRequiredACR) {
			return Config{}, fmt.Errorf("OIDC_REQUIRED_ACR must be trimmed and at most 256 bytes without control characters")
		}
		if len(cfg.OIDCRequiredAMR) > 16 {
			return Config{}, fmt.Errorf("OIDC_REQUIRED_AMR must contain at most 16 values")
		}
		for _, method := range cfg.OIDCRequiredAMR {
			if !validOIDCAssuranceValue(method) {
				return Config{}, fmt.Errorf("OIDC_REQUIRED_AMR values must be trimmed and at most 256 bytes without control characters")
			}
		}
		if cfg.OIDCMaxAuthAge > 24*time.Hour {
			return Config{}, fmt.Errorf("OIDC_MAX_AUTH_AGE must be at most 24 hours")
		}
		if (cfg.OIDCRequiredACR != "" || len(cfg.OIDCRequiredAMR) > 0) && cfg.OIDCMaxAuthAge <= 0 {
			return Config{}, fmt.Errorf("OIDC_REQUIRED_ACR or OIDC_REQUIRED_AMR requires a positive OIDC_MAX_AUTH_AGE")
		}
		if cfg.Environment == "production" && cfg.SharedStateMode != "external" {
			return Config{}, fmt.Errorf("production browser OIDC sessions require SHARED_STATE_MODE=external")
		}
	}
	if strings.EqualFold(cfg.Environment, "production") {
		if cfg.MetricsToken == "" {
			return Config{}, fmt.Errorf("METRICS_TOKEN must be set in production")
		}
		if cfg.DemoAuthEnabled && cfg.JWTSecret == "goexample-development-jwt-secret-change-me" {
			return Config{}, fmt.Errorf("JWT_SECRET must be changed in production")
		}
		if cfg.DemoAuthEnabled && cfg.MetricsToken == cfg.JWTSecret {
			return Config{}, fmt.Errorf("METRICS_TOKEN must differ from JWT_SECRET in production")
		}
		if cfg.PprofEnabled && (cfg.PprofToken == cfg.MetricsToken || (cfg.DemoAuthEnabled && cfg.PprofToken == cfg.JWTSecret)) {
			return Config{}, fmt.Errorf("PPROF_TOKEN must differ from active production authentication and metrics secrets")
		}
		if cfg.DemoAuthEnabled && (cfg.DemoUsername == "demo" || cfg.DemoPassword == "demo123") {
			return Config{}, fmt.Errorf("demo credentials must be changed when DEMO_AUTH_ENABLED is true in production")
		}
	}
	if cfg.SharedStateMode == "external" {
		switch cfg.RedisTopology {
		case "standalone":
			if err := validateRedisURL(cfg.RedisURL); err != nil {
				return Config{}, err
			}
			if len(cfg.RedisSentinelAddresses) != 0 || cfg.RedisSentinelMasterName != "" ||
				cfg.RedisSentinelUsername != "" || cfg.RedisSentinelPassword != "" || cfg.RedisTLSEnabled ||
				cfg.RedisUsername != "" || cfg.RedisPassword != "" || cfg.RedisDatabase != 0 {
				return Config{}, fmt.Errorf("standalone Redis must use REDIS_URL without Sentinel options")
			}
		case "sentinel":
			if err := validateRedisSentinelConfiguration(cfg); err != nil {
				return Config{}, err
			}
		default:
			return Config{}, fmt.Errorf("REDIS_TOPOLOGY must be standalone or sentinel")
		}
		if cfg.RedisLockTTL <= cfg.RequestTimeout {
			return Config{}, fmt.Errorf("REDIS_LOCK_TTL must be greater than HTTP_REQUEST_TIMEOUT")
		}
		if cfg.RedisLockWaitTimeout >= cfg.RequestTimeout {
			return Config{}, fmt.Errorf("REDIS_LOCK_WAIT_TIMEOUT must be less than HTTP_REQUEST_TIMEOUT")
		}
	}

	return cfg, nil
}

func validateRedisSentinelConfiguration(cfg Config) error {
	if cfg.RedisURL != "" {
		return fmt.Errorf("REDIS_URL must be empty when REDIS_TOPOLOGY=sentinel")
	}
	if len(cfg.RedisSentinelAddresses) < 3 || len(cfg.RedisSentinelAddresses) > 16 {
		return fmt.Errorf("REDIS_SENTINEL_ADDRESSES must contain between 3 and 16 unique addresses")
	}
	seen := make(map[string]struct{}, len(cfg.RedisSentinelAddresses))
	for index, address := range cfg.RedisSentinelAddresses {
		host, rawPort, err := net.SplitHostPort(address)
		port, portErr := strconv.Atoi(rawPort)
		if err != nil || host == "" || portErr != nil || port < 1 || port > 65535 ||
			strings.IndexFunc(host, func(character rune) bool {
				return character <= 0x20 || character == 0x7f || character == '/' || character == '@'
			}) >= 0 {
			return fmt.Errorf("REDIS_SENTINEL_ADDRESSES entry %d must be a safe host:port address", index+1)
		}
		normalized := strings.ToLower(address)
		if _, exists := seen[normalized]; exists {
			return fmt.Errorf("REDIS_SENTINEL_ADDRESSES must contain unique addresses")
		}
		seen[normalized] = struct{}{}
	}
	if !validRedisSentinelMasterName(cfg.RedisSentinelMasterName) {
		return fmt.Errorf("REDIS_SENTINEL_MASTER_NAME must contain 1 to 128 safe characters")
	}
	if cfg.RedisUsername != "" && cfg.RedisPassword == "" {
		return fmt.Errorf("REDIS_PASSWORD must be set when REDIS_USERNAME is set")
	}
	if cfg.RedisSentinelUsername != "" && cfg.RedisSentinelPassword == "" {
		return fmt.Errorf("REDIS_SENTINEL_PASSWORD must be set when REDIS_SENTINEL_USERNAME is set")
	}
	if cfg.Environment == "production" {
		if !cfg.RedisTLSEnabled {
			return fmt.Errorf("production Redis Sentinel requires REDIS_TLS_ENABLED=true")
		}
		if cfg.RedisUsername == "" || cfg.RedisPassword == "" {
			return fmt.Errorf("production Redis Sentinel requires REDIS_USERNAME and REDIS_PASSWORD")
		}
		if cfg.RedisSentinelUsername == "" || cfg.RedisSentinelPassword == "" {
			return fmt.Errorf("production Redis Sentinel requires REDIS_SENTINEL_USERNAME and REDIS_SENTINEL_PASSWORD")
		}
	}
	return nil
}

func validRedisSentinelMasterName(value string) bool {
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

func (c Config) Address() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func intValue(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}
	return value, nil
}

func floatValue(key string, fallback float64) (float64, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a number: %w", key, err)
	}
	return value, nil
}

func millisecondDurationValue(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer number of milliseconds: %w", key, err)
	}
	if milliseconds <= 0 || milliseconds > int64((10*time.Minute)/time.Millisecond) {
		return 0, fmt.Errorf("%s must be between 1 and 600000 milliseconds", key)
	}
	return time.Duration(milliseconds) * time.Millisecond, nil
}

func durationValue(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be a Go duration: %w", key, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("%s must be greater than zero", key)
	}
	return value, nil
}

func nonNegativeDurationValue(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be a Go duration: %w", key, err)
	}
	if value < 0 {
		return 0, fmt.Errorf("%s cannot be negative", key)
	}
	return value, nil
}

func boolValue(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %w", key, err)
	}
	return value, nil
}

func csvValues(key string, fallback []string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	values := make([]string, 0)
	seen := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	if len(values) == 0 {
		return fallback
	}
	return values
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func validateTrustedProxies(values []string, production bool) error {
	for _, value := range values {
		if strings.Contains(value, "/") {
			_, network, err := net.ParseCIDR(value)
			if err != nil {
				return fmt.Errorf("TRUSTED_PROXIES contains invalid CIDR %q", value)
			}
			prefixLength, _ := network.Mask.Size()
			if production && prefixLength == 0 {
				return fmt.Errorf("TRUSTED_PROXIES must not contain catch-all CIDR %q in production", value)
			}
			continue
		}
		if net.ParseIP(value) == nil {
			return fmt.Errorf("TRUSTED_PROXIES contains invalid IP %q", value)
		}
	}
	return nil
}

func validateRedisURL(raw string) error {
	if raw == "" {
		return fmt.Errorf("REDIS_URL must be set when SHARED_STATE_MODE=external")
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "redis" && parsed.Scheme != "rediss") || parsed.Host == "" || parsed.Fragment != "" {
		return fmt.Errorf("REDIS_URL must be an absolute redis or rediss URL without a fragment")
	}
	return nil
}

func validateOIDCEndpoint(name, raw string, production bool) error {
	parsed, err := url.Parse(raw)
	validScheme := parsed.Scheme == "https" || (!production && parsed.Scheme == "http")
	if err != nil || !validScheme || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		scheme := "HTTP(S)"
		if production {
			scheme = "HTTPS"
		}
		return fmt.Errorf("%s must be an absolute %s URL without credentials, query, or fragment", name, scheme)
	}
	return nil
}

func validateOIDCRedirectURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.Path != "/api/v1/auth/oidc/callback" {
		return fmt.Errorf("OIDC_REDIRECT_URL must be an absolute HTTPS URL ending at /api/v1/auth/oidc/callback without credentials, query, or fragment")
	}
	return nil
}

func validOIDCAssuranceValue(value string) bool {
	return value != "" && len(value) <= 256 && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\x00\t\r\n")
}

func validateRedisKeyPrefix(value string) error {
	if value == "" || value != strings.TrimSpace(value) || !strings.HasSuffix(value, ":") || len(value) > 128 {
		return fmt.Errorf("REDIS_KEY_PREFIX must be non-empty, trimmed, at most 128 characters, and end with a colon")
	}
	for index := 0; index < len(value); index++ {
		if value[index] <= 0x20 || value[index] == 0x7f {
			return fmt.Errorf("REDIS_KEY_PREFIX must not contain whitespace or control characters")
		}
	}
	return nil
}
