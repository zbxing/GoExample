'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  LocaleCode,
  ManagedProject,
  ManagementBackendProbe,
  ManagementOverview,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface DashboardSummaryCard {
  id: string;
  label: string;
  value: string;
  footnote: string;
}

export interface DashboardSpotlightCard {
  id: 'priority' | 'traffic' | 'release';
  title: string;
  description: string;
  project: ManagedProject | null;
  footnote: string;
  details: ProjectMetricItem[];
}

interface UseDashboardPagePresentationControllerOptions {
  overview: ManagementOverview & {
    backend: ManagementBackendProbe;
  };
  attentionProjectsCount: number;
  priorityProject: ManagedProject | null;
  highestTrafficProject: ManagedProject | null;
  latestDeployProject: ManagedProject | null;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useDashboardPagePresentationController({
  overview,
  attentionProjectsCount,
  priorityProject,
  highestTrafficProject,
  latestDeployProject,
  locale,
  t,
}: UseDashboardPagePresentationControllerOptions) {
  const healthyProjectRatio = overview.summary.totalProjects
    ? `${formatNumber(overview.summary.healthyProjects, locale)} / ${formatNumber(overview.summary.totalProjects, locale)}`
    : formatNumber(0, locale);
  const commandCenterSummaryCards = useMemo<DashboardSummaryCard[]>(
    () => [
      {
        id: 'projects',
        label: t('labels.projectCount'),
        value: formatNumber(overview.summary.totalProjects, locale),
        footnote: t('dashboard.metrics.projectsDelta', {
          production: formatNumber(overview.summary.productionProjects, locale),
          staging: formatNumber(overview.summary.stagingProjects, locale),
          development: formatNumber(overview.summary.developmentProjects, locale),
        }),
      },
      {
        id: 'healthy',
        label: t('status.healthy'),
        value: healthyProjectRatio,
        footnote: `${formatNumber(overview.summary.criticalProjects, locale)} ${t('status.critical')}`,
      },
      {
        id: 'attention',
        label: t('dashboard.portfolio.attentionLabel'),
        value: formatNumber(attentionProjectsCount, locale),
        footnote: `${formatNumber(overview.summary.totalAlerts, locale)} ${t('dashboard.metrics.alertsLabel')}`,
      },
      {
        id: 'error-rate',
        label: t('labels.errorRate'),
        value: `${formatPercent(overview.summary.averageErrorRate, locale)}%`,
        footnote: `${formatNumber(overview.summary.totalRequestPerMinute, locale)} ${t('labels.requests')}`,
      },
    ],
    [attentionProjectsCount, healthyProjectRatio, locale, overview.summary, t],
  );
  const commandCenterTags = useMemo(
    () => [
      `${t('dashboard.portfolio.ownerCoverageLabel')}: ${formatNumber(overview.summary.ownerCount, locale)}`,
      `${t('dashboard.portfolio.regionCoverageLabel')}: ${formatNumber(overview.summary.regionCount, locale)}`,
      `${t('labels.activeUsers')}: ${formatNumber(overview.summary.totalActiveUsers, locale)}`,
    ],
    [locale, overview.summary, t],
  );
  const spotlightCards = useMemo<DashboardSpotlightCard[]>(
    () => [
      {
        id: 'priority',
        title: t('dashboard.spotlights.priorityTitle'),
        description: t('dashboard.spotlights.priorityDescription'),
        project: priorityProject,
        footnote: priorityProject
          ? overview.alerts[0]
            ? `${t('dashboard.spotlights.latestAlert')}: ${overview.alerts[0].projectName}`
            : t('dashboard.spotlights.noAlert')
          : t('dashboard.spotlights.noAlert'),
        details: priorityProject
          ? [
              {
                label: t('labels.errorRate'),
                value: `${formatPercent(priorityProject.errorRate, locale)}%`,
              },
              {
                label: t('labels.requests'),
                value: formatNumber(priorityProject.requestPerMinute, locale),
              },
              {
                label: t('labels.activeUsers'),
                value: formatNumber(priorityProject.activeUsers, locale),
              },
              {
                label: t('sections.servers'),
                value: formatNumber(priorityProject.servers.length, locale),
              },
            ]
          : [],
      },
      {
        id: 'traffic',
        title: t('dashboard.spotlights.trafficTitle'),
        description: t('dashboard.spotlights.trafficDescription'),
        project: highestTrafficProject,
        footnote: highestTrafficProject?.description ?? t('dashboard.spotlights.noAlert'),
        details: highestTrafficProject
          ? [
              {
                label: t('labels.requests'),
                value: formatNumber(highestTrafficProject.requestPerMinute, locale),
              },
              {
                label: t('labels.activeUsers'),
                value: formatNumber(highestTrafficProject.activeUsers, locale),
              },
              {
                label: t('sections.services'),
                value: formatNumber(highestTrafficProject.services.length, locale),
              },
              {
                label: t('labels.errorRate'),
                value: `${formatPercent(highestTrafficProject.errorRate, locale)}%`,
              },
            ]
          : [],
      },
      {
        id: 'release',
        title: t('dashboard.spotlights.releaseTitle'),
        description: t('dashboard.spotlights.releaseDescription'),
        project: latestDeployProject,
        footnote: latestDeployProject
          ? `${t('labels.lastDeploy')}: ${formatDateTime(latestDeployProject.lastDeployedAt, locale)}`
          : t('dashboard.spotlights.noAlert'),
        details: latestDeployProject
          ? [
              {
                label: t('labels.version'),
                value: latestDeployProject.version,
              },
              {
                label: t('labels.owner'),
                value: latestDeployProject.owner,
              },
              {
                label: t('sections.services'),
                value: formatNumber(latestDeployProject.services.length, locale),
              },
              {
                label: t('sections.servers'),
                value: formatNumber(latestDeployProject.servers.length, locale),
              },
            ]
          : [],
      },
    ],
    [
      highestTrafficProject,
      latestDeployProject,
      locale,
      overview.alerts,
      priorityProject,
      t,
    ],
  );

  return {
    commandCenterSummaryCards,
    commandCenterTags,
    spotlightCards,
  };
}
