'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  LocaleCode,
  ManagedProject,
  ManagedProjectDraft,
} from '@/lib/types/management';
import { formatDateTime, formatNumber, joinDetails } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SummaryCardDescriptor {
  label: string;
  value: string;
  footnote: string;
}

interface ProjectRegistryEntryDescriptor {
  id: string;
  name: string;
  identity: string;
  detail: string;
  status: ManagedProject['status'];
  environment: ManagedProject['environment'];
  metrics: ProjectMetricItem[];
}

interface UseProjectManagementConsoleSurfaceControllerOptions {
  activeProject: ManagedProject | null;
  configuredUrlCount: number;
  draft: ManagedProjectDraft | null;
  filteredProjectList: readonly ManagedProject[];
  locale: LocaleCode;
  registryAttentionCount: number;
  registryOwnerCount: number;
  registryProductionCount: number;
  registryRegionCount: number;
  t: TranslationFn;
  validationIssues: readonly string[];
}

export function useProjectManagementConsoleSurfaceController({
  activeProject,
  configuredUrlCount,
  draft,
  filteredProjectList,
  locale,
  registryAttentionCount,
  registryOwnerCount,
  registryProductionCount,
  registryRegionCount,
  t,
  validationIssues,
}: UseProjectManagementConsoleSurfaceControllerOptions) {
  const registrySummaryCards = useMemo<SummaryCardDescriptor[]>(
    () => [
      {
        label: t('labels.projectCount'),
        value: formatNumber(filteredProjectList.length, locale),
        footnote: t('dashboard.portfolio.filteredLabel'),
      },
      {
        label: t('status.production'),
        value: formatNumber(registryProductionCount, locale),
        footnote: t('labels.environment'),
      },
      {
        label: t('dashboard.portfolio.attentionLabel'),
        value: formatNumber(registryAttentionCount, locale),
        footnote: t('labels.status'),
      },
      {
        label: t('labels.owner'),
        value: formatNumber(registryOwnerCount, locale),
        footnote: t('dashboard.portfolio.ownerCoverageLabel'),
      },
    ],
    [
      filteredProjectList.length,
      locale,
      registryAttentionCount,
      registryOwnerCount,
      registryProductionCount,
      t,
    ],
  );
  const registryTags = useMemo(
    () => [
      `${t('labels.projectCount')}: ${formatNumber(filteredProjectList.length, locale)}`,
      `${t('dashboard.portfolio.ownerCoverageLabel')}: ${formatNumber(registryOwnerCount, locale)}`,
      `${t('dashboard.portfolio.regionCoverageLabel')}: ${formatNumber(registryRegionCount, locale)}`,
      `${t('dashboard.portfolio.attentionLabel')}: ${formatNumber(registryAttentionCount, locale)}`,
    ],
    [
      filteredProjectList.length,
      locale,
      registryAttentionCount,
      registryOwnerCount,
      registryRegionCount,
      t,
    ],
  );
  const projectRegistryEntries = useMemo<ProjectRegistryEntryDescriptor[]>(
    () =>
      filteredProjectList.map((project) => ({
        id: project.id,
        name: project.name,
        identity: joinDetails([project.code, project.owner]),
        detail: joinDetails([
          project.region,
          project.version,
          formatDateTime(project.lastDeployedAt, locale),
        ]),
        status: project.status,
        environment: project.environment,
        metrics: [
          {
            label: t('labels.activeUsers'),
            value: formatNumber(project.activeUsers, locale),
          },
          {
            label: t('labels.requests'),
            value: formatNumber(project.requestPerMinute, locale),
          },
        ],
      })),
    [filteredProjectList, locale, t],
  );
  const editorSummaryCards = useMemo<SummaryCardDescriptor[]>(
    () =>
      draft
        ? [
            {
              label: t('projectConsole.overview.servers'),
              value: formatNumber(draft.servers.length, locale),
              footnote: t('projectConsole.sections.serversDescription'),
            },
            {
              label: t('projectConsole.overview.services'),
              value: formatNumber(draft.services.length, locale),
              footnote: t('projectConsole.sections.servicesDescription'),
            },
            {
              label: t('projectConsole.overview.tags'),
              value: formatNumber(draft.tags.length, locale),
              footnote: t('labels.tags'),
            },
            {
              label: t('projectConsole.overview.configuredUrls'),
              value: formatNumber(configuredUrlCount, locale),
              footnote: t('projectConsole.sections.endpoints'),
            },
            {
              label: t('projectConsole.overview.validation'),
              value: formatNumber(validationIssues.length, locale),
              footnote:
                validationIssues.length > 0
                  ? t('projectConsole.issuesTitle')
                  : t('projectConsole.overviewDescription'),
            },
          ]
        : [],
    [configuredUrlCount, draft, locale, t, validationIssues.length],
  );
  const editorValidationVisible = validationIssues.length > 0;
  const activeProjectFocusTag = activeProject
    ? t('projectConsole.context.projectFocus', { project: activeProject.name })
    : '';

  return {
    activeProjectFocusTag,
    editorSummaryCards,
    editorValidationVisible,
    projectRegistryEntries,
    registrySummaryCards,
    registryTags,
  };
}
