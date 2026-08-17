import type {
  SecurityApiKeyEntry,
  SecurityAuditEventEntry,
  SecurityCredentialStatus,
  SecuritySessionEntry,
  SecurityUserEntry,
} from '@/lib/types/management';

export type SecurityFocusFilter = 'all' | 'users' | 'sessions' | 'apiKeys' | 'audit';

export type SecurityStatusFilter = 'all' | 'active' | 'disabled' | 'expired' | 'revoked';

export interface SecurityFilterState {
  focus: SecurityFocusFilter;
  status: SecurityStatusFilter;
  role: string;
  search: string;
}

interface SecurityResultsFilterOptions {
  focus: SecurityFocusFilter;
  status: SecurityStatusFilter;
  role: string;
  search: string;
}

interface BuildSecurityHrefOptions {
  focus?: SecurityFocusFilter;
  status?: SecurityStatusFilter;
  role?: string;
  search?: string;
}

const securityFocusFilters = new Set<SecurityFocusFilter>([
  'all',
  'users',
  'sessions',
  'apiKeys',
  'audit',
]);

const securityStatusFilters = new Set<SecurityStatusFilter>([
  'all',
  'active',
  'disabled',
  'expired',
  'revoked',
]);

export function normalizeSecuritySearch(value?: string | null) {
  return `${value ?? ''}`.trim();
}

export function resolveSecurityFocusFilter(value?: string | null): SecurityFocusFilter {
  const normalizedValue = `${value ?? ''}`.trim();

  if (securityFocusFilters.has(normalizedValue as SecurityFocusFilter)) {
    return normalizedValue as SecurityFocusFilter;
  }

  return 'all';
}

export function resolveSecurityStatusFilter(value?: string | null): SecurityStatusFilter {
  const normalizedValue = `${value ?? ''}`.trim();

  if (securityStatusFilters.has(normalizedValue as SecurityStatusFilter)) {
    return normalizedValue as SecurityStatusFilter;
  }

  return 'all';
}

export function resolveSecurityRoleFilter(
  availableRoles: readonly string[],
  value?: string | null,
) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (normalizedValue && availableRoles.includes(normalizedValue)) {
    return normalizedValue;
  }

  return 'all';
}

export function resolveSecurityFilterState(
  values: {
    focus?: string | null;
    status?: string | null;
    role?: string | null;
    search?: string | null;
  },
  availableRoles: readonly string[],
): SecurityFilterState {
  return {
    focus: resolveSecurityFocusFilter(values.focus),
    status: resolveSecurityStatusFilter(values.status),
    role: resolveSecurityRoleFilter(availableRoles, values.role),
    search: normalizeSecuritySearch(values.search),
  };
}

export function buildSecurityHref({
  focus = 'all',
  status = 'all',
  role,
  search,
}: BuildSecurityHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedSearch = normalizeSecuritySearch(search);
  const normalizedRole = `${role ?? ''}`.trim();

  if (focus !== 'all') {
    params.set('focus', focus);
  }

  if (status !== 'all') {
    params.set('status', status);
  }

  if (normalizedRole && normalizedRole !== 'all') {
    params.set('role', normalizedRole);
  }

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  const query = params.toString();

  return query ? `/security?${query}` : '/security';
}

export function matchesSecuritySearch(
  search: string,
  ...values: Array<string | null | undefined>
) {
  const normalizedSearch = normalizeSecuritySearch(search).toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => `${value ?? ''}`.toLowerCase().includes(normalizedSearch));
}

export function matchesSecurityCredentialStatus(
  entryStatus: SecurityCredentialStatus,
  filterStatus: SecurityStatusFilter,
) {
  if (filterStatus === 'all') {
    return true;
  }

  if (filterStatus === 'disabled') {
    return false;
  }

  return entryStatus === filterStatus;
}

export function filterSecurityUsers(
  users: readonly SecurityUserEntry[],
  { focus, status, role, search }: SecurityResultsFilterOptions,
) {
  return users.filter((user) => {
    if (focus !== 'all' && focus !== 'users') {
      return false;
    }

    if (status === 'active' && user.status !== 'active') {
      return false;
    }

    if (status === 'disabled' && user.status === 'active') {
      return false;
    }

    if (status === 'expired' || status === 'revoked') {
      return false;
    }

    if (role !== 'all' && !user.roles.includes(role)) {
      return false;
    }

    return matchesSecuritySearch(
      search,
      user.displayName,
      user.username,
      user.status,
      ...user.roles,
      ...user.permissions,
    );
  });
}

export function filterSecuritySessions(
  sessions: readonly SecuritySessionEntry[],
  { focus, status, search }: Pick<SecurityResultsFilterOptions, 'focus' | 'status' | 'search'>,
) {
  return sessions.filter((session) => {
    if (focus !== 'all' && focus !== 'sessions') {
      return false;
    }

    if (!matchesSecurityCredentialStatus(session.status, status)) {
      return false;
    }

    return matchesSecuritySearch(
      search,
      session.displayName,
      session.username,
      session.authProvider,
      session.tenantId,
      session.ipAddress,
      session.userAgent,
      session.revokeReason,
      session.status,
    );
  });
}

export function filterSecurityApiKeys(
  apiKeys: readonly SecurityApiKeyEntry[],
  { focus, status, search }: Pick<SecurityResultsFilterOptions, 'focus' | 'status' | 'search'>,
) {
  return apiKeys.filter((apiKey) => {
    if (focus !== 'all' && focus !== 'apiKeys') {
      return false;
    }

    if (!matchesSecurityCredentialStatus(apiKey.status, status)) {
      return false;
    }

    return matchesSecuritySearch(
      search,
      apiKey.name,
      apiKey.keyPrefix,
      apiKey.ownerDisplayName,
      apiKey.ownerUsername,
      apiKey.revokeReason,
      apiKey.status,
      ...apiKey.permissions,
    );
  });
}

export function filterSecurityAuditEvents(
  auditEvents: readonly SecurityAuditEventEntry[],
  { focus, search }: Pick<SecurityResultsFilterOptions, 'focus' | 'search'>,
) {
  return auditEvents.filter((event) => {
    if (focus !== 'all' && focus !== 'audit') {
      return false;
    }

    return matchesSecuritySearch(
      search,
      event.category,
      event.action,
      event.actor,
      event.target,
      event.result,
      event.scope,
      event.clientIp,
    );
  });
}
