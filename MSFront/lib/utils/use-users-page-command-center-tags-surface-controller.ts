'use client';

import { useMemo } from 'react';
import {
  formatDecimal,
  formatNumber,
} from '@/lib/utils/format';
import type { UsersPageOverviewStats } from '@/lib/utils/use-users-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageCommandCenterTagsSurfaceControllerOptions {
  userOverview: UsersPageOverviewStats;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPageCommandCenterTagsSurfaceController({
  userOverview,
  locale,
  t,
}: UseUsersPageCommandCenterTagsSurfaceControllerOptions) {
  const commandCenterTags = useMemo(
    () => [
      `${t('users.overview.averageRoles')}: ${formatDecimal(userOverview.averageRolesPerUser, locale)}`,
      `${t('users.overview.averagePermissions')}: ${formatDecimal(userOverview.averagePermissionsPerUser, locale)}`,
      `${t('users.overview.activeSessions')}: ${formatNumber(userOverview.totalSessions, locale)}`,
    ],
    [locale, t, userOverview],
  );

  return {
    commandCenterTags,
  };
}
