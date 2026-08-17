'use client';

import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSignal,
  AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';
import type {
  AccessManagedRoleEntry,
  OverviewMetric,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';

export interface UseRolesPageOverviewContentSurfaceControllerOptions {
  accessMessage: string;
  accessNavigationContext: AccessNavigationContext;
  commandCenterSummaryCards: readonly AccessSurfaceSummaryCard[];
  commandCenterTags: readonly string[];
  metrics: OverviewMetric[];
  priorityRole: AccessManagedRoleEntry | null;
  priorityRoleBadges: readonly AccessSurfaceBadge[];
  priorityRoleFootnote: string;
  priorityRoleMetrics: readonly AccessSurfaceMetric[];
  roleCoverageFootnote: string;
  roleCoverageMetrics: readonly AccessSurfaceMetric[];
  rolePostureSignals: readonly AccessSurfaceSignal[];
  sourceStatusLabel: string;
  sourceTone: AccessSurfaceBadge['tone'];
}

export function useRolesPageOverviewContentSurfaceController({
  accessMessage,
  accessNavigationContext,
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
}: UseRolesPageOverviewContentSurfaceControllerOptions) {
  return {
    rolesPageOverviewContentProps: {
      accessMessage,
      accessNavigationContext,
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
    },
  };
}
