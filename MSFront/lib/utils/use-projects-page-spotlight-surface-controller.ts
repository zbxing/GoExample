'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface ProjectsPageSpotlightCard {
  id: 'priority' | 'traffic' | 'release';
  title: string;
  description: string;
  project: ManagedProject | null;
  footnote: string;
  details: ProjectMetricItem[];
}

interface UseProjectsPageSpotlightSurfaceControllerOptions {
  highestTrafficProject: ManagedProject | null;
  latestDeployProject: ManagedProject | null;
  priorityProject: ManagedProject | null;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectsPageSpotlightSurfaceController({
  highestTrafficProject,
  latestDeployProject,
  priorityProject,
  locale,
  t,
}: UseProjectsPageSpotlightSurfaceControllerOptions) {
  const spotlightCards = useMemo<ProjectsPageSpotlightCard[]>(
    () => [
      {
        id: 'priority',
        title: t('dashboard.spotlights.priorityTitle'),
        description: t('dashboard.spotlights.priorityDescription'),
        project: priorityProject,
        footnote: priorityProject?.description || t('projectConsole.noDescription'),
        details: buildPriorityDetails(priorityProject, locale, t),
      },
      {
        id: 'traffic',
        title: t('dashboard.spotlights.trafficTitle'),
        description: t('dashboard.spotlights.trafficDescription'),
        project: highestTrafficProject,
        footnote: highestTrafficProject?.description || t('projectConsole.noDescription'),
        details: buildTrafficDetails(highestTrafficProject, locale, t),
      },
      {
        id: 'release',
        title: t('dashboard.spotlights.releaseTitle'),
        description: t('dashboard.spotlights.releaseDescription'),
        project: latestDeployProject,
        footnote: latestDeployProject
          ? `${t('labels.lastDeploy')}: ${formatDateTime(latestDeployProject.lastDeployedAt, locale)}`
          : t('projectsHub.rail.noRelease'),
        details: buildReleaseDetails(latestDeployProject, locale, t),
      },
    ],
    [highestTrafficProject, latestDeployProject, locale, priorityProject, t],
  );

  return {
    spotlightCards,
  };
}

function buildPriorityDetails(
  project: ManagedProject | null,
  locale: LocaleCode,
  t: TranslationFn,
): ProjectMetricItem[] {
  if (!project) {
    return [];
  }

  return [
    {
      label: t('labels.errorRate'),
      value: `${formatPercent(project.errorRate, locale)}%`,
    },
    {
      label: t('labels.requests'),
      value: formatNumber(project.requestPerMinute, locale),
    },
    {
      label: t('projectConsole.overview.servers'),
      value: formatNumber(project.servers.length, locale),
    },
    {
      label: t('projectConsole.overview.services'),
      value: formatNumber(project.services.length, locale),
    },
  ];
}

function buildTrafficDetails(
  project: ManagedProject | null,
  locale: LocaleCode,
  t: TranslationFn,
): ProjectMetricItem[] {
  if (!project) {
    return [];
  }

  return [
    {
      label: t('labels.requests'),
      value: formatNumber(project.requestPerMinute, locale),
    },
    {
      label: t('labels.activeUsers'),
      value: formatNumber(project.activeUsers, locale),
    },
    {
      label: t('labels.errorRate'),
      value: `${formatPercent(project.errorRate, locale)}%`,
    },
    {
      label: t('projectConsole.overview.services'),
      value: formatNumber(project.services.length, locale),
    },
  ];
}

function buildReleaseDetails(
  project: ManagedProject | null,
  locale: LocaleCode,
  t: TranslationFn,
): ProjectMetricItem[] {
  if (!project) {
    return [];
  }

  return [
    {
      label: t('labels.version'),
      value: project.version,
    },
    {
      label: t('projectsHub.summary.probes'),
      value: project.probeBaseUrl
        ? t('dashboard.backend.probeEnabled')
        : t('dashboard.integrations.probeEmpty'),
    },
    {
      label: t('projectConsole.overview.servers'),
      value: formatNumber(project.servers.length, locale),
    },
    {
      label: t('projectConsole.overview.services'),
      value: formatNumber(project.services.length, locale),
    },
  ];
}
