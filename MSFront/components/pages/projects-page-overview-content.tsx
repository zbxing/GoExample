'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SummaryCard } from '@/components/common/management-primitives';
import { ProjectCommandCenterSurface } from '@/components/common/project-command-center-surface';
import { ProjectSpotlightSection } from '@/components/common/project-spotlight-section';
import {
  ProjectBadgeGroup,
  ProjectMetricList,
  ProjectSpotlightCard,
} from '@/components/common/project-surface';
import type { ManagedProject } from '@/lib/types/management';
import type { useProjectsPageSurfaceController } from '@/lib/utils/use-projects-page-surface-controller';
import { useLocale } from '@/providers/locale-provider';

interface ProjectsPageOverviewContentProps {
  commandCenterSpotlightFootnote: ReturnType<
    typeof useProjectsPageSurfaceController
  >['commandCenterSpotlightFootnote'];
  commandCenterSpotlightMetrics: ReturnType<
    typeof useProjectsPageSurfaceController
  >['commandCenterSpotlightMetrics'];
  commandCenterSummaryCards: ReturnType<
    typeof useProjectsPageSurfaceController
  >['commandCenterSummaryCards'];
  commandCenterTags: ReturnType<typeof useProjectsPageSurfaceController>['commandCenterTags'];
  priorityProject: ManagedProject | null;
  projects: ManagedProject[];
  spotlightCards: ReturnType<typeof useProjectsPageSurfaceController>['spotlightCards'];
}

export function ProjectsPageOverviewContent({
  commandCenterSpotlightFootnote,
  commandCenterSpotlightMetrics,
  commandCenterSummaryCards,
  commandCenterTags,
  priorityProject,
  projects,
  spotlightCards,
}: ProjectsPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <>
      <ProjectCommandCenterSurface
        eyebrow={t('nav.projects')}
        title={t('projectsHub.commandCenter.title')}
        description={t('projectsHub.commandCenter.description')}
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
          <article className="dashboardSpotlightCard">
            <div className="dashboardSpotlightHeader">
              <div>
                <span className="serviceCategory">{t('labels.projectRegistry')}</span>
                <h3>{t('projectsHub.commandCenter.surfaceTitle')}</h3>
                <p>{t('projectsHub.commandCenter.surfaceDescription')}</p>
              </div>
              {priorityProject ? (
                <ProjectBadgeGroup
                  status={priorityProject.status}
                  environment={priorityProject.environment}
                />
              ) : null}
            </div>

            <ProjectMetricList metrics={commandCenterSpotlightMetrics} />

            <p className="summaryFootnote">{commandCenterSpotlightFootnote}</p>

            <div className="dashboardSecurityActionGrid">
              <Link href={'/services' as Route} className="secondaryButton">
                {t('projectsHub.rail.openServices')}
                <ArrowRight size={14} />
              </Link>
              <Link href={'/environments' as Route} className="secondaryButton">
                {t('projectsHub.rail.openEnvironments')}
                <ArrowRight size={14} />
              </Link>
              <Link href={'/integrations' as Route} className="secondaryButton">
                {t('projectsHub.rail.openIntegrations')}
                <ArrowRight size={14} />
              </Link>
            </div>
          </article>
        }
      />

      <ProjectSpotlightSection
        title={t('projectsHub.spotlightTitle')}
        description={t('projectsHub.spotlightDescription')}
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
