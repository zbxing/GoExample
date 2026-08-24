package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

var configEnvironmentKeys = []string{
	"APP_NAME",
	"APP_ENV",
	"LOG_LEVEL",
	"LOG_FORMAT",
	"LOG_SKIP_PATHS",
	"OTEL_TRACES_EXPORTER",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_TRACES_SAMPLER_ARG",
	"OTEL_BSP_EXPORT_TIMEOUT",
	"OTEL_BSP_SCHEDULE_DELAY",
	"OTEL_BSP_MAX_QUEUE_SIZE",
	"OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
	"HTTP_HOST",
	"HTTP_PORT",
	"CORS_ALLOW_ORIGINS",
	"CORS_ALLOW_CREDENTIALS",
	"TRUSTED_PROXIES",
	"HTTP_BODY_LIMIT",
	"HTTP_READ_BUFFER_SIZE",
	"HTTP_READ_TIMEOUT",
	"HTTP_WRITE_TIMEOUT",
	"HTTP_IDLE_TIMEOUT",
	"HTTP_MAX_CONNECTIONS",
	"HTTP_REQUEST_TIMEOUT",
	"HTTP_MAX_IN_FLIGHT",
	"HEALTH_CHECK_TIMEOUT",
	"HEALTH_CACHE_TTL",
	"SHUTDOWN_TIMEOUT",
	"SHUTDOWN_DRAIN_DELAY",
	"RATE_LIMIT_MAX",
	"RATE_LIMIT_WINDOW",
	"AUTH_RATE_LIMIT_MAX",
	"IDEMPOTENCY_ENABLED",
	"IDEMPOTENCY_LIFETIME",
	"SHARED_STATE_MODE",
	"ALLOW_IN_MEMORY_SHARED_STATE",
	"REDIS_URL",
	"REDIS_TOPOLOGY",
	"REDIS_SENTINEL_ADDRESSES",
	"REDIS_SENTINEL_MASTER_NAME",
	"REDIS_USERNAME",
	"REDIS_PASSWORD",
	"REDIS_SENTINEL_USERNAME",
	"REDIS_SENTINEL_PASSWORD",
	"REDIS_DATABASE",
	"REDIS_TLS_ENABLED",
	"REDIS_TLS_SERVER_NAME",
	"REDIS_TLS_CA_FILE",
	"REDIS_KEY_PREFIX",
	"REDIS_OPERATION_TIMEOUT",
	"REDIS_LOCK_TTL",
	"REDIS_LOCK_WAIT_TIMEOUT",
	"REDIS_LOCK_RETRY_INTERVAL",
	"REDIS_POOL_SIZE",
	"REDIS_MIN_IDLE_CONNECTIONS",
	"METRICS_TOKEN",
	"PPROF_ENABLED",
	"PPROF_TOKEN",
	"SYSTEM_INFO_DETAILED",
	"DEMO_AUTH_ENABLED",
	"DEMO_USERNAME",
	"DEMO_PASSWORD",
	"JWT_SECRET",
	"JWT_ISSUER",
	"JWT_AUDIENCE",
	"JWT_TTL",
	"OIDC_AUTH_ENABLED",
	"OIDC_ISSUER",
	"OIDC_AUDIENCE",
	"OIDC_JWKS_URL",
	"OIDC_JWKS_HTTP_TIMEOUT",
	"OIDC_JWKS_REFRESH_INTERVAL",
	"OIDC_MAX_TOKEN_AGE",
	"OIDC_REQUIRED_ACR",
	"OIDC_REQUIRED_AMR",
	"OIDC_MAX_AUTH_AGE",
	"OIDC_BROWSER_ENABLED",
	"OIDC_CLIENT_ID",
	"OIDC_CLIENT_SECRET",
	"OIDC_REDIRECT_URL",
	"OIDC_AUTHORIZATION_TTL",
	"OIDC_BROWSER_SESSION_TTL",
	"OIDC_BROWSER_MAX_SESSIONS",
	"OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT",
}

func TestLoadDefaults(t *testing.T) {
	clearConfigEnvironment(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Address() != "0.0.0.0:3001" {
		t.Fatalf("Address() = %q", cfg.Address())
	}
	if cfg.LogLevel != "info" || cfg.LogFormat != "json" {
		t.Fatalf("logging defaults = %q/%q", cfg.LogLevel, cfg.LogFormat)
	}
	if len(cfg.LogSkipPaths) != 4 || cfg.LogSkipPaths[0] != "/livez" {
		t.Fatalf("LogSkipPaths = %#v", cfg.LogSkipPaths)
	}
	if cfg.TraceExporter != "none" || cfg.OTLPEndpoint != "" || cfg.TraceSampleRatio != 0.1 {
		t.Fatalf("trace defaults = %q/%q/%f", cfg.TraceExporter, cfg.OTLPEndpoint, cfg.TraceSampleRatio)
	}
	if cfg.TraceExportTimeout != 3*time.Second || cfg.TraceBatchTimeout != 5*time.Second || cfg.TraceMaxQueueSize != 2048 || cfg.TraceMaxExportBatchSize != 512 {
		t.Fatalf("trace batch defaults = %s/%s/%d/%d", cfg.TraceExportTimeout, cfg.TraceBatchTimeout, cfg.TraceMaxQueueSize, cfg.TraceMaxExportBatchSize)
	}
	if cfg.AllowCredentials {
		t.Fatal("AllowCredentials = true")
	}
	if cfg.BodyLimit != 4*1024*1024 {
		t.Fatalf("BodyLimit = %d", cfg.BodyLimit)
	}
	if cfg.ReadBufferSize != 16*1024 {
		t.Fatalf("ReadBufferSize = %d", cfg.ReadBufferSize)
	}
	if cfg.ReadTimeout != 10*time.Second || cfg.WriteTimeout != 10*time.Second || cfg.IdleTimeout != time.Minute {
		t.Fatalf("HTTP timeouts = %s/%s/%s", cfg.ReadTimeout, cfg.WriteTimeout, cfg.IdleTimeout)
	}
	if cfg.MaxConnections != 4096 {
		t.Fatalf("MaxConnections = %d", cfg.MaxConnections)
	}
	if cfg.RequestTimeout != 8*time.Second || cfg.HealthCheckTimeout != 2*time.Second || cfg.HealthCacheTTL != time.Second || cfg.ShutdownTimeout != 20*time.Second {
		t.Fatalf("request/health/cache/shutdown timeouts = %s/%s/%s/%s", cfg.RequestTimeout, cfg.HealthCheckTimeout, cfg.HealthCacheTTL, cfg.ShutdownTimeout)
	}
	if cfg.MaxInFlight != 256 {
		t.Fatalf("MaxInFlight = %d", cfg.MaxInFlight)
	}
	if cfg.ShutdownDrainDelay != 0 {
		t.Fatalf("ShutdownDrainDelay = %s", cfg.ShutdownDrainDelay)
	}
	if cfg.RateLimitMax != 120 || cfg.AuthRateLimitMax != 10 || cfg.RateLimitWindow != time.Minute {
		t.Fatalf("rate limit defaults = %d/%d/%s", cfg.RateLimitMax, cfg.AuthRateLimitMax, cfg.RateLimitWindow)
	}
	if !cfg.IdempotencyEnabled || cfg.IdempotencyLifetime != 30*time.Minute {
		t.Fatalf("idempotency defaults = %t/%s", cfg.IdempotencyEnabled, cfg.IdempotencyLifetime)
	}
	if cfg.SharedStateMode != "memory" || cfg.AllowInMemorySharedState {
		t.Fatalf("shared state defaults = %q/%t", cfg.SharedStateMode, cfg.AllowInMemorySharedState)
	}
	if cfg.OIDCAuthEnabled || cfg.OIDCBrowserEnabled || cfg.OIDCJWKSHTTPTimeout != 3*time.Second || cfg.OIDCJWKSRefreshInterval != 5*time.Minute || cfg.OIDCMaxTokenAge != 15*time.Minute || cfg.OIDCRequiredACR != "" || len(cfg.OIDCRequiredAMR) != 0 || cfg.OIDCMaxAuthAge != 0 || cfg.OIDCAuthorizationTTL != 5*time.Minute || cfg.OIDCBrowserSessionTTL != 15*time.Minute || cfg.OIDCBrowserMaxSessions != 10000 || cfg.OIDCBrowserMaxSessionsPerSubject != 10 {
		t.Fatalf("OIDC defaults = %#v", cfg)
	}
	if cfg.RedisURL != "" || cfg.RedisTopology != "standalone" || len(cfg.RedisSentinelAddresses) != 0 ||
		cfg.RedisSentinelMasterName != "" || cfg.RedisUsername != "" || cfg.RedisPassword != "" ||
		cfg.RedisSentinelUsername != "" || cfg.RedisSentinelPassword != "" || cfg.RedisDatabase != 0 ||
		cfg.RedisTLSEnabled || cfg.RedisTLSServerName != "" || cfg.RedisTLSCAFile != "" ||
		cfg.RedisKeyPrefix != "goexample:example:" || cfg.RedisOperationTimeout != 500*time.Millisecond ||
		cfg.RedisLockTTL != 15*time.Second || cfg.RedisLockWaitTimeout != 2*time.Second || cfg.RedisLockRetryInterval != 25*time.Millisecond ||
		cfg.RedisPoolSize != 32 || cfg.RedisMinIdleConnections != 2 {
		t.Fatalf("Redis defaults = %#v", cfg)
	}
	if cfg.MetricsToken != "" || cfg.PprofEnabled || cfg.PprofToken != "" {
		t.Fatalf("diagnostics defaults = %q/%t/%q", cfg.MetricsToken, cfg.PprofEnabled, cfg.PprofToken)
	}
	if !cfg.SystemInfoDetailed {
		t.Fatal("SystemInfoDetailed = false in development")
	}
	if !cfg.DemoAuthEnabled || cfg.DemoUsername != "demo" || cfg.DemoPassword != "demo123" {
		t.Fatalf("demo auth defaults = %t/%q/%q", cfg.DemoAuthEnabled, cfg.DemoUsername, cfg.DemoPassword)
	}
	if len(cfg.JWTSecret) < 32 || cfg.JWTIssuer != "goexample" || cfg.JWTAudience != "goexample-api" || cfg.JWTTTL != time.Hour {
		t.Fatalf("JWT defaults = secret length %d, issuer %q, audience %q, ttl %s", len(cfg.JWTSecret), cfg.JWTIssuer, cfg.JWTAudience, cfg.JWTTTL)
	}
}

func TestLoadParsesValues(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("LOG_LEVEL", "DEBUG")
	t.Setenv("LOG_FORMAT", "TEXT")
	t.Setenv("LOG_SKIP_PATHS", "/livez,/metrics")
	t.Setenv("OTEL_TRACES_EXPORTER", "otlp")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.example:4318/tenant")
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "0.25")
	t.Setenv("OTEL_BSP_EXPORT_TIMEOUT", "1500")
	t.Setenv("OTEL_BSP_SCHEDULE_DELAY", "750")
	t.Setenv("OTEL_BSP_MAX_QUEUE_SIZE", "256")
	t.Setenv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "64")
	t.Setenv("HTTP_PORT", "8080")
	t.Setenv("CORS_ALLOW_ORIGINS", "http://localhost:3000, https://console.example.com, http://localhost:3000")
	t.Setenv("CORS_ALLOW_CREDENTIALS", "true")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8")
	t.Setenv("HTTP_BODY_LIMIT", "1048576")
	t.Setenv("HTTP_READ_BUFFER_SIZE", "8192")
	t.Setenv("HTTP_REQUEST_TIMEOUT", "3s")
	t.Setenv("HTTP_MAX_CONNECTIONS", "32")
	t.Setenv("HTTP_MAX_IN_FLIGHT", "12")
	t.Setenv("HEALTH_CHECK_TIMEOUT", "500ms")
	t.Setenv("HEALTH_CACHE_TTL", "250ms")
	t.Setenv("SHUTDOWN_DRAIN_DELAY", "2s")
	t.Setenv("RATE_LIMIT_MAX", "25")
	t.Setenv("RATE_LIMIT_WINDOW", "30s")
	t.Setenv("AUTH_RATE_LIMIT_MAX", "4")
	t.Setenv("IDEMPOTENCY_ENABLED", "false")
	t.Setenv("IDEMPOTENCY_LIFETIME", "10m")
	t.Setenv("SHARED_STATE_MODE", "external")
	t.Setenv("REDIS_URL", "rediss://redis-user:redis-password@redis.example.com:6380/1")
	t.Setenv("REDIS_KEY_PREFIX", "tenant:example:")
	t.Setenv("REDIS_OPERATION_TIMEOUT", "400ms")
	t.Setenv("REDIS_LOCK_TTL", "5s")
	t.Setenv("REDIS_LOCK_WAIT_TIMEOUT", "1s")
	t.Setenv("REDIS_LOCK_RETRY_INTERVAL", "10ms")
	t.Setenv("REDIS_POOL_SIZE", "24")
	t.Setenv("REDIS_MIN_IDLE_CONNECTIONS", "3")
	t.Setenv("METRICS_TOKEN", "01234567890123456789012345678901")
	t.Setenv("PPROF_ENABLED", "true")
	t.Setenv("PPROF_TOKEN", "abcdefghijklmnopqrstuvwxyz012345")
	t.Setenv("SYSTEM_INFO_DETAILED", "false")
	t.Setenv("DEMO_AUTH_ENABLED", "false")
	t.Setenv("JWT_AUDIENCE", "example-management-api")
	t.Setenv("JWT_TTL", "20m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LogLevel != "debug" || cfg.LogFormat != "text" || cfg.Port != 8080 {
		t.Fatalf("parsed scalar values = %#v", cfg)
	}
	if len(cfg.AllowedOrigins) != 2 || len(cfg.TrustedProxies) != 2 {
		t.Fatalf("parsed lists = origins %#v, proxies %#v", cfg.AllowedOrigins, cfg.TrustedProxies)
	}
	if !cfg.AllowCredentials {
		t.Fatal("AllowCredentials = false")
	}
	if len(cfg.LogSkipPaths) != 2 {
		t.Fatalf("LogSkipPaths = %#v", cfg.LogSkipPaths)
	}
	if cfg.TraceExporter != "otlp" || cfg.OTLPEndpoint != "http://collector.example:4318/tenant" || cfg.TraceSampleRatio != 0.25 {
		t.Fatalf("parsed trace config = %q/%q/%f", cfg.TraceExporter, cfg.OTLPEndpoint, cfg.TraceSampleRatio)
	}
	if cfg.TraceExportTimeout != 1500*time.Millisecond || cfg.TraceBatchTimeout != 750*time.Millisecond || cfg.TraceMaxQueueSize != 256 || cfg.TraceMaxExportBatchSize != 64 {
		t.Fatalf("parsed trace batch = %s/%s/%d/%d", cfg.TraceExportTimeout, cfg.TraceBatchTimeout, cfg.TraceMaxQueueSize, cfg.TraceMaxExportBatchSize)
	}
	if cfg.BodyLimit != 1048576 || cfg.RequestTimeout != 3*time.Second || cfg.HealthCheckTimeout != 500*time.Millisecond || cfg.HealthCacheTTL != 250*time.Millisecond {
		t.Fatalf("parsed limits = %d/%s/%s/%s", cfg.BodyLimit, cfg.RequestTimeout, cfg.HealthCheckTimeout, cfg.HealthCacheTTL)
	}
	if cfg.ReadBufferSize != 8192 {
		t.Fatalf("ReadBufferSize = %d", cfg.ReadBufferSize)
	}
	if cfg.MaxInFlight != 12 {
		t.Fatalf("MaxInFlight = %d", cfg.MaxInFlight)
	}
	if cfg.MaxConnections != 32 {
		t.Fatalf("MaxConnections = %d", cfg.MaxConnections)
	}
	if cfg.ShutdownDrainDelay != 2*time.Second {
		t.Fatalf("ShutdownDrainDelay = %s", cfg.ShutdownDrainDelay)
	}
	if cfg.RateLimitMax != 25 || cfg.AuthRateLimitMax != 4 || cfg.RateLimitWindow != 30*time.Second {
		t.Fatalf("parsed rate limits = %d/%d/%s", cfg.RateLimitMax, cfg.AuthRateLimitMax, cfg.RateLimitWindow)
	}
	if cfg.DemoAuthEnabled || cfg.JWTAudience != "example-management-api" || cfg.JWTTTL != 20*time.Minute {
		t.Fatalf("parsed auth values = %t/%q/%s", cfg.DemoAuthEnabled, cfg.JWTAudience, cfg.JWTTTL)
	}
	if cfg.IdempotencyEnabled || cfg.IdempotencyLifetime != 10*time.Minute {
		t.Fatalf("parsed idempotency = %t/%s", cfg.IdempotencyEnabled, cfg.IdempotencyLifetime)
	}
	if cfg.SharedStateMode != "external" {
		t.Fatalf("parsed shared state mode = %q", cfg.SharedStateMode)
	}
	if cfg.RedisURL == "" || cfg.RedisKeyPrefix != "tenant:example:" || cfg.RedisOperationTimeout != 400*time.Millisecond ||
		cfg.RedisLockTTL != 5*time.Second || cfg.RedisLockWaitTimeout != time.Second || cfg.RedisLockRetryInterval != 10*time.Millisecond ||
		cfg.RedisPoolSize != 24 || cfg.RedisMinIdleConnections != 3 {
		t.Fatalf("parsed Redis config = %q/%q/%s/%s/%s/%s/%d/%d", cfg.RedisURL, cfg.RedisKeyPrefix, cfg.RedisOperationTimeout, cfg.RedisLockTTL, cfg.RedisLockWaitTimeout, cfg.RedisLockRetryInterval, cfg.RedisPoolSize, cfg.RedisMinIdleConnections)
	}
	if cfg.MetricsToken == "" || !cfg.PprofEnabled || cfg.PprofToken == "" {
		t.Fatalf("parsed diagnostics = %q/%t/%q", cfg.MetricsToken, cfg.PprofEnabled, cfg.PprofToken)
	}
	if cfg.SystemInfoDetailed {
		t.Fatal("SystemInfoDetailed = true")
	}
}

func TestLoadAcceptsHardenedProductionConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "Production")
	t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")
	t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8")
	t.Setenv("PPROF_ENABLED", "true")
	t.Setenv("PPROF_TOKEN", "production-pprof-token-with-32-characters")
	t.Setenv("REDIS_URL", "rediss://redis.example.com:6380/0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DemoAuthEnabled {
		t.Fatal("DemoAuthEnabled = true in production")
	}
	if cfg.SystemInfoDetailed {
		t.Fatal("SystemInfoDetailed = true in production")
	}
	if cfg.Environment != "production" {
		t.Fatalf("Environment = %q", cfg.Environment)
	}
	if len(cfg.TrustedProxies) != 1 || cfg.TrustedProxies[0] != "10.0.0.0/8" {
		t.Fatalf("TrustedProxies = %#v", cfg.TrustedProxies)
	}
	if cfg.SharedStateMode != "external" || cfg.AllowInMemorySharedState {
		t.Fatalf("production shared state defaults = %q/%t", cfg.SharedStateMode, cfg.AllowInMemorySharedState)
	}
	if !cfg.PprofEnabled || cfg.PprofToken == "" {
		t.Fatalf("production pprof config = %t/%q", cfg.PprofEnabled, cfg.PprofToken)
	}
}

func TestLoadRejectsCatchAllTrustedProxiesInProduction(t *testing.T) {
	for _, proxy := range []string{"0.0.0.0/0", "::/0"} {
		t.Run(proxy, func(t *testing.T) {
			clearConfigEnvironment(t)
			t.Setenv("APP_ENV", "production")
			t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")
			t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
			t.Setenv("TRUSTED_PROXIES", proxy)

			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "catch-all CIDR") {
				t.Fatalf("Load() error = %v", err)
			}
		})
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name        string
		key         string
		value       string
		wantInError string
	}{
		{name: "port syntax", key: "HTTP_PORT", value: "not-a-port", wantInError: "HTTP_PORT"},
		{name: "port range", key: "HTTP_PORT", value: "70000", wantInError: "HTTP_PORT"},
		{name: "log level", key: "LOG_LEVEL", value: "trace", wantInError: "LOG_LEVEL"},
		{name: "log format", key: "LOG_FORMAT", value: "yaml", wantInError: "LOG_FORMAT"},
		{name: "trace exporter", key: "OTEL_TRACES_EXPORTER", value: "stdout", wantInError: "OTEL_TRACES_EXPORTER"},
		{name: "trace sample syntax", key: "OTEL_TRACES_SAMPLER_ARG", value: "often", wantInError: "OTEL_TRACES_SAMPLER_ARG"},
		{name: "trace sample range", key: "OTEL_TRACES_SAMPLER_ARG", value: "1.1", wantInError: "OTEL_TRACES_SAMPLER_ARG"},
		{name: "trace sample NaN", key: "OTEL_TRACES_SAMPLER_ARG", value: "NaN", wantInError: "OTEL_TRACES_SAMPLER_ARG"},
		{name: "trace export timeout", key: "OTEL_BSP_EXPORT_TIMEOUT", value: "0", wantInError: "OTEL_BSP_EXPORT_TIMEOUT"},
		{name: "trace queue", key: "OTEL_BSP_MAX_QUEUE_SIZE", value: "0", wantInError: "OTEL_BSP_MAX_QUEUE_SIZE"},
		{name: "trace batch", key: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE", value: "4096", wantInError: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE"},
		{name: "environment", key: "APP_ENV", value: "prod", wantInError: "APP_ENV"},
		{name: "CORS credentials boolean", key: "CORS_ALLOW_CREDENTIALS", value: "sometimes", wantInError: "CORS_ALLOW_CREDENTIALS"},
		{name: "proxy IP", key: "TRUSTED_PROXIES", value: "not-an-ip", wantInError: "TRUSTED_PROXIES"},
		{name: "proxy CIDR", key: "TRUSTED_PROXIES", value: "10.0.0.0/99", wantInError: "TRUSTED_PROXIES"},
		{name: "body limit", key: "HTTP_BODY_LIMIT", value: "512", wantInError: "HTTP_BODY_LIMIT"},
		{name: "read buffer syntax", key: "HTTP_READ_BUFFER_SIZE", value: "large", wantInError: "HTTP_READ_BUFFER_SIZE"},
		{name: "read buffer range", key: "HTTP_READ_BUFFER_SIZE", value: "2048", wantInError: "HTTP_READ_BUFFER_SIZE"},
		{name: "duration syntax", key: "HTTP_REQUEST_TIMEOUT", value: "soon", wantInError: "HTTP_REQUEST_TIMEOUT"},
		{name: "request exceeds write", key: "HTTP_REQUEST_TIMEOUT", value: "10s", wantInError: "HTTP_REQUEST_TIMEOUT"},
		{name: "read exceeds idle", key: "HTTP_READ_TIMEOUT", value: "61s", wantInError: "HTTP_READ_TIMEOUT"},
		{name: "write exceeds idle", key: "HTTP_WRITE_TIMEOUT", value: "61s", wantInError: "HTTP_WRITE_TIMEOUT"},
		{name: "in-flight syntax", key: "HTTP_MAX_IN_FLIGHT", value: "many", wantInError: "HTTP_MAX_IN_FLIGHT"},
		{name: "in-flight range", key: "HTTP_MAX_IN_FLIGHT", value: "0", wantInError: "HTTP_MAX_IN_FLIGHT"},
		{name: "connections syntax", key: "HTTP_MAX_CONNECTIONS", value: "many", wantInError: "HTTP_MAX_CONNECTIONS"},
		{name: "connections range", key: "HTTP_MAX_CONNECTIONS", value: "0", wantInError: "HTTP_MAX_CONNECTIONS"},
		{name: "health cache", key: "HEALTH_CACHE_TTL", value: "0s", wantInError: "HEALTH_CACHE_TTL"},
		{name: "drain delay", key: "SHUTDOWN_DRAIN_DELAY", value: "-1s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "drain delay exceeds shutdown", key: "SHUTDOWN_DRAIN_DELAY", value: "20s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "insufficient shutdown budget", key: "SHUTDOWN_DRAIN_DELAY", value: "12s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "read exceeds shutdown budget", key: "HTTP_READ_TIMEOUT", value: "20s", wantInError: "HTTP_READ_TIMEOUT"},
		{name: "write exceeds shutdown budget", key: "HTTP_WRITE_TIMEOUT", value: "20s", wantInError: "HTTP_WRITE_TIMEOUT"},
		{name: "duration range", key: "RATE_LIMIT_WINDOW", value: "0s", wantInError: "RATE_LIMIT_WINDOW"},
		{name: "request rate", key: "RATE_LIMIT_MAX", value: "0", wantInError: "RATE_LIMIT_MAX"},
		{name: "auth rate", key: "AUTH_RATE_LIMIT_MAX", value: "0", wantInError: "AUTH_RATE_LIMIT_MAX"},
		{name: "boolean", key: "DEMO_AUTH_ENABLED", value: "sometimes", wantInError: "DEMO_AUTH_ENABLED"},
		{name: "idempotency boolean", key: "IDEMPOTENCY_ENABLED", value: "sometimes", wantInError: "IDEMPOTENCY_ENABLED"},
		{name: "shared state mode", key: "SHARED_STATE_MODE", value: "redis", wantInError: "SHARED_STATE_MODE"},
		{name: "shared state downgrade boolean", key: "ALLOW_IN_MEMORY_SHARED_STATE", value: "sometimes", wantInError: "ALLOW_IN_MEMORY_SHARED_STATE"},
		{name: "Redis topology", key: "REDIS_TOPOLOGY", value: "automatic", wantInError: "REDIS_TOPOLOGY"},
		{name: "Redis database", key: "REDIS_DATABASE", value: "16", wantInError: "REDIS_DATABASE"},
		{name: "Redis TLS boolean", key: "REDIS_TLS_ENABLED", value: "sometimes", wantInError: "REDIS_TLS_ENABLED"},
		{name: "Redis key prefix", key: "REDIS_KEY_PREFIX", value: "invalid prefix:", wantInError: "REDIS_KEY_PREFIX"},
		{name: "Redis operation timeout", key: "REDIS_OPERATION_TIMEOUT", value: "0s", wantInError: "REDIS_OPERATION_TIMEOUT"},
		{name: "Redis lock TTL", key: "REDIS_LOCK_TTL", value: "0s", wantInError: "REDIS_LOCK_TTL"},
		{name: "Redis lock wait", key: "REDIS_LOCK_WAIT_TIMEOUT", value: "0s", wantInError: "REDIS_LOCK_WAIT_TIMEOUT"},
		{name: "Redis lock retry", key: "REDIS_LOCK_RETRY_INTERVAL", value: "3s", wantInError: "REDIS_LOCK_RETRY_INTERVAL"},
		{name: "Redis pool size", key: "REDIS_POOL_SIZE", value: "0", wantInError: "REDIS_POOL_SIZE"},
		{name: "Redis idle connections", key: "REDIS_MIN_IDLE_CONNECTIONS", value: "33", wantInError: "REDIS_MIN_IDLE_CONNECTIONS"},
		{name: "metrics token", key: "METRICS_TOKEN", value: "too-short", wantInError: "METRICS_TOKEN"},
		{name: "pprof boolean", key: "PPROF_ENABLED", value: "sometimes", wantInError: "PPROF_ENABLED"},
		{name: "pprof token", key: "PPROF_ENABLED", value: "true", wantInError: "PPROF_TOKEN"},
		{name: "system info boolean", key: "SYSTEM_INFO_DETAILED", value: "sometimes", wantInError: "SYSTEM_INFO_DETAILED"},
		{name: "short JWT secret", key: "JWT_SECRET", value: "too-short", wantInError: "JWT_SECRET"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			clearConfigEnvironment(t)
			t.Setenv(test.key, test.value)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.wantInError) {
				t.Fatalf("Load() error = %v, want error containing %q", err, test.wantInError)
			}
		})
	}
}

func TestLoadRequiresSafeExternalRedisConfiguration(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("SHARED_STATE_MODE", "external")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_URL") {
		t.Fatalf("missing REDIS_URL error = %v", err)
	}

	t.Setenv("REDIS_URL", "redis://user:super-secret@")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_URL") || strings.Contains(err.Error(), "super-secret") {
		t.Fatalf("invalid REDIS_URL error = %v", err)
	}

	t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
	t.Setenv("HTTP_REQUEST_TIMEOUT", "3s")
	t.Setenv("REDIS_LOCK_TTL", "3s")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_LOCK_TTL") {
		t.Fatalf("lock lease budget error = %v", err)
	}

	t.Setenv("REDIS_LOCK_TTL", "5s")
	t.Setenv("REDIS_LOCK_WAIT_TIMEOUT", "3s")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_LOCK_WAIT_TIMEOUT") {
		t.Fatalf("lock wait budget error = %v", err)
	}
}

func TestLoadParsesSentinelTopologyAndSeparatesCredentials(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("SHARED_STATE_MODE", "external")
	t.Setenv("REDIS_TOPOLOGY", "sentinel")
	t.Setenv("REDIS_SENTINEL_ADDRESSES", "sentinel-a.internal:26379,sentinel-b.internal:26379,sentinel-c.internal:26379")
	t.Setenv("REDIS_SENTINEL_MASTER_NAME", "goexample-primary")
	t.Setenv("REDIS_USERNAME", "application-user")
	t.Setenv("REDIS_PASSWORD", "application-password")
	t.Setenv("REDIS_SENTINEL_USERNAME", "sentinel-user")
	t.Setenv("REDIS_SENTINEL_PASSWORD", "sentinel-password")
	t.Setenv("REDIS_DATABASE", "2")
	t.Setenv("REDIS_TLS_ENABLED", "true")
	t.Setenv("REDIS_TLS_SERVER_NAME", "redis.internal")
	t.Setenv("REDIS_TLS_CA_FILE", "C:/run/secrets/redis/ca.pem")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RedisTopology != "sentinel" || len(cfg.RedisSentinelAddresses) != 3 ||
		cfg.RedisSentinelMasterName != "goexample-primary" || cfg.RedisUsername != "application-user" ||
		cfg.RedisPassword != "application-password" || cfg.RedisSentinelUsername != "sentinel-user" ||
		cfg.RedisSentinelPassword != "sentinel-password" || cfg.RedisDatabase != 2 || !cfg.RedisTLSEnabled ||
		cfg.RedisTLSServerName != "redis.internal" || cfg.RedisTLSCAFile != "C:/run/secrets/redis/ca.pem" {
		t.Fatalf("Sentinel config = %#v", cfg)
	}
}

func TestLoadRejectsUnsafeSentinelTopology(t *testing.T) {
	for _, test := range []struct {
		name    string
		key     string
		value   string
		message string
	}{
		{name: "too few addresses", key: "REDIS_SENTINEL_ADDRESSES", value: "sentinel-a:26379,sentinel-b:26379", message: "between 3 and 16"},
		{name: "unsafe address", key: "REDIS_SENTINEL_ADDRESSES", value: "user@sentinel-a:26379,sentinel-b:26379,sentinel-c:26379", message: "entry 1"},
		{name: "unsafe master", key: "REDIS_SENTINEL_MASTER_NAME", value: "primary name", message: "MASTER_NAME"},
		{name: "URL ambiguity", key: "REDIS_URL", value: "redis://127.0.0.1:6379/0", message: "must be empty"},
	} {
		t.Run(test.name, func(t *testing.T) {
			clearConfigEnvironment(t)
			t.Setenv("SHARED_STATE_MODE", "external")
			t.Setenv("REDIS_TOPOLOGY", "sentinel")
			t.Setenv("REDIS_SENTINEL_ADDRESSES", "sentinel-a:26379,sentinel-b:26379,sentinel-c:26379")
			t.Setenv("REDIS_SENTINEL_MASTER_NAME", "goexample-primary")
			t.Setenv(test.key, test.value)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("Load() error = %v", err)
			}
		})
	}
}

func TestLoadRequiresTLSAndSeparateACLsForProductionSentinel(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
	t.Setenv("SHARED_STATE_MODE", "external")
	t.Setenv("REDIS_TOPOLOGY", "sentinel")
	t.Setenv("REDIS_SENTINEL_ADDRESSES", "sentinel-a:26379,sentinel-b:26379,sentinel-c:26379")
	t.Setenv("REDIS_SENTINEL_MASTER_NAME", "goexample-primary")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_TLS_ENABLED") {
		t.Fatalf("production Sentinel TLS error = %v", err)
	}

	t.Setenv("REDIS_TLS_ENABLED", "true")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_USERNAME and REDIS_PASSWORD") {
		t.Fatalf("production data ACL error = %v", err)
	}

	t.Setenv("REDIS_USERNAME", "application-user")
	t.Setenv("REDIS_PASSWORD", "application-password")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "REDIS_SENTINEL_USERNAME") {
		t.Fatalf("production Sentinel ACL error = %v", err)
	}
}

func TestLoadValidatesOTLPEndpoint(t *testing.T) {
	for _, endpoint := range []string{"", "collector:4318", "ftp://collector.example", "https://user:secret@collector.example", "https://collector.example?token=secret"} {
		t.Run(endpoint, func(t *testing.T) {
			clearConfigEnvironment(t)
			t.Setenv("OTEL_TRACES_EXPORTER", "otlp")
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "OTEL_EXPORTER_OTLP_ENDPOINT") {
				t.Fatalf("Load() error = %v", err)
			}
		})
	}
}

func TestLoadAllowsWildcardOriginWithoutCredentials(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("CORS_ALLOW_ORIGINS", "*")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AllowCredentials || len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "*" {
		t.Fatalf("CORS config = credentials %t, origins %#v", cfg.AllowCredentials, cfg.AllowedOrigins)
	}
}

func TestLoadRejectsWildcardOriginWithCredentials(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("CORS_ALLOW_ORIGINS", "*")
	t.Setenv("CORS_ALLOW_CREDENTIALS", "true")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "CORS_ALLOW_ORIGINS") {
		t.Fatalf("Load() error = %v", err)
	}
}

func TestLoadRejectsUnsafeProductionSecrets(t *testing.T) {
	t.Run("default JWT secret", func(t *testing.T) {
		clearConfigEnvironment(t)
		t.Setenv("APP_ENV", "production")
		t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
		t.Setenv("DEMO_AUTH_ENABLED", "true")
		t.Setenv("DEMO_USERNAME", "production-demo-user")
		t.Setenv("DEMO_PASSWORD", "production-demo-password")
		_, err := Load()
		if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
			t.Fatalf("Load() error = %v", err)
		}
	})

	t.Run("default demo credentials", func(t *testing.T) {
		clearConfigEnvironment(t)
		t.Setenv("APP_ENV", "production")
		t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")
		t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
		t.Setenv("DEMO_AUTH_ENABLED", "true")
		_, err := Load()
		if err == nil || !strings.Contains(err.Error(), "demo credentials") {
			t.Fatalf("Load() error = %v", err)
		}
	})
}

func TestLoadRejectsReusedProductionSecrets(t *testing.T) {
	const jwtSecret = "production-secret-with-at-least-32-characters"
	const metricsToken = "production-metrics-token-32-characters"

	tests := []struct {
		name         string
		metricsToken string
		pprofEnabled string
		pprofToken   string
		wantInError  string
	}{
		{
			name:         "metrics token reuses JWT secret",
			metricsToken: jwtSecret,
			wantInError:  "METRICS_TOKEN must differ from JWT_SECRET",
		},
		{
			name:         "pprof token reuses metrics token",
			metricsToken: metricsToken,
			pprofEnabled: "true",
			pprofToken:   metricsToken,
			wantInError:  "PPROF_TOKEN must differ",
		},
		{
			name:         "pprof token reuses JWT secret",
			metricsToken: metricsToken,
			pprofEnabled: "true",
			pprofToken:   jwtSecret,
			wantInError:  "PPROF_TOKEN must differ",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			clearConfigEnvironment(t)
			t.Setenv("APP_ENV", "production")
			t.Setenv("DEMO_AUTH_ENABLED", "true")
			t.Setenv("DEMO_USERNAME", "production-demo-user")
			t.Setenv("DEMO_PASSWORD", "production-demo-password")
			t.Setenv("JWT_SECRET", jwtSecret)
			t.Setenv("METRICS_TOKEN", test.metricsToken)
			t.Setenv("PPROF_ENABLED", test.pprofEnabled)
			t.Setenv("PPROF_TOKEN", test.pprofToken)

			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.wantInError) {
				t.Fatalf("Load() error = %v, want error containing %q", err, test.wantInError)
			}
		})
	}
}

func TestLoadValidatesOIDCResourceServerConfiguration(t *testing.T) {
	setValid := func(t *testing.T) {
		t.Helper()
		clearConfigEnvironment(t)
		t.Setenv("DEMO_AUTH_ENABLED", "false")
		t.Setenv("OIDC_AUTH_ENABLED", "true")
		t.Setenv("OIDC_ISSUER", "http://issuer.example/tenant")
		t.Setenv("OIDC_AUDIENCE", "goexample-api")
		t.Setenv("OIDC_JWKS_URL", "http://issuer.example/tenant/jwks")
	}

	t.Run("valid development", func(t *testing.T) {
		setValid(t)
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if !cfg.OIDCAuthEnabled || cfg.DemoAuthEnabled || cfg.OIDCAudience != "goexample-api" {
			t.Fatalf("OIDC config = %#v", cfg)
		}
	})

	tests := []struct {
		name        string
		mutate      func(*testing.T)
		wantInError string
	}{
		{name: "mutually exclusive", mutate: func(t *testing.T) { t.Setenv("DEMO_AUTH_ENABLED", "true") }, wantInError: "cannot both be true"},
		{name: "missing issuer", mutate: func(t *testing.T) { t.Setenv("OIDC_ISSUER", "") }, wantInError: "OIDC_ISSUER"},
		{name: "credential JWKS URL", mutate: func(t *testing.T) { t.Setenv("OIDC_JWKS_URL", "http://user:credential-secret@issuer.example/jwks") }, wantInError: "OIDC_JWKS_URL"},
		{name: "missing audience", mutate: func(t *testing.T) { t.Setenv("OIDC_AUDIENCE", "") }, wantInError: "OIDC_AUDIENCE"},
		{name: "HTTP timeout", mutate: func(t *testing.T) { t.Setenv("OIDC_JWKS_HTTP_TIMEOUT", "11s") }, wantInError: "OIDC_JWKS_HTTP_TIMEOUT"},
		{name: "refresh interval", mutate: func(t *testing.T) { t.Setenv("OIDC_JWKS_REFRESH_INTERVAL", "29s") }, wantInError: "OIDC_JWKS_REFRESH_INTERVAL"},
		{name: "token age", mutate: func(t *testing.T) { t.Setenv("OIDC_MAX_TOKEN_AGE", "25h") }, wantInError: "OIDC_MAX_TOKEN_AGE"},
		{name: "assurance without browser", mutate: func(t *testing.T) {
			t.Setenv("OIDC_REQUIRED_AMR", "otp")
			t.Setenv("OIDC_MAX_AUTH_AGE", "5m")
		}, wantInError: "OIDC_BROWSER_ENABLED"},
		{name: "production HTTP issuer", mutate: func(t *testing.T) { t.Setenv("APP_ENV", "production") }, wantInError: "OIDC_ISSUER"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setValid(t)
			test.mutate(t)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.wantInError) || strings.Contains(err.Error(), "credential-secret") {
				t.Fatalf("Load() error = %v, want sanitized error containing %q", err, test.wantInError)
			}
		})
	}
}

func TestLoadValidatesOIDCBrowserAuthorizationConfiguration(t *testing.T) {
	setValid := func(t *testing.T) {
		t.Helper()
		clearConfigEnvironment(t)
		t.Setenv("DEMO_AUTH_ENABLED", "false")
		t.Setenv("OIDC_AUTH_ENABLED", "true")
		t.Setenv("OIDC_ISSUER", "http://issuer.example/tenant")
		t.Setenv("OIDC_AUDIENCE", "goexample-api")
		t.Setenv("OIDC_JWKS_URL", "http://issuer.example/tenant/jwks")
		t.Setenv("OIDC_BROWSER_ENABLED", "true")
		t.Setenv("OIDC_CLIENT_ID", "goexample-browser")
		t.Setenv("OIDC_CLIENT_SECRET", "optional-confidential-client-secret")
		t.Setenv("OIDC_REDIRECT_URL", "https://api.example.com/api/v1/auth/oidc/callback")
		t.Setenv("OIDC_AUTHORIZATION_TTL", "4m")
		t.Setenv("OIDC_BROWSER_SESSION_TTL", "20m")
		t.Setenv("OIDC_BROWSER_MAX_SESSIONS", "500")
		t.Setenv("OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT", "7")
		t.Setenv("OIDC_REQUIRED_ACR", "urn:example:assurance:mfa")
		t.Setenv("OIDC_REQUIRED_AMR", "pwd,otp")
		t.Setenv("OIDC_MAX_AUTH_AGE", "10m")
	}

	t.Run("valid", func(t *testing.T) {
		setValid(t)
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if !cfg.OIDCBrowserEnabled || cfg.OIDCClientID != "goexample-browser" || cfg.OIDCAuthorizationTTL != 4*time.Minute || cfg.OIDCBrowserSessionTTL != 20*time.Minute || cfg.OIDCBrowserMaxSessions != 500 || cfg.OIDCBrowserMaxSessionsPerSubject != 7 || cfg.OIDCRequiredACR != "urn:example:assurance:mfa" || !reflect.DeepEqual(cfg.OIDCRequiredAMR, []string{"pwd", "otp"}) || cfg.OIDCMaxAuthAge != 10*time.Minute {
			t.Fatalf("browser OIDC config = %#v", cfg)
		}
	})

	t.Run("assurance disabled by default", func(t *testing.T) {
		setValid(t)
		t.Setenv("OIDC_REQUIRED_ACR", "")
		t.Setenv("OIDC_REQUIRED_AMR", "")
		t.Setenv("OIDC_MAX_AUTH_AGE", "0s")
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if cfg.OIDCRequiredACR != "" || len(cfg.OIDCRequiredAMR) != 0 || cfg.OIDCMaxAuthAge != 0 {
			t.Fatalf("disabled assurance config = %#v", cfg)
		}
	})

	tests := []struct {
		name        string
		mutate      func(*testing.T)
		wantInError string
	}{
		{name: "resource server disabled", mutate: func(t *testing.T) { t.Setenv("OIDC_AUTH_ENABLED", "false") }, wantInError: "OIDC_AUTH_ENABLED"},
		{name: "missing client ID", mutate: func(t *testing.T) { t.Setenv("OIDC_CLIENT_ID", "") }, wantInError: "OIDC_CLIENT_ID"},
		{name: "client secret control", mutate: func(t *testing.T) { t.Setenv("OIDC_CLIENT_SECRET", "provider-secret\nvalue") }, wantInError: "OIDC_CLIENT_SECRET"},
		{name: "HTTP redirect", mutate: func(t *testing.T) { t.Setenv("OIDC_REDIRECT_URL", "http://api.example.com/api/v1/auth/oidc/callback") }, wantInError: "OIDC_REDIRECT_URL"},
		{name: "redirect credentials", mutate: func(t *testing.T) {
			t.Setenv("OIDC_REDIRECT_URL", "https://user:provider-secret@api.example.com/api/v1/auth/oidc/callback")
		}, wantInError: "OIDC_REDIRECT_URL"},
		{name: "redirect query", mutate: func(t *testing.T) {
			t.Setenv("OIDC_REDIRECT_URL", "https://api.example.com/api/v1/auth/oidc/callback?secret=value")
		}, wantInError: "OIDC_REDIRECT_URL"},
		{name: "wrong callback path", mutate: func(t *testing.T) { t.Setenv("OIDC_REDIRECT_URL", "https://api.example.com/callback") }, wantInError: "OIDC_REDIRECT_URL"},
		{name: "authorization TTL", mutate: func(t *testing.T) { t.Setenv("OIDC_AUTHORIZATION_TTL", "16m") }, wantInError: "OIDC_AUTHORIZATION_TTL"},
		{name: "session TTL", mutate: func(t *testing.T) { t.Setenv("OIDC_BROWSER_SESSION_TTL", "25h") }, wantInError: "OIDC_BROWSER_SESSION_TTL"},
		{name: "session limit", mutate: func(t *testing.T) { t.Setenv("OIDC_BROWSER_MAX_SESSIONS", "10001") }, wantInError: "OIDC_BROWSER_MAX_SESSIONS"},
		{name: "per-subject session limit", mutate: func(t *testing.T) { t.Setenv("OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT", "501") }, wantInError: "OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT"},
		{name: "invalid required ACR", mutate: func(t *testing.T) { t.Setenv("OIDC_REQUIRED_ACR", " assurance\nsecret") }, wantInError: "OIDC_REQUIRED_ACR"},
		{name: "too many required AMR values", mutate: func(t *testing.T) {
			t.Setenv("OIDC_REQUIRED_AMR", "m01,m02,m03,m04,m05,m06,m07,m08,m09,m10,m11,m12,m13,m14,m15,m16,m17")
		}, wantInError: "OIDC_REQUIRED_AMR"},
		{name: "missing maximum auth age", mutate: func(t *testing.T) { t.Setenv("OIDC_MAX_AUTH_AGE", "0s") }, wantInError: "OIDC_MAX_AUTH_AGE"},
		{name: "unbounded maximum auth age", mutate: func(t *testing.T) { t.Setenv("OIDC_MAX_AUTH_AGE", "25h") }, wantInError: "OIDC_MAX_AUTH_AGE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setValid(t)
			test.mutate(t)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.wantInError) || strings.Contains(err.Error(), "provider-secret") {
				t.Fatalf("Load() error = %v, want sanitized error containing %q", err, test.wantInError)
			}
		})
	}
}

func TestLoadDoesNotRequireInactiveDemoJWTSecret(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("DEMO_AUTH_ENABLED", "false")
	t.Setenv("JWT_SECRET", "short-unused-value")
	t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
	t.Setenv("SHARED_STATE_MODE", "memory")
	t.Setenv("ALLOW_IN_MEMORY_SHARED_STATE", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DemoAuthEnabled || cfg.OIDCAuthEnabled {
		t.Fatalf("authentication modes = demo %t, OIDC %t", cfg.DemoAuthEnabled, cfg.OIDCAuthEnabled)
	}
}

func TestLoadRequiresMetricsTokenInProduction(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "METRICS_TOKEN") {
		t.Fatalf("Load() error = %v", err)
	}
}

func TestLoadRequiresExplicitProductionMemoryDowngrade(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")
	t.Setenv("METRICS_TOKEN", "production-metrics-token-32-characters")
	t.Setenv("SHARED_STATE_MODE", "memory")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "ALLOW_IN_MEMORY_SHARED_STATE") {
		t.Fatalf("Load() error = %v", err)
	}

	t.Setenv("ALLOW_IN_MEMORY_SHARED_STATE", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() explicit downgrade error = %v", err)
	}
	if cfg.SharedStateMode != "memory" || !cfg.AllowInMemorySharedState {
		t.Fatalf("explicit downgrade = %q/%t", cfg.SharedStateMode, cfg.AllowInMemorySharedState)
	}
}

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range configEnvironmentKeys {
		t.Setenv(key, "")
	}
}
