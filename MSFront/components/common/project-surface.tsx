'use client';

import { ProjectSpotlightCardContent } from '@/components/common/project-spotlight-card-content';
import { useLocale } from '@/providers/locale-provider';
import { StatusBadge } from '@/components/common/status-badge';
import type {
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';

export interface ProjectMetricItem {
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

interface ProjectSpotlightCardProps {
  title: string;
  description: string;
  project: ManagedProject | null;
  details: readonly ProjectMetricItem[];
  footnote: string;
  emptyDescription?: string;
}

export function ProjectBadgeGroup({
  status,
  environment,
  className = 'projectBadges',
}: ProjectBadgeGroupProps) {
  const { t } = useLocale();

  return (
    <div className={className}>
      <StatusBadge label={t(`status.${status}`)} type="status" value={status} />
      {environment ? (
        <StatusBadge label={t(`status.${environment}`)} type="environment" value={environment} />
      ) : null}
    </div>
  );
}

export function ProjectMetricList({
  metrics,
  className = 'summaryMetricList',
}: ProjectMetricListProps) {
  return (
    <div className={className}>
      {metrics.map((metric) => (
        <div key={metric.id ?? metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ProjectSpotlightCard({
  title,
  description,
  project,
  details,
  footnote,
  emptyDescription,
}: ProjectSpotlightCardProps) {
  if (!project) {
    return <ProjectSpotlightCardContent title={title} emptyDescription={emptyDescription} />;
  }

  return (
    <ProjectSpotlightCardContent
      title={title}
      description={description}
      project={project}
      details={details}
      footnote={footnote}
      BadgeGroupComponent={ProjectBadgeGroup}
      MetricListComponent={ProjectMetricList}
    />
  );
}
