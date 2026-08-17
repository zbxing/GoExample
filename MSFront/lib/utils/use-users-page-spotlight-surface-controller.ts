'use client';

import { useMemo } from 'react';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
} from '@/components/common/access-governance-surface';
import type {
  AccessManagedUserEntry,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  humanizeIdentifier,
  joinDetails,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageSpotlightSurfaceControllerOptions {
  priorityUser: AccessManagedUserEntry | null;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPageSpotlightSurfaceController({
  priorityUser,
  locale,
  t,
}: UseUsersPageSpotlightSurfaceControllerOptions) {
  const priorityUserRoleLabel = priorityUser
    ? priorityUser.roles.length > 0
      ? priorityUser.roles.map((roleId) => humanizeIdentifier(roleId)).join(' / ')
      : t('users.unassignedRole')
    : '';

  const priorityUserBadges = useMemo<AccessSurfaceBadge[]>(
    () =>
      priorityUser
        ? [
            {
              label: t(`security.status.${priorityUser.status}`),
              tone: priorityUser.status === 'active' ? 'success' : 'warning',
            },
            {
              label:
                priorityUser.extraPermissions.length > 0
                  ? t('users.commandCenter.directGrantBadge')
                  : t('users.commandCenter.roleOnlyBadge'),
              tone: priorityUser.extraPermissions.length > 0 ? 'warning' : 'info',
            },
          ]
        : [],
    [priorityUser, t],
  );

  const priorityUserMetrics = useMemo<AccessSurfaceMetric[]>(
    () => [
      {
        label: t('labels.roles'),
        value: formatNumber(priorityUser?.roles.length ?? 0, locale),
      },
      {
        label: t('labels.permissions'),
        value: formatNumber(priorityUser?.effectivePermissions.length ?? 0, locale),
      },
      {
        label: t('labels.sessions'),
        value: formatNumber(priorityUser?.sessionCount ?? 0, locale),
      },
      {
        label: t('labels.apiKeys'),
        value: formatNumber(priorityUser?.apiKeyCount ?? 0, locale),
      },
    ],
    [locale, priorityUser, t],
  );

  const priorityUserFootnote = priorityUser
    ? joinDetails([
        `@${priorityUser.username}`,
        priorityUserRoleLabel,
        priorityUser.lastSeenAt
          ? formatDateTime(priorityUser.lastSeenAt, locale)
          : t('security.emptyValue'),
      ])
    : t('users.commandCenter.emptyDescription');

  return {
    priorityUserBadges,
    priorityUserFootnote,
    priorityUserMetrics,
  };
}
