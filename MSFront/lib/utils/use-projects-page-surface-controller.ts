'use client';

import { useMemo } from 'react';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import {
  buildProjectsPageCommandCenterSummary,
  useProjectsPageCommandCenterSurfaceController,
} from '@/lib/utils/use-projects-page-command-center-surface-controller';
import { useProjectsPageCommandCenterSpotlightSurfaceController } from '@/lib/utils/use-projects-page-command-center-spotlight-surface-controller';
import { useProjectsPageSpotlightSelectionSurfaceController } from '@/lib/utils/use-projects-page-spotlight-selection-surface-controller';
import { useProjectsPageSpotlightSurfaceController } from '@/lib/utils/use-projects-page-spotlight-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectsPageSurfaceControllerOptions {
  projects: readonly ManagedProject[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectsPageSurfaceController({
  projects,
  locale,
  t,
}: UseProjectsPageSurfaceControllerOptions) {
  const commandCenterSummary = useMemo(
    () => buildProjectsPageCommandCenterSummary(projects),
    [projects],
  );
  const {
    highestTrafficProject,
    latestDeployProject,
    latestReleaseLabel,
    priorityProject,
  } = useProjectsPageSpotlightSelectionSurfaceController({
    projects,
    locale,
    t,
  });
  const { spotlightCards } = useProjectsPageSpotlightSurfaceController({
    highestTrafficProject,
    latestDeployProject,
    locale,
    priorityProject,
    t,
  });
  const {
    commandCenterSummaryCards,
    commandCenterTags,
  } = useProjectsPageCommandCenterSurfaceController({
    commandCenterSummary,
    locale,
    projectsCount: projects.length,
    latestReleaseLabel,
    t,
  });
  const {
    commandCenterSpotlightFootnote,
    commandCenterSpotlightMetrics,
  } = useProjectsPageCommandCenterSpotlightSurfaceController({
    commandCenterSummary,
    locale,
    priorityProject,
    t,
  });
  const projectConsoleKey = useMemo(
    () =>
      JSON.stringify(
        projects.map((project) => [
          project.id,
          project.code,
          project.name,
          project.status,
          project.environment,
          project.version,
          project.lastDeployedAt,
        ]),
      ),
    [projects],
  );

  return {
    commandCenterSpotlightFootnote,
    commandCenterSpotlightMetrics,
    commandCenterSummaryCards,
    commandCenterTags,
    latestReleaseLabel,
    priorityProject,
    projectConsoleKey,
    spotlightCards,
  };
}
