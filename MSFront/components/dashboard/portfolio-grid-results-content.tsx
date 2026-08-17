'use client';

import Link from 'next/link';
import { ArrowRight, Copy } from 'lucide-react';
import { FeedbackBanner } from '@/components/common/feedback-banner';
import {
  WorkbenchStatusGroupSection,
  WorkbenchStatusGroupStack,
} from '@/components/common/workbench-status-group';
import {
  ProjectBadgeGroup,
  ProjectMetricList,
} from '@/components/common/project-surface';
import { useLocale } from '@/providers/locale-provider';
import type { ManagedProject, ProjectStatus } from '@/lib/types/management';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/utils/format';
import { useFeedback } from '@/lib/utils/use-feedback';
import { buildProjectDetailHref } from '@/lib/utils/governance-filters';

type PortfolioGridProjectGroup = {
  status: ProjectStatus;
  entries: readonly ManagedProject[];
};

interface PortfolioGridResultsContentProps {
  groupedProjects: readonly PortfolioGridProjectGroup[];
  onCopyApi: (apiBaseUrl: string) => Promise<void>;
}

export function PortfolioGridResultsContent({
  groupedProjects,
  onCopyApi,
}: PortfolioGridResultsContentProps) {
  const { locale, t } = useLocale();

  if (groupedProjects.length === 0) {
    return (
      <div className="emptyStatePanel">
        <strong>{t('dashboard.portfolio.noResultsTitle')}</strong>
        <p>{t('dashboard.portfolio.noResultsDescription')}</p>
      </div>
    );
  }

  return (
    <WorkbenchStatusGroupStack>
      {groupedProjects.map((group) => (
        <WorkbenchStatusGroupSection
          key={group.status}
          eyebrow={t(`status.${group.status}`)}
          title={t(`status.${group.status}`)}
          description={t(`dashboard.portfolio.groups.${group.status}`)}
          summary={t('dashboard.portfolio.results.projectsCount', {
            count: formatNumber(group.entries.length, locale),
          })}
          bodyClassName="portfolioGrid"
        >
          {group.entries.map((project) => (
            <PortfolioGridProjectCard
              key={project.id}
              project={project}
              onCopyApi={onCopyApi}
            />
          ))}
        </WorkbenchStatusGroupSection>
      ))}
    </WorkbenchStatusGroupStack>
  );
}

function PortfolioGridProjectCard({
  project,
  onCopyApi,
}: {
  project: ManagedProject;
  onCopyApi: (apiBaseUrl: string) => Promise<void>;
}) {
  const { locale, t } = useLocale();
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback({ durationMs: 2200 });

  async function handleCopyApi() {
    clearFeedback();

    try {
      await onCopyApi(project.apiBaseUrl);
      showSuccess(t('actions.copySuccess'));
    } catch {
      showError(t('actions.copyError'));
    }
  }

  return (
    <article className="projectCard">
      <div className="projectCardHeader">
        <div>
          <p className="projectCode">{project.code}</p>
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>
        <div className="projectBadges">
          <ProjectBadgeGroup status={project.status} environment={project.environment} />
        </div>
      </div>
      <ProjectMetricList
        className="projectStats"
        metrics={[
          {
            label: t('labels.activeUsers'),
            value: formatNumber(project.activeUsers, locale),
          },
          {
            label: t('labels.requests'),
            value: formatNumber(project.requestPerMinute, locale),
          },
          {
            label: t('labels.errorRate'),
            value: `${formatPercent(project.errorRate, locale)}%`,
          },
          {
            label: t('labels.lastDeploy'),
            value: formatDateTime(project.lastDeployedAt, locale),
          },
        ]}
      />
      <div className="projectMeta">
        <span>{project.region}</span>
        <span>{project.owner}</span>
        <span>{project.version}</span>
      </div>
      <FeedbackBanner feedback={feedback} />
      <div className="projectActions">
        <button
          type="button"
          className="secondaryButton"
          onClick={() => {
            void handleCopyApi();
          }}
        >
          <Copy size={14} />
          {t('actions.copyApi')}
        </button>
        <Link href={buildProjectDetailHref(project.id)} className="primaryButton">
          {t('actions.viewProject')}
          <ArrowRight size={14} />
        </Link>
      </div>
    </article>
  );
}
