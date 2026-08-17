'use client';

import { SummaryCard } from '@/components/common/management-primitives';
import { ProjectBadgeGroup } from '@/components/common/project-surface';
import { RuntimeSurfacePreview } from '@/components/common/runtime-surface-panel';
import type { ManagedProject } from '@/lib/types/management';
import type { useProjectDetailPageController } from '@/lib/utils/use-project-detail-page-controller';
import type { useProjectDetailPageSurfaceController } from '@/lib/utils/use-project-detail-page-surface-controller';
import { useLocale } from '@/providers/locale-provider';

interface ProjectDetailPageOverviewContentProps {
  heroStats: ReturnType<typeof useProjectDetailPageSurfaceController>['heroStats'];
  heroTagLabels: ReturnType<typeof useProjectDetailPageSurfaceController>['heroTagLabels'];
  overviewCards: ReturnType<typeof useProjectDetailPageController>['overviewCards'];
  project: ManagedProject;
  runtimeSummary: ReturnType<typeof useProjectDetailPageController>['runtimeSummary'];
}

export function ProjectDetailPageOverviewContent({
  heroStats,
  heroTagLabels,
  overviewCards,
  project,
  runtimeSummary,
}: ProjectDetailPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <section className="heroCard projectDetailHero">
      <div className="projectWorkbenchStack">
        <ProjectBadgeGroup status={project.status} environment={project.environment} />
        <div className="projectWorkbenchStack">
          <div>
            <span className="serviceCategory">{t('projectDetail.overviewTitle')}</span>
            <p className="summaryFootnote">{t('projectDetail.overviewDescription')}</p>
          </div>
          <div className="heroStats">
            {heroStats.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="portfolioSummaryGrid projectSummaryGrid">
            {overviewCards.map((card) => (
              <SummaryCard
                key={card.label}
                label={card.label}
                value={card.value}
                footnote={card.footnote}
              />
            ))}
          </div>
          <div className="tagList">
            {heroTagLabels.map((tag) => (
              <span key={tag} className="securityTag">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="heroHealth">
        <RuntimeSurfacePreview
          title={t('projectDetail.runtimeTitle')}
          description={t('projectDetail.runtimePreviewDescription')}
          summary={runtimeSummary}
        />
      </div>
    </section>
  );
}
