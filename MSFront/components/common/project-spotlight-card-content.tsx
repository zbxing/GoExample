'use client';

import type { ComponentType } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type {
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { buildProjectDetailHref } from '@/lib/utils/governance-filters';
import { buildProjectIdentityMeta } from '@/lib/utils/project-surface';
import { useLocale } from '@/providers/locale-provider';

interface ProjectMetricItem {
  id?: string;
  label: string;
  value: string;
}

interface ProjectBadgeGroupProps {
  status: ProjectStatus;
  environment?: ProjectEnvironment | null;
  className?: string;
}

interface ProjectMetricListProps {
  metrics: readonly ProjectMetricItem[];
  className?: string;
}

interface ProjectSpotlightCardContentProps {
  title: string;
  description?: string;
  project?: ManagedProject | null;
  details?: readonly ProjectMetricItem[];
  footnote?: string;
  emptyDescription?: string;
  BadgeGroupComponent?: ComponentType<ProjectBadgeGroupProps>;
  MetricListComponent?: ComponentType<ProjectMetricListProps>;
}

export function ProjectSpotlightCardContent({
  title,
  description,
  project,
  details,
  footnote,
  emptyDescription,
  BadgeGroupComponent,
  MetricListComponent,
}: ProjectSpotlightCardContentProps) {
  const { t } = useLocale();

  if (!project) {
    return (
      <article className="dashboardSpotlightCard emptyStatePanel">
        <strong>{title}</strong>
        <p>{emptyDescription ?? t('dashboard.spotlights.emptyDescription')}</p>
      </article>
    );
  }

  if (!BadgeGroupComponent || !MetricListComponent || !details || !footnote || !description) {
    return null;
  }

  return (
    <article className="dashboardSpotlightCard">
      <div className="dashboardSpotlightHeader">
        <div>
          <span className="serviceCategory">{title}</span>
          <h3>{project.name}</h3>
          <p>{description}</p>
        </div>
        <BadgeGroupComponent status={project.status} environment={project.environment} />
      </div>

      <p className="summaryFootnote">{buildProjectIdentityMeta(project)}</p>

      <MetricListComponent metrics={details} />

      <p className="summaryFootnote">{footnote}</p>

      <div className="dashboardSpotlightActions">
        <Link href={buildProjectDetailHref(project.id)} className="secondaryButton">
          {t('actions.viewProject')}
          <ArrowRight size={14} />
        </Link>
      </div>
    </article>
  );
}
