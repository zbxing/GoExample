'use client';

import { useMemo } from 'react';
import type { AccessSurfaceSignal } from '@/components/common/access-governance-surface';
import type {
  AccessManagedUserEntry,
  AccessManagementView,
} from '@/lib/types/management';
import { formatNumber } from '@/lib/utils/format';
import type { UsersPageOverviewStats } from '@/lib/utils/use-users-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPagePostureSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  userOverview: UsersPageOverviewStats;
  priorityUser: AccessManagedUserEntry | null;
  densePermissionThreshold: number;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPagePostureSurfaceController({
  summary,
  userOverview,
  priorityUser,
  densePermissionThreshold,
  locale,
  t,
}: UseUsersPagePostureSurfaceControllerOptions) {
  const userPostureSignals = useMemo<AccessSurfaceSignal[]>(
    () => [
      {
        label: t('users.posture.signals.unassigned'),
        value: formatNumber(userOverview.unassignedUsers, locale),
        detail:
          userOverview.unassignedUsers > 0
            ? t('users.posture.details.unassignedSome', {
                count: formatNumber(userOverview.unassignedUsers, locale),
              })
            : t('users.posture.details.unassignedNone'),
        tone: userOverview.unassignedUsers > 0 ? 'warning' : 'success',
      },
      {
        label: t('users.posture.signals.disabled'),
        value: formatNumber(summary.disabledUsers, locale),
        detail:
          summary.disabledUsers > 0
            ? t('users.posture.details.disabledSome', {
                count: formatNumber(summary.disabledUsers, locale),
              })
            : t('users.posture.details.disabledNone'),
        tone: summary.disabledUsers > 0 ? 'warning' : 'success',
      },
      {
        label: t('users.posture.signals.directGrants'),
        value: formatNumber(userOverview.usersWithDirectGrants, locale),
        detail:
          userOverview.usersWithDirectGrants > 0
            ? t('users.posture.details.directGrantsSome', {
                count: formatNumber(userOverview.usersWithDirectGrants, locale),
              })
            : t('users.posture.details.directGrantsNone'),
        tone: userOverview.usersWithDirectGrants > 0 ? 'warning' : 'success',
      },
      {
        label: t('users.posture.signals.permissionDensity'),
        value: formatNumber(priorityUser?.effectivePermissions.length ?? 0, locale),
        detail: priorityUser
          ? t('users.posture.details.permissionDensitySome', {
              user: priorityUser.displayName,
            })
          : t('users.posture.details.permissionDensityEmpty'),
        tone:
          priorityUser
            ? priorityUser.effectivePermissions.length >= densePermissionThreshold ||
              priorityUser.extraPermissions.length > 0 ||
              priorityUser.roles.length === 0
              ? 'warning'
              : 'info'
            : 'info',
      },
    ],
    [densePermissionThreshold, locale, priorityUser, summary.disabledUsers, t, userOverview],
  );

  return {
    userPostureSignals,
  };
}
