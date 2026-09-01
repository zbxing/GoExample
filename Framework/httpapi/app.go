package httpapi

import (
	"context"
	"log/slog"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/compress"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/earlydata"
	"github.com/gofiber/fiber/v3/middleware/helmet"
	"github.com/gofiber/fiber/v3/middleware/idempotency"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"go.opentelemetry.io/otel/trace"

	"github.com/zbxing/goexample/Framework/auth"
	"github.com/zbxing/goexample/Framework/health"
	"github.com/zbxing/goexample/Framework/observability"
	"github.com/zbxing/goexample/Framework/validation"
)

type RouteRegistrar func(fiber.Router)

type appMiddlewareSet struct {
	requestLog  bool
	trace       bool
	metrics     bool
	cors        bool
	compression bool
	etag        bool
}

func defaultAppMiddlewareSet() appMiddlewareSet {
	return appMiddlewareSet{
		requestLog:  true,
		trace:       true,
		metrics:     true,
		cors:        true,
		compression: true,
		etag:        true,
	}
}

type Options struct {
	Name                string
	Environment         string
	Version             string
	Commit              string
	BuildTime           string
	LogSkipPaths        []string
	AllowedOrigins      []string
	AllowCredentials    bool
	TrustedProxies      []string
	BodyLimit           int
	ReadBufferSize      int
	ReadTimeout         time.Duration
	WriteTimeout        time.Duration
	IdleTimeout         time.Duration
	MaxConnections      int
	RequestTimeout      time.Duration
	MaxInFlight         int
	HealthCheckTimeout  time.Duration
	HealthCacheTTL      time.Duration
	RateLimitMax        int
	RateLimitWindow     time.Duration
	AuthRateLimitMax    int
	IdempotencyEnabled  bool
	IdempotencyLifetime time.Duration
	// SharedStorage and IdempotencyLock are optional in development/test.
	// External mode requires storage and, when idempotency is enabled, a lock.
	SharedStorage        fiber.Storage
	IdempotencyLock      idempotency.Locker
	MetricsToken         string
	PprofEnabled         bool
	PprofToken           string
	SystemInfoDetailed   bool
	Auth                 *auth.Service
	TokenVerifier        auth.TokenVerifier
	OIDCBrowser          *OIDCBrowser
	Health               *health.Checker
	Metrics              *observability.Metrics
	TracerProvider       trace.TracerProvider
	Validator            fiber.StructValidator
	Logger               *slog.Logger
	SecurityAuditSink    SecurityAuditSink
	SecurityAuditTimeout time.Duration
	// ResourceAuthorizationTimeout bounds each application resource policy.
	ResourceAuthorizationTimeout time.Duration
	Now                          func() time.Time
	Endpoints                    []string
	ApplicationQueries           []ApplicationQuery
	ApplicationCommands          []ApplicationCommand
	RegisterRoutes               RouteRegistrar
}

func New(options Options) *fiber.App {
	return newApp(options, defaultAppMiddlewareSet())
}

func newApp(options Options, middleware appMiddlewareSet) *fiber.App {
	options = withDefaults(options)
	applicationContext, cancelApplication := context.WithCancel(context.Background())
	requestCancellations := newRequestCancellationRegistry()
	helmetConfig := helmet.Config{
		ContentSecurityPolicy:     "default-src 'none'; frame-ancestors 'none'",
		XFrameOptions:             "DENY",
		CrossOriginEmbedderPolicy: "unsafe-none",
		CrossOriginResourcePolicy: "cross-origin",
		PermissionPolicy:          "camera=(), microphone=(), geolocation=()",
	}
	if strings.EqualFold(options.Environment, "production") {
		helmetConfig.HSTSMaxAge = 31536000
		helmetConfig.HSTSPreloadEnabled = true
	}

	app := fiber.New(fiber.Config{
		AppName:            options.Name,
		BodyLimit:          options.BodyLimit,
		ReadBufferSize:     options.ReadBufferSize,
		ReadTimeout:        options.ReadTimeout,
		WriteTimeout:       options.WriteTimeout,
		IdleTimeout:        options.IdleTimeout,
		Concurrency:        options.MaxConnections,
		TrustProxy:         len(options.TrustedProxies) > 0,
		TrustProxyConfig:   fiber.TrustProxyConfig{Proxies: options.TrustedProxies},
		ProxyHeader:        fiber.HeaderXForwardedFor,
		EnableIPValidation: true,
		StructValidator:    options.Validator,
		ErrorHandler:       errorHandler,
	})
	app.Hooks().OnPreShutdown(func() error {
		cancelApplication()
		requestCancellations.cancelAll()
		return nil
	})

	app.Use(standardRequestContextBridge())
	app.Use(requestIDBoundary(options.Metrics))
	app.Use(requestid.New())
	if middleware.trace {
		app.Use(observability.TraceMiddlewareWithProvider(options.TracerProvider))
	}
	if middleware.requestLog {
		app.Use(observability.RequestLogger(options.Logger, options.LogSkipPaths...))
	}
	if middleware.metrics {
		app.Use(options.Metrics.Middleware)
	}
	app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
		StackTraceHandler: func(c fiber.Ctx, recovered any) {
			logContext := c.Context()
			if logContext == nil {
				logContext = context.Background()
			}
			attributes := []any{
				"request_id", requestid.FromContext(c),
				"panic", recovered,
				"stack", string(debug.Stack()),
			}
			if trace, ok := observability.FromContext(c.Context()); ok {
				attributes = append(attributes, "trace_id", trace.TraceID, "span_id", trace.SpanID)
			}
			options.Logger.ErrorContext(logContext, "panic_recovered", attributes...)
		},
	}))
	app.Use(helmet.New(helmetConfig))
	app.Use(earlydata.New())
	restrictedCORS := middleware.cors && corsRequiresOriginVary(options.AllowedOrigins)
	if middleware.cors {
		var corsNext func(fiber.Ctx) bool
		if restrictedCORS {
			app.Use("/api/v1", seedAPIOriginVary())
			corsNext = skipPreseededAPICORS
		}
		app.Use(cors.New(cors.Config{
			Next:         corsNext,
			AllowOrigins: options.AllowedOrigins,
			AllowMethods: []string{
				fiber.MethodGet,
				fiber.MethodPost,
				fiber.MethodPut,
				fiber.MethodPatch,
				fiber.MethodDelete,
				fiber.MethodOptions,
			},
			AllowHeaders: []string{
				fiber.HeaderAccept,
				fiber.HeaderAuthorization,
				fiber.HeaderContentType,
				fiber.HeaderXRequestID,
				observability.TraceparentHeader,
				observability.TracestateHeader,
				"X-Idempotency-Key",
				"X-Tenant-ID",
				browserCSRFHeaderName,
			},
			ExposeHeaders: []string{
				fiber.HeaderXRequestID,
				fiber.HeaderWWWAuthenticate,
				observability.TraceparentHeader,
				fiber.HeaderRetryAfter,
				deprecationHeader,
				sunsetHeader,
				linkHeader,
				"X-Idempotency-Replayed",
				"X-RateLimit-Limit",
				"X-RateLimit-Remaining",
				"X-RateLimit-Reset",
			},
			AllowCredentials: options.AllowCredentials,
			MaxAge:           300,
		}))
	}
	registerDiagnostics(app, options)
	if middleware.etag {
		app.Use("/api/v1", streamSafeETag())
	}
	if middleware.compression {
		app.Use("/api/v1", compress.New(compress.Config{Level: compress.LevelBestSpeed}))
	}
	if restrictedCORS && middleware.compression {
		app.Use("/api/v1", coalesceCompressionVary())
	}

	registerRoutes(app, options, applicationContext, requestCancellations)
	return app
}

func withDefaults(options Options) Options {
	if strings.TrimSpace(options.Name) == "" {
		options.Name = "GoExample API"
	}
	if strings.TrimSpace(options.Environment) == "" {
		options.Environment = "development"
	}
	if strings.TrimSpace(options.Version) == "" {
		options.Version = "dev"
	}
	if strings.TrimSpace(options.Commit) == "" {
		options.Commit = "unknown"
	}
	if strings.TrimSpace(options.BuildTime) == "" {
		options.BuildTime = "unknown"
	}
	if len(options.AllowedOrigins) == 0 {
		options.AllowedOrigins = []string{"http://localhost:3000"}
	}
	if options.BodyLimit <= 0 {
		options.BodyLimit = fiber.DefaultBodyLimit
	}
	if options.ReadBufferSize <= 0 {
		options.ReadBufferSize = 16 * 1024
	}
	if options.ReadTimeout <= 0 {
		options.ReadTimeout = 10 * time.Second
	}
	if options.WriteTimeout <= 0 {
		options.WriteTimeout = 10 * time.Second
	}
	if options.IdleTimeout <= 0 {
		options.IdleTimeout = 60 * time.Second
	}
	if options.MaxConnections <= 0 {
		options.MaxConnections = 4096
	}
	if options.RequestTimeout <= 0 {
		options.RequestTimeout = 8 * time.Second
	}
	if options.MaxInFlight <= 0 {
		options.MaxInFlight = 256
	}
	if options.HealthCheckTimeout <= 0 {
		options.HealthCheckTimeout = 2 * time.Second
	}
	if options.HealthCacheTTL <= 0 {
		options.HealthCacheTTL = time.Second
	}
	if options.RateLimitMax <= 0 {
		options.RateLimitMax = 120
	}
	if options.RateLimitWindow <= 0 {
		options.RateLimitWindow = time.Minute
	}
	if options.AuthRateLimitMax <= 0 {
		options.AuthRateLimitMax = 10
	}
	if options.IdempotencyLifetime <= 0 {
		options.IdempotencyLifetime = 30 * time.Minute
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.SecurityAuditTimeout <= 0 {
		options.SecurityAuditTimeout = 100 * time.Millisecond
	}
	if options.ResourceAuthorizationTimeout <= 0 {
		options.ResourceAuthorizationTimeout = 100 * time.Millisecond
	}
	if !validResourceAuthorizationTimeout(options.ResourceAuthorizationTimeout) {
		panic("ResourceAuthorizationTimeout must be between 1ns and 1s")
	}
	if options.Validator == nil {
		options.Validator = validation.New()
	}
	if options.Metrics == nil {
		options.Metrics = observability.NewMetrics()
	}
	if options.Auth == nil {
		options.Auth = auth.NewService(auth.Config{})
	}
	if options.TokenVerifier == nil {
		options.TokenVerifier = options.Auth
	}
	if options.Health == nil {
		options.Health = health.New(options.HealthCheckTimeout, options.HealthCacheTTL)
	}
	if options.Endpoints == nil {
		if options.RegisterRoutes == nil {
			options.Endpoints = DefaultEndpointsForAuth(AuthenticationEnabled(options), options.Auth.Enabled())
			if options.OIDCBrowser != nil {
				options.Endpoints = append(options.Endpoints,
					"GET /api/v1/auth/oidc/start",
					"GET /api/v1/auth/oidc/callback",
				)
				if options.OIDCBrowser.SessionsEnabled() {
					options.Endpoints = append(options.Endpoints,
						"POST /api/v1/auth/oidc/logout",
						"GET /api/v1/auth/oidc/sessions",
						"PATCH /api/v1/auth/oidc/sessions/:sessionId",
						"DELETE /api/v1/auth/oidc/sessions/:sessionId",
						"DELETE /api/v1/auth/oidc/sessions",
					)
				}
			}
		} else {
			options.Endpoints = []string{}
		}
	}
	return options
}

// AuthenticationEnabled reports whether bearer-protected routes can verify
// tokens. Demo credential issuance is intentionally a separate capability.
func AuthenticationEnabled(options Options) bool {
	if options.TokenVerifier != nil {
		return options.TokenVerifier.Enabled()
	}
	return options.Auth != nil && options.Auth.Enabled()
}
