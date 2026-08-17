'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  AccessCommandCenterSurface,
  AccessCoverageCard,
  AccessOverviewSection,
  AccessPosturePanel,
  AccessSourceCard,
  type AccessSurfaceBadge,
  type AccessSurfaceMetric,
  type AccessSurfaceSignal,
  type AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';
import { MetricGrid } from '@/components/dashboard/metric-grid';
import { useLocale } from '@/providers/locale-provider';
import type {
  AccessManagedRoleEntry,
  OverviewMetric,
} from '@/lib/types/management';
import {
  buildContextualSecurityHref,
  buildContextualUsersHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';

interface RolesPageOverviewContentProps {
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

export function RolesPageOverviewContent({
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
}: RolesPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <>
      <MetricGrid metrics={metrics} />
      <AccessCommandCenterSurface
        eyebrow={t('rbac.eyebrow')}
        title={t('roles.commandCenter.title')}
        description={t('roles.commandCenter.description')}
        summaryCards={commandCenterSummaryCards}
        highlightBadge={{ label: sourceStatusLabel, tone: sourceTone }}
        tags={commandCenterTags}
        spotlightEyebrow={t('roles.commandCenter.surfaceTitle')}
        spotlightTitle={priorityRole ? priorityRole.name : t('roles.commandCenter.emptyTitle')}
        spotlightDescription={t('roles.commandCenter.surfaceDescription')}
        spotlightBadges={priorityRoleBadges}
        spotlightMetrics={priorityRoleMetrics}
        spotlightFootnote={priorityRoleFootnote}
      />

      <AccessOverviewSection
        title={t('roles.overview.title')}
        description={t('roles.overview.description')}
        sourceCard={
          <AccessSourceCard
            eyebrow={t('labels.source')}
            title={sourceStatusLabel}
            description={accessMessage}
            badge={{ label: sourceStatusLabel, tone: sourceTone }}
          />
        }
        coverageCard={
          <AccessCoverageCard
            eyebrow={t('roles.overview.coverageTitle')}
            metrics={roleCoverageMetrics}
            footnote={roleCoverageFootnote}
          />
        }
        posturePanel={
          <AccessPosturePanel
            eyebrow={t('roles.posture.title')}
            title={t('roles.posture.heading')}
            description={t('roles.posture.description')}
            signals={rolePostureSignals}
            actions={
              <>
                <Link
                  href={buildContextualUsersHref(accessNavigationContext)}
                  className="secondaryButton"
                >
                  {t('roles.posture.actions.openUsers')}
                  <ArrowRight size={14} />
                </Link>
                <Link
                  href={
                    buildContextualSecurityHref(accessNavigationContext, {
                      focus: 'users',
                      role: priorityRole?.id,
                    })
                  }
                  className="secondaryButton"
                >
                  {t('roles.posture.actions.openSecurity')}
                  <ArrowRight size={14} />
                </Link>
                <Link href={'/dashboard' as Route} className="secondaryButton">
                  {t('roles.posture.actions.openDashboard')}
                  <ArrowRight size={14} />
                </Link>
              </>
            }
          />
        }
      />
    </>
  );
}
