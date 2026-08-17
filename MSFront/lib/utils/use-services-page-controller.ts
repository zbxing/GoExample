'use client';

import {
  useMemo,
  useState,
} from 'react';
import type { WorkbenchResultsTag } from '@/components/common/workbench-results-bar';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import {
  buildProjectDetailHref,
  buildServicesHref,
  resolveServicesFilterState,
  type ServiceSortMode,
  type ServicesFilterState,
} from '@/lib/utils/governance-filters';
import { formatNumber } from '@/lib/utils/format';
import type {
  LocaleCode,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
  ServiceCategorySummary,
  ServiceHealthEntry,
} from '@/lib/types/management';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

const serviceStatusOrder: ProjectStatus[] = ['critical', 'warning', 'healthy'];

interface UseServicesPageControllerOptions {
  pathname: string;
  locale: LocaleCode;
  t: TranslationFn;
  services: readonly ServiceHealthEntry[];
  categorySummary: readonly ServiceCategorySummary[];
  initialProjectId?: string;
  initialSearch?: string;
  initialCategory?: 'all' | ManagedServiceCategory;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ServiceSortMode;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

export function useServicesPageController({
  pathname,
  locale,
  t,
  services,
  categorySummary,
  initialProjectId = '',
  initialSearch = '',
  initialCategory = 'all',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  clearFeedback,
  showError,
  showSuccess,
}: UseServicesPageControllerOptions) {
  const availableProjectIds = useMemo(
    () => Array.from(new Set(services.map((service) => service.projectId))),
    [services],
  );
  const initialFilters = useMemo(
    () =>
      resolveServicesFilterState(
        {
          projectId: initialProjectId,
          search: initialSearch,
          category: initialCategory,
          environment: initialEnvironment,
          status: initialStatus,
          sort: initialSort,
        },
        availableProjectIds,
      ),
    [
      availableProjectIds,
      initialCategory,
      initialEnvironment,
      initialProjectId,
      initialSearch,
      initialSort,
      initialStatus,
    ],
  );
  const [scopedProjectId, setScopedProjectId] = useState(initialFilters.projectId);
  const [searchQuery, setSearchQuery] = useState(initialFilters.search);
  const [categoryFilter, setCategoryFilter] =
    useState<'all' | ManagedServiceCategory>(initialFilters.category);
  const [environmentFilter, setEnvironmentFilter] =
    useState<'all' | ProjectEnvironment>(initialFilters.environment);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>(initialFilters.status);
  const [sortMode, setSortMode] = useState<ServiceSortMode>(initialFilters.sort);

  const scopedProject = useMemo(
    () => services.find((service) => service.projectId === scopedProjectId) ?? null,
    [scopedProjectId, services],
  );
  const visibleCategorySummary = useMemo(
    () =>
      scopedProject
        ? buildCategorySummaryFromServices(
            services.filter((service) => service.projectId === scopedProject.projectId),
          )
        : categorySummary,
    [categorySummary, scopedProject, services],
  );
  const filteredServices = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return [...services]
      .filter((service) => {
        if (scopedProjectId && service.projectId !== scopedProjectId) {
          return false;
        }

        if (categoryFilter !== 'all' && service.category !== categoryFilter) {
          return false;
        }

        if (environmentFilter !== 'all' && service.environment !== environmentFilter) {
          return false;
        }

        if (statusFilter !== 'all' && service.status !== statusFilter) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const haystack = [
          service.name,
          service.projectName,
          service.projectCode,
          service.owner,
          service.region,
          service.version,
          service.category,
          service.environment,
          service.status,
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (sortMode === 'traffic') {
          return (
            right.requestPerMinute - left.requestPerMinute ||
            statusWeight(right.status) - statusWeight(left.status)
          );
        }

        if (sortMode === 'name') {
          return left.name.localeCompare(right.name, locale);
        }

        return (
          statusWeight(right.status) - statusWeight(left.status) ||
          right.requestPerMinute - left.requestPerMinute ||
          left.name.localeCompare(right.name, locale)
        );
      });
  }, [
    categoryFilter,
    environmentFilter,
    locale,
    scopedProjectId,
    searchQuery,
    services,
    sortMode,
    statusFilter,
  ]);
  const groupedServices = useMemo(
    () =>
      serviceStatusOrder
        .map((status) => ({
          status,
          entries: filteredServices.filter((service) => service.status === status),
        }))
        .filter((group) => group.entries.length > 0),
    [filteredServices],
  );
  const filteredProjectCount = useMemo(
    () => new Set(filteredServices.map((service) => service.projectId)).size,
    [filteredServices],
  );
  const filteredOwnerCount = useMemo(
    () => new Set(filteredServices.map((service) => service.owner)).size,
    [filteredServices],
  );
  const filteredCategoryCount = useMemo(
    () => new Set(filteredServices.map((service) => service.category)).size,
    [filteredServices],
  );
  const filteredHealthyCount = filteredServices.filter((service) => service.status === 'healthy').length;
  const filteredWarningCount = filteredServices.filter((service) => service.status === 'warning').length;
  const filteredCriticalCount = filteredServices.filter((service) => service.status === 'critical').length;
  const resultTags = useMemo<WorkbenchResultsTag[]>(() => {
    const nextTags: WorkbenchResultsTag[] = [];

    if (scopedProject) {
      nextTags.push({
        label: t('dashboard.services.context.projectFocus', {
          project: scopedProject.projectName,
        }),
      });
    }

    nextTags.push(
      {
        label: t('dashboard.services.results.servicesCount', {
          count: formatNumber(filteredServices.length, locale),
        }),
      },
      {
        label: t('dashboard.services.results.projectsCount', {
          count: formatNumber(filteredProjectCount, locale),
        }),
      },
      {
        label: t('dashboard.services.results.warningCount', {
          count: formatNumber(filteredWarningCount, locale),
        }),
      },
      {
        label: t('dashboard.services.results.criticalCount', {
          count: formatNumber(filteredCriticalCount, locale),
        }),
      },
    );

    if (scopedProject) {
      nextTags.push({
        label: t('dashboard.services.context.openProject'),
        href: buildProjectDetailHref(scopedProject.projectId),
      });
    }

    return nextTags;
  }, [
    filteredCriticalCount,
    filteredProjectCount,
    filteredServices.length,
    filteredWarningCount,
    locale,
    scopedProject,
    t,
  ]);
  const currentFilterState = useMemo<ServicesFilterState>(
    () => ({
      projectId: scopedProjectId,
      search: searchQuery,
      category: categoryFilter,
      environment: environmentFilter,
      status: statusFilter,
      sort: sortMode,
    }),
    [categoryFilter, environmentFilter, scopedProjectId, searchQuery, sortMode, statusFilter],
  );
  const currentFilterHref = useMemo(
    () => buildServicesHref(currentFilterState),
    [currentFilterState],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveServicesFilterState(
      {
        projectId: nextSearchParams.get('projectId'),
        search: nextSearchParams.get('search'),
        category: nextSearchParams.get('category'),
        environment: nextSearchParams.get('environment'),
        status: nextSearchParams.get('status'),
        sort: nextSearchParams.get('sort'),
      },
      availableProjectIds,
    );

    setScopedProjectId(nextFilters.projectId);
    setSearchQuery(nextFilters.search);
    setCategoryFilter(nextFilters.category);
    setEnvironmentFilter(nextFilters.environment);
    setStatusFilter(nextFilters.status);
    setSortMode(nextFilters.sort);
    clearFeedback();
  }

  useUrlFilterHistory({
    pathname,
    currentState: currentFilterState,
    getCurrentHref: () => currentFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushServicesHistory,
  });

  function clearScopedProject() {
    clearFeedback();
    setScopedProjectId('');
  }

  function resetFilters() {
    clearFeedback();
    setSearchQuery('');
    setCategoryFilter('all');
    setEnvironmentFilter('all');
    setStatusFilter('all');
    setSortMode('risk');
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('dashboard.services.copyFiltersSuccess'));
    } catch {
      showError(t('dashboard.services.copyFiltersError'));
    }
  }

  return {
    categoryFilter,
    clearScopedProject,
    environmentFilter,
    filteredCategoryCount,
    filteredCriticalCount,
    filteredHealthyCount,
    filteredOwnerCount,
    filteredProjectCount,
    filteredServices,
    filteredWarningCount,
    groupedServices,
    handleCopyCurrentView,
    resetFilters,
    resultTags,
    scopedProject,
    searchQuery,
    setCategoryFilter,
    setEnvironmentFilter,
    setSearchQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
    visibleCategorySummary,
  };
}

function statusWeight(status: ProjectStatus) {
  if (status === 'critical') {
    return 3;
  }

  if (status === 'warning') {
    return 2;
  }

  return 1;
}

function buildCategorySummaryFromServices(
  services: readonly ServiceHealthEntry[],
): ServiceCategorySummary[] {
  const categories: ManagedServiceCategory[] = ['api', 'worker', 'queue', 'storage', 'database'];

  return categories
    .map((category) => {
      const matchingServices = services.filter((service) => service.category === category);

      if (matchingServices.length === 0) {
        return null;
      }

      return {
        category,
        totalServices: matchingServices.length,
        healthyServices: matchingServices.filter((service) => service.status === 'healthy').length,
        warningServices: matchingServices.filter((service) => service.status === 'warning').length,
        criticalServices: matchingServices.filter((service) => service.status === 'critical').length,
        productionServices: matchingServices.filter(
          (service) => service.environment === 'production',
        ).length,
        stagingServices: matchingServices.filter((service) => service.environment === 'staging').length,
        developmentServices: matchingServices.filter(
          (service) => service.environment === 'development',
        ).length,
      } satisfies ServiceCategorySummary;
    })
    .filter((summary): summary is ServiceCategorySummary => summary !== null);
}

function shouldPushServicesHistory(
  previousFilters: ServicesFilterState | null,
  nextFilters: ServicesFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.projectId !== nextFilters.projectId ||
    previousFilters.category !== nextFilters.category ||
    previousFilters.environment !== nextFilters.environment ||
    previousFilters.status !== nextFilters.status ||
    previousFilters.sort !== nextFilters.sort
  );
}
