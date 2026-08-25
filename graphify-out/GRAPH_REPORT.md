# Graph Report - GoExample  (2026-08-25)

## Corpus Check
- 616 files · ~355,467 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5427 nodes · 14317 edges · 217 communities (191 shown, 26 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 779 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e060d1a9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- formatNumber
- governance-filters.ts
- New
- go-sdk.mjs
- use-project-management-console-presentation-controller.ts
- types/management.ts
- use-roles-page-surface-controller.ts
- useLocale
- admin-primitives.tsx
- New
- registerApplicationCommands
- use-project-detail-page-surface-controller.ts
- readJsonBody
- AccessManagedRoleEntry
- registerAuthRoutes
- Request
- use-command-palette-controller.ts
- project-surface.tsx
- gva-setting-drawer.tsx
- context.Context
- access-management-repository.ts
- SystemAdapter
- api/management.ts
- apiFetch
- use-roles-page-bridge-controller.ts
- auth-token.ts
- access-governance-surface.tsx
- requireApiAccess
- use-users-page-editor-presentation-controller.ts
- project-repository.ts
- time.Duration
- AccessManagedUserEntry
- security-repository.ts
- dashboard-shell.tsx
- cluster_integration_test.go
- scripts
- BrowserSessionManager
- use-environments-page-controller.ts
- WorkerGroup
- overview.ts
- evidence-manifest.mjs
- testing.T
- transport_benchmark_test.go
- Metrics
- access-navigation.ts
- security_audit_chain.go
- TraceMiddlewareWithProvider
- apisnapshot/main.go
- idempotencyMiddleware
- sqlclient/client_test.go
- runtime.ts
- oidc_client.go
- Options
- system-user-repository.ts
- request-schemas.ts
- New
- SessionManager
- net.Conn
- oidc_browser_test.go
- NewMetrics
- gva-page-loading.ts
- LocaleCode
- compilerOptions
- transport-soak-report.mjs
- JWKSVerifier
- FeedbackState
- tags-view.tsx
- system-api-sync.ts
- New
- Redis
- Redis
- evidence-verify.mjs
- README.md
- GoExample 待优化 V9
- security-filters.ts
- use-settings-panel-controller.ts
- server-release.mjs
- transport-benchmark-report.mjs
- What You Must Do When Invoked
- 4. 本轮实施设计
- RunHTTP
- go-project.mjs
- nginx-edge-contract.mjs
- New
- api-contracts/package.json
- server-recovery-drill.mjs
- topbar.tsx
- kubernetes-manifest.mjs
- contractStorage
- redis_test.go
- application_query.go
- environment.mjs
- postgres-recovery-report.mjs
- redis-sentinel-contract.mjs
- 3. P0 实施项
- 3. 达到 10 分仍需完成
- devDependencies
- registerOIDCBrowserRoutes
- Client
- go.opentelemetry.io/otel/sdk/trace.ReadOnlySpan
- run
- postgres-recovery-contract.mjs
- 1. 本轮已完成
- metrics.go
- sidebar.tsx
- dependencies
- 2. 已完成优化
- 6. 全量优缺点
- jwks_test.go
- sync.Once
- idempotency_fingerprint.go
- useProjectManagementConsoleController
- Claims
- 1. 本轮已完成
- NewService
- gva-message.ts
- nginx-edge.mjs
- GvaSettingDrawer
- 2. 优化清单
- success
- snapshot_integration_test.go
- Redis
- migrate.mjs
- theme-provider.tsx
- users-page-editor-permissions-content.tsx
- TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler
- 1. 本轮完成项
- fakeMessage
- api-inventory-parser.ts
- msfront-route-authorization.mjs
- 2. 优化清单
- 2. 优化清单
- GoExample 项目架构与性能评估（V12）
- Checker
- finishRedisSpan
- AccessManagementView
- net/http.ConnState
- use-security-governance-surface-presentation-controller.ts
- http_test.go
- time.Time
- authorization/authorization.go
- Framework
- requireInternalToken
- New
- scripts
- GoExample 待优化清单（V12）
- newTestBrowserSessionManager
- openRealPostgresClient
- namespacedStorage
- registerRoutes
- package.json
- GoExample Server Threat Model
- NewResourceAuthorizer
- newRedisBrowserSessionManagerWithSubjectLimit
- reference-dashboard.tsx
- database-migration.mjs
- kubernetes-manifest.test.mjs
- postgres-recovery-report.test.mjs
- graphify reference: extra exports and benchmark
- GoExample Server Security Audit Events
- newRedisSentinelIntegrationClient
- Q: graphify-out中的cache有必要上传仓库吗
- GoExample
- transport-benchmark-report.test.mjs
- MSFront/package.json
- Example
- e2e-msfront.mjs
- nginx-edge.test.mjs
- devDependencies
- ADR 0001：Example HTTP transport 选择与测量门槛
- eslint-config-next
- msfront.mjs
- Changelog
- API Contracts
- server-release.test.mjs
- graphify reference: query, path, explain
- ADR 0002：HTTP 请求生命周期与协议边界
- GoExample SLO and Alerts
- Server Failure Matrix And Local Recovery Drill
- MSFront
- Unreleased
- validate-openapi.mjs
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- login-page-content.tsx
- sidebar-navigation-content.tsx
- github.com/zbxing/goexample/Framework
- script-guards.test.mjs
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- Framework compatibility policy
- sidebar-summary-content.tsx
- playwright.config.ts
- 测试目录
- AGENTS.md
- extraction-spec.md
- MSFront/AGENTS.md
- database/README.md
- eslint.config.mjs
- next-env.d.ts
- @tailwindcss/postcss
- @types/react
- postcss.config.mjs
- vitest.config.mts
- GoExample/README.md
- HealthProbe/README.md

## God Nodes (most connected - your core abstractions)
1. `useLocale()` - 157 edges
2. `LocaleCode` - 112 edges
3. `ProjectStatus` - 97 edges
4. `New()` - 95 edges
5. `ProjectEnvironment` - 90 edges
6. `ManagedProject` - 83 edges
7. `formatNumber()` - 83 edges
8. `testOptions()` - 80 edges
9. `requireApiAccess()` - 64 edges
10. `AccessManagedUserEntry` - 61 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `NewBrowserSessionManager()`  [EXTRACTED]
  Proj/Example/cmd/server/main.go → Framework/auth/browser_session.go
- `run()` --calls--> `NewJWKSVerifier()`  [EXTRACTED]
  Proj/Example/cmd/server/main.go → Framework/auth/jwks.go
- `run()` --calls--> `NewOIDCClient()`  [EXTRACTED]
  Proj/Example/cmd/server/main.go → Framework/auth/oidc_client.go
- `issueProjectTestToken()` --references--> `User`  [EXTRACTED]
  Proj/Example/internal/projectapi/routes_test.go → Framework/auth/service.go
- `issueProjectTestToken()` --references--> `Service`  [EXTRACTED]
  Proj/Example/internal/projectapi/routes_test.go → Framework/auth/service.go

## Import Cycles
- None detected.

## Communities (217 total, 26 thin omitted)

### Community 0 - "formatNumber"
Cohesion: 0.05
Nodes (87): ProjectCommandCenterSurface(), ProjectCommandCenterSurfaceProps, ProjectSpotlightSection(), ProjectSpotlightSectionProps, ProjectMetricItem, ProjectSpotlightCard(), SecurityUserResultsTable(), SecurityOverviewPanel() (+79 more)

### Community 1 - "governance-filters.ts"
Cohesion: 0.06
Nodes (76): dynamic, normalizeEnvironment(), normalizeSort(), normalizeStatus(), ProjectsRoute(), ProjectEndpointSurfaceCardProps, ProjectBadgeGroupProps, ProjectBadgeGroupProps (+68 more)

### Community 2 - "New"
Cohesion: 0.06
Nodes (98): fiber.App, New(), assertBearerChallenge(), assertHealthDeprecationHeaders(), assertNoStoreResponse(), decodeEnvelope(), doJSONRequest(), fiber.App (+90 more)

### Community 3 - "go-sdk.mjs"
Cohesion: 0.06
Nodes (78): args, checkPath, checkRoot, collectOperations(), currentDirectory, document, fail(), generated (+70 more)

### Community 4 - "use-project-management-console-presentation-controller.ts"
Cohesion: 0.06
Nodes (46): ProjectEntityEditorCard(), ProjectEntityEditorCardProps, ProjectEntityEditorSection(), ProjectEntityEditorSectionProps, ProjectManagementConsoleRegistryContent(), ProjectManagementConsoleRegistryContentProps, ProjectManagementConsoleEditorActionsContent(), ProjectManagementConsoleEditorActionsContentProps (+38 more)

### Community 5 - "types/management.ts"
Cohesion: 0.07
Nodes (63): ProjectEndpointField, ProjectEndpointFieldGridProps, ProjectEndpointFooterLink(), ProjectEndpointFooterLinkProps, ProjectEndpointIdentity, ProjectEndpointMetric, ProjectEndpointSurfaceCard(), IntegrationsPageResultsContent() (+55 more)

### Community 6 - "use-roles-page-surface-controller.ts"
Cohesion: 0.14
Nodes (23): formatDecimal(), buildRolesPageOverviewStats(), RolesPageOverviewStats, TranslationFn, useRolesPageCommandCenterSurfaceController(), UseRolesPageCommandCenterSurfaceControllerOptions, TranslationFn, useRolesPageCommandCenterTagsSurfaceController() (+15 more)

### Community 7 - "useLocale"
Cohesion: 0.05
Nodes (55): AttentionCardProps, ManagementContextStrip(), ManagementContextStripProps, SummaryCard(), SummaryCardProps, TonePillProps, OverviewSummarySection(), OverviewSummarySectionProps (+47 more)

### Community 8 - "admin-primitives.tsx"
Cohesion: 0.07
Nodes (60): baseProps(), IconArrowDown(), IconArrowLeft(), IconArrowRight(), IconCompass(), IconDelete(), IconDownload(), IconEdit() (+52 more)

### Community 9 - "New"
Cohesion: 0.07
Nodes (29): New(), NewWorkerGroup(), TestMinimumDeliveryLeaseRejectsInvalidAndOverflowingBudgets(), TestMinimumDeliveryLeaseUsesEffectiveRetryBudget(), TestNewWorkerGroupValidatesCallbacksAndConcurrency(), TestWorkerGroupBoundsAndRedactsDeliverySettlementFailure(), TestWorkerGroupBoundsAndRedactsLeaseExtensionFailure(), TestWorkerGroupCancellationDuringRetryDoesNotSettleDelivery() (+21 more)

### Community 10 - "registerApplicationCommands"
Cohesion: 0.12
Nodes (30): applicationPrincipalFromContext(), authorizeApplicationResource(), authorizeApplicationRoles(), cloneAuthorizationResource(), fiber.Ctx, Options, resolveApplicationResource(), validApplicationRoleID() (+22 more)

### Community 11 - "use-project-detail-page-surface-controller.ts"
Cohesion: 0.05
Nodes (69): ProjectDetailPanelSection(), ProjectDetailPanelSectionProps, EnvironmentCard(), ProjectDetailActionsContent(), ProjectDetailActionsContentProps, ProjectDetailAttentionSection(), ProjectDetailPageContent(), ProjectDetailPageContentProps (+61 more)

### Community 12 - "readJsonBody"
Cohesion: 0.22
Nodes (28): DELETE(), GET(), POST(), PUT(), GET(), GET(), PUT(), GET() (+20 more)

### Community 13 - "AccessManagedRoleEntry"
Cohesion: 0.11
Nodes (33): EditorWorkspaceShell(), RolesPageContent(), RolesPageContentProps, RolesEditorActionsContent(), RolesEditorActionsContentProps, RolesEditorMembersContent(), RolesEditorMembersContentProps, RolesEditorPermissionsContent() (+25 more)

### Community 14 - "registerAuthRoutes"
Cohesion: 0.10
Nodes (23): browserSessionRequiresCSRF(), currentClaims(), fiber.Ctx, fiber.Handler, Options, requireAuth(), requireBrowserSession(), bindBody() (+15 more)

### Community 15 - "Request"
Cohesion: 0.16
Nodes (33): Authorizer, Decision, Request, Resource, TestApplicationCommandsRejectAmbiguousDefinitions(), TestTypedApplicationQueriesRejectUnsafeBindingsAndOverlappingRoutes(), evaluateApplicationAuthorization(), validateApplicationResourceAuthorization() (+25 more)

### Community 16 - "use-command-palette-controller.ts"
Cohesion: 0.10
Nodes (28): CommandPalette(), CommandPaletteContent(), CommandPaletteShell(), CommandPaletteShellCopy, CommandPaletteShellProps, NavigationItem, navigationItems, buildCommandPaletteItemDomId() (+20 more)

### Community 17 - "project-surface.tsx"
Cohesion: 0.10
Nodes (25): ProjectMetricItem, ProjectMetricListProps, ProjectSpotlightCardContent(), ProjectSpotlightCardContentProps, ProjectBadgeGroup(), ProjectMetricList(), ProjectMetricListProps, ProjectSpotlightCardProps (+17 more)

### Community 18 - "gva-setting-drawer.tsx"
Cohesion: 0.06
Nodes (44): handleShellSettingsChange(), LayoutModeCard(), MenuThemeSelector(), PresetCard(), PresetsPane(), applyPreset(), handleExport(), handleImport() (+36 more)

### Community 19 - "context.Context"
Cohesion: 0.06
Nodes (41): context.Context, go.opentelemetry.io/otel/sdk/trace.ReadWriteSpan, go.opentelemetry.io/otel/sdk/trace.SpanProcessor, net/http.Header, net/url.Values, sync.RWMutex, BrowserSessionDeviceNameRequest, BrowserSessionInfo (+33 more)

### Community 20 - "access-management-repository.ts"
Cohesion: 0.11
Nodes (54): AccessPermissionCatalogEntry, AccessRoleSeedDefinition, filterValidPermissionIdentifiers(), isValidPermissionIdentifier(), isValidRoleIdentifier(), MSFRONT_DEFAULT_ROLE_DEFINITIONS, MSFRONT_PERMISSION_CATALOG, MSFRONT_SUPPORTED_PERMISSIONS (+46 more)

### Community 21 - "SystemAdapter"
Cohesion: 0.07
Nodes (18): fiberSystemAdapter, SystemAdapter, ApisFile, SyncApiPreview, MenusFile, AuthSessionUser, CreateSystemApiInput, CreateSystemMenuInput (+10 more)

### Community 22 - "api/management.ts"
Cohesion: 0.07
Nodes (45): DashboardRoute(), dynamic, dynamic, EnvironmentsRoute(), dynamic, IntegrationsRoute(), dynamic, ProjectDetailRoute() (+37 more)

### Community 23 - "apiFetch"
Cohesion: 0.04
Nodes (30): downloadText(), methodLabel(), SystemApisPage(), addOneSyncApi(), confirmBatchDelete(), confirmDelete(), downloadTemplate(), exportApis() (+22 more)

### Community 24 - "use-roles-page-bridge-controller.ts"
Cohesion: 0.10
Nodes (36): refreshAccessManagement(), TranslationFn, useRolesPageBridgeController(), createRoleDraft(), dedupeStrings(), RoleEditorDraft, selectManagedRole(), toDraft() (+28 more)

### Community 25 - "auth-token.ts"
Cohesion: 0.09
Nodes (36): POST(), POST(), GET(), register(), jsonFail(), requireSession(), AUTH_COOKIE_NAME, buildAuthCookie() (+28 more)

### Community 26 - "access-governance-surface.tsx"
Cohesion: 0.08
Nodes (49): AccessCommandCenterSurfaceContent(), AccessCommandCenterSurfaceContentProps, AccessSurfaceMetricGridProps, SummaryCardProps, TonePillProps, AccessCommandCenterSurface(), AccessCommandCenterSurfaceProps, AccessCoverageCard() (+41 more)

### Community 27 - "requireApiAccess"
Cohesion: 0.16
Nodes (27): GET(), GET(), GET(), DELETE(), GET(), PUT(), GET(), POST() (+19 more)

### Community 28 - "use-users-page-editor-presentation-controller.ts"
Cohesion: 0.08
Nodes (44): ManagedUserUpdateInput, FrameworkUserStatus, collectPermissionsForRoles(), dedupeStrings(), toDraft(), TranslationFn, UserEditorDraft, useUsersPageEditorController() (+36 more)

### Community 29 - "project-repository.ts"
Cohesion: 0.09
Nodes (49): getManagedProjectCatalog(), getManagedProjectSummaries(), clampInteger(), compareProjectSummaries(), createProject(), createProjectInDatabase(), deleteProject(), deleteProjectInDatabase() (+41 more)

### Community 30 - "time.Duration"
Cohesion: 0.12
Nodes (28): boundedContext(), classifyResult(), exec(), execVersioned(), finishSpan(), isRetryablePostgresError(), jitteredBackoff(), nextRetryBackoff() (+20 more)

### Community 31 - "AccessManagedUserEntry"
Cohesion: 0.09
Nodes (44): RegistryWorkspaceShell(), UsersPageContent(), UsersPageContentProps, UsersEditorActionsContentProps, PermissionSectionModel, ProfileSectionModel, renderUsersProfileField(), UsersEditorProfileContent() (+36 more)

### Community 32 - "security-repository.ts"
Cohesion: 0.07
Nodes (40): buildSecurityGovernanceView(), rankCredentialStatus(), rankUserStatus(), resolveAuditTone(), resolveCredentialStatus(), DatabasePoolOptions, EnvironmentValues, readBoundedInteger() (+32 more)

### Community 33 - "dashboard-shell.tsx"
Cohesion: 0.12
Nodes (22): DashboardShell(), onPointerDown(), GvaPageTransition(), useGvaListLoad(), run(), finishLeave(), GVA_LEAVE_DURATIONS, isGvaPageLeaving() (+14 more)

### Community 34 - "cluster_integration_test.go"
Cohesion: 0.07
Nodes (59): calibrateExistingContractConsumer(), clusterAttemptContext(), clusterAvailable(), clusterReady(), connectClusterJetStream(), createClusterConsumer(), createClusterStream(), disableClusterRouteProxies() (+51 more)

### Community 35 - "scripts"
Cohesion: 0.04
Nodes (48): scripts, api:compat, api:snapshot, bench:server, bench:transports, build, build:front, build:server (+40 more)

### Community 36 - "BrowserSessionManager"
Cohesion: 0.20
Nodes (16): BrowserSessionConfig, BrowserSessionInventoryStore, BrowserSessionMetadataStore, browserSessionInfo(), cloneClaims(), BrowserSessionCredentials, BrowserSessionInfo, BrowserSessionManager (+8 more)

### Community 37 - "use-environments-page-controller.ts"
Cohesion: 0.06
Nodes (42): SecurityHeroOverview(), WorkbenchResultsBar(), WorkbenchResultsBarProps, WorkbenchResultsTag, EnvironmentsPageWorkbenchResultsBarContent(), EnvironmentsPageWorkbenchResultsBarContentProps, SecurityPage(), ProjectManagementConsoleRegistryWorkbenchResultsBarContent() (+34 more)

### Community 38 - "WorkerGroup"
Cohesion: 0.10
Nodes (23): addDeliveryBudget(), callDeliveryLeaseExtension(), callDeliverySettlement(), defaultDeliveryRetryConfig(), deliveryBackoff(), deliveryLeaseExtensionEnabled(), Client, Delivery (+15 more)

### Community 39 - "overview.ts"
Cohesion: 0.24
Nodes (13): buildActivitySignals(), buildAlertSignals(), buildManagementOverview(), countByStatus(), createSummaryDraft(), findHottestServer(), healthScore(), highSeverityThresholds (+5 more)

### Community 40 - "evidence-manifest.mjs"
Cohesion: 0.05
Nodes (40): benchmarkArtifactPaths, benchmarkArtifactsComplete, benchmarkFiles, benchmarkStatusArtifact, collectEvidence(), defaultOutput, describeFile(), describeInput() (+32 more)

### Community 41 - "testing.T"
Cohesion: 0.08
Nodes (53): boolValue(), csvValues(), durationValue(), floatValue(), Config, intValue(), Load(), millisecondDurationValue() (+45 more)

### Community 42 - "transport_benchmark_test.go"
Cohesion: 0.07
Nodes (53): BenchmarkReadiness(), BenchmarkMetricsMiddlewareParallel(), net/http.Client, net/http.Handler, sync/atomic.Int64, testing.B, testing.TB, BenchmarkProjectTransportTCP() (+45 more)

### Community 44 - "access-navigation.ts"
Cohesion: 0.06
Nodes (55): groupEntriesByStatus(), SecurityApiKeyResultsSection(), SecurityCredentialResults(), SecurityCredentialResultsProps, SecuritySessionResultsSection(), TranslationFn, SecurityCredentialCardBadgeActions(), toneFromCredentialStatus() (+47 more)

### Community 45 - "security_audit_chain.go"
Cohesion: 0.11
Nodes (30): auditChainDigest(), auditEventReasonTargetValid(), boundedAuditValue(), maxAuditEncryptionEnvelopeBytes(), newAuditChainVerifier(), NewEncryptedAuditWriter(), NewHashChainAuditSink(), TestEncryptedAuditWriterEncryptsAndSupportsKeyRotation() (+22 more)

### Community 46 - "TraceMiddlewareWithProvider"
Cohesion: 0.10
Nodes (26): fiber.Ctx, fiber.Handler, parseLevel(), requestContext(), RequestLogger(), responseBytes(), TestRequestLoggerSkipsConfiguredPaths(), TestResponseBytesDoesNotMaterializeStream() (+18 more)

### Community 47 - "apisnapshot/main.go"
Cohesion: 0.12
Nodes (35): semanticVersion, snapshot, addSymbol(), allowsBreakingChange(), collectDeclaration(), collectPackageSymbols(), collectSnapshot(), compareSemanticVersions() (+27 more)

### Community 48 - "idempotencyMiddleware"
Cohesion: 0.15
Nodes (21): atomicRateLimiter(), boundedConcurrency(), fiber.Ctx, fiber.Handler, fiber.Storage, idempotencyMiddleware(), rateLimiter(), rejectWhenDraining() (+13 more)

### Community 49 - "sqlclient/client_test.go"
Cohesion: 0.08
Nodes (37): New(), assertDatabaseSpanAttributes(), assertSpanExcludes(), consumeFailure(), Client, Config, newTracedClient(), openScriptedDatabase() (+29 more)

### Community 50 - "runtime.ts"
Cohesion: 0.17
Nodes (24): asRecord(), buildBackendRuntimeSummary(), buildProjectRuntimeSummary(), buildRuntimeSurfaceSummary(), formatCompactNumber(), formatIdentity(), formatRuntimeRole(), formatUptime() (+16 more)

### Community 51 - "oidc_client.go"
Cohesion: 0.17
Nodes (22): OIDCClientConfig, OIDCProviderMetadata, OIDCTokenResponse, TestCompleteOIDCCallbackConsumesStateAndBindsIDTokenNonce(), TestCompleteOIDCCallbackFailsClosedAndDoesNotLeakProviderErrors(), boundedToken(), containsString(), isJSONResponse() (+14 more)

### Community 52 - "Options"
Cohesion: 0.14
Nodes (27): AuthenticationEnabled(), fiber.Storage, fiber.StructValidator, Options, withDefaults(), RouteRegistrar, Commands(), Endpoints() (+19 more)

### Community 53 - "system-user-repository.ts"
Cohesion: 0.10
Nodes (44): localSystemAdapter, loginWithPassword(), readCookieValue(), resolveSessionFromRequest(), nowIso(), compareHash(), derivePassword(), hashPassword() (+36 more)

### Community 54 - "request-schemas.ts"
Cohesion: 0.08
Nodes (25): createSystemApiSchema, createSystemMenuSchema, createSystemRoleSchema, createSystemUserSchema, httpMethod, identifier, loginRequestSchema, longText (+17 more)

### Community 55 - "New"
Cohesion: 0.08
Nodes (35): applicationHeaders(), deadLetterID(), fromJetStreamMessage(), nats.Header, jetStreamControlHeader(), New(), nilInterface(), PreflightConsumer() (+27 more)

### Community 56 - "SessionManager"
Cohesion: 0.14
Nodes (22): sessionFamily, SessionManager, SessionStore, SessionConfig, hashRefreshToken(), newRefreshToken(), NewSessionManager(), hashForTest() (+14 more)

### Community 57 - "net.Conn"
Cohesion: 0.47
Nodes (4): net.Conn, net.Listener, connectionTrackingListener, writeBufferListener

### Community 58 - "oidc_browser_test.go"
Cohesion: 0.19
Nodes (25): completeOIDCBrowserSession(), fiber.App, jwt.Claims, newOIDCBrowserTestApp(), newOIDCBrowserTestAppWithSessionStore(), newOIDCBrowserTestProvider(), oidcBrowserCallback(), responseCookie() (+17 more)

### Community 59 - "NewMetrics"
Cohesion: 0.10
Nodes (33): NewMetrics(), TestMetricsMapsDeadlineToRequestTimeout(), TestMetricsRecordsBoundedHTTPConnectionLifecycle(), TestMetricsRecordsBoundedQueueWorkerLifecycle(), TestMetricsRecordsNormalizedRoute(), TestMetricsRenderAdmissionRejections(), TestMetricsRenderSecurityAuditSinkOutcomesWithFixedLabels(), TestMetricsRenderSecurityEventsWithFixedLabels() (+25 more)

### Community 60 - "gva-page-loading.ts"
Cohesion: 0.12
Nodes (35): GvaRouteLoadingEffects(), isInternalDashboardHref(), applyProgressVisual(), beginGvaContentLoading(), beginGvaRouteProgress(), clamp(), clearContentTimers(), clearFinishTimers() (+27 more)

### Community 61 - "LocaleCode"
Cohesion: 0.05
Nodes (61): SecurityApiKeyCardContent(), SecurityApiKeyCardContentProps, SecurityCredentialCardBadgeActionsProps, SecurityCredentialCardFooterLinkProps, SecurityCredentialCardProps, TranslationFn, SecurityApiKeyResultsSectionProps, SecurityCredentialStatusGroup (+53 more)

### Community 62 - "compilerOptions"
Cohesion: 0.06
Nodes (30): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+22 more)

### Community 63 - "transport-soak-report.mjs"
Cohesion: 0.08
Nodes (26): durations, evidenceRoot, fail(), measurements, median(), options, parseArguments(), parseMeasurements() (+18 more)

### Community 64 - "JWKSVerifier"
Cohesion: 0.07
Nodes (44): AuthorizationCode, AuthorizationRequest, AuthorizationRequestConfig, IDTokenClaims, jwk, JWKSConfig, jwksDocument, OIDCCallbackResult (+36 more)

### Community 65 - "FeedbackState"
Cohesion: 0.07
Nodes (48): EditorWorkspaceShellProps, FeedbackBanner(), FeedbackBannerProps, FeedbackState, RegistryWorkspaceShellProps, ResultsWorkspaceShell(), ResultsWorkspaceShellProps, EnvironmentsPageResultsContent() (+40 more)

### Community 66 - "tags-view.tsx"
Cohesion: 0.11
Nodes (35): captureTabRects(), computeInsertIndex(), emitStorage(), ensureTag(), getDropTargetLeft(), getReorderedLefts(), getServerSnapshot(), getTabShiftX() (+27 more)

### Community 67 - "system-api-sync.ts"
Cohesion: 0.08
Nodes (44): addOneSchema, applySyncSchema, httpMethod, ignoreSchema, POST(), syncItemSchema, syncMutationSchema, inventoryFilePath (+36 more)

### Community 68 - "New"
Cohesion: 0.15
Nodes (23): cloneTLSConfig(), New(), spanMethod(), onlyEndedSpan(), spanAttributes(), TestClientCreatesLowSensitivitySpanAndPropagatesW3CContext(), TestClientEnforcesResponseHeaderLimit(), TestClientNormalizesCustomMethodInSpan() (+15 more)

### Community 69 - "Redis"
Cohesion: 0.21
Nodes (9): decodeBrowserSessionPayload(), formatRedisMillis(), Redis, parseBrowserSessionMetadata(), validBrowserSessionDeviceName(), validBrowserSessionPublicID(), validBrowserSessionStoredSubject(), validSHA256Hex() (+1 more)

### Community 70 - "Redis"
Cohesion: 0.09
Nodes (29): applyRedisClientBudgets(), RateLimitResult, Redis, NewRedis(), newRedisClient(), redisFailure(), redisSentinelOptions(), TestRealRedisIntegration() (+21 more)

### Community 71 - "evidence-verify.mjs"
Cohesion: 0.15
Nodes (27): boundaryNames, boundaryStatuses, { count: artifactCount, paths: evidencePaths }, defaultManifest, document, evidenceCategories, fail(), hashFile() (+19 more)

### Community 72 - "README.md"
Cohesion: 0.09
Nodes (17): OpenAPI 兼容性政策, 有意破坏兼容性, 自动阻断, API consumer and SDK matrix, Health endpoint migration, Project OpenAPI contracts, Contract, GoExample Nginx Edge Baseline (+9 more)

### Community 73 - "GoExample 待优化 V9"
Cohesion: 0.07
Nodes (26): 10. 完成定义, 1. 本轮状态, 2. 优化原则, 3. 优先级总表, 4. P0 实施项, 5. P1 实施项, 6. P2 实施项, 7. 执行顺序与依赖 (+18 more)

### Community 74 - "security-filters.ts"
Cohesion: 0.06
Nodes (52): SecurityFiltersWorkbench(), SecurityFiltersWorkbenchProps, SecurityWorkbenchControlsProps, SecurityWorkbenchOption, SecurityFiltersWorkbenchFiltersContent(), SecurityFiltersWorkbenchFiltersContentProps, SecurityWorkbenchOption, SecurityFiltersWorkbenchResultsBarContent() (+44 more)

### Community 75 - "use-settings-panel-controller.ts"
Cohesion: 0.07
Nodes (50): SettingsPageProps, LocaleMode, SettingsPreferencesContent(), SettingsPreferencesContentProps, ThemeMode, SettingsHeroContentProps, SettingsPanelLowerContent(), SettingsPanelLowerContentProps (+42 more)

### Community 76 - "server-release.mjs"
Cohesion: 0.15
Nodes (25): artifactPath, assertExactKeys(), assertObject(), build(), checksumPath, fail(), git(), goCandidates (+17 more)

### Community 77 - "transport-benchmark-report.mjs"
Cohesion: 0.15
Nodes (23): assertStablePayload(), capacityMeasurements, compare(), evidenceRoot, fail(), groupExactRounds(), latencyMeasurements, median() (+15 more)

### Community 78 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 79 - "4. 本轮实施设计"
Cohesion: 0.08
Nodes (24): 1. 结论, 2. 扫描发现, 3. 优先级总表, 4. 本轮实施设计, 5. 后续实施细节, 6. 评分规则, 7. 本轮评分变化, GoExample 待优化 V11（非 MSFront） (+16 more)

### Community 80 - "RunHTTP"
Cohesion: 0.29
Nodes (12): callApplicationShutdown(), defaultHTTPOptions(), isExpectedHTTPServerClose(), notifyHTTPConnectionCapacity(), notifyHTTPConnectionState(), RunHTTP(), shutdownHTTP(), TestRunHTTPReturnsListenErrorBeforeStartedLog() (+4 more)

### Community 81 - "go-project.mjs"
Cohesion: 0.08
Nodes (23): buildTime, commandIsAvailable(), currentDirectory, findWindowsGcc(), frameworkAPIArguments, frameworkAPIBaselineRef, frameworkRoot, gitCommitResult (+15 more)

### Community 82 - "nginx-edge-contract.mjs"
Cohesion: 0.12
Nodes (24): artifactDirectory, beginInterruptedUpload(), certificatePath, commandError(), configPath, contract, contractPath, deploymentDirectory (+16 more)

### Community 83 - "New"
Cohesion: 0.17
Nodes (15): New(), TestCanceledCallerDoesNotCancelSharedRefresh(), TestReadinessCachesAndCopiesReports(), TestReadinessChecksAndDraining(), TestReadinessCheckTimeout(), TestReadinessMergesConcurrentRefreshes(), TestRegisterDuringRefreshInvalidatesResult(), TestRegisterRejectsInvalidChecks() (+7 more)

### Community 84 - "api-contracts/package.json"
Cohesion: 0.08
Nodes (23): openapi-typescript, dist, openapi, description, devDependencies, openapi-typescript, typescript, engines (+15 more)

### Community 85 - "server-recovery-drill.mjs"
Cohesion: 0.08
Nodes (19): args, environment, gitCommitResult, goCacheRoot, goCandidates, goTemporaryRoot, goVersionResult, outputRoot (+11 more)

### Community 86 - "topbar.tsx"
Cohesion: 0.15
Nodes (12): GvaMorphButton(), GvaMorphButtonProps, GvaSettingDrawerProps, BREADCRUMB_FALLBACKS, buildBreadcrumbs(), findMenuTitleChain(), Topbar(), clearCloseTimer() (+4 more)

### Community 87 - "kubernetes-manifest.mjs"
Cohesion: 0.22
Nodes (22): defaultOutput, defaultTemplate, fail(), integerAtLeast(), isWithin(), main(), parseArguments(), parseSeconds() (+14 more)

### Community 89 - "redis_test.go"
Cohesion: 0.18
Nodes (20): newRedisAuthorizationRequestManager(), TestRedisAuthorizationRequestStoreConsumesAcrossClientsExactlyOnce(), TestRedisAuthorizationRequestStoreEnforcesGlobalLimitExpiryTamperAndOutage(), encodeRedisSpan(), miniredis.Miniredis, Redis, isFixedRedisStatus(), newRedisTestTracerProvider() (+12 more)

### Community 90 - "application_query.go"
Cohesion: 0.17
Nodes (19): applicationBindingAlias(), applicationQueryMethod(), applicationQueryRoutesOverlap(), bindApplicationQuery(), defaultApplicationRoutePaths(), fiber.Ctx, fiber.StructValidator, newTypedQuery() (+11 more)

### Community 91 - "environment.mjs"
Cohesion: 0.18
Nodes (18): currentDirectory, findGo(), frontRoot, goArchive(), goModuleRoots(), goVersion(), installGo(), main() (+10 more)

### Community 92 - "postgres-recovery-report.mjs"
Cohesion: 0.12
Nodes (18): backupSha256, completedAt, durationMs, evidenceRoot, fail(), live, options, parseArguments() (+10 more)

### Community 93 - "redis-sentinel-contract.mjs"
Cohesion: 0.12
Nodes (17): archive(), artifactDirectory, cleanup(), containers, contractOutput, dataCLI(), delay(), ports (+9 more)

### Community 94 - "3. P0 实施项"
Cohesion: 0.10
Nodes (20): 1. 当前状态, 2. 优先级总表, 3. P0 实施项, 4. P1 实施项, 5. P2 实施项, 6. 推荐执行顺序, 7. 评分关闭规则, GoExample 待优化 V10 (+12 more)

### Community 95 - "3. 达到 10 分仍需完成"
Cohesion: 0.10
Nodes (20): 1. 状态定义, 2. 本轮实施项, 3. 达到 10 分仍需完成, 4. 满分验收规则, V4-01 Go 工具链下载完整性, V4-02 Go 构建可追溯性与本地执行稳定性, V4-03 MSFront JSON 存储完整性, V4-04 密码哈希升级与兼容迁移 (+12 more)

### Community 96 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, @eslint/eslintrc, devDependencies, eslint, @eslint/eslintrc, postcss, tailwindcss, @types/node (+13 more)

### Community 97 - "registerOIDCBrowserRoutes"
Cohesion: 0.24
Nodes (14): browserRequestContext(), clearBrowserSessionCookies(), clearOIDCStateCookie(), fiber.Ctx, fiber.Handler, fiber.Router, Options, oidcStateBinding() (+6 more)

### Community 98 - "Client"
Cohesion: 0.20
Nodes (16): classifyResult(), finishSpan(), Client, Message, isTraceHeader(), removeTraceHeaders(), traceCarrier(), validateConfig() (+8 more)

### Community 99 - "go.opentelemetry.io/otel/sdk/trace.ReadOnlySpan"
Cohesion: 0.19
Nodes (19): assertMessagingResult(), assertMessagingSpan(), assertSpanExcludes(), Client, Config, newTracedClient(), spanAttribute(), TestCallbackPanicEndsSpanAndIsRethrown() (+11 more)

### Community 100 - "run"
Cohesion: 0.20
Nodes (16): NewAuthorizationRequestManager(), TestAuthorizationRequestManagerBuildsSingleUsePKCERequest(), TestAuthorizationRequestManagerExpiresAndBoundsPendingState(), TestAuthorizationRequestStoreSharesHashOnlyStateAcrossManagers(), TestNewAuthorizationRequestManagerRejectsUnsafeConfiguration(), main(), redisTLSConfig(), run() (+8 more)

### Community 101 - "postgres-recovery-contract.mjs"
Cohesion: 0.12
Nodes (17): archive(), args, artifactDirectory, backupHostPath, checkpoint(), contract, contractOutput, dockerExec() (+9 more)

### Community 102 - "1. 本轮已完成"
Cohesion: 0.10
Nodes (19): 1. 本轮已完成, 2. 本轮验证结果, 3. 仍需完成, 4. 评分影响, 5. 进入 V7 的准入条件, V6-01 PostgreSQL 初始 schema, V6-02 事务型 migration runner, V6-03 PostgreSQL 连接池边界 (+11 more)

### Community 103 - "metrics.go"
Cohesion: 0.17
Nodes (11): formatDurationBucket(), fiber.Ctx, responseStatus(), routePath(), securityLabelIndex(), writeRuntimeMetrics(), strings.Builder, sync/atomic.Uint64 (+3 more)

### Community 104 - "sidebar.tsx"
Cohesion: 0.19
Nodes (18): collectActiveAncestorIds(), collectAllBranchIds(), collectSubtreeIds(), findMenuPathById(), hasActiveDescendant(), isPathActive(), menuIndent(), MenuNode() (+10 more)

### Community 105 - "dependencies"
Cohesion: 0.11
Nodes (19): clsx, dotenv, jose, lucide-react, dependencies, clsx, dotenv, jose (+11 more)

### Community 106 - "2. 已完成优化"
Cohesion: 0.11
Nodes (18): 1. 本轮目标, 2. 已完成优化, 3. 本地验收结果, 4. 未纳入本轮的剩余优化, 5. V9 建议顺序, 6. 完成定义, P0：生产可观测性闭环, P0：真实数据与恢复证据 (+10 more)

### Community 107 - "6. 全量优缺点"
Cohesion: 0.11
Nodes (19): 6.10 可观测性与 SRE：9.95, 6.11 数据一致性与持久化：9.6, 6.12 前端架构、性能与可访问性：9.2, 6.13 测试与质量工程：9.95, 6.14 CI、安全与供应链：9.7, 6.15 部署、多实例与弹性：8.3, 6.16 韧性、故障与恢复：9.2, 6.17 开发体验与文档治理：9.95 (+11 more)

### Community 108 - "jwks_test.go"
Cohesion: 0.33
Nodes (18): generateRSAKey(), jwkMap(), jwksJSON(), mutateOIDCClaims(), newJWKSServer(), newTestJWKSVerifier(), oidcTestClaims(), signIDToken() (+10 more)

### Community 109 - "sync.Once"
Cohesion: 0.18
Nodes (6): classifyError(), io.ReadCloser, sync.Once, spanBody, clusterRouteProxyConnection, signalingDeliveryObserver

### Community 110 - "idempotency_fingerprint.go"
Cohesion: 0.27
Nodes (11): fingerprintLifetime(), fiber.Ctx, fiber.Storage, idempotencyPrincipal(), idempotencyRequestFingerprint(), newIdempotencyFingerprintRegistry(), normalizedMediaType(), writeFingerprintPart() (+3 more)

### Community 111 - "useProjectManagementConsoleController"
Cohesion: 0.09
Nodes (30): ManagedProjectCatalogEntry, ManagedProjectSummary, createEmptyDraft(), selectManagedProject(), shouldPushProjectsHistory(), toDraft(), upsertProject(), useProjectManagementConsoleController() (+22 more)

### Community 112 - "Claims"
Cohesion: 0.16
Nodes (10): Config, Claims, Service, TokenVerifier, User, jwt.RegisteredClaims, randomID(), validClaims() (+2 more)

### Community 113 - "1. 本轮已完成"
Cohesion: 0.11
Nodes (17): 1. 本轮已完成, 2. 本轮验证结果, 3. 仍需完成, 4. 评分影响, 5. 进入 V8 的准入条件, V7-01 PostgreSQL CI service integration, V7-02 migration 并发、幂等与约束集成测试, V7-03 OpenAPI 引用与 security 完整性 (+9 more)

### Community 114 - "NewService"
Cohesion: 0.15
Nodes (18): NewService(), newTestService(), TestDisabledService(), TestServiceIssueAndVerify(), TestServiceRejectsCredentialsAndExpiredToken(), TestServiceRejectsMalformedAndOverageClaims(), TestExternalTokenVerifierFailureUsesPrivateBearerResponse(), TestExternalTokenVerifierProtectsRoutesWithoutDemoLogin() (+10 more)

### Community 115 - "gva-message.ts"
Cohesion: 0.17
Nodes (18): GvaMessageCard(), GvaMessageHost(), clearTimer(), closeGvaMessage(), closeTimers, emit(), getGvaMessages(), getGvaMessageTops() (+10 more)

### Community 116 - "nginx-edge.mjs"
Cohesion: 0.24
Nodes (17): defaultContract, defaultOutput, fail(), isWithin(), kibibytes(), main(), mebibytes(), parseArguments() (+9 more)

### Community 117 - "GvaSettingDrawer"
Cohesion: 0.19
Nodes (10): ColorSwatch(), onKey(), placePopover(), toggleOpen(), GvaSettingDrawer(), patch(), resetConfig(), scheduleSaveToast() (+2 more)

### Community 118 - "2. 优化清单"
Cohesion: 0.12
Nodes (16): 1. 完成定义, 2. 优化清单, 3. 验证记录, 4. 尚未完成：达到 10 分所需工作, 5. V3 结论, V3-01 Framework 与多项目边界, V3-02 Framework 扩展点与生命周期, V3-03 配置与 HTTP 语义加固 (+8 more)

### Community 119 - "success"
Cohesion: 0.20
Nodes (14): concurrentMutation(), fiber.App, miniredis.Miniredis, newHTTPTestRedis(), TestRedisIdempotencyIsCoordinatedAcrossApplications(), TestRedisRateLimitIsAtomicAcrossApplications(), success(), contains() (+6 more)

### Community 120 - "snapshot_integration_test.go"
Cohesion: 0.24
Nodes (15): deterministicSnapshotPayload(), nats.Conn, newSnapshotContractClient(), requireJetStreamAPIResponse(), restoreStreamSnapshot(), takeStreamSnapshot(), TestRealNATSJetStreamSnapshotRestoreRecovery(), verifySnapshotArchive() (+7 more)

### Community 122 - "migrate.mjs"
Cohesion: 0.15
Nodes (11): allowedArguments, argumentsSet, databaseUrl, frontRoot, migrationsDirectory, pool, scriptDirectory, workspaceRoot (+3 more)

### Community 123 - "theme-provider.tsx"
Cohesion: 0.19
Nodes (13): metadata, siteConfig, ProjectStorageDriver, ThemeMode, themeClassMap, UseSettingsPanelSurfaceControllerOptions, AppProviders(), applyTheme() (+5 more)

### Community 124 - "users-page-editor-permissions-content.tsx"
Cohesion: 0.08
Nodes (29): AccessCustomInputField(), AccessCustomInputFieldProps, AccessSelectionGrid(), AccessSelectionGridProps, AccessSelectionOptionCard(), AccessSelectionOptionCardProps, EditorSection(), EditorSectionProps (+21 more)

### Community 125 - "TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler"
Cohesion: 0.31
Nodes (10): AuthorizerFunc, Options, resourceAuthorizationToken(), TestResourceAuthorizationConfigurationFailsAtStartup(), TestResourceAuthorizedCommandDoesNotPolluteIdempotencyOnDeny(), TestResourceAuthorizedQueryChecksRolesAndResourceShapeBeforePolicy(), TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler(), TestResourceAuthorizedVersionedCommandChecksPolicyBeforePrecondition() (+2 more)

### Community 126 - "1. 本轮完成项"
Cohesion: 0.13
Nodes (14): 1. 本轮完成项, 2. 仍需完成, 3. 验证结果, 4. 评分影响, V5-01 Route Handler 运行时输入契约, V5-02 API 内部错误脱敏, V5-03 路由失败、加载与 404 状态, V5-04 MSFront 响应安全头 (+6 more)

### Community 127 - "fakeMessage"
Cohesion: 0.15
Nodes (3): nats.Header, github.com/nats-io/nats.go/jetstream.MsgMetadata, fakeMessage

### Community 128 - "api-inventory-parser.ts"
Cohesion: 0.22
Nodes (10): classifyArea(), httpMethods, isRecord(), normalizeSecurityRequirements(), normalizeSecuritySchemes(), optionalString(), parseApiInventoryDocument(), uniquePaths() (+2 more)

### Community 129 - "msfront-route-authorization.mjs"
Cohesion: 0.15
Nodes (12): apiRoot, callsAccessGuard(), visit(), callsRawRequestJson(), visit(), failures, frontRoot, httpMethods (+4 more)

### Community 130 - "2. 优化清单"
Cohesion: 0.14
Nodes (13): 1. V1 完成定义, 2. 优化清单, 3. V1 不做项, 4. 验证记录, GoServer 待优化 V1, V1-01 统一时间预算并优化请求 deadline, V1-02 优化指标并发热路径和延迟模型, V1-03 readiness 缓存与并发合并 (+5 more)

### Community 131 - "2. 优化清单"
Cohesion: 0.14
Nodes (13): 1. 完成定义, 2. 优化清单, 3. 延后项, 4. 验证记录, GoServer 待优化 V2, V2-01 健康检查刷新与 goroutine 收敛, V2-02 基础设施端点响应策略, V2-03 补充 Go runtime metrics (+5 more)

### Community 132 - "GoExample 项目架构与性能评估（V12）"
Cohesion: 0.14
Nodes (13): 1. 执行结论, 2.1 已实测, 2.2 仅有代码或静态配置, 2.3 不得据此宣称完成, 2. 证据边界, 3. 项目结构扫描, 4. 官方与社区基线, 5. 详细分项评分 (+5 more)

### Community 133 - "Checker"
Cohesion: 0.32
Nodes (6): canceledReport(), cloneReport(), drainingReport(), Checker, Check, Report

### Community 134 - "finishRedisSpan"
Cohesion: 0.25
Nodes (9): TestRedisTraceClassificationIsBounded(), boundedRedisPipelineSize(), classifyRedisTraceResult(), finishRedisSpan(), redisSpanOperation(), redis.DialHook, redis.ProcessHook, redis.ProcessPipelineHook (+1 more)

### Community 135 - "AccessManagementView"
Cohesion: 0.07
Nodes (41): RolesPageProps, AccessManagementView, UseRolesPageBridgeControllerOptions, UseRolesPageEditorControllerOptions, refreshAccessManagement(), selectManagedUser(), TranslationFn, useUsersPageBridgeController() (+33 more)

### Community 136 - "net/http.ConnState"
Cohesion: 0.24
Nodes (5): decrementNonnegative(), httpConnectionStateIndex(), net/http.ConnState, panicHTTPConnectionObserver, recordingHTTPConnectionObserver

### Community 137 - "use-security-governance-surface-presentation-controller.ts"
Cohesion: 0.08
Nodes (38): AttentionCard(), TonePill(), toneValueFromManagementTone(), SecurityEmptyState(), SecurityEmptyStateProps, SecurityGovernanceOverviewPanelShell(), SecurityGovernanceOverviewPanelShellProps, SecurityPermissionResultsSection() (+30 more)

### Community 138 - "http_test.go"
Cohesion: 0.44
Nodes (10): containsHTTPConnectionState(), reserveHTTPAddress(), TestRunHTTPBoundsAcceptedConnections(), TestRunHTTPBoundsApplicationShutdownHook(), TestRunHTTPBoundsSlowRequestHeaders(), TestRunHTTPForcesBoundedShutdown(), TestRunHTTPIsolatesApplicationShutdownPanic(), TestRunHTTPIsolatesConnectionObserverPanic() (+2 more)

### Community 139 - "time.Time"
Cohesion: 0.12
Nodes (12): testAuthorizationRequestStore, testBrowserSessionStore, BrowserSessionRecord, AuthorizationRequestRecord, Redis, validAuthorizationRequestSecret(), time.Time, oidcBrowserLegacySessionStore (+4 more)

### Community 140 - "authorization/authorization.go"
Cohesion: 0.38
Nodes (8): Principal, boundedValue(), optionalBoundedValue(), TestValidateRequestAcceptsBoundedTenantResourceAndAttributes(), TestValidateRequestRejectsUnboundedOrMalformedInput(), validRequest(), ValidateRequest(), validIdentifier()

### Community 141 - "Framework"
Cohesion: 0.17
Nodes (12): API 生命周期, Bearer 验证, Framework, 关系数据库, 兼容治理, 出站 HTTP, 包, 可观测性 (+4 more)

### Community 142 - "requireInternalToken"
Cohesion: 0.32
Nodes (7): fiber.App, fiber.Ctx, fiber.Handler, Options, noStore(), registerDiagnostics(), requireInternalToken()

### Community 143 - "New"
Cohesion: 0.32
Nodes (5): Message(), New(), TestValidateAndMessage(), StructValidator, validator.Validate

### Community 144 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, lint, lint:fix, migrate, start, test (+4 more)

### Community 145 - "GoExample 待优化清单（V12）"
Cohesion: 0.18
Nodes (10): 1. 本轮结论, 2. 评分表, 3. 已完成与证据, 4. 全量优缺点扫描, 5. V12 待实施项, 6. 门禁与评分规则, 7. 复核命令, GoExample 待优化清单（V12） (+2 more)

### Community 146 - "newTestBrowserSessionManager"
Cohesion: 0.45
Nodes (10): NewBrowserSessionManager(), newTestBrowserSessionManager(), TestBrowserSessionCapsLifetimeBindsCSRFAndCopiesClaims(), testBrowserSessionClaims(), TestBrowserSessionDeviceNameLocalUpdateClearAndValidation(), TestBrowserSessionInventoryEnforcesSubjectLimitAndScopesRevocation(), TestBrowserSessionLegacyStoreKeepsStartCompatibilityWithoutInventory(), TestBrowserSessionLimitEndAndInputValidation() (+2 more)

### Community 147 - "openRealPostgresClient"
Cohesion: 0.42
Nodes (9): createRealPostgresCounterTable(), Client, Config, openRealPostgresClient(), TestRealPostgresLockWaitHonorsDeadlineAndRecovers(), TestRealPostgresRetryTransactionDeadlock(), TestRealPostgresRetryTransactionSerializationConflict(), TestRealPostgresVersionedHTTPPrecondition() (+1 more)

### Community 149 - "registerRoutes"
Cohesion: 0.13
Nodes (16): DefaultEndpoints(), DefaultEndpointsForAuth(), fiber.App, fiber.Router, Options, deprecatedEndpoint(), fiber.App, fiber.Handler (+8 more)

### Community 150 - "package.json"
Cohesion: 0.18
Nodes (10): dependencies, @simple-prism/core, engines, node, name, packageManager, private, type (+2 more)

### Community 151 - "GoExample Server Threat Model"
Cohesion: 0.20
Nodes (9): 1. Purpose And Evidence Boundary, 2. Assets And Data Classification, 3. Trust Boundaries And Data Flow, 4. STRIDE Threat Register, 5. Security Invariants, 6. Open Production Risks, 7. Review Triggers And Ownership, 8. References (+1 more)

### Community 152 - "NewResourceAuthorizer"
Cohesion: 0.47
Nodes (4): NewResourceAuthorizer(), TestResourceAuthorizerEnforcesTenantActionAndEnvironment(), TestResourceAuthorizerHonorsCancellation(), ResourceAuthorizer

### Community 153 - "newRedisBrowserSessionManagerWithSubjectLimit"
Cohesion: 0.49
Nodes (9): newRedisBrowserSessionManager(), newRedisBrowserSessionManagerWithSubjectLimit(), redisBrowserClaims(), TestRedisBrowserSessionDeviceNameUpdateIsAtomicAndPreservesSession(), TestRedisBrowserSessionInventoryCrossClientLimitsAndScopesRevocation(), TestRedisBrowserSessionInventoryRejectsTamperAndOutage(), TestRedisBrowserSessionStoreEnforcesLimitExpiryAndOutage(), TestRedisBrowserSessionStoreSharesAndRevokesHashOnlySession() (+1 more)

### Community 154 - "reference-dashboard.tsx"
Cohesion: 0.20
Nodes (6): externalLinks, metrics, plugins, quickLinks, ReferenceDashboard(), updates

### Community 155 - "database-migration.mjs"
Cohesion: 0.20
Nodes (7): databaseUrl, migrationScript, pg, pool, repositoryRoot, requireFromMSFront, testDirectory

### Community 156 - "kubernetes-manifest.test.mjs"
Cohesion: 0.20
Nodes (7): deploymentTempRoot, oidcArguments, repositoryRoot, scriptPath, templatePath, tempRoot, testDirectory

### Community 157 - "postgres-recovery-report.test.mjs"
Cohesion: 0.20
Nodes (7): evidenceRoot, fixtureRoot, liveDigest, repositoryRoot, scriptPath, snapshotDigest, testDirectory

### Community 158 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 159 - "GoExample Server Security Audit Events"
Cohesion: 0.22
Nodes (8): 1. Contract, 2. Event Catalog, 3.1 Local Hash-Chain Adapter, 3. Sink Delivery Contract, 4. Metrics And Alert, 5. Operating Procedure, 6. Evidence And Residual Boundary, GoExample Server Security Audit Events

### Community 160 - "newRedisSentinelIntegrationClient"
Cohesion: 0.36
Nodes (8): Redis, newRedisSentinelIntegrationClient(), requiredRedisSentinelTestEnvironment(), splitRedisSentinelTestAddresses(), TestRedisSentinelFailoverReconnectsSharedStateClients(), waitForRedisSentinelClients(), waitForRedisSentinelMasterChange(), redis.SentinelClient

### Community 161 - "Q: graphify-out中的cache有必要上传仓库吗"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: graphify-out中的cache有必要上传仓库吗, Source Nodes

### Community 162 - "GoExample"
Cohesion: 0.22
Nodes (9): API 与供应链契约, Docker, GoExample, 启动, 安装, 文档, 根目录命令, 环境要求 (+1 more)

### Community 163 - "transport-benchmark-report.test.mjs"
Cohesion: 0.22
Nodes (6): benchmarkRoot, repositoryRoot, scriptPath, testDirectory, testFixtureRoot, workloads

### Community 164 - "MSFront/package.json"
Cohesion: 0.25
Nodes (7): engines, node, name, packageManager, private, type, version

### Community 165 - "Example"
Cohesion: 0.25
Nodes (8): Docker, Example, 健康检查与停机, 启动与检查, 接口, 结构, 能力, 配置与安全边界

### Community 166 - "e2e-msfront.mjs"
Cohesion: 0.32
Nodes (7): currentDirectory, firstAccessiblePath(), playwrightCli, repositoryRoot, resolveLocalBrowser(), run(), sourceDataDirectory

### Community 167 - "nginx-edge.test.mjs"
Cohesion: 0.25
Nodes (6): contractPath, deploymentRoot, repositoryRoot, scriptPath, tempRoot, testDirectory

### Community 168 - "devDependencies"
Cohesion: 0.29
Nodes (7): @axe-core/playwright, devDependencies, @axe-core/playwright, playwright-core, @playwright/test, playwright-core, @playwright/test

### Community 169 - "ADR 0001：Example HTTP transport 选择与测量门槛"
Cohesion: 0.29
Nodes (6): ADR 0001：Example HTTP transport 选择与测量门槛, 决策门槛, 固定工作负载, 当前实现与命令, 结果与复评, 背景

### Community 173 - "msfront.mjs"
Cohesion: 0.29
Nodes (6): child, currentDirectory, forwardArguments, frontRoot, repositoryRoot, scriptTasks

### Community 174 - "Changelog"
Cohesion: 0.29
Nodes (6): 1.0.0 - 2026-08-21, 1.1.0 - 2026-08-24, 1.2.0 - 2026-08-24, 1.3.0 - 2026-08-24, 1.4.0 - 2026-08-24, Changelog

### Community 175 - "API Contracts"
Cohesion: 0.29
Nodes (5): NestJS integration, Server rules, API Contracts, Ownership, Update workflow

### Community 176 - "server-release.test.mjs"
Cohesion: 0.29
Nodes (5): releaseRoot, releaseRootRelative, repositoryRoot, scriptPath, testDirectory

### Community 177 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 178 - "ADR 0002：HTTP 请求生命周期与协议边界"
Cohesion: 0.33
Nodes (5): ADR 0002：HTTP 请求生命周期与协议边界, 决策, 已验证行为, 未完成项, 超时预算

### Community 179 - "GoExample SLO and Alerts"
Cohesion: 0.33
Nodes (5): Evidence boundary, GoExample SLO and Alerts, Objectives, Operating procedure, Rules

### Community 180 - "Server Failure Matrix And Local Recovery Drill"
Cohesion: 0.33
Nodes (5): Artifact Contract, Executable Matrix, Production Completion Criteria, Purpose And Evidence Boundary, Server Failure Matrix And Local Recovery Drill

### Community 181 - "MSFront"
Cohesion: 0.33
Nodes (5): MSFront, 启动, 检查, 环境变量, 目录

### Community 182 - "Unreleased"
Cohesion: 0.40
Nodes (4): Added, Changed, Framework changelog, Unreleased

### Community 184 - "validate-openapi.mjs"
Cohesion: 0.40
Nodes (4): document, errors, openApiPath, rootDir

### Community 185 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 186 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 187 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 190 - "github.com/zbxing/goexample/Framework"
Cohesion: 0.50
Nodes (4): github.com/zbxing/goexample/Framework, github.com/zbxing/goexample/Proj/Example, github.com/zbxing/goexample/SDK/GoExample, github.com/zbxing/goexample/support/consumer/HealthProbe

## Knowledge Gaps
- **1165 isolated node(s):** `applicationCommandRequestContextKey`, `applicationPreconditionContextKey`, `resourceQueryRequest`, `resourceCommandRequest`, `authClaimsKey` (+1160 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Known dead ends** — questions that led nowhere; don't re-derive.
- "graphify-out中的cache有必要上传仓库吗" -> `graphify`, `cacheRoot()`

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useLocale()` connect `useLocale` to `formatNumber`, `governance-filters.ts`, `FeedbackState`, `use-project-management-console-presentation-controller.ts`, `use-environments-page-controller.ts`, `types/management.ts`, `use-project-detail-page-surface-controller.ts`, `access-navigation.ts`, `AccessManagedRoleEntry`, `use-settings-panel-controller.ts`, `use-command-palette-controller.ts`, `project-surface.tsx`, `access-governance-surface.tsx`, `users-page-editor-permissions-content.tsx`, `LocaleCode`, `AccessManagedUserEntry`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `LocaleCode` connect `LocaleCode` to `formatNumber`, `governance-filters.ts`, `use-project-management-console-presentation-controller.ts`, `types/management.ts`, `use-roles-page-surface-controller.ts`, `useLocale`, `AccessManagementView`, `use-security-governance-surface-presentation-controller.ts`, `use-project-detail-page-surface-controller.ts`, `use-roles-page-bridge-controller.ts`, `use-users-page-editor-presentation-controller.ts`, `AccessManagedUserEntry`, `use-environments-page-controller.ts`, `access-navigation.ts`, `runtime.ts`, `FeedbackState`, `security-filters.ts`, `use-settings-panel-controller.ts`, `theme-provider.tsx`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `ProjectStatus` connect `governance-filters.ts` to `formatNumber`, `FeedbackState`, `use-project-management-console-presentation-controller.ts`, `types/management.ts`, `use-environments-page-controller.ts`, `useLocale`, `overview.ts`, `project-surface.tsx`, `api/management.ts`, `project-repository.ts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `applicationCommandRequestContextKey`, `applicationPreconditionContextKey`, `resourceQueryRequest` to the rest of the system?**
  _1165 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `formatNumber` be split into smaller, more focused modules?**
  _Cohesion score 0.045787545787545784 - nodes in this community are weakly interconnected._
- **Should `governance-filters.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.060781786941580755 - nodes in this community are weakly interconnected._
- **Should `New` be split into smaller, more focused modules?**
  _Cohesion score 0.06098901098901099 - nodes in this community are weakly interconnected._