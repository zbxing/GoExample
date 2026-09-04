package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/config"
	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/server"
	"github.com/zbxing/goexample/Framework/sharedstate"
	"github.com/zbxing/goexample/Framework/validation"
	"github.com/zbxing/goexample/Solutions/Example/internal/projectapi"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Stdout); err != nil {
		slog.Error("server_stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, output io.Writer) (runErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	logger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel, output)
	slog.SetDefault(logger)
	authService := auth.NewService(auth.Config{
		Enabled:  cfg.DemoAuthEnabled,
		Username: cfg.DemoUsername,
		Password: cfg.DemoPassword,
		Secret:   cfg.JWTSecret,
		Issuer:   cfg.JWTIssuer,
		Audience: cfg.JWTAudience,
		TTL:      cfg.JWTTTL,
	})
	var tokenVerifier auth.TokenVerifier = authService
	var oidcVerifier *auth.JWKSVerifier
	var oidcBrowser *httpapi.OIDCBrowser
	var oidcClient *auth.OIDCClient
	var oidcRequests *auth.AuthorizationRequestManager
	authMode := "disabled"
	if authService.Enabled() {
		authMode = "demo"
	}
	if cfg.OIDCAuthEnabled {
		oidcVerifier, err = auth.NewJWKSVerifier(ctx, auth.JWKSConfig{
			Issuer:          cfg.OIDCIssuer,
			Audience:        cfg.OIDCAudience,
			JWKSURL:         cfg.OIDCJWKSURL,
			HTTPTimeout:     cfg.OIDCJWKSHTTPTimeout,
			RefreshInterval: cfg.OIDCJWKSRefreshInterval,
			MaxTokenAge:     cfg.OIDCMaxTokenAge,
			RequiredACR:     cfg.OIDCRequiredACR,
			RequiredAMR:     cfg.OIDCRequiredAMR,
			MaxAuthAge:      cfg.OIDCMaxAuthAge,
		})
		if err != nil {
			return fmt.Errorf("initialize OIDC token verifier: %w", err)
		}
		tokenVerifier = oidcVerifier
		authMode = "oidc"
		if cfg.OIDCBrowserEnabled {
			oidcClient, err = auth.NewOIDCClient(ctx, auth.OIDCClientConfig{
				Issuer:       cfg.OIDCIssuer,
				ClientID:     cfg.OIDCClientID,
				ClientSecret: cfg.OIDCClientSecret,
				RedirectURL:  cfg.OIDCRedirectURL,
				HTTPTimeout:  cfg.OIDCJWKSHTTPTimeout,
			})
			if err != nil {
				return fmt.Errorf("initialize browser OIDC client: %w", err)
			}
		}
	}
	healthChecker := health.New(cfg.HealthCheckTimeout, cfg.HealthCacheTTL)
	metrics := observability.NewMetrics()
	tracerProvider, err := observability.NewTracerProvider(ctx, observability.TracingConfig{
		ServiceName:        cfg.Name,
		ServiceVersion:     version,
		Environment:        cfg.Environment,
		Exporter:           cfg.TraceExporter,
		Endpoint:           cfg.OTLPEndpoint,
		SampleRatio:        cfg.TraceSampleRatio,
		ExportTimeout:      cfg.TraceExportTimeout,
		BatchTimeout:       cfg.TraceBatchTimeout,
		MaxQueueSize:       cfg.TraceMaxQueueSize,
		MaxExportBatchSize: cfg.TraceMaxExportBatchSize,
		Metrics:            metrics,
	})
	if err != nil {
		return fmt.Errorf("initialize tracing: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.TraceExportTimeout)
		defer cancel()
		if err := tracerProvider.Shutdown(shutdownCtx); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown tracing: %w", err))
		}
	}()

	var externalState *sharedstate.Redis
	if cfg.SharedStateMode == httpapi.SharedStateModeExternal {
		redisTLS, tlsErr := redisTLSConfig(cfg)
		if tlsErr != nil {
			return fmt.Errorf("initialize Redis TLS: %w", tlsErr)
		}
		externalState, err = sharedstate.NewRedis(ctx, sharedstate.RedisConfig{
			URL:                cfg.RedisURL,
			Topology:           sharedstate.RedisTopology(cfg.RedisTopology),
			SentinelAddresses:  cfg.RedisSentinelAddresses,
			SentinelMasterName: cfg.RedisSentinelMasterName,
			Username:           cfg.RedisUsername,
			Password:           cfg.RedisPassword,
			SentinelUsername:   cfg.RedisSentinelUsername,
			SentinelPassword:   cfg.RedisSentinelPassword,
			Database:           cfg.RedisDatabase,
			TLSConfig:          redisTLS,
			KeyPrefix:          cfg.RedisKeyPrefix,
			OperationTimeout:   cfg.RedisOperationTimeout,
			LockTTL:            cfg.RedisLockTTL,
			LockWaitTimeout:    cfg.RedisLockWaitTimeout,
			LockRetryInterval:  cfg.RedisLockRetryInterval,
			PoolSize:           cfg.RedisPoolSize,
			MinIdleConnections: cfg.RedisMinIdleConnections,
			TracerProvider:     tracerProvider,
		})
		if err != nil {
			return fmt.Errorf("initialize external shared state: %w", err)
		}
		defer func() {
			if err := externalState.Close(); err != nil {
				runErr = errors.Join(runErr, fmt.Errorf("close external shared state: %w", err))
			}
		}()
		if err := healthChecker.Register("redis", externalState.Check); err != nil {
			return fmt.Errorf("register Redis readiness check: %w", err)
		}
	}
	if cfg.OIDCBrowserEnabled {
		var authorizationRequestStore auth.AuthorizationRequestStore
		var browserSessionStore auth.BrowserSessionStore
		var authorizationACRValues []string
		if externalState != nil {
			authorizationRequestStore = externalState
			browserSessionStore = externalState
		}
		if cfg.OIDCRequiredACR != "" {
			authorizationACRValues = []string{cfg.OIDCRequiredACR}
		}
		oidcRequests, err = auth.NewAuthorizationRequestManager(auth.AuthorizationRequestConfig{
			AuthorizationURL: oidcClient.Metadata().AuthorizationEndpoint,
			ClientID:         cfg.OIDCClientID,
			RedirectURL:      cfg.OIDCRedirectURL,
			Scopes:           []string{"openid"},
			ACRValues:        authorizationACRValues,
			TTL:              cfg.OIDCAuthorizationTTL,
			Store:            authorizationRequestStore,
		})
		if err != nil {
			return fmt.Errorf("initialize browser OIDC authorization requests: %w", err)
		}
		browserSessions, sessionErr := auth.NewBrowserSessionManager(auth.BrowserSessionConfig{
			TTL:                   cfg.OIDCBrowserSessionTTL,
			MaxSessions:           cfg.OIDCBrowserMaxSessions,
			MaxSessionsPerSubject: cfg.OIDCBrowserMaxSessionsPerSubject,
			Store:                 browserSessionStore,
		})
		if sessionErr != nil {
			return fmt.Errorf("initialize browser application sessions: %w", sessionErr)
		}
		oidcBrowser, err = httpapi.NewOIDCBrowserWithSessions(oidcRequests, oidcClient, oidcVerifier, browserSessions)
		if err != nil {
			return fmt.Errorf("initialize browser OIDC adapter: %w", err)
		}
		authMode = "oidc_browser"
	}

	apiOptions := httpapi.Options{
		Name:                cfg.Name,
		Environment:         cfg.Environment,
		Version:             version,
		Commit:              commit,
		BuildTime:           buildTime,
		LogSkipPaths:        cfg.LogSkipPaths,
		AllowedOrigins:      cfg.AllowedOrigins,
		AllowCredentials:    cfg.AllowCredentials,
		TrustedProxies:      cfg.TrustedProxies,
		BodyLimit:           cfg.BodyLimit,
		ReadBufferSize:      cfg.ReadBufferSize,
		ReadTimeout:         cfg.ReadTimeout,
		WriteTimeout:        cfg.WriteTimeout,
		IdleTimeout:         cfg.IdleTimeout,
		MaxConnections:      cfg.MaxConnections,
		RequestTimeout:      cfg.RequestTimeout,
		MaxInFlight:         cfg.MaxInFlight,
		HealthCheckTimeout:  cfg.HealthCheckTimeout,
		HealthCacheTTL:      cfg.HealthCacheTTL,
		RateLimitMax:        cfg.RateLimitMax,
		RateLimitWindow:     cfg.RateLimitWindow,
		AuthRateLimitMax:    cfg.AuthRateLimitMax,
		IdempotencyEnabled:  cfg.IdempotencyEnabled,
		IdempotencyLifetime: cfg.IdempotencyLifetime,
		MetricsToken:        cfg.MetricsToken,
		PprofEnabled:        cfg.PprofEnabled,
		PprofToken:          cfg.PprofToken,
		SystemInfoDetailed:  cfg.SystemInfoDetailed,
		Auth:                authService,
		TokenVerifier:       tokenVerifier,
		OIDCBrowser:         oidcBrowser,
		Health:              healthChecker,
		Metrics:             metrics,
		TracerProvider:      tracerProvider,
		Validator:           validation.New(),
		Logger:              logger,
	}
	if externalState != nil {
		apiOptions.SharedStorage = externalState
		apiOptions.IdempotencyLock = externalState
	}
	apiOptions.Endpoints = projectapi.EndpointsForAuth(tokenVerifier.Enabled(), authService.Enabled())
	if oidcBrowser != nil {
		apiOptions.Endpoints = append(apiOptions.Endpoints,
			"GET /api/v1/auth/oidc/start",
			"GET /api/v1/auth/oidc/callback",
			"POST /api/v1/auth/oidc/logout",
			"GET /api/v1/auth/oidc/sessions",
			"PATCH /api/v1/auth/oidc/sessions/:sessionId",
			"DELETE /api/v1/auth/oidc/sessions/:sessionId",
			"DELETE /api/v1/auth/oidc/sessions",
		)
	}
	apiOptions.ApplicationQueries = projectapi.Queries(apiOptions)
	apiOptions.ApplicationCommands = projectapi.Commands(apiOptions)
	if err := httpapi.ValidateSharedState(
		cfg.Environment,
		cfg.SharedStateMode,
		cfg.AllowInMemorySharedState,
		cfg.IdempotencyEnabled,
		apiOptions.SharedStorage,
		apiOptions.IdempotencyLock,
	); err != nil {
		return fmt.Errorf("validate shared state: %w", err)
	}
	application, err := httpapi.NewHTTPApplication(apiOptions)
	if err != nil {
		return fmt.Errorf("initialize standard HTTP application: %w", err)
	}

	return server.RunHTTP(ctx, server.HTTPOptions{
		Handler:             application,
		ApplicationShutdown: application.Shutdown,
		ConnectionObserver:  metrics,
		Health:              healthChecker,
		Logger:              logger,
		Name:                cfg.Name,
		Version:             version,
		Environment:         cfg.Environment,
		Address:             cfg.Address(),
		ShutdownTimeout:     cfg.ShutdownTimeout,
		DrainDelay:          cfg.ShutdownDrainDelay,
		ReadHeaderTimeout:   cfg.ReadTimeout,
		ReadTimeout:         cfg.ReadTimeout,
		WriteTimeout:        cfg.WriteTimeout,
		IdleTimeout:         cfg.IdleTimeout,
		MaxHeaderBytes:      cfg.ReadBufferSize,
		MaxConnections:      cfg.MaxConnections,
		Attributes:          []any{"auth_mode", authMode, "trace_exporter", cfg.TraceExporter, "shared_state_mode", cfg.SharedStateMode},
	})
}

func redisTLSConfig(cfg config.Config) (*tls.Config, error) {
	if !cfg.RedisTLSEnabled {
		return nil, nil
	}
	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: cfg.RedisTLSServerName,
	}
	if cfg.RedisTLSCAFile == "" {
		return tlsConfig, nil
	}
	file, err := os.Open(cfg.RedisTLSCAFile)
	if err != nil {
		return nil, errors.New("open Redis TLS CA file")
	}
	defer file.Close()
	const maxCABytes = 1 << 20
	contents, err := io.ReadAll(io.LimitReader(file, maxCABytes+1))
	if err != nil {
		return nil, errors.New("read Redis TLS CA file")
	}
	if len(contents) > maxCABytes {
		return nil, errors.New("Redis TLS CA file exceeds 1 MiB")
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	if !roots.AppendCertsFromPEM(contents) {
		return nil, errors.New("Redis TLS CA file contains no valid certificates")
	}
	tlsConfig.RootCAs = roots
	return tlsConfig, nil
}
