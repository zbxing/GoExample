export type LocaleCode = 'zh-CN' | 'en-US';

export type ThemeMode = 'system' | 'aurora' | 'graphite' | 'ocean' | 'gva';

export type ProjectStorageDriver = 'auto' | 'database' | 'file';

export type ProjectStatus = 'healthy' | 'warning' | 'critical';

export type ProjectEnvironment = 'production' | 'staging' | 'development';

export type ManagedServiceCategory = 'api' | 'worker' | 'queue' | 'storage' | 'database';

export interface ManagedProjectServer {
  id: string;
  name: string;
  region: string;
  host: string;
  environment: ProjectEnvironment;
  status: ProjectStatus;
  cpuUsage: number;
  memoryUsage: number;
  responseTimeMs: number;
}

export interface ManagedProjectService {
  id: string;
  name: string;
  category: ManagedServiceCategory;
  uptime: string;
  status: ProjectStatus;
}

export interface ManagedProject {
  id: string;
  name: string;
  code: string;
  description: string;
  owner: string;
  environment: ProjectEnvironment;
  status: ProjectStatus;
  region: string;
  baseUrl: string;
  apiBaseUrl: string;
  probeBaseUrl?: string | null;
  tags: string[];
  version: string;
  lastDeployedAt: string;
  activeUsers: number;
  requestPerMinute: number;
  errorRate: number;
  servers: ManagedProjectServer[];
  services: ManagedProjectService[];
}

/** Lightweight project metadata used by navigation and paginated registries. */
export type ManagedProjectCatalogEntry = Omit<ManagedProject, 'servers' | 'services'>;

export interface ManagedProjectSummary extends ManagedProjectCatalogEntry {
  serverCount: number;
  serviceCount: number;
  healthyServerCount: number;
  healthyServiceCount: number;
}

export interface ManagedProjectListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  environment?: 'all' | ProjectEnvironment;
  status?: 'all' | ProjectStatus;
  sort?: 'risk' | 'traffic' | 'deploy' | 'name';
}

export interface ManagedProjectPage {
  items: ManagedProjectSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface OverviewMetric {
  id: string;
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down' | 'steady';
}

export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  tone: 'high' | 'medium' | 'low' | 'info';
  meta?: string;
  projectId: string;
  timestamp: string;
}

export interface ManagementPortfolioSummary {
  totalProjects: number;
  healthyProjects: number;
  warningProjects: number;
  criticalProjects: number;
  productionProjects: number;
  stagingProjects: number;
  developmentProjects: number;
  totalServers: number;
  healthyServers: number;
  warningServers: number;
  criticalServers: number;
  totalActiveUsers: number;
  totalRequestPerMinute: number;
  averageErrorRate: number;
  ownerCount: number;
  regionCount: number;
  totalAlerts: number;
  highSeverityAlerts: number;
  mediumSeverityAlerts: number;
}

export type ManagementAlertCode =
  | 'critical-project'
  | 'warning-project'
  | 'elevated-error-rate'
  | 'server-pressure'
  | 'stale-production-deploy';

export interface ManagementAlertSignal {
  id: string;
  code: ManagementAlertCode;
  projectId: string;
  projectName: string;
  environment: ProjectEnvironment;
  owner: string;
  region: string;
  serverName?: string;
  errorRate?: number;
  daysSinceDeploy?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  responseTimeMs?: number;
  severity: 'high' | 'medium' | 'low';
  timestamp: string;
}

export type ManagementActivityCode =
  | 'recent-deploy'
  | 'highest-traffic'
  | 'healthiest-service-mesh'
  | 'largest-server-footprint';

export interface ManagementActivitySignal {
  id: string;
  code: ManagementActivityCode;
  projectId: string;
  projectName: string;
  environment: ProjectEnvironment;
  owner: string;
  region: string;
  actor: string;
  requestPerMinute?: number;
  activeUsers?: number;
  healthyServiceCount?: number;
  totalServiceCount?: number;
  serverCount?: number;
  timestamp: string;
}

export interface ManagementOverview {
  summary: ManagementPortfolioSummary;
  alerts: ManagementAlertSignal[];
  activity: ManagementActivitySignal[];
}

export interface ManagementBackendProbe {
  connected: boolean;
  probeEnabled: boolean;
  health: unknown;
  systemInfo: unknown;
  message: string;
}

export interface ManagedProjectRuntimeProbe {
  projectId: string;
  projectName: string;
  probeEnabled: boolean;
  health: unknown;
  ready: unknown;
  currentUser: unknown;
  message: string;
}

export interface ServiceHealthEntry {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  version: string;
  name: string;
  category: ManagedServiceCategory;
  status: ProjectStatus;
  uptime: string;
  environment: ProjectEnvironment;
  owner: string;
  region: string;
  activeUsers: number;
  requestPerMinute: number;
  serverCount: number;
}

export interface ServiceCategorySummary {
  category: ManagedServiceCategory;
  totalServices: number;
  healthyServices: number;
  warningServices: number;
  criticalServices: number;
  productionServices: number;
  stagingServices: number;
  developmentServices: number;
}

export interface ServicesGovernanceView {
  services: ServiceHealthEntry[];
  categorySummary: ServiceCategorySummary[];
}

export interface EnvironmentGovernanceItem {
  environment: ProjectEnvironment;
  projectCount: number;
  healthyProjects: number;
  warningProjects: number;
  criticalProjects: number;
  totalServers: number;
  totalServices: number;
  totalActiveUsers: number;
  totalRequestPerMinute: number;
  averageErrorRate: number;
  ownerCoverage: string[];
  regionCoverage: string[];
  latestDeployAt: string | null;
  projects: ManagedProject[];
}

export interface IntegrationEndpointEntry {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  environment: ProjectEnvironment;
  status: ProjectStatus;
  baseUrl: string;
  apiBaseUrl: string;
  probeBaseUrl: string | null;
  owner: string;
  region: string;
  tags: string[];
  activeUsers: number;
  requestPerMinute: number;
  serverCount: number;
  serviceCount: number;
  version: string;
}

export interface IntegrationsGovernanceSummary {
  totalEndpoints: number;
  productionEndpoints: number;
  attentionEndpoints: number;
  probeReadyEndpoints: number;
  uniqueOwners: number;
  uniqueRegions: number;
}

export interface ApiInventorySecurityScheme {
  name: string;
  type: string;
  scheme: string | null;
  bearerFormat: string | null;
  location: string | null;
  parameterName: string | null;
}

export type ApiInventoryArea = 'auth' | 'example' | 'platform' | 'other';

export interface ApiInventoryOperationEntry {
  id: string;
  method: string;
  path: string;
  area: ApiInventoryArea;
  secured: boolean;
  securitySchemes: string[];
  deprecated: boolean;
}

export interface ApiInventorySummary {
  specVersion: string;
  title: string;
  version: string;
  operations: ApiInventoryOperationEntry[];
  authPaths: string[];
  examplePaths: string[];
  securitySchemes: ApiInventorySecurityScheme[];
  securedOperationCount: number;
  deprecatedOperationCount: number;
}

export interface IntegrationsGovernanceView {
  endpoints: IntegrationEndpointEntry[];
  summary: IntegrationsGovernanceSummary;
  inventory: ApiInventorySummary | null;
}

export interface SecurityOverviewSummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
  roleCount: number;
  permissionCount: number;
  totalSessions: number;
  activeSessions: number;
  revokedSessions: number;
  expiredSessions: number;
  totalApiKeys: number;
  activeApiKeys: number;
  revokedApiKeys: number;
  expiredApiKeys: number;
  recentAuditEvents: number;
  failedAuditEvents: number;
  uniqueAuditActors: number;
}

export interface SecurityRoleCoverage {
  role: string;
  memberCount: number;
  activeMemberCount: number;
  disabledMemberCount: number;
}

export interface SecurityPermissionCoverage {
  permission: string;
  userAssignments: number;
  apiKeyAssignments: number;
  totalAssignments: number;
}

export interface SecurityUserEntry {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: string[];
  sessionCount: number;
  apiKeyCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}

export type SecurityCredentialStatus = 'active' | 'expired' | 'revoked';

export interface SecuritySessionEntry {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  status: SecurityCredentialStatus;
  authProvider: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface SecurityApiKeyEntry {
  id: string;
  name: string;
  keyPrefix: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  status: SecurityCredentialStatus;
  permissions: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface SecurityAuditEventEntry {
  id: string;
  category: string;
  action: string;
  result: string;
  actor: string;
  target: string;
  scope: string | null;
  clientIp: string | null;
  createdAt: string;
  tone: 'high' | 'medium' | 'low' | 'info';
}

export interface SecurityGovernanceView {
  source: 'database' | 'unavailable';
  message: string;
  summary: SecurityOverviewSummary;
  roles: SecurityRoleCoverage[];
  permissions: SecurityPermissionCoverage[];
  users: SecurityUserEntry[];
  sessions: SecuritySessionEntry[];
  apiKeys: SecurityApiKeyEntry[];
  auditEvents: SecurityAuditEventEntry[];
}

export type FrameworkUserStatus = 'active' | 'disabled';

export interface AccessManagedRoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  locked: boolean;
  imported: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessManagedRoleEntry extends AccessManagedRoleDefinition {
  memberCount: number;
  activeMemberCount: number;
  disabledMemberCount: number;
  permissionCount: number;
}

export interface AccessManagedUserEntry {
  id: string;
  username: string;
  displayName: string;
  status: FrameworkUserStatus;
  roles: string[];
  inheritedPermissions: string[];
  extraPermissions: string[];
  effectivePermissions: string[];
  sessionCount: number;
  apiKeyCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface AccessManagementSummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  totalRoles: number;
  customRoles: number;
  usersWithCustomPermissions: number;
  totalRoleAssignments: number;
  totalEffectivePermissions: number;
}

export interface AccessManagementView {
  source: 'database' | 'unavailable';
  message: string;
  supportedPermissions: string[];
  roles: AccessManagedRoleEntry[];
  users: AccessManagedUserEntry[];
  summary: AccessManagementSummary;
}

export interface WorkspaceSettingsSummary {
  defaultLocale: LocaleCode;
  defaultTheme: ThemeMode;
  apiBaseUrl: string;
  enableLiveProbes: boolean;
  configuredStorageDriver: ProjectStorageDriver;
  effectiveProjectSource: 'database' | 'file';
  projectSourceStatus: 'ready' | 'fallback' | 'blocked';
  databaseConfigured: boolean;
  msFrontDatabaseUrlConfigured: boolean;
  sharedDatabaseUrlConfigured: boolean;
  apiInventoryAvailable: boolean;
  supportedLocaleCount: number;
  supportedThemeCount: number;
  supportedPermissionCount: number;
  seededRoleCount: number;
  inventoryDocumentPath: string;
  projectCatalogPath: string;
}

export interface ManagedProjectDraft {
  name: string;
  code: string;
  description: string;
  owner: string;
  environment: ProjectEnvironment;
  status: ProjectStatus;
  region: string;
  baseUrl: string;
  apiBaseUrl: string;
  probeBaseUrl?: string | null;
  tags: string[];
  version: string;
  lastDeployedAt: string;
  activeUsers: number;
  requestPerMinute: number;
  errorRate: number;
  servers: ManagedProjectServer[];
  services: ManagedProjectService[];
}

export interface ProjectRepositoryPayload {
  projects: ManagedProject[];
}
