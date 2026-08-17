'use client';

import { useMemo } from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagementView,
  LocaleCode,
} from '@/lib/types/management';
import {
  buildRolesPageOverviewStats,
  useRolesPageCommandCenterSurfaceController,
} from '@/lib/utils/use-roles-page-command-center-surface-controller';
import { useRolesPageOverviewHeaderSurfaceController } from '@/lib/utils/use-roles-page-overview-header-surface-controller';
import { useRolesPageOverviewSurfaceController } from '@/lib/utils/use-roles-page-overview-surface-controller';
import { useRolesPagePostureSurfaceController } from '@/lib/utils/use-roles-page-posture-surface-controller';
import { useRolesPageSpotlightSelectionSurfaceController } from '@/lib/utils/use-roles-page-spotlight-selection-surface-controller';
import { useRolesPageSpotlightSurfaceController } from '@/lib/utils/use-roles-page-spotlight-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageSurfaceControllerOptions {
  accessManagement: AccessManagementView;
  roles: readonly AccessManagedRoleEntry[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useRolesPageSurfaceController({
  accessManagement,
  roles,
  locale,
  t,
}: UseRolesPageSurfaceControllerOptions) {
  const summary = accessManagement.summary;
  const roleOverview = useMemo(
    () => buildRolesPageOverviewStats(roles),
    [roles],
  );
  const {
    metrics,
    sourceStatusLabel,
    sourceTone,
  } = useRolesPageOverviewHeaderSurfaceController({
    locale,
    source: accessManagement.source,
    summary,
    supportedPermissionCount: accessManagement.supportedPermissions.length,
    t,
  });
  const { priorityRole } = useRolesPageSpotlightSelectionSurfaceController({
    locale,
    roles,
  });
  const {
    priorityRoleBadges,
    priorityRoleFootnote,
    priorityRoleMetrics,
  } = useRolesPageSpotlightSurfaceController({
    locale,
    priorityRole,
    t,
  });
  const {
    commandCenterSummaryCards,
    commandCenterTags,
  } = useRolesPageCommandCenterSurfaceController({
    locale,
    roleOverview,
    summary,
    supportedPermissionCount: accessManagement.supportedPermissions.length,
    t,
  });
  const {
    roleCoverageFootnote,
    roleCoverageMetrics,
  } = useRolesPageOverviewSurfaceController({
    locale,
    priorityRole,
    roleOverview,
    t,
  });
  const { rolePostureSignals } = useRolesPagePostureSurfaceController({
    locale,
    priorityRole,
    roleOverview,
    summary,
    t,
  });

  return {
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    priorityRole,
    priorityRoleBadges,
    priorityRoleFootnote,
    priorityRoleMetrics,
    roleCoverageFootnote,
    roleCoverageMetrics,
    rolePostureSignals,
    sourceStatusLabel,
    sourceTone,
  };
}
