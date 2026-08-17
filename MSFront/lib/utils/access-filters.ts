import type { FrameworkUserStatus } from '@/lib/types/management';

export type AccessUserStatusFilter = 'all' | FrameworkUserStatus;

export interface UsersFilterState {
  userId: string;
  roleId: string;
  status: AccessUserStatusFilter;
  search: string;
}

export interface RolesFilterState {
  roleId: string;
  userId: string;
  search: string;
}

interface BuildUsersHrefOptions {
  userId?: string;
  roleId?: string;
  status?: AccessUserStatusFilter;
  search?: string;
}

interface BuildRolesHrefOptions {
  roleId?: string;
  userId?: string;
  search?: string;
}

const accessUserStatusFilters = new Set<AccessUserStatusFilter>(['all', 'active', 'disabled']);

export function normalizeAccessSearch(value?: string | null) {
  return `${value ?? ''}`.trim();
}

export function resolveAccessUserStatusFilter(value?: string | null): AccessUserStatusFilter {
  const normalizedValue = `${value ?? ''}`.trim();

  if (accessUserStatusFilters.has(normalizedValue as AccessUserStatusFilter)) {
    return normalizedValue as AccessUserStatusFilter;
  }

  return 'all';
}

export function resolveAccessUserId(
  availableUserIds: readonly string[],
  value?: string | null,
) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (normalizedValue && availableUserIds.includes(normalizedValue)) {
    return normalizedValue;
  }

  return '';
}

export function resolveAccessRoleId(
  availableRoleIds: readonly string[],
  value?: string | null,
) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (normalizedValue && availableRoleIds.includes(normalizedValue)) {
    return normalizedValue;
  }

  return '';
}

export function resolveAccessRoleFilter(
  availableRoleIds: readonly string[],
  value?: string | null,
) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (normalizedValue && availableRoleIds.includes(normalizedValue)) {
    return normalizedValue;
  }

  return 'all';
}

export function resolveUsersFilterState(
  values: {
    userId?: string | null;
    roleId?: string | null;
    status?: string | null;
    search?: string | null;
  },
  availableUserIds: readonly string[],
  availableRoleIds: readonly string[],
): UsersFilterState {
  return {
    userId: resolveAccessUserId(availableUserIds, values.userId),
    roleId: resolveAccessRoleFilter(availableRoleIds, values.roleId),
    status: resolveAccessUserStatusFilter(values.status),
    search: normalizeAccessSearch(values.search),
  };
}

export function resolveRolesFilterState(
  values: {
    roleId?: string | null;
    userId?: string | null;
    search?: string | null;
  },
  availableRoleIds: readonly string[],
  availableUserIds: readonly string[],
): RolesFilterState {
  return {
    roleId: resolveAccessRoleId(availableRoleIds, values.roleId),
    userId: resolveAccessUserId(availableUserIds, values.userId),
    search: normalizeAccessSearch(values.search),
  };
}

export function buildUsersHref({
  userId,
  roleId,
  status = 'all',
  search,
}: BuildUsersHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedUserId = `${userId ?? ''}`.trim();
  const normalizedRoleId = `${roleId ?? ''}`.trim();
  const normalizedSearch = normalizeAccessSearch(search);

  if (normalizedUserId) {
    params.set('userId', normalizedUserId);
  }

  if (normalizedRoleId && normalizedRoleId !== 'all') {
    params.set('roleId', normalizedRoleId);
  }

  if (status !== 'all') {
    params.set('status', status);
  }

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  const query = params.toString();

  return query ? `/users?${query}` : '/users';
}

export function buildRolesHref({
  roleId,
  userId,
  search,
}: BuildRolesHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedRoleId = `${roleId ?? ''}`.trim();
  const normalizedUserId = `${userId ?? ''}`.trim();
  const normalizedSearch = normalizeAccessSearch(search);

  if (normalizedRoleId) {
    params.set('roleId', normalizedRoleId);
  }

  if (normalizedUserId) {
    params.set('userId', normalizedUserId);
  }

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  const query = params.toString();

  return query ? `/roles?${query}` : '/roles';
}
