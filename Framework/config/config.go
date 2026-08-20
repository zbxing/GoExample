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
)

const (
	defaultName        = "GoExample API"
	defaultEnvironment = "development"
	defaultHost        = "0.0.0.0"
	defaultPort        = 3001
)

type Config struct {
	Name                     string
	Environment              string
	LogLevel                 string
	LogFormat                string
	LogSkipPaths             []string
	TraceExporter            string
	OTLPEndpoint             string
	TraceSampleRatio         float64
	TraceExportTimeout       time.Duration
	TraceBatchTimeout        time.Duration
	TraceMaxQueueSize        int
	TraceMaxExportBatchSize  int
	Host                     string
	Port                     int
	AllowedOrigins           []string
	AllowCredentials         bool
	TrustedProxies           []string
	BodyLimit                int
	ReadBufferSize           int
	ReadTimeout              time.Duration
	WriteTimeout             time.Duration
	IdleTimeout              time.Duration
	MaxConnections           int
	RequestTimeout           time.Duration
	MaxInFlight              int
	HealthCheckTimeout       time.Duration
	HealthCacheTTL           time.Duration
	ShutdownTimeout          time.Duration
	ShutdownDrainDelay       time.Duration
	RateLimitMax             int
	RateLimitWindow          time.Duration
	AuthRateLimitMax         int
	IdempotencyEnabled       bool
	IdempotencyLifetime      time.Duration
	SharedStateMode          string
	AllowInMemorySharedState bool
	MetricsToken             string
	PprofEnabled             bool
	PprofToken               string
	SystemInfoDetailed       bool
	DemoAuthEnabled          bool
	DemoUsername             string
	DemoPassword             string
	JWTSecret                string
	JWTIssuer                string
	JWTAudience              string
	JWTTTL                   time.Duration
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
		Name:                     valueOrDefault("APP_NAME", defaultName),
		Environment:              environment,
		LogLevel:                 strings.ToLower(valueOrDefault("LOG_LEVEL", "info")),
		LogFormat:                strings.ToLower(valueOrDefault("LOG_FORMAT", "json")),
		LogSkipPaths:             csvValues("LOG_SKIP_PATHS", []string{"/livez", "/readyz", "/startupz", "/metrics"}),
		TraceExporter:            strings.ToLower(valueOrDefault("OTEL_TRACES_EXPORTER", "none")),
		OTLPEndpoint:             strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
		TraceSampleRatio:         0.1,
		TraceExportTimeout:       3 * time.Second,
		TraceBatchTimeout:        5 * time.Second,
		TraceMaxQueueSize:        2048,
		TraceMaxExportBatchSize:  512,
		Host:                     valueOrDefault("HTTP_HOST", defaultHost),
		AllowedOrigins:           csvValues("CORS_ALLOW_ORIGINS", []string{"http://localhost:3000"}),
		AllowCredentials:         false,
		TrustedProxies:           csvValues("TRUSTED_PROXIES", nil),
		BodyLimit:                4 * 1024 * 1024,
		ReadBufferSize:           16 * 1024,
		ReadTimeout:              10 * time.Second,
		WriteTimeout:             10 * time.Second,
		IdleTimeout:              60 * time.Second,
		MaxConnections:           4096,
		RequestTimeout:           8 * time.Second,
		MaxInFlight:              256,
		HealthCheckTimeout:       2 * time.Second,
		HealthCacheTTL:           time.Second,
		ShutdownTimeout:          20 * time.Second,
		ShutdownDrainDelay:       0,
		RateLimitMax:             120,
		RateLimitWindow:          time.Minute,
		AuthRateLimitMax:         10,
		IdempotencyEnabled:       true,
		IdempotencyLifetime:      30 * time.Minute,
		SharedStateMode:          strings.ToLower(valueOrDefault("SHARED_STATE_MODE", sharedStateMode)),
		AllowInMemorySharedState: false,
		MetricsToken:             strings.TrimSpace(os.Getenv("METRICS_TOKEN")),
		PprofEnabled:             false,
		PprofToken:               strings.TrimSpace(os.Getenv("PPROF_TOKEN")),
		SystemInfoDetailed:       !strings.EqualFold(environment, "production"),
		DemoAuthEnabled:          !strings.EqualFold(environment, "production"),
		DemoUsername:             valueOrDefault("DEMO_USERNAME", "demo"),
		DemoPassword:             valueOrDefault("DEMO_PASSWORD", "demo123"),
		JWTSecret:                valueOrDefault("JWT_SECRET", "goexample-development-jwt-secret-change-me"),
		JWTIssuer:                valueOrDefault("JWT_ISSUER", "goexample"),
		JWTAudience:              valueOrDefault("JWT_AUDIENCE", "goexample-api"),
		JWTTTL:                   time.Hour,
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
	if cfg.JWTTTL, err = durationValue("JWT_TTL", cfg.JWTTTL); err != nil {
		return Config{}, err
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must contain at least 32 characters")
	}
	if strings.EqualFold(cfg.Environment, "production") {
		if cfg.MetricsToken == "" {
			return Config{}, fmt.Errorf("METRICS_TOKEN must be set in production")
		}
		if cfg.JWTSecret == "goexample-development-jwt-secret-change-me" {
			return Config{}, fmt.Errorf("JWT_SECRET must be changed in production")
		}
		if cfg.MetricsToken == cfg.JWTSecret {
			return Config{}, fmt.Errorf("METRICS_TOKEN must differ from JWT_SECRET in production")
		}
		if cfg.PprofEnabled && (cfg.PprofToken == cfg.MetricsToken || cfg.PprofToken == cfg.JWTSecret) {
			return Config{}, fmt.Errorf("PPROF_TOKEN must differ from METRICS_TOKEN and JWT_SECRET in production")
		}
		if cfg.DemoAuthEnabled && (cfg.DemoUsername == "demo" || cfg.DemoPassword == "demo123") {
			return Config{}, fmt.Errorf("demo credentials must be changed when DEMO_AUTH_ENABLED is true in production")
		}
	}

	return cfg, nil
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
