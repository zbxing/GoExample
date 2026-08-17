'use client';

import { useMemo } from 'react';
import type { ManagementTone } from '@/components/common/management-primitives';
import type {
  AccessManagementView,
  LocaleCode,
  OverviewMetric,
} from '@/lib/types/management';
import { formatNumber } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageOverviewHeaderSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  source: AccessManagementView['source'];
  supportedPermissionCount: number;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useRolesPageOverviewHeaderSurfaceController({
  summary,
  source,
  supportedPermissionCount,
  locale,
  t,
}: UseRolesPageOverviewHeaderSurfaceControllerOptions) {
  const metrics = useMemo<OverviewMetric[]>(
    () => [
      {
        id: 'roles',
        label: t('roles.metrics.rolesLabel'),
        value: formatNumber(summary.totalRoles, locale),
        delta: t('roles.metrics.rolesDelta', {
          customRoles: formatNumber(summary.customRoles, locale),
        }),
        trend: summary.customRoles > 0 ? 'up' : 'steady',
      },
      {
        id: 'users',
        label: t('roles.metrics.usersLabel'),
        value: formatNumber(summary.totalUsers, locale),
        delta: t('roles.metrics.usersDelta', {
          assignments: formatNumber(summary.totalRoleAssignments, locale),
        }),
        trend: summary.totalUsers > 0 ? 'up' : 'steady',
      },
      {
        id: 'permissions',
        label: t('roles.metrics.permissionsLabel'),
        value: formatNumber(supportedPermissionCount, locale),
        delta: t('roles.metrics.permissionsDelta'),
        trend: supportedPermissionCount > 0 ? 'up' : 'steady',
      },
      {
        id: 'direct-grants',
        label: t('roles.metrics.directGrantLabel'),
        value: formatNumber(summary.usersWithCustomPermissions, locale),
        delta: t('roles.metrics.directGrantDelta'),
        trend: summary.usersWithCustomPermissions > 0 ? 'steady' : 'up',
      },
    ],
    [locale, summary, supportedPermissionCount, t],
  );

  const sourceStatusLabel =
    source === 'database' ? t('security.sourceLive') : t('security.sourceUnavailable');
  const sourceTone: ManagementTone = source === 'database' ? 'success' : 'warning';

  return {
    metrics,
    sourceStatusLabel,
    sourceTone,
  };
}
