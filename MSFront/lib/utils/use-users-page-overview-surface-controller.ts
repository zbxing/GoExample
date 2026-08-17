'use client';

import { useMemo } from 'react';
import type {
  AccessSurfaceMetric,
} from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
} from '@/lib/types/management';
import {
  formatDecimal,
  formatNumber,
} from '@/lib/utils/format';
import type { UsersPageOverviewStats } from '@/lib/utils/use-users-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageOverviewSurfaceControllerOptions {
  roles: readonly AccessManagedRoleEntry[];
  userOverview: UsersPageOverviewStats;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPageOverviewSurfaceController({
  roles,
  userOverview,
  locale,
  t,
}: UseUsersPageOverviewSurfaceControllerOptions) {
  const topAssignedRole = useMemo(
    () =>
      [...roles].sort(
        (left, right) =>
          right.memberCount - left.memberCount ||
          right.permissionCount - left.permissionCount ||
          left.name.localeCompare(right.name, locale),
      )[0] ?? null,
    [locale, roles],
  );

  const userCoverageMetrics = useMemo<AccessSurfaceMetric[]>(
    () => [
      {
        label: t('users.overview.averageRoles'),
        value: formatDecimal(userOverview.averageRolesPerUser, locale),
      },
      {
        label: t('users.overview.averagePermissions'),
        value: formatDecimal(userOverview.averagePermissionsPerUser, locale),
      },
      {
        label: t('users.overview.activeSessions'),
        value: formatNumber(userOverview.totalSessions, locale),
      },
      {
        label: t('users.overview.activeKeys'),
        value: formatNumber(userOverview.totalApiKeys, locale),
      },
    ],
    [locale, t, userOverview],
  );

  const userCoverageFootnote = topAssignedRole
    ? t('users.overview.coverageFootnoteSome', {
        count: formatNumber(userOverview.rolesInUse, locale),
        role: topAssignedRole.name,
      })
    : t('users.overview.coverageFootnoteNone');

  return {
    userCoverageFootnote,
    userCoverageMetrics,
  };
}
