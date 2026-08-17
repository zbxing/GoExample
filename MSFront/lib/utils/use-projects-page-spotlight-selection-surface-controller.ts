'use client';

import { useMemo } from 'react';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import { formatDateTime } from '@/lib/utils/format';
import { calculateProjectRiskScore } from '@/lib/utils/project-surface';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectsPageSpotlightSelectionSurfaceControllerOptions {
  projects: readonly ManagedProject[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectsPageSpotlightSelectionSurfaceController({
  projects,
  locale,
  t,
}: UseProjectsPageSpotlightSelectionSurfaceControllerOptions) {
  const priorityProject = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          calculateProjectRiskScore(right) - calculateProjectRiskScore(left) ||
          right.requestPerMinute - left.requestPerMinute ||
          left.name.localeCompare(right.name, locale),
      )[0] ?? null,
    [locale, projects],
  );

  const highestTrafficProject = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          right.requestPerMinute - left.requestPerMinute ||
          calculateProjectRiskScore(right) - calculateProjectRiskScore(left),
      )[0] ?? null,
    [projects],
  );

  const latestDeployProject = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          new Date(right.lastDeployedAt).valueOf() - new Date(left.lastDeployedAt).valueOf(),
      )[0] ?? null,
    [projects],
  );

  const latestReleaseLabel = latestDeployProject
    ? formatDateTime(latestDeployProject.lastDeployedAt, locale)
    : t('projectsHub.rail.noRelease');

  return {
    highestTrafficProject,
    latestDeployProject,
    latestReleaseLabel,
    priorityProject,
  };
}
