'use client';

import { useMemo } from 'react';
import type { AccessSurfaceSignal } from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
  AccessManagementView,
} from '@/lib/types/management';
import { formatNumber } from '@/lib/utils/format';
import type { RolesPageOverviewStats } from '@/lib/utils/use-roles-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPagePostureSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  roleOverview: RolesPageOverviewStats;
  priorityRole: AccessManagedRoleEntry | null;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPagePostureSurfaceController({
  summary,
  roleOverview,
  priorityRole,
  locale,
  t,
}: UseRolesPagePostureSurfaceControllerOptions) {
  const rolePostureSignals = useMemo<AccessSurfaceSignal[]>(
    () => [
      {
        label: t('roles.posture.signals.emptyRoles'),
        value: formatNumber(roleOverview.emptyRoles, locale),
        detail:
          roleOverview.emptyRoles > 0
            ? t('roles.posture.details.emptyRolesSome', {
                count: formatNumber(roleOverview.emptyRoles, locale),
              })
            : t('roles.posture.details.emptyRolesNone'),
        tone: roleOverview.emptyRoles > 0 ? 'warning' : 'success',
      },
      {
        label: t('roles.posture.signals.customRoles'),
        value: formatNumber(summary.customRoles, locale),
        detail:
          summary.customRoles > 0
            ? t('roles.posture.details.customRolesSome', {
                count: formatNumber(summary.customRoles, locale),
              })
            : t('roles.posture.details.customRolesNone'),
        tone: summary.customRoles > 0 ? 'info' : 'success',
      },
      {
        label: t('roles.posture.signals.directGrants'),
        value: formatNumber(summary.usersWithCustomPermissions, locale),
        detail:
          summary.usersWithCustomPermissions > 0
            ? t('roles.posture.details.directGrantsSome', {
                count: formatNumber(summary.usersWithCustomPermissions, locale),
              })
            : t('roles.posture.details.directGrantsNone'),
        tone: summary.usersWithCustomPermissions > 0 ? 'warning' : 'success',
      },
      {
        label: t('roles.posture.signals.memberDensity'),
        value: formatNumber(priorityRole?.memberCount ?? 0, locale),
        detail: priorityRole
          ? t('roles.posture.details.memberDensitySome', {
              role: priorityRole.name,
            })
          : t('roles.posture.details.memberDensityEmpty'),
        tone:
          priorityRole
            ? priorityRole.disabledMemberCount > 0 || priorityRole.memberCount === 0
              ? 'warning'
              : priorityRole.memberCount > 0
                ? 'info'
                : 'success'
            : 'info',
      },
    ],
    [locale, priorityRole, roleOverview, summary.customRoles, summary.usersWithCustomPermissions, t],
  );

  return {
    rolePostureSignals,
  };
}
