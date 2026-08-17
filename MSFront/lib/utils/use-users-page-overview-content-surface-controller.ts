'use client';

import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSignal,
  AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';
import type {
  AccessManagedUserEntry,
  OverviewMetric,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';

export interface UseUsersPageOverviewContentSurfaceControllerOptions {
  accessMessage: string;
  accessNavigationContext: AccessNavigationContext;
  commandCenterSummaryCards: readonly AccessSurfaceSummaryCard[];
  commandCenterTags: readonly string[];
  metrics: OverviewMetric[];
  priorityUser: AccessManagedUserEntry | null;
  priorityUserBadges: readonly AccessSurfaceBadge[];
  priorityUserFootnote: string;
  priorityUserMetrics: readonly AccessSurfaceMetric[];
  sourceStatusLabel: string;
  sourceTone: AccessSurfaceBadge['tone'];
  userCoverageFootnote: string;
  userCoverageMetrics: readonly AccessSurfaceMetric[];
  userPostureSignals: readonly AccessSurfaceSignal[];
}

export function useUsersPageOverviewContentSurfaceController({
  accessMessage,
  accessNavigationContext,
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
}: UseUsersPageOverviewContentSurfaceControllerOptions) {
  return {
    usersPageOverviewContentProps: {
      accessMessage,
      accessNavigationContext,
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
    },
  };
}
