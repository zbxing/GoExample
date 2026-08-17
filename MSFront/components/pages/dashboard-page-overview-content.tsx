'use client';

import { SummaryCard } from '@/components/common/management-primitives';
import { ProjectCommandCenterSurface } from '@/components/common/project-command-center-surface';
import { ProjectSpotlightSection } from '@/components/common/project-spotlight-section';
import { ProjectSpotlightCard } from '@/components/common/project-surface';
import { RuntimeSurfacePreview } from '@/components/common/runtime-surface-panel';
import { SecurityOverviewPanel } from '@/components/common/security-governance-surface';
import { MetricGrid } from '@/components/dashboard/metric-grid';
import type {
  ManagedProject,
} from '@/lib/types/management';
import type { useDashboardPageController } from '@/lib/utils/use-dashboard-page-controller';
import { useLocale } from '@/providers/locale-provider';

interface DashboardPageOverviewContentProps {
  backendRuntime: ReturnType<typeof useDashboardPageController>['backendRuntime'];
  commandCenterSummaryCards: ReturnType<
    typeof useDashboardPageController
  >['commandCenterSummaryCards'];
  commandCenterTags: ReturnType<typeof useDashboardPageController>['commandCenterTags'];
  metrics: ReturnType<typeof useDashboardPageController>['metrics'];
  projects: ManagedProject[];
  securityOverviewPanelProps: ReturnType<
    typeof useDashboardPageController
  >['securityOverviewPanelProps'];
  spotlightCards: ReturnType<typeof useDashboardPageController>['spotlightCards'];
}

export function DashboardPageOverviewContent({
  backendRuntime,
  commandCenterSummaryCards,
  commandCenterTags,
  metrics,
  projects,
  securityOverviewPanelProps,
  spotlightCards,
}: DashboardPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <>
      <ProjectCommandCenterSurface
        eyebrow={t('nav.dashboard')}
        title={t('dashboard.commandCenter.title')}
        description={t('dashboard.commandCenter.description')}
        summaryCards={
          <>
            {commandCenterSummaryCards.map((card) => (
              <SummaryCard
                key={card.label}
                label={card.label}
                value={card.value}
                footnote={card.footnote}
              />
            ))}
          </>
        }
        tags={
          <>
            {commandCenterTags.map((tag) => (
              <span key={tag} className="securityTag">
                {tag}
              </span>
            ))}
          </>
        }
        spotlight={
          <RuntimeSurfacePreview
            title={t('dashboard.backend.title')}
            description={t('dashboard.backend.description')}
            summary={backendRuntime}
          />
        }
      />

      <MetricGrid metrics={metrics} />

      <SecurityOverviewPanel {...securityOverviewPanelProps} />

      <ProjectSpotlightSection
        title={t('dashboard.spotlights.title')}
        description={t('dashboard.spotlights.description')}
        emptyTitle={t('dashboard.spotlights.emptyTitle')}
        emptyDescription={t('dashboard.spotlights.emptyDescription')}
        hasContent={projects.length > 0}
      >
        {spotlightCards.map((card) => (
          <ProjectSpotlightCard
            key={card.id}
            title={card.title}
            description={card.description}
            project={card.project}
            footnote={card.footnote}
            details={card.details}
          />
        ))}
      </ProjectSpotlightSection>
    </>
  );
}
