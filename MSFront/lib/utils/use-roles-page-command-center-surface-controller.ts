'use client';

import { useMemo } from 'react';
import type { AccessSurfaceSummaryCard } from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
  AccessManagementView,
} from '@/lib/types/management';
import {
  formatDecimal,
  formatNumber,
} from '@/lib/utils/format';
import {
  useRolesPageCommandCenterTagsSurfaceController,
} from '@/lib/utils/use-roles-page-command-center-tags-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface RolesPageOverviewStats {
  averageMembersPerRole: number;
  averagePermissionsPerRole: number;
  emptyRoles: number;
  lockedRoles: number;
  rolesInUse: number;
}

interface UseRolesPageCommandCenterSurfaceControllerOptions {
  summary: AccessManagementView['summary'];
  roleOverview: RolesPageOverviewStats;
  supportedPermissionCount: number;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPageCommandCenterSurfaceController({
  summary,
  roleOverview,
  supportedPermissionCount,
  locale,
  t,
}: UseRolesPageCommandCenterSurfaceControllerOptions) {
  const commandCenterSummaryCards = useMemo<AccessSurfaceSummaryCard[]>(
    () => [
      {
        label: t('roles.summary.custom'),
        value: formatNumber(summary.customRoles, locale),
        footnote: t('roles.footnotes.custom', {
          locked: formatNumber(roleOverview.lockedRoles, locale),
        }),
      },
      {
        label: t('roles.summary.coverage'),
        value: formatNumber(summary.totalRoleAssignments, locale),
        footnote: t('roles.footnotes.coverage', {
          count: formatNumber(roleOverview.rolesInUse, locale),
          total: formatNumber(summary.totalRoles, locale),
        }),
      },
      {
        label: t('roles.summary.permissions'),
        value: formatNumber(supportedPermissionCount, locale),
        footnote: t('roles.footnotes.permissions', {
          count: formatDecimal(roleOverview.averagePermissionsPerRole, locale),
        }),
      },
      {
        label: t('roles.summary.directExposure'),
        value: formatNumber(summary.usersWithCustomPermissions, locale),
        footnote: t('roles.footnotes.directExposure', {
          count: formatNumber(roleOverview.emptyRoles, locale),
        }),
      },
    ],
    [
      locale,
      roleOverview,
      summary.customRoles,
      summary.totalRoleAssignments,
      summary.totalRoles,
      summary.usersWithCustomPermissions,
      supportedPermissionCount,
      t,
    ],
  );
  const { commandCenterTags } = useRolesPageCommandCenterTagsSurfaceController({
    locale,
    roleOverview,
    t,
  });

  return {
    commandCenterSummaryCards,
    commandCenterTags,
  };
}

export function buildRolesPageOverviewStats(
  roles: readonly AccessManagedRoleEntry[],
): RolesPageOverviewStats {
  const emptyRoles = roles.filter((role) => role.memberCount === 0).length;
  const lockedRoles = roles.filter((role) => role.locked).length;
  const rolesInUse = roles.filter((role) => role.memberCount > 0).length;
  const averageMembersPerRole =
    roles.length > 0 ? roles.reduce((sum, role) => sum + role.memberCount, 0) / roles.length : 0;
  const averagePermissionsPerRole =
    roles.length > 0
      ? roles.reduce((sum, role) => sum + role.permissionCount, 0) / roles.length
      : 0;

  return {
    averageMembersPerRole,
    averagePermissionsPerRole,
    emptyRoles,
    lockedRoles,
    rolesInUse,
  };
}
