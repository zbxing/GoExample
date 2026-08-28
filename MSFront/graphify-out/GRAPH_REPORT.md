# Graph Report - MSFront  (2026-08-28)

## Corpus Check
- 426 files · ~133,177 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2665 nodes · 7978 edges · 123 communities (108 shown, 15 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 158 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `46fa0344`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- useLocale
- governance-filters.ts
- ga-setting-drawer.tsx
- types/management.ts
- apiFetch
- use-security-governance-surface-presentation-controller.ts
- use-roles-page-bridge-controller.ts
- system.ts
- api/management.ts
- LocaleCode
- project-repository.ts
- access-governance-surface.tsx
- access-management-repository.ts
- use-services-page-controller.ts
- security-filters.ts
- AccessManagedRoleEntry
- requireApiAccess
- AccessManagedUserEntry
- use-environments-page-controller.ts
- access-navigation.ts
- tags-view.tsx
- readJsonBody
- ga-page-loading.ts
- use-users-page-editor-presentation-controller.ts
- system-apis-page.tsx
- ManagedProject
- formatDateTime
- admin-primitives.tsx
- security-credential-results-sections-content.tsx
- formatNumber
- gva-feature-placeholder-page.tsx
- use-users-page-bridge-controller.ts
- auth-token.ts
- compilerOptions
- dashboard-shell.tsx
- use-project-management-console-controller.ts
- use-users-page-surface-controller.ts
- FeedbackState
- security-repository.ts
- system-menus-page.tsx
- request-schemas.ts
- security-filters-workbench-content.tsx
- users-page-editor-permissions-content.tsx
- use-integrations-page-controller.ts
- topbar.tsx
- runtime.ts
- use-portfolio-grid-controller.ts
- WorkspaceSettingsSummary
- ga-message.ts
- system-user-repository.ts
- projects-registry-page.tsx
- proxy.ts
- devDependencies
- system-api-sync.ts
- use-dashboard-page-bridge-controller.ts
- dependencies
- useProjectManagementConsoleSurfaceController
- sidebar.tsx
- theme-provider.tsx
- use-dashboard-page-controller.tsx
- resolveIntegrationsFilterState
- shell-navigation.ts
- use-project-management-console-presentation-controller.ts
- migrate.mjs
- settings-panel-operations-content.tsx
- overview.ts
- api-inventory-parser.ts
- system-menu-repository.ts
- useGvaListLoad
- use-command-palette-controller.ts
- topbar-shell.tsx
- AccessManagementView
- management-primitives.tsx
- runtime-surface-panel.tsx
- status-badge.tsx
- useCommandPaletteController
- local-system-adapter.ts
- system-casbin-repository.ts
- use-settings-panel-controller.ts
- scripts
- project-endpoint-surface.tsx
- use-project-detail-page-surface-controller.ts
- project-management-console-editor-content.tsx
- json-store.ts
- project-provider.tsx
- useUsersPageController
- use-project-management-console-surface-controller.ts
- index.ts
- database.ts
- useSettingsPanelController
- use-settings-panel-runtime-surface-controller.ts
- access-control-config.ts
- sync/route.ts
- use-roles-page-content-surface-controller.ts
- package.json
- ColorSwatch
- buildAuthSessionUser
- MSFront
- login-page-content.tsx
- about-page.tsx
- SecurityCredentialRefreshWorkbench
- sidebar-navigation-content.tsx
- sidebar-summary-content.tsx
- AGENTS.md
- 0001_initial.sql
- database/README.md
- eslint.config.mjs
- eslint-config-next
- next-env.d.ts
- @types/react
- vitest
- postcss.config.mjs
- vitest.config.mts

## God Nodes (most connected - your core abstractions)
1. `useLocale()` - 157 edges
2. `LocaleCode` - 112 edges
3. `ProjectStatus` - 97 edges
4. `ProjectEnvironment` - 90 edges
5. `ManagedProject` - 83 edges
6. `formatNumber()` - 83 edges
7. `requireApiAccess()` - 68 edges
8. `AccessManagedUserEntry` - 61 edges
9. `AccessManagedRoleEntry` - 52 edges
10. `AccessNavigationContext` - 47 edges

## Surprising Connections (you probably didn't know these)
- `AdminTable()` --indirect_call--> `getGvaContentLoadingVisible()`  [INFERRED]
  MSFront/components/admin/admin-primitives.tsx → MSFront/lib/utils/ga-page-loading.ts
- `AdminTable()` --indirect_call--> `subscribeGvaPageLoading()`  [INFERRED]
  MSFront/components/admin/admin-primitives.tsx → MSFront/lib/utils/ga-page-loading.ts
- `SettingsSourceCardModel` --references--> `ManagementTone`  [EXTRACTED]
  MSFront/lib/utils/use-settings-panel-runtime-surface-controller.ts → MSFront/components/common/management-primitives.tsx
- `SettingsTonePillModel` --references--> `ManagementTone`  [EXTRACTED]
  MSFront/lib/utils/use-settings-panel-surface-controller.ts → MSFront/components/common/management-primitives.tsx
- `SecurityCredentialResultsProps` --references--> `LocaleCode`  [EXTRACTED]
  MSFront/components/common/security-credential-results-sections-content.tsx → MSFront/lib/types/management.ts

## Import Cycles
- None detected.

## Communities (123 total, 15 thin omitted)

### Community 0 - "useLocale"
Cohesion: 0.06
Nodes (49): SummaryCard(), OverviewSummarySection(), OverviewSummarySectionProps, ProjectCommandCenterSurface(), ProjectCommandCenterSurfaceProps, ProjectBadgeGroupProps, ProjectMetricItem, ProjectMetricListProps (+41 more)

### Community 1 - "governance-filters.ts"
Cohesion: 0.08
Nodes (58): PortfolioGridWorkbenchContent(), PortfolioGridWorkbenchContentProps, PortfolioGridWorkbenchSummary, TranslationFn, DashboardPageContentProps, EnvironmentsPage(), EnvironmentsPageProps, EnvironmentsPageWorkbenchContentProps (+50 more)

### Community 2 - "ga-setting-drawer.tsx"
Cohesion: 0.06
Nodes (47): LayoutModeCard(), MenuThemeSelector(), PresetCard(), PresetsPane(), applyPreset(), handleExport(), handleImport(), shadowOptions (+39 more)

### Community 3 - "types/management.ts"
Cohesion: 0.10
Nodes (44): IntegrationsPage(), IntegrationsPageProps, IntegrationsPageInventoryContent(), IntegrationsPageInventoryContentProps, IntegrationsPageInventoryOperationsContent(), IntegrationsPageInventoryWorkbenchContentProps, IntegrationsPageInventorySectionShell(), IntegrationsPageInventorySectionShellProps (+36 more)

### Community 4 - "apiFetch"
Cohesion: 0.05
Nodes (29): downloadText(), methodLabel(), SystemApisPage(), addOneSyncApi(), confirmBatchDelete(), confirmDelete(), downloadTemplate(), exportApis() (+21 more)

### Community 5 - "use-security-governance-surface-presentation-controller.ts"
Cohesion: 0.08
Nodes (43): SecurityPermissionResultsSection(), SecurityPermissionResultsSectionProps, SecurityRoleResultsSection(), SecurityRoleResultsSectionProps, Translate, SecurityHeroOverviewProps, SecurityOverviewPanel(), SecurityPostureOverviewProps (+35 more)

### Community 6 - "use-roles-page-bridge-controller.ts"
Cohesion: 0.08
Nodes (43): refreshAccessManagement(), TranslationFn, useRolesPageBridgeController(), createRoleDraft(), dedupeStrings(), RoleEditorDraft, selectManagedRole(), toDraft() (+35 more)

### Community 7 - "system.ts"
Cohesion: 0.08
Nodes (22): RoleTreeNode, fiberSystemAdapter, SystemAdapter, AuthSessionUser, CopySystemRoleInput, CreateSystemApiInput, CreateSystemMenuInput, CreateSystemRoleInput (+14 more)

### Community 8 - "api/management.ts"
Cohesion: 0.08
Nodes (40): DashboardRoute(), dynamic, dynamic, EnvironmentsRoute(), dynamic, IntegrationsRoute(), dynamic, ProjectDetailRoute() (+32 more)

### Community 9 - "LocaleCode"
Cohesion: 0.10
Nodes (40): SecurityApiKeyCardContentProps, SecurityApiKeyResultsSection(), SecurityApiKeyResultsSectionProps, SecuritySessionResultsSection(), SecuritySessionResultsSectionProps, SecurityCredentialRefreshWorkbenchProps, TranslationFn, SecurityCredentialWorkbench() (+32 more)

### Community 10 - "project-repository.ts"
Cohesion: 0.10
Nodes (48): clampInteger(), compareProjectSummaries(), createProject(), createProjectInDatabase(), deleteProject(), deleteProjectInDatabase(), getProjectById(), getProjectByIdFromDatabase() (+40 more)

### Community 11 - "access-governance-surface.tsx"
Cohesion: 0.11
Nodes (39): AccessCommandCenterSurfaceContent(), AccessCommandCenterSurfaceContentProps, AccessSurfaceMetricGridProps, SummaryCardProps, TonePillProps, AccessCommandCenterSurface(), AccessCommandCenterSurfaceProps, AccessCoverageCard() (+31 more)

### Community 12 - "access-management-repository.ts"
Cohesion: 0.14
Nodes (47): isValidRoleIdentifier(), normalizePermissionList(), ApiKeyRevokeRow, arraysEqual(), assertDatabaseIsConfigured(), buildAccessManagementSummary(), buildRoleCatalog(), collectPermissionsForRoles() (+39 more)

### Community 13 - "use-services-page-controller.ts"
Cohesion: 0.10
Nodes (36): ServicesPageResultsContentProps, ServicesPageLowerContent(), ServicesPageLowerContentProps, ServicesPageOverviewContentProps, ServicesPageResultsWorkspaceShell(), ServicesPageResultsWorkspaceShellProps, ServicesPage(), ServicesPageProps (+28 more)

### Community 14 - "security-filters.ts"
Cohesion: 0.10
Nodes (38): dynamic, SecurityRoute(), SecurityHeroOverview(), focusLabelFromFilter(), SecurityFiltersContextWorkbench(), SecurityFiltersContextWorkbenchProps, TranslationFn, SecurityPage() (+30 more)

### Community 15 - "AccessManagedRoleEntry"
Cohesion: 0.11
Nodes (33): RegistryWorkspaceShell(), RolesPageContentProps, RolesEditorActionsContent(), RolesEditorActionsContentProps, RolesEditorMembersContent(), RolesEditorMembersContentProps, RolesEditorPermissionsSectionModel, renderRolesProfileField() (+25 more)

### Community 16 - "requireApiAccess"
Cohesion: 0.16
Nodes (28): GET(), GET(), GET(), DELETE(), GET(), PUT(), GET(), POST() (+20 more)

### Community 17 - "AccessManagedUserEntry"
Cohesion: 0.12
Nodes (32): UsersPageContentProps, UsersEditorActionsContentProps, UsersPageLowerContent(), UsersPageLowerContentProps, UsersPageRegistryWorkbenchBulkActionsContent(), UsersPageRegistryWorkbenchBulkActionsContentProps, BulkSummaryModel, UsersRegistryWorkbenchContent() (+24 more)

### Community 18 - "use-environments-page-controller.ts"
Cohesion: 0.08
Nodes (32): ResultsWorkspaceShell(), WorkbenchResultsBar(), WorkbenchResultsBarProps, WorkbenchResultsTag, EnvironmentsPageResultsContent(), EnvironmentsPageLowerContent(), EnvironmentsPageLowerContentProps, EnvironmentsPageOverviewContent() (+24 more)

### Community 19 - "access-navigation.ts"
Cohesion: 0.10
Nodes (36): SecurityUserResultsTable(), RolesPageOverviewContent(), UsersPageOverviewContent(), buildRolesHref(), buildUsersHref(), normalizeAccessSearch(), resolveAccessRoleFilter(), resolveAccessRoleId() (+28 more)

### Community 20 - "tags-view.tsx"
Cohesion: 0.11
Nodes (37): captureTabRects(), computeInsertIndex(), emitStorage(), ensureTag(), getDropTargetLeft(), getReorderedLefts(), getServerSnapshot(), getTabShiftX() (+29 more)

### Community 21 - "readJsonBody"
Cohesion: 0.20
Nodes (30): DELETE(), GET(), POST(), PUT(), POST(), GET(), PUT(), GET() (+22 more)

### Community 22 - "ga-page-loading.ts"
Cohesion: 0.12
Nodes (35): GvaRouteLoadingEffects(), isInternalDashboardHref(), applyProgressVisual(), beginGvaContentLoading(), beginGvaRouteProgress(), clamp(), clearContentTimers(), clearFinishTimers() (+27 more)

### Community 23 - "use-users-page-editor-presentation-controller.ts"
Cohesion: 0.11
Nodes (32): ManagedUserUpdateInput, FrameworkUserStatus, TranslationFn, UserEditorDraft, TranslationFn, useUsersPageEditorPermissionsPresentationController(), UseUsersPageEditorPermissionsPresentationControllerOptions, TranslationFn (+24 more)

### Community 24 - "system-apis-page.tsx"
Cohesion: 0.11
Nodes (29): AdminCard(), AdminConfirmDialog(), onKeyDown(), AdminDialog(), AdminField(), AdminLinkButton(), AdminPage(), AdminSearchForm() (+21 more)

### Community 25 - "ManagedProject"
Cohesion: 0.13
Nodes (30): ProjectDetailPanelSection(), ProjectDetailPanelSectionProps, ProjectSpotlightCardContentProps, ProjectSpotlightCardProps, ProjectDetailActionsContent(), ProjectDetailActionsContentProps, ProjectDetailAttentionSection(), ProjectDetailPageContent() (+22 more)

### Community 26 - "formatDateTime"
Cohesion: 0.10
Nodes (32): ProjectMetricItem, ProjectsPageOverviewContentProps, formatDateTime(), formatPercent(), DashboardSpotlightCard, DashboardSummaryCard, TranslationFn, useDashboardPagePresentationController() (+24 more)

### Community 27 - "admin-primitives.tsx"
Cohesion: 0.10
Nodes (30): baseProps(), IconArrowDown(), IconArrowLeft(), IconArrowRight(), IconCompass(), IconCopy(), IconDelete(), IconDownload() (+22 more)

### Community 28 - "security-credential-results-sections-content.tsx"
Cohesion: 0.09
Nodes (27): SecurityApiKeyCardContent(), SecurityCredentialCardBadgeActionsProps, SecurityCredentialCardFooterLinkProps, SecurityCredentialCardProps, TranslationFn, groupEntriesByStatus(), SecurityCredentialResults(), SecurityCredentialResultsProps (+19 more)

### Community 29 - "formatNumber"
Cohesion: 0.15
Nodes (25): DetailPart, formatDecimal(), formatNumber(), buildRolesPageOverviewStats(), RolesPageOverviewStats, TranslationFn, useRolesPageCommandCenterSurfaceController(), TranslationFn (+17 more)

### Community 31 - "use-users-page-bridge-controller.ts"
Cohesion: 0.10
Nodes (26): UsersPageContent(), UsersPage(), refreshAccessManagement(), selectManagedUser(), TranslationFn, useUsersPageBridgeController(), dedupeStrings(), TranslationFn (+18 more)

### Community 32 - "auth-token.ts"
Cohesion: 0.14
Nodes (21): POST(), register(), buildAuthCookie(), getJwtSecret(), isBoundedNonEmptyString(), signAuthToken(), verifyAuthToken(), loginRequestSchema (+13 more)

### Community 33 - "compilerOptions"
Cohesion: 0.06
Nodes (30): dom, dom.iterable, es2022, .next/dev/types/**/*.ts, .next/dev/types/validator.ts, next-env.d.ts, .next/types/**/*.ts, .next/types/validator.ts (+22 more)

### Community 34 - "dashboard-shell.tsx"
Cohesion: 0.12
Nodes (21): BottomInfo(), DashboardShell(), handleShellSettingsChange(), onPointerDown(), Sidebar(), finishLeave(), GVA_LEAVE_DURATIONS, LeaveEndListener (+13 more)

### Community 35 - "use-project-management-console-controller.ts"
Cohesion: 0.13
Nodes (21): createEmptyDraft(), selectManagedProject(), shouldPushProjectsHistory(), toDraft(), TranslationFn, upsertProject(), useProjectManagementConsoleController(), clearProjectFilter() (+13 more)

### Community 36 - "use-users-page-surface-controller.ts"
Cohesion: 0.12
Nodes (23): buildUsersPageOverviewStats(), TranslationFn, UsersPageOverviewStats, useUsersPageCommandCenterSurfaceController(), UseUsersPageCommandCenterSurfaceControllerOptions, TranslationFn, useUsersPageCommandCenterTagsSurfaceController(), UseUsersPageCommandCenterTagsSurfaceControllerOptions (+15 more)

### Community 37 - "FeedbackState"
Cohesion: 0.15
Nodes (21): EditorWorkspaceShell(), EditorWorkspaceShellProps, FeedbackBanner(), FeedbackBannerProps, FeedbackState, RegistryWorkspaceShellProps, ResultsWorkspaceShellProps, PermissionSectionModel (+13 more)

### Community 38 - "security-repository.ts"
Cohesion: 0.10
Nodes (27): AccessSummaryRow, ApiKeyInventoryRow, ApiKeySummaryRow, AuditInventoryRow, AuditSummaryRow, createUnavailablePayload(), emptySummary, mapAccessSummary() (+19 more)

### Community 39 - "system-menus-page.tsx"
Cohesion: 0.12
Nodes (20): AdminTreeNode, buildRoleTree(), emptyForm(), MenuBtnRow, MenuFormState, RoleTreeNode, SystemMenusPage(), confirmAssign() (+12 more)

### Community 40 - "request-schemas.ts"
Cohesion: 0.07
Nodes (26): copySystemRoleSchema, createSystemApiSchema, createSystemMenuSchema, createSystemRoleSchema, createSystemUserSchema, httpMethod, identifier, longText (+18 more)

### Community 41 - "security-filters-workbench-content.tsx"
Cohesion: 0.09
Nodes (18): ManagementContextStrip(), RegistryWorkbenchControls(), RegistryWorkbenchControlsProps, SecurityFiltersWorkbench(), SecurityFiltersWorkbenchProps, SecurityWorkbenchControlsProps, SecurityWorkbenchOption, SecurityFiltersWorkbenchFiltersContent() (+10 more)

### Community 42 - "users-page-editor-permissions-content.tsx"
Cohesion: 0.12
Nodes (20): AccessCustomInputField(), AccessCustomInputFieldProps, AccessSelectionGrid(), AccessSelectionGridProps, AccessSelectionOptionCard(), AccessSelectionOptionCardProps, EditorSection(), EditorSectionProps (+12 more)

### Community 43 - "use-integrations-page-controller.ts"
Cohesion: 0.16
Nodes (17): ResultsWorkbenchControls(), ResultsWorkbenchControlsProps, IntegrationsPageResultsWorkspaceShell(), IntegrationsPageResultsWorkspaceShellProps, IntegrationsPageWorkbenchContent(), IntegrationsPageWorkbenchContentProps, IntegrationsPageWorkbenchFiltersContent(), IntegrationsPageWorkbenchFiltersContentProps (+9 more)

### Community 44 - "topbar.tsx"
Cohesion: 0.11
Nodes (18): GvaMorphButton(), GvaMorphButtonProps, GvaSettingDrawer(), patch(), resetConfig(), scheduleSaveToast(), GvaSettingDrawerProps, syncThemeScheme() (+10 more)

### Community 45 - "runtime.ts"
Cohesion: 0.17
Nodes (24): asRecord(), buildBackendRuntimeSummary(), buildProjectRuntimeSummary(), buildRuntimeSurfaceSummary(), formatCompactNumber(), formatIdentity(), formatRuntimeRole(), formatUptime() (+16 more)

### Community 46 - "use-portfolio-grid-controller.ts"
Cohesion: 0.12
Nodes (20): copyTextToClipboard(), copyTextWithExecCommand(), buildDashboardHref(), handleCopyCurrentView(), handleCopyCurrentView(), buildPortfolioHref(), isProjectEnvironmentFilter(), isProjectSortMode() (+12 more)

### Community 47 - "WorkspaceSettingsSummary"
Cohesion: 0.17
Nodes (17): SettingsPageProps, LocaleMode, SettingsPreferencesContentProps, ThemeMode, SettingsHeroContent(), SettingsHeroContentProps, SettingsPanel(), SettingsPanelProps (+9 more)

### Community 48 - "ga-message.ts"
Cohesion: 0.17
Nodes (20): GvaMessageCard(), GvaMessageHost(), clearTimer(), closeGvaMessage(), closeTimers, emit(), EMPTY_MESSAGES, getGvaMessages() (+12 more)

### Community 49 - "system-user-repository.ts"
Cohesion: 0.23
Nodes (20): nowIso(), compareHash(), derivePassword(), hashPassword(), needsPasswordRehash(), verifyPassword(), authenticateSystemUser(), createSystemUser() (+12 more)

### Community 50 - "projects-registry-page.tsx"
Cohesion: 0.13
Nodes (14): dynamic, normalizeEnvironment(), normalizeSort(), normalizeStatus(), ProjectsRoute(), SectionHeader(), SectionHeaderProps, ProjectsRegistryPage() (+6 more)

### Community 51 - "proxy.ts"
Cohesion: 0.18
Nodes (15): POST(), GET(), jsonFail(), requireSession(), AUTH_COOKIE_NAME, buildClearAuthCookie(), disableResponseCaching(), config (+7 more)

### Community 52 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, @eslint/eslintrc, devDependencies, eslint, @eslint/eslintrc, postcss, tailwindcss, @tailwindcss/postcss (+13 more)

### Community 53 - "system-api-sync.ts"
Cohesion: 0.21
Nodes (19): readApiInventorySummary(), ApisFile, createSystemApi(), deleteSystemApi(), listSystemApis(), loadApis(), saveApis(), updateSystemApi() (+11 more)

### Community 54 - "use-dashboard-page-bridge-controller.ts"
Cohesion: 0.14
Nodes (14): DashboardPageProps, externalLinks, metrics, plugins, quickLinks, ReferenceDashboard(), updates, ManagementBackendProbe (+6 more)

### Community 55 - "dependencies"
Cohesion: 0.11
Nodes (19): clsx, dotenv, jose, lucide-react, next, dependencies, clsx, dotenv (+11 more)

### Community 56 - "useProjectManagementConsoleSurfaceController"
Cohesion: 0.17
Nodes (15): ProjectManagementConsoleRegistryContent(), ProjectManagementConsoleRegistryContentProps, ProjectManagementConsoleEditorContentProps, ProjectManagementConsoleEditorWorkspaceShell(), ProjectManagementConsoleEditorWorkspaceShellProps, ProjectManagementConsoleLowerContent(), ProjectManagementConsoleLowerContentProps, ProjectManagementConsoleRegistryActionsContent() (+7 more)

### Community 57 - "sidebar.tsx"
Cohesion: 0.20
Nodes (17): collectActiveAncestorIds(), collectAllBranchIds(), collectSubtreeIds(), findMenuPathById(), hasActiveDescendant(), isPathActive(), menuIndent(), MenuNode() (+9 more)

### Community 58 - "theme-provider.tsx"
Cohesion: 0.21
Nodes (12): metadata, siteConfig, ProjectStorageDriver, ThemeMode, THEME_STORAGE_KEY, themeClassMap, AppProviders(), applyTheme() (+4 more)

### Community 59 - "use-dashboard-page-controller.tsx"
Cohesion: 0.20
Nodes (16): DashboardPageOverviewContentProps, calculateProjectRiskScore(), compareProjectsBySortMode(), ProjectIdentityComparable, projectNeedsAttention(), ProjectRiskComparable, sortProjectsBySortMode(), compareProjectsByLatestDeploy() (+8 more)

### Community 60 - "resolveIntegrationsFilterState"
Cohesion: 0.15
Nodes (18): resolveApiInventoryAreaFilter(), resolveEndpointSortMode(), resolveIntegrationsFilterState(), resolveInventorySecurityFilter(), resolveManagedServiceCategoryFilter(), resolveProbeCoverageFilter(), resolveProjectEnvironmentFilter(), resolveProjectSortMode() (+10 more)

### Community 61 - "shell-navigation.ts"
Cohesion: 0.24
Nodes (16): appendProjectsPortfolioSearchParams(), buildEnvironmentsHref(), buildIntegrationsHref(), buildProjectsHref(), buildServicesHref(), normalizeGovernanceSearch(), resolveEnvironmentsFilterState(), resolveEnvironmentSortMode() (+8 more)

### Community 62 - "use-project-management-console-presentation-controller.ts"
Cohesion: 0.15
Nodes (16): environmentOptions, ProjectEditorFieldBaseModel, ProjectEditorInputFieldModel, ProjectEditorNumberFieldModel, ProjectEditorSectionPresentationModel, ProjectEditorSelectFieldModel, ProjectEditorTextareaFieldModel, ProjectEntityEditorCardPresentationModel (+8 more)

### Community 63 - "migrate.mjs"
Cohesion: 0.15
Nodes (11): allowedArguments, argumentsSet, databaseUrl, frontRoot, migrationsDirectory, pool, scriptDirectory, workspaceRoot (+3 more)

### Community 64 - "settings-panel-operations-content.tsx"
Cohesion: 0.22
Nodes (13): SettingsPanelLowerContent(), SettingsPanelLowerContentProps, SettingsCapabilitiesContent(), SettingsCapabilitiesContentProps, SettingsGovernanceContent(), SettingsGovernanceContentProps, SettingsRuntimeContent(), SettingsSourcesContent() (+5 more)

### Community 65 - "overview.ts"
Cohesion: 0.20
Nodes (15): buildActivitySignals(), buildAlertSignals(), buildManagementOverview(), countByStatus(), createSummaryDraft(), findHottestServer(), healthScore(), highSeverityThresholds (+7 more)

### Community 66 - "api-inventory-parser.ts"
Cohesion: 0.21
Nodes (10): inventoryFilePath, classifyArea(), httpMethods, isRecord(), normalizeSecurityRequirements(), normalizeSecuritySchemes(), optionalString(), parseApiInventoryDocument() (+2 more)

### Community 67 - "system-menu-repository.ts"
Cohesion: 0.23
Nodes (13): buildMenuTree(), collectAllowedPaths(), createSystemMenu(), deleteSystemMenu(), listAsyncMenusForRoles(), listSystemMenus(), listSystemMenuTree(), loadMenus() (+5 more)

### Community 68 - "useGvaListLoad"
Cohesion: 0.18
Nodes (10): SystemCasbinPage(), save(), sync(), GvaPageTransition(), useGvaListLoad(), run(), isGvaPageLeaving(), subscribeGvaPageLeaveEnd() (+2 more)

### Community 69 - "use-command-palette-controller.ts"
Cohesion: 0.21
Nodes (10): CommandPalette(), CommandPaletteContent(), CommandPaletteShellCopy, CommandPaletteShellProps, NavigationItem, navigationItems, CommandPaletteController, CommandPaletteGroupModel (+2 more)

### Community 70 - "topbar-shell.tsx"
Cohesion: 0.15
Nodes (9): TopbarContextContent(), TopbarContextContentProps, TopbarQuickLink, TopbarQuickLink, TopbarSelectOption, TopbarShellProps, TopbarSelectOption, TopbarWorkbenchContent() (+1 more)

### Community 71 - "AccessManagementView"
Cohesion: 0.16
Nodes (12): UsersPageProps, AccessManagementView, UseRolesPageBridgeControllerOptions, UseRolesPageCommandCenterSurfaceControllerOptions, TranslationFn, UseRolesPageOverviewHeaderSurfaceControllerOptions, UseRolesPageSurfaceControllerOptions, UseUsersPageBridgeControllerOptions (+4 more)

### Community 72 - "management-primitives.tsx"
Cohesion: 0.19
Nodes (9): AttentionCard(), AttentionCardProps, ManagementContextStripProps, SummaryCardProps, TonePill(), TonePillProps, toneValueFromManagementTone(), SecurityGovernanceOverviewPanelShell() (+1 more)

### Community 73 - "runtime-surface-panel.tsx"
Cohesion: 0.27
Nodes (9): RuntimeSurfacePanelDetailsContent(), RuntimeSurfacePanelDetailsContentProps, getToneStyle(), RuntimeSurfacePanel(), RuntimeSurfacePanelProps, RuntimeSurfacePreviewProps, RuntimeSurfacePanelSummaryContent(), RuntimeSurfacePanelSummaryContentProps (+1 more)

### Community 74 - "status-badge.tsx"
Cohesion: 0.23
Nodes (10): StatusBadge(), StatusBadgeProps, ServerTable(), ServerTableProps, ServiceGrid(), ServiceGridProps, ManagedProjectServer, ManagedProjectService (+2 more)

### Community 75 - "useCommandPaletteController"
Cohesion: 0.24
Nodes (12): CommandPaletteShell(), buildCommandPaletteItemDomId(), resolveDefaultActiveItemId(), useCommandPaletteController(), closePalette(), focusBoundaryItem(), handleItemHover(), handleSearchChange() (+4 more)

### Community 76 - "local-system-adapter.ts"
Cohesion: 0.35
Nodes (11): localSystemAdapter, copySystemRole(), createSystemRole(), deleteSystemRole(), getSystemRolesByIds(), listSystemRoles(), loadRoles(), mergeRoleCapabilities() (+3 more)

### Community 77 - "system-casbin-repository.ts"
Cohesion: 0.32
Nodes (10): createId(), CasbinFile, copyCasbinPoliciesForRole(), isPathAllowedForRoles(), listCasbinPolicies(), loadPolicies(), matchApiPath(), replaceCasbinPoliciesForRole() (+2 more)

### Community 78 - "use-settings-panel-controller.ts"
Cohesion: 0.20
Nodes (10): SettingsActionLink, TranslationFn, UseSettingsPanelControllerOptions, describeWorkspaceRoute(), formatWorkspaceProjectMeta(), ProjectMetaField, ProjectMetaProject, resolveWorkspacePageCopy() (+2 more)

### Community 79 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, lint, lint:fix, migrate, start, test (+4 more)

### Community 80 - "project-endpoint-surface.tsx"
Cohesion: 0.22
Nodes (7): ProjectEndpointFieldGridProps, ProjectEndpointFooterLink(), ProjectEndpointFooterLinkProps, ProjectEndpointSurfaceCard(), ProjectEndpointSurfaceCardProps, IntegrationsPageResultsContent(), IntegrationsPageResultsContentProps

### Community 81 - "use-project-detail-page-surface-controller.ts"
Cohesion: 0.27
Nodes (10): ProjectEndpointField, ProjectEndpointIdentity, ProjectEndpointMetric, IntegrationEndpointCardDescriptor, ProjectDetailActionLink, ProjectDetailEndpointCardModel, ProjectDetailHeroStat, ProjectDetailPanelTag (+2 more)

### Community 82 - "project-management-console-editor-content.tsx"
Cohesion: 0.25
Nodes (9): ProjectEntityEditorCard(), ProjectEntityEditorCardProps, ProjectEntityEditorSection(), ProjectEntityEditorSectionProps, ProjectManagementConsoleEditorContent(), renderProjectEditorField(), renderProjectEditorFieldControl(), TranslationFn (+1 more)

### Community 83 - "json-store.ts"
Cohesion: 0.33
Nodes (8): dataRootPath(), readJsonFile(), resolveDataFilePath(), writeJsonFile(), writeJsonPath(), currentDirectoryPath, currentFilePath, msFrontRootPath

### Community 84 - "project-provider.tsx"
Cohesion: 0.24
Nodes (10): ManagedProjectCatalogEntry, ManagedProjectSummary, extractProjectIdFromLocation(), extractProjectIdFromPathname(), noopAsync(), ProjectContext, ProjectContextValue, ProjectProviderFallback() (+2 more)

### Community 85 - "useUsersPageController"
Cohesion: 0.22
Nodes (7): selectManagedUser(), shouldPushUsersHistory(), userSearchToken(), useUsersPageController(), applyAccessManagementSnapshot(), handleCopyCurrentView(), syncFiltersFromUrl()

### Community 86 - "use-project-management-console-surface-controller.ts"
Cohesion: 0.29
Nodes (7): ProjectManagementConsoleEditorActionsContent(), ProjectManagementConsoleEditorActionsContentProps, ManagedProjectDraft, UseProjectManagementConsolePresentationControllerOptions, SummaryCardDescriptor, TranslationFn, UseProjectManagementConsoleSurfaceControllerOptions

### Community 87 - "index.ts"
Cohesion: 0.27
Nodes (8): dictionaries, Dictionary, enUS, zhCN, getDictionary(), isLocaleCode(), translate(), LocaleProvider()

### Community 88 - "database.ts"
Cohesion: 0.31
Nodes (7): DatabasePoolOptions, EnvironmentValues, readBoundedInteger(), resolveDatabasePoolOptions(), isDatabaseConfigured(), loadWorkspaceEnvironment(), resolveDatabaseUrl()

### Community 89 - "useSettingsPanelController"
Cohesion: 0.53
Nodes (9): SettingsPreferencesContent(), useSettingsPanelController(), handleLocaleChange(), handleProjectChange(), handleThemeChange(), resetLocalePreference(), resetProjectPreference(), resetThemePreference() (+1 more)

### Community 90 - "use-settings-panel-runtime-surface-controller.ts"
Cohesion: 0.25
Nodes (8): SettingsRuntimeContentProps, SettingsSourcesContentProps, SettingsFactField, SettingsSourceCardModel, toneFromProjectSourceStatus(), TranslationFn, useSettingsPanelRuntimeSurfaceController(), UseSettingsPanelRuntimeSurfaceControllerOptions

### Community 91 - "access-control-config.ts"
Cohesion: 0.28
Nodes (8): AccessPermissionCatalogEntry, AccessRoleSeedDefinition, filterValidPermissionIdentifiers(), isValidPermissionIdentifier(), MSFRONT_DEFAULT_ROLE_DEFINITIONS, MSFRONT_PERMISSION_CATALOG, MSFRONT_SUPPORTED_PERMISSIONS, normalizeManagedPermissionInput()

### Community 92 - "sync/route.ts"
Cohesion: 0.25
Nodes (7): addOneSchema, applySyncSchema, GET(), httpMethod, ignoreSchema, syncItemSchema, syncMutationSchema

### Community 93 - "use-roles-page-content-surface-controller.ts"
Cohesion: 0.29
Nodes (6): useRolesPageContentSurfaceController(), UseRolesPageContentSurfaceControllerOptions, useRolesPageOverviewContentSurfaceController(), useUsersPageContentSurfaceController(), UseUsersPageContentSurfaceControllerOptions, useUsersPageOverviewContentSurfaceController()

### Community 94 - "package.json"
Cohesion: 0.25
Nodes (7): engines, node, name, packageManager, private, type, version

### Community 95 - "ColorSwatch"
Cohesion: 0.33
Nodes (5): ColorSwatch(), onKey(), placePopover(), toggleOpen(), normalizeHexColor()

### Community 96 - "buildAuthSessionUser"
Cohesion: 0.33
Nodes (5): loginWithPassword(), readCookieValue(), resolveSessionFromRequest(), buildAuthSessionUser(), mocks

### Community 97 - "MSFront"
Cohesion: 0.33
Nodes (5): MSFront, 启动, 检查, 环境变量, 目录

### Community 100 - "SecurityCredentialRefreshWorkbench"
Cohesion: 0.83
Nodes (4): SecurityCredentialRefreshWorkbench(), handleRevokeApiKey(), handleRevokeSession(), refreshGovernanceData()

## Knowledge Gaps
- **487 isolated node(s):** `mocks`, `encodedSecret`, `mocks`, `mocks`, `temporaryDirectories` (+482 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useLocale()` connect `useLocale` to `governance-filters.ts`, `types/management.ts`, `api/management.ts`, `access-governance-surface.tsx`, `use-services-page-controller.ts`, `security-filters.ts`, `AccessManagedRoleEntry`, `AccessManagedUserEntry`, `use-environments-page-controller.ts`, `access-navigation.ts`, `ManagedProject`, `use-users-page-bridge-controller.ts`, `FeedbackState`, `security-filters-workbench-content.tsx`, `users-page-editor-permissions-content.tsx`, `use-integrations-page-controller.ts`, `WorkspaceSettingsSummary`, `projects-registry-page.tsx`, `useProjectManagementConsoleSurfaceController`, `settings-panel-operations-content.tsx`, `use-command-palette-controller.ts`, `runtime-surface-panel.tsx`, `status-badge.tsx`, `useCommandPaletteController`, `use-settings-panel-controller.ts`, `use-project-management-console-surface-controller.ts`, `useSettingsPanelController`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `LocaleCode` connect `LocaleCode` to `useLocale`, `governance-filters.ts`, `types/management.ts`, `use-security-governance-surface-presentation-controller.ts`, `use-roles-page-bridge-controller.ts`, `use-services-page-controller.ts`, `security-filters.ts`, `use-environments-page-controller.ts`, `use-users-page-editor-presentation-controller.ts`, `ManagedProject`, `formatDateTime`, `security-credential-results-sections-content.tsx`, `formatNumber`, `use-users-page-bridge-controller.ts`, `use-project-management-console-controller.ts`, `use-users-page-surface-controller.ts`, `use-integrations-page-controller.ts`, `runtime.ts`, `use-portfolio-grid-controller.ts`, `WorkspaceSettingsSummary`, `use-dashboard-page-bridge-controller.ts`, `theme-provider.tsx`, `use-dashboard-page-controller.tsx`, `topbar-shell.tsx`, `AccessManagementView`, `use-settings-panel-controller.ts`, `use-project-detail-page-surface-controller.ts`, `use-project-management-console-surface-controller.ts`, `index.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `ManagedProject` connect `ManagedProject` to `useLocale`, `governance-filters.ts`, `overview.ts`, `types/management.ts`, `use-project-management-console-controller.ts`, `topbar-shell.tsx`, `api/management.ts`, `project-repository.ts`, `use-portfolio-grid-controller.ts`, `use-settings-panel-controller.ts`, `use-project-detail-page-surface-controller.ts`, `use-environments-page-controller.ts`, `use-dashboard-page-bridge-controller.ts`, `use-project-management-console-surface-controller.ts`, `useProjectManagementConsoleSurfaceController`, `formatDateTime`, `use-dashboard-page-controller.tsx`, `shell-navigation.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `mocks`, `encodedSecret`, `mocks` to the rest of the system?**
  _487 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `useLocale` be split into smaller, more focused modules?**
  _Cohesion score 0.060882800608828 - nodes in this community are weakly interconnected._
- **Should `governance-filters.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08128772635814889 - nodes in this community are weakly interconnected._
- **Should `ga-setting-drawer.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05913461538461538 - nodes in this community are weakly interconnected._