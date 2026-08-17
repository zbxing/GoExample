import type {
  LocaleCode,
  ManagedProjectRuntimeProbe,
  ManagementBackendProbe,
} from '@/lib/types/management';

export interface RuntimeMetricItem {
  id: string;
  label: string;
  value: string;
}

export interface RuntimeSurfaceSummary {
  tone: 'success' | 'warning' | 'danger' | 'info';
  statusLabel: string;
  summaryKey:
    | 'disabled'
    | 'disconnected'
    | 'healthy'
    | 'degraded'
    | 'projectProbeMissing'
    | 'projectHealthy'
    | 'projectDegraded';
  summaryVariables?: Record<string, string | number>;
  primaryMetrics: {
    connection: RuntimeMetricItem;
    probe: RuntimeMetricItem;
    readiness: RuntimeMetricItem;
    identity: RuntimeMetricItem;
  };
  detailMetrics: RuntimeMetricItem[];
  diagnosticMetrics: RuntimeMetricItem[];
  endpointMetrics?: RuntimeMetricItem[];
  tags: string[];
}

interface RuntimeSurfaceInput {
  connected: boolean;
  probeEnabled: boolean;
  health: unknown;
  ready?: unknown;
  currentUser?: unknown;
  systemInfo?: unknown;
  endpoints?: {
    consoleUrl?: string | null;
    apiUrl?: string | null;
    probeUrl?: string | null;
  };
}

interface NormalizedHealth {
  status: string | null;
  appName: string | null;
  processRole: string | null;
  adapter: string | null;
  lifecycleState: string | null;
  startupState: string | null;
  tenantId: string | null;
  uptimeInSeconds: number | null;
}

interface NormalizedReady {
  status: string | null;
  totalChecks: number;
  failedChecks: number;
}

interface NormalizedUser {
  displayName: string | null;
  username: string | null;
  status: string | null;
  roleCount: number;
  permissionCount: number;
}

interface NormalizedSystemInfo {
  appName: string | null;
  adapter: string | null;
  processRole: string | null;
  startupState: string | null;
  host: string | null;
  port: number | null;
  nodeVersion: string | null;
  platform: string | null;
  locale: string | null;
  uptimeInSeconds: number | null;
}

export function buildBackendRuntimeSummary(
  probe: ManagementBackendProbe,
  locale: LocaleCode,
  t: TranslateFn,
): RuntimeSurfaceSummary {
  const normalized = normalizeRuntimeSurface({
    connected: probe.connected,
    probeEnabled: probe.probeEnabled,
    health: probe.health,
    systemInfo: probe.systemInfo,
  });

  return buildRuntimeSurfaceSummary(
    {
      connected: probe.connected,
      probeEnabled: probe.probeEnabled,
      health: probe.health,
      systemInfo: probe.systemInfo,
    },
    normalized,
    locale,
    t,
  );
}

export function buildProjectRuntimeSummary(
  probe: ManagedProjectRuntimeProbe | null,
  locale: LocaleCode,
  t: TranslateFn,
  endpoints: {
    consoleUrl: string;
    apiUrl: string;
    probeUrl: string | null;
  },
): RuntimeSurfaceSummary {
  const normalized = normalizeRuntimeSurface({
    connected: Boolean(probe?.health || probe?.ready || probe?.currentUser),
    probeEnabled: Boolean(probe?.probeEnabled),
    health: probe?.health ?? null,
    ready: probe?.ready ?? null,
    currentUser: probe?.currentUser ?? null,
    endpoints,
  });

  return buildRuntimeSurfaceSummary(
    {
      connected: Boolean(probe?.health || probe?.ready || probe?.currentUser),
      probeEnabled: Boolean(probe?.probeEnabled),
      health: probe?.health ?? null,
      ready: probe?.ready ?? null,
      currentUser: probe?.currentUser ?? null,
      endpoints,
    },
    normalized,
    locale,
    t,
  );
}

type TranslateFn = (path: string, variables?: Record<string, string | number>) => string;

function buildRuntimeSurfaceSummary(
  input: RuntimeSurfaceInput,
  normalized: ReturnType<typeof normalizeRuntimeSurface>,
  locale: LocaleCode,
  t: TranslateFn,
): RuntimeSurfaceSummary {
  const readinessOk =
    input.ready === undefined
      ? normalized.health.status === 'ok'
      : normalized.ready.status === 'ok' && normalized.ready.failedChecks === 0;
  const identityConnected = Boolean(normalized.user.username || normalized.user.displayName);
  const hasDiagnostics = Boolean(normalized.systemInfo.appName || normalized.systemInfo.host);

  const tone = !input.probeEnabled
    ? 'warning'
    : !input.connected
      ? 'danger'
      : readinessOk
        ? 'success'
        : 'warning';

  const statusLabel = !input.probeEnabled
    ? t('dashboard.runtime.labels.probeDisabled')
    : !input.connected
      ? t('dashboard.runtime.labels.probeFailed')
      : readinessOk
        ? t('dashboard.runtime.labels.ready')
        : t('dashboard.runtime.labels.degraded');

  const summaryKey = !input.probeEnabled
    ? input.endpoints
      ? 'projectProbeMissing'
      : 'disabled'
    : !input.connected
      ? 'disconnected'
      : input.endpoints
        ? readinessOk
          ? 'projectHealthy'
          : 'projectDegraded'
        : readinessOk
          ? 'healthy'
          : 'degraded';

  const summaryVariables: Record<string, string | number> = {};

  if (normalized.health.appName) {
    summaryVariables.appName = normalized.health.appName;
  }

  if (normalized.ready.failedChecks > 0) {
    summaryVariables.count = formatCompactNumber(normalized.ready.failedChecks, locale);
  }

  if (identityConnected) {
    summaryVariables.user = formatIdentity(normalized.user);
  }

  const tags = [
    formatRuntimeRole(normalized.health.processRole ?? normalized.systemInfo.processRole),
    normalized.health.adapter ?? normalized.systemInfo.adapter,
    normalized.systemInfo.nodeVersion,
  ].filter((value): value is string => Boolean(value));

  const detailMetrics: RuntimeMetricItem[] = [
    {
      id: 'status',
      label: t('dashboard.runtime.metrics.healthStatus'),
      value: normalized.health.status
        ? tRuntimeStatus(normalized.health.status, t)
        : t('security.emptyValue'),
    },
    {
      id: 'startup',
      label: t('dashboard.runtime.metrics.startupState'),
      value: normalized.health.startupState
        ? tRuntimeStatus(normalized.health.startupState, t)
        : normalized.systemInfo.startupState
          ? tRuntimeStatus(normalized.systemInfo.startupState, t)
          : t('security.emptyValue'),
    },
    {
      id: 'processRole',
      label: t('dashboard.runtime.metrics.processRole'),
      value:
        normalized.health.processRole ??
        normalized.systemInfo.processRole ??
        t('security.emptyValue'),
    },
    {
      id: 'lifecycle',
      label: t('dashboard.runtime.metrics.lifecycleState'),
      value: normalized.health.lifecycleState
        ? tRuntimeStatus(normalized.health.lifecycleState, t)
        : t('security.emptyValue'),
    },
    {
      id: 'checks',
      label: t('dashboard.runtime.metrics.failedChecks'),
      value:
        input.ready === undefined
          ? t('security.emptyValue')
          : `${formatCompactNumber(normalized.ready.failedChecks, locale)} / ${formatCompactNumber(normalized.ready.totalChecks, locale)}`,
    },
    {
      id: 'tenant',
      label: t('dashboard.runtime.metrics.context'),
      value:
        normalized.health.tenantId ??
        normalized.systemInfo.locale ??
        t('security.emptyValue'),
    },
  ];

  if (identityConnected) {
    detailMetrics.push(
      {
        id: 'userStatus',
        label: t('dashboard.runtime.metrics.userStatus'),
        value: normalized.user.status
          ? tRuntimeStatus(normalized.user.status, t)
          : t('security.emptyValue'),
      },
      {
        id: 'roleCount',
        label: t('labels.roles'),
        value: formatCompactNumber(normalized.user.roleCount, locale),
      },
      {
        id: 'permissionCount',
        label: t('labels.permissions'),
        value: formatCompactNumber(normalized.user.permissionCount, locale),
      },
    );
  }

  const diagnosticMetrics: RuntimeMetricItem[] = [
    {
      id: 'appName',
      label: t('dashboard.runtime.metrics.appName'),
      value:
        normalized.systemInfo.appName ??
        normalized.health.appName ??
        t('security.emptyValue'),
    },
    {
      id: 'adapter',
      label: t('dashboard.runtime.metrics.adapter'),
      value:
        normalized.systemInfo.adapter ??
        normalized.health.adapter ??
        t('security.emptyValue'),
    },
    {
      id: 'host',
      label: t('dashboard.runtime.metrics.listenAddress'),
      value:
        normalized.systemInfo.host && normalized.systemInfo.port !== null
          ? `${normalized.systemInfo.host}:${normalized.systemInfo.port}`
          : normalized.systemInfo.host ?? t('security.emptyValue'),
    },
    {
      id: 'nodeVersion',
      label: t('dashboard.runtime.metrics.nodeVersion'),
      value: normalized.systemInfo.nodeVersion ?? t('security.emptyValue'),
    },
    {
      id: 'platform',
      label: t('dashboard.runtime.metrics.platform'),
      value: normalized.systemInfo.platform ?? t('security.emptyValue'),
    },
    {
      id: 'uptime',
      label: t('labels.uptime'),
      value: formatUptime(
        normalized.systemInfo.uptimeInSeconds ?? normalized.health.uptimeInSeconds,
        locale,
        t,
      ),
    },
  ];

  const endpointMetrics = input.endpoints
    ? [
        {
          id: 'console',
          label: t('labels.baseUrl'),
          value: input.endpoints.consoleUrl ?? t('security.emptyValue'),
        },
        {
          id: 'api',
          label: t('labels.apiBaseUrl'),
          value: input.endpoints.apiUrl ?? t('security.emptyValue'),
        },
        {
          id: 'probe',
          label: t('labels.probeBaseUrl'),
          value: input.endpoints.probeUrl ?? t('dashboard.integrations.probeEmpty'),
        },
      ]
    : undefined;

  return {
    tone,
    statusLabel,
    summaryKey,
    summaryVariables: Object.keys(summaryVariables).length > 0 ? summaryVariables : undefined,
    primaryMetrics: {
      connection: {
        id: 'connection',
        label: t('dashboard.backend.connectionLabel'),
        value: input.connected
          ? t('dashboard.backend.connectionConnected')
          : t('dashboard.backend.connectionDisconnected'),
      },
      probe: {
        id: 'probe',
        label: t('dashboard.backend.probeLabel'),
        value: input.probeEnabled
          ? t('dashboard.backend.probeEnabled')
          : t('dashboard.backend.probeDisabled'),
      },
      readiness: {
        id: 'readiness',
        label: t('dashboard.runtime.metrics.readiness'),
        value: readinessOk
          ? t('dashboard.runtime.labels.ready')
          : input.probeEnabled
            ? t('dashboard.runtime.labels.degraded')
            : t('dashboard.runtime.labels.unavailable'),
      },
      identity: {
        id: 'identity',
        label: t('dashboard.runtime.metrics.identity'),
        value: identityConnected
          ? formatIdentity(normalized.user)
          : hasDiagnostics && input.ready === undefined
            ? t('dashboard.runtime.labels.diagnosticsOnly')
            : t('dashboard.runtime.labels.unavailable'),
      },
    },
    detailMetrics,
    diagnosticMetrics,
    endpointMetrics,
    tags,
  };
}

function normalizeRuntimeSurface(input: RuntimeSurfaceInput) {
  return {
    health: normalizeHealth(input.health),
    ready: normalizeReady(input.ready),
    user: normalizeUser(input.currentUser),
    systemInfo: normalizeSystemInfo(input.systemInfo),
  };
}

function normalizeHealth(value: unknown): NormalizedHealth {
  const record = asRecord(value);

  return {
    status: readString(record.status),
    appName: readString(record.appName),
    processRole: readString(record.processRole),
    adapter: readString(record.adapter),
    lifecycleState: readString(record.lifecycleState),
    startupState: readString(record.startupState),
    tenantId: readString(record.tenantId),
    uptimeInSeconds: readNumber(record.uptimeInSeconds),
  };
}

function normalizeReady(value: unknown): NormalizedReady {
  const record = asRecord(value);
  const details = asRecord(record.details);
  const errors = asRecord(record.error);

  return {
    status: readString(record.status),
    totalChecks: Object.keys(details).length,
    failedChecks: Object.keys(errors).length,
  };
}

function normalizeUser(value: unknown): NormalizedUser {
  const record = asRecord(value);
  const roles = Array.isArray(record.roles) ? record.roles : [];
  const permissions = Array.isArray(record.permissions) ? record.permissions : [];

  return {
    displayName: readString(record.displayName),
    username: readString(record.username),
    status: readString(record.status),
    roleCount: roles.length,
    permissionCount: permissions.length,
  };
}

function normalizeSystemInfo(value: unknown): NormalizedSystemInfo {
  const record = asRecord(value);

  return {
    appName: readString(record.appName),
    adapter: readString(record.adapter),
    processRole: readString(record.processRole),
    startupState: readString(record.startupState),
    host: readString(record.host),
    port: readNumber(record.port),
    nodeVersion: readString(record.nodeVersion),
    platform: readString(record.platform),
    locale: readString(record.locale),
    uptimeInSeconds: readNumber(record.uptimeInSeconds),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tRuntimeStatus(status: string, t: TranslateFn): string {
  const path = `dashboard.runtime.status.${status}`;
  const translated = t(path);
  return translated === path ? humanizeToken(status) : translated;
}

function formatIdentity(user: NormalizedUser): string {
  if (user.displayName && user.username) {
    return `${user.displayName} (@${user.username})`;
  }

  return user.displayName ?? user.username ?? '';
}

function formatRuntimeRole(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (value === 'api') {
    return 'API';
  }

  return humanizeToken(value);
}

function formatCompactNumber(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatUptime(
  seconds: number | null,
  locale: LocaleCode,
  t: TranslateFn,
): string {
  if (seconds === null || seconds < 0) {
    return t('security.emptyValue');
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return t('dashboard.runtime.uptime.dayHour', {
      days: formatCompactNumber(days, locale),
      hours: formatCompactNumber(hours, locale),
    });
  }

  if (hours > 0) {
    return t('dashboard.runtime.uptime.hourMinute', {
      hours: formatCompactNumber(hours, locale),
      minutes: formatCompactNumber(minutes, locale),
    });
  }

  return t('dashboard.runtime.uptime.minuteOnly', {
    minutes: formatCompactNumber(Math.max(minutes, 1), locale),
  });
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
