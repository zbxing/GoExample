'use client';

import { useMemo } from 'react';
import type {
  AccessSurfaceMetric,
} from '@/components/common/access-governance-surface';
import {
  formatDecimal,
  formatNumber,
} from '@/lib/utils/format';
import type {
  RolesPageOverviewStats,
} from '@/lib/utils/use-roles-page-command-center-surface-controller';
import type { AccessManagedRoleEntry } from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageOverviewSurfaceControllerOptions {
  roleOverview: RolesPageOverviewStats;
  priorityRole: AccessManagedRoleEntry | null;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPageOverviewSurfaceController({
  roleOverview,
  priorityRole,
  locale,
  t,
}: UseRolesPageOverviewSurfaceControllerOptions) {
  const roleCoverageMetrics = useMemo<AccessSurfaceMetric[]>(
    () => [
      {
        label: t('roles.overview.averageMembers'),
        value: formatDecimal(roleOverview.averageMembersPerRole, locale),
      },
      {
        label: t('roles.overview.averagePermissions'),
        value: formatDecimal(roleOverview.averagePermissionsPerRole, locale),
      },
      {
        label: t('roles.overview.lockedRoles'),
        value: formatNumber(roleOverview.lockedRoles, locale),
      },
      {
        label: t('roles.overview.rolesInUse'),
        value: formatNumber(roleOverview.rolesInUse, locale),
      },
    ],
    [locale, roleOverview, t],
  );

  const roleCoverageFootnote = priorityRole
    ? t('roles.overview.coverageFootnoteSome', {
        role: priorityRole.name,
        members: formatNumber(priorityRole.memberCount, locale),
      })
    : t('roles.overview.coverageFootnoteNone');

  return {
    roleCoverageFootnote,
    roleCoverageMetrics,
  };
}
