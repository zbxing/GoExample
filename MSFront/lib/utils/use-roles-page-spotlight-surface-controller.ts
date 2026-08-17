'use client';

import { useMemo } from 'react';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
} from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
} from '@/lib/types/management';
import {
  formatNumber,
  joinDetails,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageSpotlightSurfaceControllerOptions {
  priorityRole: AccessManagedRoleEntry | null;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPageSpotlightSurfaceController({
  priorityRole,
  locale,
  t,
}: UseRolesPageSpotlightSurfaceControllerOptions) {
  const priorityRoleBadges = useMemo<AccessSurfaceBadge[]>(
    () =>
      priorityRole
        ? [
            {
              label: priorityRole.locked
                ? t('roles.commandCenter.lockedBadge')
                : t('roles.commandCenter.customBadge'),
              tone: priorityRole.locked ? 'info' : 'warning',
            },
            {
              label: t('roles.commandCenter.memberBadge', {
                count: formatNumber(priorityRole.memberCount, locale),
              }),
              tone: priorityRole.memberCount > 0 ? 'success' : 'warning',
            },
          ]
        : [],
    [locale, priorityRole, t],
  );

  const priorityRoleMetrics = useMemo<AccessSurfaceMetric[]>(
    () => [
      {
        label: t('labels.users'),
        value: formatNumber(priorityRole?.memberCount ?? 0, locale),
      },
      {
        label: t('labels.permissions'),
        value: formatNumber(priorityRole?.permissionCount ?? 0, locale),
      },
      {
        label: t('security.activeLabel'),
        value: formatNumber(priorityRole?.activeMemberCount ?? 0, locale),
      },
      {
        label: t('security.disabledLabel'),
        value: formatNumber(priorityRole?.disabledMemberCount ?? 0, locale),
      },
    ],
    [locale, priorityRole, t],
  );

  const priorityRoleFootnote = priorityRole
    ? joinDetails([
        priorityRole.id,
        priorityRole.description,
        t('roles.commandCenter.permissionBadge', {
          count: formatNumber(priorityRole.permissionCount, locale),
        }),
      ])
    : t('roles.commandCenter.emptyDescription');

  return {
    priorityRoleBadges,
    priorityRoleFootnote,
    priorityRoleMetrics,
  };
}
