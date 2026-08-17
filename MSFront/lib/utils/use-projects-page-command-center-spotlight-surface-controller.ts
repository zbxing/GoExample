'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import {
  formatNumber,
  formatPercent,
} from '@/lib/utils/format';
import type { ProjectsPageCommandCenterSummary } from '@/lib/utils/use-projects-page-command-center-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectsPageCommandCenterSpotlightSurfaceControllerOptions {
  commandCenterSummary: ProjectsPageCommandCenterSummary;
  locale: LocaleCode;
  priorityProject: ManagedProject | null;
  t: TranslationFn;
}

export function useProjectsPageCommandCenterSpotlightSurfaceController({
  commandCenterSummary,
  locale,
  priorityProject,
  t,
}: UseProjectsPageCommandCenterSpotlightSurfaceControllerOptions) {
  const commandCenterSpotlightMetrics = useMemo<ProjectMetricItem[]>(
    () => [
      {
        label: t('projectConsole.overview.servers'),
        value: formatNumber(commandCenterSummary.totalServers, locale),
      },
      {
        label: t('projectConsole.overview.services'),
        value: formatNumber(commandCenterSummary.totalServices, locale),
      },
      {
        label: t('labels.errorRate'),
        value: `${formatPercent(commandCenterSummary.averageErrorRate, locale)}%`,
      },
      {
        label: t('projectsHub.summary.probes'),
        value: formatNumber(commandCenterSummary.probeReadyCount, locale),
      },
    ],
    [commandCenterSummary, locale, t],
  );

  const commandCenterSpotlightFootnote = priorityProject
    ? [priorityProject.name, priorityProject.owner, priorityProject.region].join(' / ')
    : t('dashboard.spotlights.emptyDescription');

  return {
    commandCenterSpotlightFootnote,
    commandCenterSpotlightMetrics,
  };
}
