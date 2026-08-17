'use client';

import { useMemo } from 'react';
import type { AccessSurfaceSummaryCard } from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementView,
} from '@/lib/types/management';
import {
  formatNumber,
} from '@/lib/utils/format';
import {
  useUsersPageCommandCenterTagsSurfaceController,
} from '@/lib/utils/use-users-page-command-center-tags-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UsersPageOverviewStats {
  averagePermissionsPerUser: number;
  averageRolesPerUser: number;
  rolesInUse: number;
  totalApiKeys: number;
  totalExtraPermissions: number;
  totalSessions: number;
  unassignedUsers: number;
  usersWithApiKeys: number;
  usersWithDirectGrants: number;
  usersWithSessions: number;
}

interface UseUsersPageCommandCenterSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  userOverview: UsersPageOverviewStats;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPageCommandCenterSurfaceController({
  summary,
  userOverview,
  locale,
  t,
}: UseUsersPageCommandCenterSurfaceControllerOptions) {
  const commandCenterSummaryCards = useMemo<AccessSurfaceSummaryCard[]>(
    () => [
      {
        label: t('users.summary.active'),
        value: formatNumber(summary.activeUsers, locale),
        footnote: t('users.footnotes.active', {
          disabled: formatNumber(summary.disabledUsers, locale),
        }),
      },
      {
        label: t('users.summary.directAccess'),
        value: formatNumber(userOverview.usersWithDirectGrants, locale),
        footnote: t('users.footnotes.directAccess', {
          count: formatNumber(userOverview.totalExtraPermissions, locale),
        }),
      },
      {
        label: t('users.summary.sessions'),
        value: formatNumber(userOverview.usersWithSessions, locale),
        footnote: t('users.footnotes.sessions', {
          keys: formatNumber(userOverview.usersWithApiKeys, locale),
        }),
      },
      {
        label: t('users.summary.roleCoverage'),
        value: formatNumber(userOverview.rolesInUse, locale),
        footnote: t('users.footnotes.roleCoverage', {
          covered: formatNumber(userOverview.rolesInUse, locale),
          total: formatNumber(summary.totalRoles, locale),
        }),
      },
    ],
    [locale, summary.activeUsers, summary.disabledUsers, summary.totalRoles, t, userOverview],
  );
  const { commandCenterTags } = useUsersPageCommandCenterTagsSurfaceController({
    locale,
    t,
    userOverview,
  });

  return {
    commandCenterSummaryCards,
    commandCenterTags,
  };
}

export function buildUsersPageOverviewStats(
  users: readonly AccessManagedUserEntry[],
  roles: readonly AccessManagedRoleEntry[],
): UsersPageOverviewStats {
  const unassignedUsers = users.filter((user) => user.roles.length === 0).length;
  const usersWithSessions = users.filter((user) => user.sessionCount > 0).length;
  const usersWithApiKeys = users.filter((user) => user.apiKeyCount > 0).length;
  const usersWithDirectGrants = users.filter((user) => user.extraPermissions.length > 0).length;
  const totalExtraPermissions = users.reduce((sum, user) => sum + user.extraPermissions.length, 0);
  const totalSessions = users.reduce((sum, user) => sum + user.sessionCount, 0);
  const totalApiKeys = users.reduce((sum, user) => sum + user.apiKeyCount, 0);
  const rolesInUse = roles.filter((role) => role.memberCount > 0).length;
  const averageRolesPerUser =
    users.length > 0 ? users.reduce((sum, user) => sum + user.roles.length, 0) / users.length : 0;
  const averagePermissionsPerUser =
    users.length > 0
      ? users.reduce((sum, user) => sum + user.effectivePermissions.length, 0) / users.length
      : 0;

  return {
    averagePermissionsPerUser,
    averageRolesPerUser,
    rolesInUse,
    totalApiKeys,
    totalExtraPermissions,
    totalSessions,
    unassignedUsers,
    usersWithApiKeys,
    usersWithDirectGrants,
    usersWithSessions,
  };
}
