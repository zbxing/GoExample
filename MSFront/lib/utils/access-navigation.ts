import type { Route } from 'next';
import {
  buildRolesHref,
  buildUsersHref,
  normalizeAccessSearch,
  resolveAccessUserStatusFilter,
  type AccessUserStatusFilter,
  type RolesFilterState,
  type UsersFilterState,
} from '@/lib/utils/access-filters';
import {
  buildSecurityHref,
  normalizeSecuritySearch,
  type SecurityFilterState,
  type SecurityFocusFilter,
  type SecurityStatusFilter,
  resolveSecurityFocusFilter,
  resolveSecurityStatusFilter,
} from '@/lib/utils/security-filters';

export interface AccessNavigationContext {
  users?: UsersFilterState | null;
  roles?: RolesFilterState | null;
  security?: SecurityFilterState | null;
}

interface BuildContextualUsersHrefOptions {
  userId?: string;
  roleId?: string;
  search?: string;
  status?: AccessUserStatusFilter;
}

interface BuildContextualRolesHrefOptions {
  roleId?: string;
  userId?: string;
  search?: string;
}

interface BuildContextualSecurityHrefOptions {
  focus?: SecurityFocusFilter;
  status?: SecurityStatusFilter;
  role?: string;
  search?: string;
}

export function resolveAccessNavigationContext(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>,
): AccessNavigationContext {
  if (pathname === '/users') {
    return {
      users: {
        userId: normalizeAccessEntityId(searchParams.get('userId')),
        roleId: normalizeAccessRoleFilterValue(searchParams.get('roleId')),
        status: resolveAccessUserStatusFilter(searchParams.get('status')),
        search: normalizeAccessSearch(searchParams.get('search')),
      },
    };
  }

  if (pathname === '/roles') {
    return {
      roles: {
        roleId: normalizeAccessEntityId(searchParams.get('roleId')),
        userId: normalizeAccessEntityId(searchParams.get('userId')),
        search: normalizeAccessSearch(searchParams.get('search')),
      },
    };
  }

  if (pathname === '/security') {
    return {
      security: {
        focus: resolveSecurityFocusFilter(searchParams.get('focus')),
        status: resolveSecurityStatusFilter(searchParams.get('status')),
        role: normalizeSecurityRoleValue(searchParams.get('role')),
        search: normalizeSecuritySearch(searchParams.get('search')),
      },
    };
  }

  return {};
}

export function buildContextualUsersHref(
  context: AccessNavigationContext,
  {
    userId,
    roleId,
    search,
    status,
  }: BuildContextualUsersHrefOptions = {},
): Route {
  return buildUsersHref({
    userId:
      userId !== undefined
        ? userId
        : context.users?.userId || context.roles?.userId || '',
    roleId:
      roleId !== undefined
        ? roleId
        : normalizeSharedRoleId(context.users?.roleId) ||
          context.roles?.roleId ||
          normalizeSharedRoleId(context.security?.role) ||
          'all',
    status:
      status !== undefined
        ? status
        : context.users?.status || mapSecurityStatusToAccessStatus(context.security?.status),
    search:
      search !== undefined
        ? search
        : context.users?.search ||
          (supportsUsersSearch(context.security?.focus) ? context.security?.search ?? '' : ''),
  }) as Route;
}

export function buildContextualRolesHref(
  context: AccessNavigationContext,
  {
    roleId,
    userId,
    search,
  }: BuildContextualRolesHrefOptions = {},
): Route {
  return buildRolesHref({
    roleId:
      roleId !== undefined
        ? roleId
        : context.roles?.roleId ||
          normalizeSharedRoleId(context.users?.roleId) ||
          normalizeSharedRoleId(context.security?.role),
    userId:
      userId !== undefined
        ? userId
        : context.roles?.userId || context.users?.userId || '',
    search: search !== undefined ? search : context.roles?.search ?? '',
  }) as Route;
}

export function buildContextualSecurityHref(
  context: AccessNavigationContext,
  {
    focus,
    status,
    role,
    search,
  }: BuildContextualSecurityHrefOptions = {},
): Route {
  return buildSecurityHref({
    focus:
      focus !== undefined
        ? focus
        : context.security?.focus ?? (context.users || context.roles ? 'users' : 'all'),
    status:
      status !== undefined
        ? status
        : context.security?.status || mapAccessStatusToSecurityStatus(context.users?.status),
    role:
      role !== undefined
        ? role
        : normalizeSharedRoleId(context.security?.role) ||
          normalizeSharedRoleId(context.users?.roleId) ||
          context.roles?.roleId,
    search:
      search !== undefined
        ? search
        : context.security?.search || context.users?.search || '',
  }) as Route;
}

function mapAccessStatusToSecurityStatus(
  status?: AccessUserStatusFilter,
): SecurityStatusFilter {
  if (status === 'active' || status === 'disabled') {
    return status;
  }

  return 'all';
}

function mapSecurityStatusToAccessStatus(
  status?: SecurityStatusFilter,
): AccessUserStatusFilter {
  if (status === 'active' || status === 'disabled') {
    return status;
  }

  return 'all';
}

function normalizeSharedRoleId(value?: string | null) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (!normalizedValue || normalizedValue === 'all') {
    return '';
  }

  return normalizedValue;
}

function normalizeAccessEntityId(value?: string | null) {
  return `${value ?? ''}`.trim();
}

function normalizeAccessRoleFilterValue(value?: string | null) {
  const normalizedValue = `${value ?? ''}`.trim();

  return normalizedValue || 'all';
}

function normalizeSecurityRoleValue(value?: string | null) {
  const normalizedValue = `${value ?? ''}`.trim();

  return normalizedValue || 'all';
}

function supportsUsersSearch(focus?: SecurityFocusFilter) {
  return focus === 'all' || focus === 'users';
}
