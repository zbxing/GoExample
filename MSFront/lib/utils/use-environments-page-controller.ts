'use client';

import {
  useMemo,
  useState,
} from 'react';
import type { WorkbenchResultsTag } from '@/components/common/workbench-results-bar';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import {
  buildEnvironmentsHref,
  resolveEnvironmentsFilterState,
  type EnvironmentSortMode,
  type EnvironmentsFilterState,
} from '@/lib/utils/governance-filters';
import { formatNumber } from '@/lib/utils/format';
import type {
  EnvironmentGovernanceItem,
  LocaleCode,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

const environmentStatusOrder: ProjectStatus[] = ['critical', 'warning', 'healthy'];

interface UseEnvironmentsPageControllerOptions {
  pathname: string;
  locale: LocaleCode;
  t: TranslationFn;
  environments: readonly EnvironmentGovernanceItem[];
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: EnvironmentSortMode;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

export function useEnvironmentsPageController({
  pathname,
  locale,
  t,
  environments,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  clearFeedback,
  showError,
  showSuccess,
}: UseEnvironmentsPageControllerOptions) {
  const initialFilters = useMemo(
    () =>
      resolveEnvironmentsFilterState({
        search: initialSearch,
        environment: initialEnvironment,
        status: initialStatus,
        sort: initialSort,
      }),
    [initialEnvironment, initialSearch, initialSort, initialStatus],
  );
  const [searchQuery, setSearchQuery] = useState(initialFilters.search);
  const [environmentFilter, setEnvironmentFilter] =
    useState<'all' | ProjectEnvironment>(initialFilters.environment);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>(initialFilters.status);
  const [sortMode, setSortMode] = useState<EnvironmentSortMode>(initialFilters.sort);
  const focusedEnvironment = environmentFilter !== 'all' ? environmentFilter : null;

  const filteredEnvironments = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return [...environments]
      .filter((item) => {
        const derivedStatus = getEnvironmentStatus(item);

        if (environmentFilter !== 'all' && item.environment !== environmentFilter) {
          return false;
        }

        if (statusFilter !== 'all' && derivedStatus !== statusFilter) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const haystack = [
          item.environment,
          ...item.ownerCoverage,
          ...item.regionCoverage,
          ...item.projects.flatMap((project) => [
            project.name,
            project.code,
            project.owner,
            project.region,
            project.version,
            project.status,
            project.environment,
            project.tags.join(' '),
          ]),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (sortMode === 'traffic') {
          return (
            right.totalRequestPerMinute - left.totalRequestPerMinute ||
            right.projectCount - left.projectCount ||
            statusWeight(getEnvironmentStatus(right)) - statusWeight(getEnvironmentStatus(left))
          );
        }

        if (sortMode === 'deploy') {
          return (
            timestampValue(right.latestDeployAt) - timestampValue(left.latestDeployAt) ||
            statusWeight(getEnvironmentStatus(right)) - statusWeight(getEnvironmentStatus(left))
          );
        }

        if (sortMode === 'name') {
          return t(`status.${left.environment}`).localeCompare(t(`status.${right.environment}`), locale);
        }

        return (
          statusWeight(getEnvironmentStatus(right)) - statusWeight(getEnvironmentStatus(left)) ||
          right.criticalProjects - left.criticalProjects ||
          right.warningProjects - left.warningProjects ||
          right.totalRequestPerMinute - left.totalRequestPerMinute
        );
      });
  }, [environmentFilter, environments, locale, searchQuery, sortMode, statusFilter, t]);
  const groupedEnvironments = useMemo(
    () =>
      environmentStatusOrder
        .map((status) => ({
          status,
          entries: filteredEnvironments.filter((item) => getEnvironmentStatus(item) === status),
        }))
        .filter((group) => group.entries.length > 0),
    [filteredEnvironments],
  );
  const filteredSummary = useMemo(() => {
    const owners = new Set<string>();
    const regions = new Set<string>();
    let projectCount = 0;
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let requestCount = 0;

    for (const item of filteredEnvironments) {
      projectCount += item.projectCount;
      healthyCount += item.healthyProjects;
      warningCount += item.warningProjects;
      criticalCount += item.criticalProjects;
      requestCount += item.totalRequestPerMinute;

      item.ownerCoverage.forEach((owner) => owners.add(owner));
      item.regionCoverage.forEach((region) => regions.add(region));
    }

    return {
      filteredCriticalCount: criticalCount,
      filteredHealthyCount: healthyCount,
      filteredOwnerCount: owners.size,
      filteredProjectCount: projectCount,
      filteredRegionCount: regions.size,
      filteredRequestCount: requestCount,
      filteredWarningCount: warningCount,
    };
  }, [filteredEnvironments]);
  const resultTags = useMemo<WorkbenchResultsTag[]>(() => {
    const nextTags: WorkbenchResultsTag[] = [];

    if (focusedEnvironment) {
      nextTags.push({
        label: t('dashboard.environments.context.environmentFocus', {
          environment: t(`status.${focusedEnvironment}`),
        }),
      });
    }

    nextTags.push(
      {
        label: t('dashboard.environments.results.environmentsCount', {
          count: formatNumber(filteredEnvironments.length, locale),
        }),
      },
      {
        label: t('dashboard.environments.results.projectsCount', {
          count: formatNumber(filteredSummary.filteredProjectCount, locale),
        }),
      },
      {
        label: t('dashboard.environments.results.warningCount', {
          count: formatNumber(filteredSummary.filteredWarningCount, locale),
        }),
      },
      {
        label: t('dashboard.environments.results.requestsCount', {
          count: formatNumber(filteredSummary.filteredRequestCount, locale),
        }),
      },
    );

    return nextTags;
  }, [filteredEnvironments.length, filteredSummary, focusedEnvironment, locale, t]);
  const currentFilterState = useMemo<EnvironmentsFilterState>(
    () => ({
      search: searchQuery,
      environment: environmentFilter,
      status: statusFilter,
      sort: sortMode,
    }),
    [environmentFilter, searchQuery, sortMode, statusFilter],
  );
  const currentFilterHref = useMemo(
    () => buildEnvironmentsHref(currentFilterState),
    [currentFilterState],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveEnvironmentsFilterState({
      search: nextSearchParams.get('search'),
      environment: nextSearchParams.get('environment'),
      status: nextSearchParams.get('status'),
      sort: nextSearchParams.get('sort'),
    });

    setSearchQuery(nextFilters.search);
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
    shouldPushHistory: shouldPushEnvironmentsHistory,
  });

  function clearEnvironmentFilter() {
    clearFeedback();
    setEnvironmentFilter('all');
  }

  function resetFilters() {
    clearFeedback();
    setSearchQuery('');
    setEnvironmentFilter('all');
    setStatusFilter('all');
    setSortMode('risk');
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('dashboard.environments.copyFiltersSuccess'));
    } catch {
      showError(t('dashboard.environments.copyFiltersError'));
    }
  }

  return {
    clearEnvironmentFilter,
    environmentFilter,
    filteredCriticalCount: filteredSummary.filteredCriticalCount,
    filteredEnvironments,
    filteredHealthyCount: filteredSummary.filteredHealthyCount,
    filteredOwnerCount: filteredSummary.filteredOwnerCount,
    filteredProjectCount: filteredSummary.filteredProjectCount,
    filteredRegionCount: filteredSummary.filteredRegionCount,
    filteredWarningCount: filteredSummary.filteredWarningCount,
    focusedEnvironment,
    groupedEnvironments,
    handleCopyCurrentView,
    resetFilters,
    resultTags,
    searchQuery,
    setEnvironmentFilter,
    setSearchQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
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

function statusWeight(status: ProjectStatus) {
  if (status === 'critical') {
    return 3;
  }

  if (status === 'warning') {
    return 2;
  }

  return 1;
}

function timestampValue(value: string | null) {
  return value ? new Date(value).valueOf() : 0;
}

function shouldPushEnvironmentsHistory(
  previousFilters: EnvironmentsFilterState | null,
  nextFilters: EnvironmentsFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.environment !== nextFilters.environment ||
    previousFilters.status !== nextFilters.status ||
    previousFilters.sort !== nextFilters.sort
  );
}
