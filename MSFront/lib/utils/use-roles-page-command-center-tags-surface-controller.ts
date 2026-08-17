'use client';

import { useMemo } from 'react';
import {
  formatDecimal,
  formatNumber,
} from '@/lib/utils/format';
import type { RolesPageOverviewStats } from '@/lib/utils/use-roles-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageCommandCenterTagsSurfaceControllerOptions {
  roleOverview: RolesPageOverviewStats;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPageCommandCenterTagsSurfaceController({
  roleOverview,
  locale,
  t,
}: UseRolesPageCommandCenterTagsSurfaceControllerOptions) {
  const commandCenterTags = useMemo(
    () => [
      `${t('roles.overview.averageMembers')}: ${formatDecimal(roleOverview.averageMembersPerRole, locale)}`,
      `${t('roles.overview.averagePermissions')}: ${formatDecimal(roleOverview.averagePermissionsPerRole, locale)}`,
      `${t('roles.overview.rolesInUse')}: ${formatNumber(roleOverview.rolesInUse, locale)}`,
    ],
    [locale, roleOverview, t],
  );

  return {
    commandCenterTags,
  };
}
