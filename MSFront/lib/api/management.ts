import 'server-only';
import { createApiClient } from '@/lib/api/client';
import { resolveConfiguredProjectStorageDriver, siteConfig } from '@/lib/config/site';
import { buildManagementOverview } from '@/lib/management/overview';
import { buildEnvironmentGovernanceView, buildIntegrationsGovernanceView, buildServicesGovernanceView } from '@/lib/management/operations';
import { buildSecurityGovernanceView } from '@/lib/management/security';
import {
  MSFRONT_DEFAULT_ROLE_DEFINITIONS,
  MSFRONT_SUPPORTED_PERMISSIONS,
} from '@/lib/server/access-control-config';
import { readAccessManagementView } from '@/lib/server/access-management-repository';
import { readApiInventorySummary } from '@/lib/server/api-inventory';
import { resolveDatabaseUrl } from '@/lib/server/database';
import type { ManagedProject, WorkspaceSettingsSummary } from '@/lib/types/management';
import { getProjectById, listProjectCatalog, listProjectSummaries, listProjects } from '@/lib/server/project-repository';
import { readSecurityRepositoryPayload } from '@/lib/server/security-repository';
import { resolveAllowedProbeBaseUrl } from '@/lib/server/probe-policy';

const probeTimeoutMs = 5_000;
const probeCacheTtlMs = 15_000;
const projectProbeCache = new Map<
  string,
  { expiresAt: number; value: Awaited<ReturnType<typeof loadProjectHealth>> }
>();
const projectProbeInFlight = new Map<string, Promise<Awaited<ReturnType<typeof loadProjectHealth>>>>();

export async function getManagementOverview(projects?: ManagedProject[]) {
  const [managedProjects, backend] = await Promise.all([
    projects ? Promise.resolve(projects) : listProjects(),
    probeBaseUrl(siteConfig.apiBaseUrl, siteConfig.enableLiveProbes),
  ]);

  return {
    ...buildManagementOverview(managedProjects),
    backend,
  };
}

export async function getManagedProjects() {
  return listProjects();
}

export async function getManagedProjectSummaries(query?: Parameters<typeof listProjectSummaries>[0]) {
  return listProjectSummaries(query);
}

export async function getManagedProjectCatalog() {
  return listProjectCatalog();
}

export async function getServicesGovernance() {
  const projects = await listProjects();
  return buildServicesGovernanceView(projects);
}

export async function getEnvironmentGovernance() {
  const projects = await listProjects();
  return buildEnvironmentGovernanceView(projects);
}

export async function getIntegrationsGovernance() {
  const [projects, inventory] = await Promise.all([listProjects(), readApiInventorySummary()]);
  return buildIntegrationsGovernanceView(projects, inventory);
}

export async function getSecurityGovernance() {
  const payload = await readSecurityRepositoryPayload();
  return buildSecurityGovernanceView(payload);
}

export async function getAccessManagement() {
  return readAccessManagementView();
}

export async function getWorkspaceSettingsSummary(): Promise<WorkspaceSettingsSummary> {
  const inventory = await readApiInventorySummary();
  const configuredStorageDriver = resolveConfiguredProjectStorageDriver();
  const databaseUrl = resolveDatabaseUrl();
  const msFrontDatabaseUrlConfigured = Boolean(`${process.env.MSFRONT_DATABASE_URL ?? ''}`.trim());
  const sharedDatabaseUrlConfigured = Boolean(`${process.env.DATABASE_URL ?? ''}`.trim());
  const databaseConfigured = Boolean(databaseUrl);
  const effectiveProjectSource =
    configuredStorageDriver === 'file' ? 'file' : databaseConfigured ? 'database' : 'file';
  const projectSourceStatus =
    configuredStorageDriver === 'database' && !databaseConfigured
      ? 'blocked'
      : configuredStorageDriver === 'auto' && !databaseConfigured
        ? 'fallback'
        : 'ready';

  return {
    defaultLocale: siteConfig.defaultLocale,
    defaultTheme: siteConfig.defaultTheme,
    apiBaseUrl: siteConfig.apiBaseUrl,
    enableLiveProbes: siteConfig.enableLiveProbes,
    configuredStorageDriver,
    effectiveProjectSource,
    projectSourceStatus,
    databaseConfigured,
    msFrontDatabaseUrlConfigured,
    sharedDatabaseUrlConfigured,
    apiInventoryAvailable: inventory !== null,
    supportedLocaleCount: siteConfig.locales.length,
    supportedThemeCount: siteConfig.themes.length,
    supportedPermissionCount: MSFRONT_SUPPORTED_PERMISSIONS.length,
    seededRoleCount: MSFRONT_DEFAULT_ROLE_DEFINITIONS.length,
    inventoryDocumentPath: siteConfig.inventoryDocumentPath,
    projectCatalogPath: siteConfig.projectCatalogPath,
  };
}

export async function getManagedProject(projectId: string) {
  return getProjectById(projectId);
}

export async function getProjectHealth(projectId: string) {
  const cached = projectProbeCache.get(projectId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inFlight = projectProbeInFlight.get(projectId);

  if (inFlight) {
    return inFlight;
  }

  const request = loadProjectHealth(projectId)
    .then((value) => {
      projectProbeCache.set(projectId, { expiresAt: Date.now() + probeCacheTtlMs, value });
      return value;
    })
    .finally(() => {
      projectProbeInFlight.delete(projectId);
    });
  projectProbeInFlight.set(projectId, request);
  return request;
}

async function loadProjectHealth(projectId: string) {
  const project = await getProjectById(projectId);

  if (!project) {
    return null;
  }

  if (!project.probeBaseUrl) {
    return {
      projectId,
      projectName: project.name,
      probeEnabled: false,
      health: null,
      ready: null,
      currentUser: null,
      message: 'Probe endpoint not configured for this managed project.',
    };
  }

  const client = createApiClient(resolveAllowedProbeBaseUrl(project.probeBaseUrl, {
    primaryBaseUrl: siteConfig.apiBaseUrl,
  }));
  const [health, ready, me] = await Promise.allSettled([
    requestWithTimeout((signal) => client.request('/api/health', { method: 'get', cache: 'no-store', signal })),
    requestWithTimeout((signal) => client.request('/api/health/ready', { method: 'get', cache: 'no-store', signal })),
    requestWithTimeout((signal) => client.request('/api/v1/auth/me', { method: 'get', cache: 'no-store', signal })),
  ]);

  return {
    projectId,
    projectName: project.name,
    probeEnabled: true,
    health: health.status === 'fulfilled' ? (health.value as { data: unknown }).data : null,
    ready: ready.status === 'fulfilled' ? (ready.value as { data: unknown }).data : null,
    currentUser: me.status === 'fulfilled' ? (me.value as { data: unknown }).data : null,
    message:
      health.status === 'fulfilled' || ready.status === 'fulfilled'
        ? 'Live project probe completed.'
        : 'Live project probe failed or target service is unavailable.',
  };
}

async function probeBaseUrl(baseUrl: string, enabled: boolean) {
  if (!enabled) {
    return {
      connected: false,
      probeEnabled: false,
      health: null,
      systemInfo: null,
      message: 'Live backend probes are disabled. Set MSFRONT_ENABLE_LIVE_PROBES=true to enable.',
    };
  }

  const client = createApiClient(resolveAllowedProbeBaseUrl(baseUrl, {
    primaryBaseUrl: siteConfig.apiBaseUrl,
  }));
  const [health, systemInfo] = await Promise.allSettled([
    requestWithTimeout((signal) => client.request('/api/health', { method: 'get', cache: 'no-store', signal })),
    requestWithTimeout((signal) => client.request('/api/system/info', { method: 'get', cache: 'no-store', signal })),
  ]);

  return {
    connected: health.status === 'fulfilled' || systemInfo.status === 'fulfilled',
    probeEnabled: true,
    health: health.status === 'fulfilled' ? (health.value as { data: unknown }).data : null,
    systemInfo: systemInfo.status === 'fulfilled' ? (systemInfo.value as { data: unknown }).data : null,
    message:
      health.status === 'fulfilled' || systemInfo.status === 'fulfilled'
        ? 'Live backend probe succeeded.'
        : 'Live backend probe failed or backend is unavailable.',
  };
}

async function requestWithTimeout<T>(request: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs);

  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
