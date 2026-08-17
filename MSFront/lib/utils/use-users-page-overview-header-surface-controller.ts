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

interface UseUsersPageOverviewHeaderSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  source: AccessManagementView['source'];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useUsersPageOverviewHeaderSurfaceController({
  summary,
  source,
  locale,
  t,
}: UseUsersPageOverviewHeaderSurfaceControllerOptions) {
  const metrics = useMemo<OverviewMetric[]>(
    () => [
      {
        id: 'users',
        label: t('users.metrics.usersLabel'),
        value: formatNumber(summary.totalUsers, locale),
        delta: t('users.metrics.usersDelta', {
          active: formatNumber(summary.activeUsers, locale),
          disabled: formatNumber(summary.disabledUsers, locale),
        }),
        trend: summary.disabledUsers > 0 ? 'steady' : 'up',
      },
      {
        id: 'roles',
        label: t('users.metrics.rolesLabel'),
        value: formatNumber(summary.totalRoles, locale),
        delta: t('users.metrics.rolesDelta', {
          customRoles: formatNumber(summary.customRoles, locale),
        }),
        trend: summary.customRoles > 0 ? 'up' : 'steady',
      },
      {
        id: 'assignments',
        label: t('users.metrics.assignmentsLabel'),
        value: formatNumber(summary.totalRoleAssignments, locale),
        delta: t('users.metrics.assignmentsDelta', {
          effectivePermissions: formatNumber(summary.totalEffectivePermissions, locale),
        }),
        trend: summary.totalRoleAssignments > 0 ? 'up' : 'steady',
      },
      {
        id: 'custom-access',
        label: t('users.metrics.customAccessLabel'),
        value: formatNumber(summary.usersWithCustomPermissions, locale),
        delta: t('users.metrics.customAccessDelta'),
        trend: summary.usersWithCustomPermissions > 0 ? 'steady' : 'up',
      },
    ],
    [locale, summary, t],
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
