'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  EnvironmentGovernanceItem,
  LocaleCode,
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  joinDetails,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface EnvironmentsPageSummaryCard {
  label: string;
  value: string;
  footnote: string;
}

interface EnvironmentsPageStatusGroup {
  status: ProjectStatus;
  eyebrow: string;
  title: string;
  description: string;
  summary: string;
  entries: readonly EnvironmentGovernanceItem[];
}

interface EnvironmentRegistryItemCard {
  id: string;
  title: string;
  owner: string;
  meta: string;
  status: ProjectStatus;
  metrics: ProjectMetricItem[];
  projectId: string;
}

interface EnvironmentCardDescriptor {
  environment: ProjectEnvironment;
  eyebrow: string;
  title: string;
  description: string;
  status: ProjectStatus;
  metrics: ProjectMetricItem[];
  healthLine: string;
  capacityLine: string;
  coverageLine: string;
  deployLine: string;
  projectCards: EnvironmentRegistryItemCard[];
}

interface UseEnvironmentsPageSurfaceControllerOptions {
  filteredEnvironments: readonly EnvironmentGovernanceItem[];
  filteredProjectCount: number;
  filteredHealthyCount: number;
  filteredWarningCount: number;
  filteredCriticalCount: number;
  filteredOwnerCount: number;
  filteredRegionCount: number;
  groupedEnvironments: readonly {
    status: ProjectStatus;
    entries: readonly EnvironmentGovernanceItem[];
  }[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useEnvironmentsPageSurfaceController({
  filteredEnvironments,
  filteredProjectCount,
  filteredHealthyCount,
  filteredWarningCount,
  filteredCriticalCount,
  filteredOwnerCount,
  filteredRegionCount,
  groupedEnvironments,
  locale,
  t,
}: UseEnvironmentsPageSurfaceControllerOptions) {
  const overviewSummaryCards = useMemo<EnvironmentsPageSummaryCard[]>(
    () => [
      {
        label: t('dashboard.environments.summary.environments'),
        value: formatNumber(filteredEnvironments.length, locale),
        footnote: t('dashboard.environments.allEnvironments'),
      },
      {
        label: t('dashboard.environments.summary.projects'),
        value: formatNumber(filteredProjectCount, locale),
        footnote: t('dashboard.environments.results.healthyCount', {
          count: formatNumber(filteredHealthyCount, locale),
        }),
      },
      {
        label: t('dashboard.environments.summary.attention'),
        value: formatNumber(filteredWarningCount + filteredCriticalCount, locale),
        footnote: t('dashboard.environments.results.criticalCount', {
          count: formatNumber(filteredCriticalCount, locale),
        }),
      },
      {
        label: t('dashboard.environments.summary.coverage'),
        value: formatNumber(filteredOwnerCount, locale),
        footnote: t('dashboard.environments.results.regionsCount', {
          count: formatNumber(filteredRegionCount, locale),
        }),
      },
    ],
    [
      filteredCriticalCount,
      filteredEnvironments.length,
      filteredHealthyCount,
      filteredOwnerCount,
      filteredProjectCount,
      filteredRegionCount,
      filteredWarningCount,
      locale,
      t,
    ],
  );
  const environmentStatusGroups = useMemo<EnvironmentsPageStatusGroup[]>(
    () =>
      groupedEnvironments.map((group) => ({
        status: group.status,
        eyebrow: t(`status.${group.status}`),
        title: t(`status.${group.status}`),
        description: t(`dashboard.environments.groups.${group.status}`),
        summary: t('dashboard.environments.results.environmentsCount', {
          count: formatNumber(group.entries.length, locale),
        }),
        entries: group.entries,
      })),
    [groupedEnvironments, locale, t],
  );
  const projectRegistryItemCards = useMemo(
    () =>
      new Map(
        filteredEnvironments.flatMap((item) =>
          item.projects.map((project) => [
            project.id,
            mapProjectRegistryItem(project, locale, t),
          ] as const),
        ),
      ),
    [filteredEnvironments, locale, t],
  );
  const environmentCards = useMemo(
    () =>
      new Map(
        filteredEnvironments.map((item) => [
          item.environment,
          mapEnvironmentCard(item, projectRegistryItemCards, locale, t),
        ] as const),
      ),
    [filteredEnvironments, locale, projectRegistryItemCards, t],
  );

  return {
    environmentCards,
    environmentStatusGroups,
    overviewSummaryCards,
  };
}

function mapEnvironmentCard(
  item: EnvironmentGovernanceItem,
  projectRegistryItemCards: Map<string, EnvironmentRegistryItemCard>,
  locale: LocaleCode,
  t: TranslationFn,
): EnvironmentCardDescriptor {
  return {
    environment: item.environment,
    eyebrow: t(`status.${item.environment}`),
    title: t(`status.${item.environment}`),
    description: t('dashboard.environments.summaryDescription'),
    status: getEnvironmentStatus(item),
    metrics: [
      {
        label: t('labels.projectCount'),
        value: formatNumber(item.projectCount, locale),
      },
      {
        label: t('labels.requests'),
        value: formatNumber(item.totalRequestPerMinute, locale),
      },
      {
        label: t('labels.activeUsers'),
        value: formatNumber(item.totalActiveUsers, locale),
      },
      {
        label: t('labels.errorRate'),
        value: `${formatPercent(item.averageErrorRate, locale)}%`,
      },
    ],
    healthLine: t('dashboard.environments.healthLine', {
      healthy: formatNumber(item.healthyProjects, locale),
      warning: formatNumber(item.warningProjects, locale),
      critical: formatNumber(item.criticalProjects, locale),
    }),
    capacityLine: t('dashboard.environments.capacityLine', {
      servers: formatNumber(item.totalServers, locale),
      services: formatNumber(item.totalServices, locale),
    }),
    coverageLine: t('dashboard.environments.coverageLine', {
      owners: joinDetails(item.ownerCoverage) || '-',
      regions: joinDetails(item.regionCoverage) || '-',
    }),
    deployLine: t('dashboard.environments.deployLine', {
      timestamp: item.latestDeployAt
        ? formatDateTime(item.latestDeployAt, locale)
        : t('dashboard.environments.noDeploy'),
    }),
    projectCards: item.projects.map((project) => projectRegistryItemCards.get(project.id)!),
  };
}

function mapProjectRegistryItem(
  project: ManagedProject,
  locale: LocaleCode,
  t: TranslationFn,
): EnvironmentRegistryItemCard {
  return {
    id: project.id,
    title: project.name,
    owner: project.owner,
    meta: joinDetails([project.code, project.region, project.version]),
    status: project.status,
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
    projectId: project.id,
  };
}

function getEnvironmentStatus(item: EnvironmentGovernanceItem): ProjectStatus {
  if (item.criticalProjects > 0) {
    return 'critical';
  }

  if (item.warningProjects > 0) {
    return 'warning';
  }

  return 'healthy';
}
