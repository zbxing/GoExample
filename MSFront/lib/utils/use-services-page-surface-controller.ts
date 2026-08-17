'use client';

import { useMemo } from 'react';
import type { ProjectMetricItem } from '@/components/common/project-surface';
import type {
  LocaleCode,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
  ServiceCategorySummary,
  ServiceHealthEntry,
} from '@/lib/types/management';
import { formatNumber, joinDetails } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface ServicesPageSummaryCard {
  label: string;
  value: string;
  footnote: string;
}

interface ServicesPageCategoryCard {
  category: ManagedServiceCategory;
  title: string;
  status: ProjectStatus;
  metrics: ProjectMetricItem[];
  footnote: string;
}

interface ServicesPageStatusGroup {
  status: ProjectStatus;
  eyebrow: string;
  title: string;
  description: string;
  summary: string;
  entries: readonly ServiceHealthEntry[];
}

interface ServicesPageServiceCard {
  id: string;
  categoryLabel: string;
  title: string;
  description: string;
  status: ProjectStatus;
  environment: ProjectEnvironment;
  metrics: ProjectMetricItem[];
  footnote: string;
  projectId: string;
}

interface UseServicesPageSurfaceControllerOptions {
  filteredServices: readonly ServiceHealthEntry[];
  filteredProjectCount: number;
  filteredHealthyCount: number;
  filteredWarningCount: number;
  filteredCriticalCount: number;
  filteredOwnerCount: number;
  filteredCategoryCount: number;
  visibleCategorySummary: readonly ServiceCategorySummary[];
  groupedServices: readonly {
    status: ProjectStatus;
    entries: readonly ServiceHealthEntry[];
  }[];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useServicesPageSurfaceController({
  filteredServices,
  filteredProjectCount,
  filteredHealthyCount,
  filteredWarningCount,
  filteredCriticalCount,
  filteredOwnerCount,
  filteredCategoryCount,
  visibleCategorySummary,
  groupedServices,
  locale,
  t,
}: UseServicesPageSurfaceControllerOptions) {
  const overviewSummaryCards = useMemo<ServicesPageSummaryCard[]>(
    () => [
      {
        label: t('dashboard.services.summary.services'),
        value: formatNumber(filteredServices.length, locale),
        footnote: t('dashboard.services.results.projectsCount', {
          count: formatNumber(filteredProjectCount, locale),
        }),
      },
      {
        label: t('dashboard.services.summary.attention'),
        value: formatNumber(filteredWarningCount + filteredCriticalCount, locale),
        footnote: t('dashboard.services.results.healthyCount', {
          count: formatNumber(filteredHealthyCount, locale),
        }),
      },
      {
        label: t('dashboard.services.summary.owners'),
        value: formatNumber(filteredOwnerCount, locale),
        footnote: t('dashboard.services.results.servicesCount', {
          count: formatNumber(filteredServices.length, locale),
        }),
      },
      {
        label: t('dashboard.services.summary.categories'),
        value: formatNumber(filteredCategoryCount, locale),
        footnote: t('dashboard.services.allCategories'),
      },
    ],
    [
      filteredCategoryCount,
      filteredCriticalCount,
      filteredHealthyCount,
      filteredOwnerCount,
      filteredProjectCount,
      filteredServices.length,
      filteredWarningCount,
      locale,
      t,
    ],
  );
  const categorySummaryCards = useMemo<ServicesPageCategoryCard[]>(
    () =>
      visibleCategorySummary.map((summary) => ({
        category: summary.category,
        title: t(`dashboard.services.categories.${summary.category}`),
        status:
          summary.criticalServices > 0
            ? 'critical'
            : summary.warningServices > 0
              ? 'warning'
              : 'healthy',
        metrics: [
          {
            label: t('dashboard.services.totalLabel'),
            value: formatNumber(summary.totalServices, locale),
          },
          {
            label: t('status.healthy'),
            value: formatNumber(summary.healthyServices, locale),
          },
          {
            label: t('status.warning'),
            value: formatNumber(summary.warningServices, locale),
          },
          {
            label: t('status.critical'),
            value: formatNumber(summary.criticalServices, locale),
          },
        ],
        footnote: t('dashboard.services.coverageDescription', {
          production: formatNumber(summary.productionServices, locale),
          staging: formatNumber(summary.stagingServices, locale),
          development: formatNumber(summary.developmentServices, locale),
        }),
      })),
    [locale, t, visibleCategorySummary],
  );
  const serviceStatusGroups = useMemo<ServicesPageStatusGroup[]>(
    () =>
      groupedServices.map((group) => ({
        status: group.status,
        eyebrow: t(`status.${group.status}`),
        title: t(`status.${group.status}`),
        description: t(`dashboard.services.groups.${group.status}`),
        summary: t('dashboard.services.results.servicesCount', {
          count: formatNumber(group.entries.length, locale),
        }),
        entries: group.entries,
      })),
    [groupedServices, locale, t],
  );
  const serviceCards = useMemo<ServicesPageServiceCard[]>(
    () =>
      filteredServices.map((service) => ({
        id: service.id,
        categoryLabel: t(`dashboard.services.categories.${service.category}`),
        title: service.name,
        description: joinDetails([service.projectName, service.projectCode]),
        status: service.status,
        environment: service.environment,
        metrics: [
          {
            label: t('labels.uptime'),
            value: service.uptime,
          },
          {
            label: t('labels.activeUsers'),
            value: formatNumber(service.activeUsers, locale),
          },
          {
            label: t('labels.requests'),
            value: formatNumber(service.requestPerMinute, locale),
          },
          {
            label: t('projectConsole.overview.servers'),
            value: formatNumber(service.serverCount, locale),
          },
        ],
        footnote: joinDetails([service.owner, service.region, service.version]),
        projectId: service.projectId,
      })),
    [filteredServices, locale, t],
  );
  const serviceCardMap = useMemo(
    () => new Map(serviceCards.map((card) => [card.id, card])),
    [serviceCards],
  );

  return {
    categorySummaryCards,
    overviewSummaryCards,
    serviceCardMap,
    serviceStatusGroups,
  };
}
