'use client';

import {
  useDeferredValue,
  useMemo,
  useState,
} from 'react';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import {
  buildDashboardHref,
  buildProjectsHref,
  resolveProjectsPortfolioFilterState,
  type ProjectSortMode,
  type ProjectsPortfolioFilterState,
} from '@/lib/utils/governance-filters';
import { formatNumber } from '@/lib/utils/format';
import type {
  LocaleCode,
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import {
  compareProjectsBySortMode,
  projectNeedsAttention,
} from '@/lib/utils/project-surface';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UsePortfolioGridControllerOptions {
  pathname: string;
  locale: LocaleCode;
  t: TranslationFn;
  projects: readonly ManagedProject[];
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ProjectSortMode;
  enableUrlSync?: boolean;
  urlSyncScope?: 'projects' | 'dashboard';
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

const portfolioStatusOrder: ProjectStatus[] = ['critical', 'warning', 'healthy'];

export function usePortfolioGridController({
  pathname,
  locale,
  t,
  projects,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  enableUrlSync = false,
  urlSyncScope = 'projects',
  clearFeedback,
  showError,
  showSuccess,
}: UsePortfolioGridControllerOptions) {
  const initialFilters = useMemo(
    () =>
      resolveProjectsPortfolioFilterState({
        portfolioSearch: initialSearch,
        portfolioEnvironment: initialEnvironment,
        portfolioStatus: initialStatus,
        portfolioSort: initialSort,
      }),
    [initialEnvironment, initialSearch, initialSort, initialStatus],
  );
  const [query, setQuery] = useState<string>(initialFilters.search);
  const [environmentFilter, setEnvironmentFilter] =
    useState<'all' | ProjectEnvironment>(initialFilters.environment);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>(initialFilters.status);
  const [sortMode, setSortMode] = useState<ProjectSortMode>(initialFilters.sort);
  const deferredQuery = useDeferredValue(query);
  const focusedEnvironment = environmentFilter !== 'all' ? environmentFilter : null;

  const filteredProjects = useMemo(() => {
    const searchTerm = deferredQuery.trim().toLowerCase();

    return [...projects]
      .filter((project) => {
        if (environmentFilter !== 'all' && project.environment !== environmentFilter) {
          return false;
        }

        if (statusFilter !== 'all' && project.status !== statusFilter) {
          return false;
        }

        if (!searchTerm) {
          return true;
        }

        const haystack = [
          project.name,
          project.code,
          project.description,
          project.owner,
          project.region,
          project.version,
          project.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(searchTerm);
      })
      .sort((left, right) => compareProjectsBySortMode(left, right, sortMode, locale));
  }, [deferredQuery, environmentFilter, locale, projects, sortMode, statusFilter]);
  const groupedProjects = useMemo(
    () =>
      portfolioStatusOrder
        .map((status) => ({
          status,
          entries: filteredProjects.filter((project) => project.status === status),
        }))
        .filter((group) => group.entries.length > 0),
    [filteredProjects],
  );
  const summary = useMemo(() => {
    let attentionProjects = 0;
    let healthyProjects = 0;
    let warningProjects = 0;
    let criticalProjects = 0;
    const owners = new Set<string>();
    const regions = new Set<string>();

    for (const project of filteredProjects) {
      owners.add(project.owner);
      regions.add(project.region);

      if (projectNeedsAttention(project)) {
        attentionProjects += 1;
      }

      if (project.status === 'healthy') {
        healthyProjects += 1;
      } else if (project.status === 'warning') {
        warningProjects += 1;
      } else if (project.status === 'critical') {
        criticalProjects += 1;
      }
    }

    return {
      attentionProjects,
      criticalProjects,
      healthyProjects,
      ownerCoverage: owners.size,
      regionCoverage: regions.size,
      warningProjects,
    };
  }, [filteredProjects]);
  const resultTags = useMemo(() => {
    const nextTags: string[] = [];

    if (focusedEnvironment) {
      nextTags.push(
        t('dashboard.portfolio.environmentFocus', {
          environment: t(`status.${focusedEnvironment}`),
        }),
      );
    }

    nextTags.push(
      t('dashboard.portfolio.results.projectsCount', {
        count: formatNumber(filteredProjects.length, locale),
      }),
      t('dashboard.portfolio.results.healthyCount', {
        count: formatNumber(summary.healthyProjects, locale),
      }),
      t('dashboard.portfolio.results.warningCount', {
        count: formatNumber(summary.warningProjects, locale),
      }),
      t('dashboard.portfolio.results.criticalCount', {
        count: formatNumber(summary.criticalProjects, locale),
      }),
    );

    return nextTags;
  }, [filteredProjects.length, focusedEnvironment, locale, summary, t]);
  const currentFilterState = useMemo<ProjectsPortfolioFilterState>(
    () => ({
      search: query,
      environment: environmentFilter,
      status: statusFilter,
      sort: sortMode,
    }),
    [environmentFilter, query, sortMode, statusFilter],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveProjectsPortfolioFilterState({
      portfolioSearch: nextSearchParams.get('portfolioSearch'),
      portfolioEnvironment: nextSearchParams.get('portfolioEnvironment'),
      environment: nextSearchParams.get('environment'),
      portfolioStatus: nextSearchParams.get('portfolioStatus'),
      portfolioSort: nextSearchParams.get('portfolioSort'),
    });

    setQuery(nextFilters.search);
    setEnvironmentFilter(nextFilters.environment);
    setStatusFilter(nextFilters.status);
    setSortMode(nextFilters.sort);
    clearFeedback();
  }

  useUrlFilterHistory({
    enabled: enableUrlSync,
    pathname,
    currentState: currentFilterState,
    getCurrentHref: (currentSearch) =>
      buildPortfolioHref(urlSyncScope, currentFilterState, currentSearch),
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushProjectsPortfolioHistory,
  });

  function clearEnvironmentFilter() {
    clearFeedback();
    setEnvironmentFilter('all');
  }

  function resetFilters() {
    clearFeedback();
    setQuery('');
    setEnvironmentFilter('all');
    setStatusFilter('all');
    setSortMode('risk');
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(
        t(
          urlSyncScope === 'dashboard'
            ? 'dashboard.copyFiltersSuccess'
            : 'projectsHub.copyFiltersSuccess',
        ),
      );
    } catch {
      showError(
        t(
          urlSyncScope === 'dashboard'
            ? 'dashboard.copyFiltersError'
            : 'projectsHub.copyFiltersError',
        ),
      );
    }
  }

  async function copyApi(apiBaseUrl: string) {
    await copyTextToClipboard(apiBaseUrl);
  }

  return {
    clearEnvironmentFilter,
    copyApi,
    environmentFilter,
    filteredProjects,
    focusedEnvironment,
    groupedProjects,
    handleCopyCurrentView,
    query,
    resetFilters,
    resultTags,
    setEnvironmentFilter,
    setQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
    summary,
  };
}

function shouldPushProjectsPortfolioHistory(
  previousFilters: ProjectsPortfolioFilterState | null,
  nextFilters: ProjectsPortfolioFilterState,
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

function isProjectEnvironmentFilter(
  value: string | null,
): value is 'all' | ProjectEnvironment {
  return value === 'all' || value === 'production' || value === 'staging' || value === 'development';
}

function isProjectStatusFilter(value: string | null): value is 'all' | ProjectStatus {
  return value === 'all' || value === 'healthy' || value === 'warning' || value === 'critical';
}

function isProjectSortMode(value: string | null): value is ProjectSortMode {
  return value === 'risk' || value === 'traffic' || value === 'deploy' || value === 'name';
}

function buildPortfolioHref(
  scope: 'projects' | 'dashboard',
  currentFilterState: ProjectsPortfolioFilterState,
  currentSearch: string,
) {
  if (scope === 'dashboard') {
    return buildDashboardHref({
      portfolioSearch: currentFilterState.search,
      portfolioEnvironment: currentFilterState.environment,
      portfolioStatus: currentFilterState.status,
      portfolioSort: currentFilterState.sort,
    });
  }

  const currentSearchParams = new URLSearchParams(currentSearch);
  const registryEnvironment = currentSearchParams.get('registryEnvironment');
  const registryStatus = currentSearchParams.get('registryStatus');
  const registrySort = currentSearchParams.get('registrySort');

  return buildProjectsHref({
    portfolioSearch: currentFilterState.search,
    portfolioEnvironment: currentFilterState.environment,
    portfolioStatus: currentFilterState.status,
    portfolioSort: currentFilterState.sort,
    projectId: currentSearchParams.get('projectId') ?? '',
    registrySearch: currentSearchParams.get('registrySearch') ?? '',
    registryEnvironment: isProjectEnvironmentFilter(registryEnvironment)
      ? registryEnvironment
      : 'all',
    registryStatus: isProjectStatusFilter(registryStatus) ? registryStatus : 'all',
    registrySort: isProjectSortMode(registrySort) ? registrySort : 'risk',
    mode: currentSearchParams.get('mode') === 'create' ? 'create' : 'browse',
  });
}
