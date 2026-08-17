package config

import (
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
	"HTTP_HOST",
	"HTTP_PORT",
	"CORS_ALLOW_ORIGINS",
	"CORS_ALLOW_CREDENTIALS",
	"TRUSTED_PROXIES",
	"HTTP_BODY_LIMIT",
	"HTTP_READ_TIMEOUT",
	"HTTP_WRITE_TIMEOUT",
	"HTTP_IDLE_TIMEOUT",
	"HTTP_REQUEST_TIMEOUT",
	"HEALTH_CHECK_TIMEOUT",
	"HEALTH_CACHE_TTL",
	"SHUTDOWN_TIMEOUT",
	"SHUTDOWN_DRAIN_DELAY",
	"RATE_LIMIT_MAX",
	"RATE_LIMIT_WINDOW",
	"AUTH_RATE_LIMIT_MAX",
	"IDEMPOTENCY_ENABLED",
	"IDEMPOTENCY_LIFETIME",
	"METRICS_TOKEN",
	"PPROF_ENABLED",
	"PPROF_TOKEN",
	"SYSTEM_INFO_DETAILED",
	"DEMO_AUTH_ENABLED",
	"DEMO_USERNAME",
	"DEMO_PASSWORD",
	"JWT_SECRET",
	"JWT_ISSUER",
	"JWT_TTL",
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
	if cfg.AllowCredentials {
		t.Fatal("AllowCredentials = true")
	}
	if cfg.BodyLimit != 4*1024*1024 {
		t.Fatalf("BodyLimit = %d", cfg.BodyLimit)
	}
	if cfg.ReadTimeout != 10*time.Second || cfg.WriteTimeout != 10*time.Second || cfg.IdleTimeout != time.Minute {
		t.Fatalf("HTTP timeouts = %s/%s/%s", cfg.ReadTimeout, cfg.WriteTimeout, cfg.IdleTimeout)
	}
	if cfg.RequestTimeout != 8*time.Second || cfg.HealthCheckTimeout != 2*time.Second || cfg.HealthCacheTTL != time.Second || cfg.ShutdownTimeout != 20*time.Second {
		t.Fatalf("request/health/cache/shutdown timeouts = %s/%s/%s/%s", cfg.RequestTimeout, cfg.HealthCheckTimeout, cfg.HealthCacheTTL, cfg.ShutdownTimeout)
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
	if cfg.MetricsToken != "" || cfg.PprofEnabled || cfg.PprofToken != "" {
		t.Fatalf("diagnostics defaults = %q/%t/%q", cfg.MetricsToken, cfg.PprofEnabled, cfg.PprofToken)
	}
	if !cfg.SystemInfoDetailed {
		t.Fatal("SystemInfoDetailed = false in development")
	}
	if !cfg.DemoAuthEnabled || cfg.DemoUsername != "demo" || cfg.DemoPassword != "demo123" {
		t.Fatalf("demo auth defaults = %t/%q/%q", cfg.DemoAuthEnabled, cfg.DemoUsername, cfg.DemoPassword)
	}
	if len(cfg.JWTSecret) < 32 || cfg.JWTIssuer != "goexample" || cfg.JWTTTL != time.Hour {
		t.Fatalf("JWT defaults = secret length %d, issuer %q, ttl %s", len(cfg.JWTSecret), cfg.JWTIssuer, cfg.JWTTTL)
	}
}

func TestLoadParsesValues(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("LOG_LEVEL", "DEBUG")
	t.Setenv("LOG_FORMAT", "TEXT")
	t.Setenv("LOG_SKIP_PATHS", "/livez,/metrics")
	t.Setenv("HTTP_PORT", "8080")
	t.Setenv("CORS_ALLOW_ORIGINS", "http://localhost:3000, https://console.example.com, http://localhost:3000")
	t.Setenv("CORS_ALLOW_CREDENTIALS", "true")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8")
	t.Setenv("HTTP_BODY_LIMIT", "1048576")
	t.Setenv("HTTP_REQUEST_TIMEOUT", "3s")
	t.Setenv("HEALTH_CHECK_TIMEOUT", "500ms")
	t.Setenv("HEALTH_CACHE_TTL", "250ms")
	t.Setenv("SHUTDOWN_DRAIN_DELAY", "2s")
	t.Setenv("RATE_LIMIT_MAX", "25")
	t.Setenv("RATE_LIMIT_WINDOW", "30s")
	t.Setenv("AUTH_RATE_LIMIT_MAX", "4")
	t.Setenv("IDEMPOTENCY_ENABLED", "false")
	t.Setenv("IDEMPOTENCY_LIFETIME", "10m")
	t.Setenv("METRICS_TOKEN", "01234567890123456789012345678901")
	t.Setenv("PPROF_ENABLED", "true")
	t.Setenv("PPROF_TOKEN", "abcdefghijklmnopqrstuvwxyz012345")
	t.Setenv("SYSTEM_INFO_DETAILED", "false")
	t.Setenv("DEMO_AUTH_ENABLED", "false")
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
	if cfg.BodyLimit != 1048576 || cfg.RequestTimeout != 3*time.Second || cfg.HealthCheckTimeout != 500*time.Millisecond || cfg.HealthCacheTTL != 250*time.Millisecond {
		t.Fatalf("parsed limits = %d/%s/%s/%s", cfg.BodyLimit, cfg.RequestTimeout, cfg.HealthCheckTimeout, cfg.HealthCacheTTL)
	}
	if cfg.ShutdownDrainDelay != 2*time.Second {
		t.Fatalf("ShutdownDrainDelay = %s", cfg.ShutdownDrainDelay)
	}
	if cfg.RateLimitMax != 25 || cfg.AuthRateLimitMax != 4 || cfg.RateLimitWindow != 30*time.Second {
		t.Fatalf("parsed rate limits = %d/%d/%s", cfg.RateLimitMax, cfg.AuthRateLimitMax, cfg.RateLimitWindow)
	}
	if cfg.DemoAuthEnabled || cfg.JWTTTL != 20*time.Minute {
		t.Fatalf("parsed auth values = %t/%s", cfg.DemoAuthEnabled, cfg.JWTTTL)
	}
	if cfg.IdempotencyEnabled || cfg.IdempotencyLifetime != 10*time.Minute {
		t.Fatalf("parsed idempotency = %t/%s", cfg.IdempotencyEnabled, cfg.IdempotencyLifetime)
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
		{name: "environment", key: "APP_ENV", value: "prod", wantInError: "APP_ENV"},
		{name: "CORS credentials boolean", key: "CORS_ALLOW_CREDENTIALS", value: "sometimes", wantInError: "CORS_ALLOW_CREDENTIALS"},
		{name: "proxy IP", key: "TRUSTED_PROXIES", value: "not-an-ip", wantInError: "TRUSTED_PROXIES"},
		{name: "proxy CIDR", key: "TRUSTED_PROXIES", value: "10.0.0.0/99", wantInError: "TRUSTED_PROXIES"},
		{name: "body limit", key: "HTTP_BODY_LIMIT", value: "512", wantInError: "HTTP_BODY_LIMIT"},
		{name: "duration syntax", key: "HTTP_REQUEST_TIMEOUT", value: "soon", wantInError: "HTTP_REQUEST_TIMEOUT"},
		{name: "request exceeds write", key: "HTTP_REQUEST_TIMEOUT", value: "10s", wantInError: "HTTP_REQUEST_TIMEOUT"},
		{name: "health cache", key: "HEALTH_CACHE_TTL", value: "0s", wantInError: "HEALTH_CACHE_TTL"},
		{name: "drain delay", key: "SHUTDOWN_DRAIN_DELAY", value: "-1s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "drain delay exceeds shutdown", key: "SHUTDOWN_DRAIN_DELAY", value: "20s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "insufficient shutdown budget", key: "SHUTDOWN_DRAIN_DELAY", value: "12s", wantInError: "SHUTDOWN_DRAIN_DELAY"},
		{name: "duration range", key: "RATE_LIMIT_WINDOW", value: "0s", wantInError: "RATE_LIMIT_WINDOW"},
		{name: "request rate", key: "RATE_LIMIT_MAX", value: "0", wantInError: "RATE_LIMIT_MAX"},
		{name: "auth rate", key: "AUTH_RATE_LIMIT_MAX", value: "0", wantInError: "AUTH_RATE_LIMIT_MAX"},
		{name: "boolean", key: "DEMO_AUTH_ENABLED", value: "sometimes", wantInError: "DEMO_AUTH_ENABLED"},
		{name: "idempotency boolean", key: "IDEMPOTENCY_ENABLED", value: "sometimes", wantInError: "IDEMPOTENCY_ENABLED"},
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

func TestLoadRequiresMetricsTokenInProduction(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "production-secret-with-at-least-32-characters")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "METRICS_TOKEN") {
		t.Fatalf("Load() error = %v", err)
	}
}

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range configEnvironmentKeys {
		t.Setenv(key, "")
	}
}
