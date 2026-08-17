'use client';

import { useMemo } from 'react';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import {
  formatNumber,
} from '@/lib/utils/format';
import { projectNeedsAttention } from '@/lib/utils/project-surface';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface ProjectsPageSummaryCard {
  label: string;
  value: string;
  footnote: string;
}

export interface ProjectsPageCommandCenterSummary {
  attentionCount: number;
  averageErrorRate: number;
  criticalCount: number;
  developmentCount: number;
  ownerCoverage: number;
  probeReadyCount: number;
  productionCount: number;
  regionCoverage: number;
  stagingCount: number;
  totalActiveUsers: number;
  totalRequestPerMinute: number;
  totalServers: number;
  totalServices: number;
  warningCount: number;
}

interface UseProjectsPageCommandCenterSurfaceControllerOptions {
  commandCenterSummary: ProjectsPageCommandCenterSummary;
  locale: LocaleCode;
  projectsCount: number;
  latestReleaseLabel: string;
  t: TranslationFn;
}

export function useProjectsPageCommandCenterSurfaceController({
  commandCenterSummary,
  locale,
  projectsCount,
  latestReleaseLabel,
  t,
}: UseProjectsPageCommandCenterSurfaceControllerOptions) {
  const commandCenterSummaryCards = useMemo<ProjectsPageSummaryCard[]>(
    () => [
      {
        label: t('labels.projectCount'),
        value: formatNumber(projectsCount, locale),
        footnote: t('dashboard.portfolio.filteredLabel'),
      },
      {
        label: t('projectsHub.summary.production'),
        value: formatNumber(commandCenterSummary.productionCount, locale),
        footnote: t('projectsHub.footnotes.production', {
          staging: formatNumber(commandCenterSummary.stagingCount, locale),
          development: formatNumber(commandCenterSummary.developmentCount, locale),
        }),
      },
      {
        label: t('projectsHub.summary.attention'),
        value: formatNumber(commandCenterSummary.attentionCount, locale),
        footnote: t('projectsHub.footnotes.attention', {
          critical: formatNumber(commandCenterSummary.criticalCount, locale),
          warning: formatNumber(commandCenterSummary.warningCount, locale),
        }),
      },
      {
        label: t('projectsHub.summary.traffic'),
        value: formatNumber(commandCenterSummary.totalRequestPerMinute, locale),
        footnote: t('projectsHub.footnotes.traffic', {
          count: formatNumber(commandCenterSummary.totalActiveUsers, locale),
        }),
      },
    ],
    [commandCenterSummary, locale, projectsCount, t],
  );

  const commandCenterTags = useMemo(
    () => [
      `${t('dashboard.portfolio.ownerCoverageLabel')}: ${formatNumber(commandCenterSummary.ownerCoverage, locale)}`,
      `${t('dashboard.portfolio.regionCoverageLabel')}: ${formatNumber(commandCenterSummary.regionCoverage, locale)}`,
      `${t('projectsHub.summary.probes')}: ${formatNumber(commandCenterSummary.probeReadyCount, locale)}`,
      `${t('projectsHub.rail.latestRelease')}: ${latestReleaseLabel}`,
    ],
    [commandCenterSummary, latestReleaseLabel, locale, t],
  );

  return {
    commandCenterSummaryCards,
    commandCenterTags,
  };
}

export function buildProjectsPageCommandCenterSummary(
  projects: readonly ManagedProject[],
): ProjectsPageCommandCenterSummary {
  const productionCount = projects.filter((project) => project.environment === 'production').length;
  const stagingCount = projects.filter((project) => project.environment === 'staging').length;
  const developmentCount = projects.filter((project) => project.environment === 'development').length;
  const warningCount = projects.filter((project) => project.status === 'warning').length;
  const criticalCount = projects.filter((project) => project.status === 'critical').length;
  const attentionCount = projects.filter((project) => projectNeedsAttention(project)).length;
  const probeReadyCount = projects.filter((project) => Boolean(project.probeBaseUrl)).length;
  const totalActiveUsers = projects.reduce((sum, project) => sum + project.activeUsers, 0);
  const totalRequestPerMinute = projects.reduce(
    (sum, project) => sum + project.requestPerMinute,
    0,
  );
  const totalServers = projects.reduce((sum, project) => sum + project.servers.length, 0);
  const totalServices = projects.reduce((sum, project) => sum + project.services.length, 0);
  const averageErrorRate =
    projects.length > 0
      ? projects.reduce((sum, project) => sum + project.errorRate, 0) / projects.length
      : 0;
  const ownerCoverage = new Set(projects.map((project) => project.owner)).size;
  const regionCoverage = new Set(projects.map((project) => project.region)).size;

  return {
    attentionCount,
    averageErrorRate,
    criticalCount,
    developmentCount,
    ownerCoverage,
    probeReadyCount,
    productionCount,
    regionCoverage,
    stagingCount,
    totalActiveUsers,
    totalRequestPerMinute,
    totalServers,
    totalServices,
    warningCount,
  };
}
