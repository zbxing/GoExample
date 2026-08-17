'use client';

import { useMemo } from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementView,
  LocaleCode,
} from '@/lib/types/management';
import {
  buildUsersPageOverviewStats,
  useUsersPageCommandCenterSurfaceController,
} from '@/lib/utils/use-users-page-command-center-surface-controller';
import { useUsersPageOverviewSurfaceController } from '@/lib/utils/use-users-page-overview-surface-controller';
import { useUsersPageOverviewHeaderSurfaceController } from '@/lib/utils/use-users-page-overview-header-surface-controller';
import { useUsersPagePostureSurfaceController } from '@/lib/utils/use-users-page-posture-surface-controller';
import { useUsersPageSpotlightSelectionSurfaceController } from '@/lib/utils/use-users-page-spotlight-selection-surface-controller';
import { useUsersPageSpotlightSurfaceController } from '@/lib/utils/use-users-page-spotlight-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageSurfaceControllerOptions {
  accessManagement: AccessManagementView;
  users: readonly AccessManagedUserEntry[];
  roles: readonly AccessManagedRoleEntry[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useUsersPageSurfaceController({
  accessManagement,
  users,
  roles,
  locale,
  t,
}: UseUsersPageSurfaceControllerOptions) {
  const summary = accessManagement.summary;
  const userOverview = useMemo(
    () => buildUsersPageOverviewStats(users, roles),
    [roles, users],
  );
  const densePermissionThreshold = Math.max(
    4,
    Math.ceil(accessManagement.supportedPermissions.length * 0.5),
  );
  const {
    metrics,
    sourceStatusLabel,
    sourceTone,
  } = useUsersPageOverviewHeaderSurfaceController({
    locale,
    source: accessManagement.source,
    summary,
    t,
  });
  const { priorityUser } = useUsersPageSpotlightSelectionSurfaceController({
    locale,
    users,
  });
  const {
    priorityUserBadges,
    priorityUserFootnote,
    priorityUserMetrics,
  } = useUsersPageSpotlightSurfaceController({
    locale,
    priorityUser,
    t,
  });
  const {
    commandCenterSummaryCards,
    commandCenterTags,
  } = useUsersPageCommandCenterSurfaceController({
    locale,
    summary,
    t,
    userOverview,
  });
  const {
    userCoverageFootnote,
    userCoverageMetrics,
  } = useUsersPageOverviewSurfaceController({
    locale,
    roles,
    t,
    userOverview,
  });
  const { userPostureSignals } = useUsersPagePostureSurfaceController({
    densePermissionThreshold,
    locale,
    priorityUser,
    summary,
    t,
    userOverview,
  });

  return {
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    priorityUser,
    priorityUserBadges,
    priorityUserFootnote,
    priorityUserMetrics,
    sourceStatusLabel,
    sourceTone,
    userCoverageFootnote,
    userCoverageMetrics,
    userPostureSignals,
  };
}
