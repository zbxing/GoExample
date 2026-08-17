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
  AccessManagedUserEntry,
  OverviewMetric,
} from '@/lib/types/management';
import {
  buildContextualRolesHref,
  buildContextualSecurityHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';

interface UsersPageOverviewContentProps {
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

export function UsersPageOverviewContent({
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
}: UsersPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <>
      <MetricGrid metrics={metrics} />
      <AccessCommandCenterSurface
        eyebrow={t('rbac.eyebrow')}
        title={t('users.commandCenter.title')}
        description={t('users.commandCenter.description')}
        summaryCards={commandCenterSummaryCards}
        highlightBadge={{ label: sourceStatusLabel, tone: sourceTone }}
        tags={commandCenterTags}
        spotlightEyebrow={t('users.commandCenter.surfaceTitle')}
        spotlightTitle={priorityUser ? priorityUser.displayName : t('users.commandCenter.emptyTitle')}
        spotlightDescription={t('users.commandCenter.surfaceDescription')}
        spotlightBadges={priorityUserBadges}
        spotlightMetrics={priorityUserMetrics}
        spotlightFootnote={priorityUserFootnote}
      />

      <AccessOverviewSection
        title={t('users.overview.title')}
        description={t('users.overview.description')}
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
            eyebrow={t('users.overview.coverageTitle')}
            metrics={userCoverageMetrics}
            footnote={userCoverageFootnote}
          />
        }
        posturePanel={
          <AccessPosturePanel
            eyebrow={t('users.posture.title')}
            title={t('users.posture.heading')}
            description={t('users.posture.description')}
            signals={userPostureSignals}
            actions={
              <>
                <Link
                  href={buildContextualRolesHref(accessNavigationContext)}
                  className="secondaryButton"
                >
                  {t('users.posture.actions.openRoles')}
                  <ArrowRight size={14} />
                </Link>
                <Link
                  href={
                    buildContextualSecurityHref(accessNavigationContext, {
                      focus: 'users',
                      status: 'disabled',
                    })
                  }
                  className="secondaryButton"
                >
                  {t('users.posture.actions.openSecurity')}
                  <ArrowRight size={14} />
                </Link>
                <Link href={'/dashboard' as Route} className="secondaryButton">
                  {t('users.posture.actions.openDashboard')}
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
