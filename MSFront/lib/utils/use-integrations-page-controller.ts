'use client';

import {
  useMemo,
  useState,
} from 'react';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import {
  buildIntegrationsHref,
  resolveIntegrationsFilterState,
  type EndpointSortMode,
  type IntegrationsFilterState,
  type InventorySecurityFilter,
  type ProbeCoverageFilter,
} from '@/lib/utils/governance-filters';
import { formatNumber } from '@/lib/utils/format';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';
import type {
  ApiInventoryArea,
  IntegrationEndpointEntry,
  IntegrationsGovernanceView,
  LocaleCode,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { WorkbenchResultsTag } from '@/components/common/workbench-results-bar';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseIntegrationsPageControllerOptions {
  pathname: string;
  locale: LocaleCode;
  t: TranslationFn;
  endpoints: readonly IntegrationEndpointEntry[];
  summary: IntegrationsGovernanceView['summary'];
  inventory: IntegrationsGovernanceView['inventory'];
  initialProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialCoverage?: ProbeCoverageFilter;
  initialSort?: EndpointSortMode;
  initialInventorySearch?: string;
  initialInventoryArea?: 'all' | ApiInventoryArea;
  initialInventorySecurity?: InventorySecurityFilter;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

export function useIntegrationsPageController({
  pathname,
  locale,
  t,
  endpoints,
  summary,
  inventory,
  initialProjectId = '',
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialCoverage = 'all',
  initialSort = 'risk',
  initialInventorySearch = '',
  initialInventoryArea = 'all',
  initialInventorySecurity = 'all',
  clearFeedback,
  showError,
  showSuccess,
}: UseIntegrationsPageControllerOptions) {
  const availableProjectIds = useMemo(
    () => Array.from(new Set(endpoints.map((endpoint) => endpoint.projectId))),
    [endpoints],
  );
  const initialFilters = useMemo(
    () =>
      resolveIntegrationsFilterState(
        {
          projectId: initialProjectId,
          search: initialSearch,
          environment: initialEnvironment,
          status: initialStatus,
          coverage: initialCoverage,
          sort: initialSort,
          inventorySearch: initialInventorySearch,
          inventoryArea: initialInventoryArea,
          inventorySecurity: initialInventorySecurity,
        },
        availableProjectIds,
      ),
    [
      availableProjectIds,
      initialCoverage,
      initialEnvironment,
      initialInventoryArea,
      initialInventorySearch,
      initialInventorySecurity,
      initialProjectId,
      initialSearch,
      initialSort,
      initialStatus,
    ],
  );
  const [scopedProjectId, setScopedProjectId] = useState(initialFilters.projectId);
  const [searchQuery, setSearchQuery] = useState(initialFilters.search);
  const [environmentFilter, setEnvironmentFilter] =
    useState<'all' | ProjectEnvironment>(initialFilters.environment);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>(initialFilters.status);
  const [probeFilter, setProbeFilter] = useState<ProbeCoverageFilter>(initialFilters.coverage);
  const [sortMode, setSortMode] = useState<EndpointSortMode>(initialFilters.sort);
  const [inventorySearchQuery, setInventorySearchQuery] = useState(initialFilters.inventorySearch);
  const [inventoryAreaFilter, setInventoryAreaFilter] =
    useState<'all' | ApiInventoryArea>(initialFilters.inventoryArea);
  const [inventorySecurityFilter, setInventorySecurityFilter] =
    useState<InventorySecurityFilter>(initialFilters.inventorySecurity);

  const scopedProject = useMemo(
    () => endpoints.find((endpoint) => endpoint.projectId === scopedProjectId) ?? null,
    [endpoints, scopedProjectId],
  );
  const filteredEndpoints = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return [...endpoints]
      .filter((endpoint) => {
        if (scopedProjectId && endpoint.projectId !== scopedProjectId) {
          return false;
        }

        if (environmentFilter !== 'all' && endpoint.environment !== environmentFilter) {
          return false;
        }

        if (statusFilter !== 'all' && endpoint.status !== statusFilter) {
          return false;
        }

        if (probeFilter === 'ready' && !endpoint.probeBaseUrl) {
          return false;
        }

        if (probeFilter === 'missing' && endpoint.probeBaseUrl) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const haystack = [
          endpoint.projectName,
          endpoint.projectCode,
          endpoint.owner,
          endpoint.region,
          endpoint.baseUrl,
          endpoint.apiBaseUrl,
          endpoint.probeBaseUrl ?? '',
          endpoint.tags.join(' '),
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
          return left.projectName.localeCompare(right.projectName, locale);
        }

        return (
          statusWeight(right.status) - statusWeight(left.status) ||
          right.requestPerMinute - left.requestPerMinute
        );
      });
  }, [
    endpoints,
    environmentFilter,
    locale,
    probeFilter,
    scopedProjectId,
    searchQuery,
    sortMode,
    statusFilter,
  ]);
  const filteredOperations = useMemo(() => {
    if (!inventory) {
      return [];
    }

    const normalizedSearch = inventorySearchQuery.trim().toLowerCase();

    return inventory.operations.filter((operation) => {
      if (inventoryAreaFilter !== 'all' && operation.area !== inventoryAreaFilter) {
        return false;
      }

      if (inventorySecurityFilter === 'secured' && !operation.secured) {
        return false;
      }

      if (inventorySecurityFilter === 'unsecured' && operation.secured) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        operation.method,
        operation.path,
        operation.area,
        operation.securitySchemes.join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [inventory, inventoryAreaFilter, inventorySearchQuery, inventorySecurityFilter]);
  const filteredHealthCount = filteredEndpoints.filter((endpoint) => endpoint.status === 'healthy').length;
  const filteredWarningCount = filteredEndpoints.filter((endpoint) => endpoint.status === 'warning').length;
  const filteredCriticalCount = filteredEndpoints.filter((endpoint) => endpoint.status === 'critical').length;
  const resultTags = useMemo<WorkbenchResultsTag[]>(() => {
    const nextTags: WorkbenchResultsTag[] = [];

    if (scopedProject) {
      nextTags.push({
        label: t('dashboard.integrations.context.projectFocus', {
          project: scopedProject.projectName,
        }),
      });
    }

    nextTags.push(
      {
        label: t('dashboard.integrations.results.endpointCount', {
          count: formatNumber(filteredEndpoints.length, locale),
        }),
      },
      {
        label: t('dashboard.integrations.results.healthyCount', {
          count: formatNumber(filteredHealthCount, locale),
        }),
      },
      {
        label: t('dashboard.integrations.results.warningCount', {
          count: formatNumber(filteredWarningCount, locale),
        }),
      },
      {
        label: t('dashboard.integrations.results.criticalCount', {
          count: formatNumber(filteredCriticalCount, locale),
        }),
      },
    );

    return nextTags;
  }, [
    filteredCriticalCount,
    filteredEndpoints.length,
    filteredHealthCount,
    filteredWarningCount,
    locale,
    scopedProject,
    t,
  ]);
  const endpointSummary = useMemo(
    () =>
      scopedProject
        ? {
            totalEndpoints: filteredEndpoints.length,
            productionEndpoints: filteredEndpoints.filter(
              (endpoint) => endpoint.environment === 'production',
            ).length,
            attentionEndpoints: filteredWarningCount + filteredCriticalCount,
            probeReadyEndpoints: filteredEndpoints.filter((endpoint) => Boolean(endpoint.probeBaseUrl))
              .length,
            uniqueOwners: new Set(filteredEndpoints.map((endpoint) => endpoint.owner)).size,
            uniqueRegions: new Set(filteredEndpoints.map((endpoint) => endpoint.region)).size,
          }
        : summary,
    [
      filteredCriticalCount,
      filteredEndpoints,
      filteredWarningCount,
      scopedProject,
      summary,
    ],
  );
  const currentFilterState = useMemo<IntegrationsFilterState>(
    () => ({
      projectId: scopedProjectId,
      search: searchQuery,
      environment: environmentFilter,
      status: statusFilter,
      coverage: probeFilter,
      sort: sortMode,
      inventorySearch: inventorySearchQuery,
      inventoryArea: inventoryAreaFilter,
      inventorySecurity: inventorySecurityFilter,
    }),
    [
      environmentFilter,
      inventoryAreaFilter,
      inventorySearchQuery,
      inventorySecurityFilter,
      probeFilter,
      scopedProjectId,
      searchQuery,
      sortMode,
      statusFilter,
    ],
  );
  const currentFilterHref = useMemo(
    () => buildIntegrationsHref(currentFilterState),
    [currentFilterState],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveIntegrationsFilterState(
      {
        projectId: nextSearchParams.get('projectId'),
        search: nextSearchParams.get('search'),
        environment: nextSearchParams.get('environment'),
        status: nextSearchParams.get('status'),
        coverage: nextSearchParams.get('coverage'),
        sort: nextSearchParams.get('sort'),
        inventorySearch: nextSearchParams.get('inventorySearch'),
        inventoryArea: nextSearchParams.get('inventoryArea'),
        inventorySecurity: nextSearchParams.get('inventorySecurity'),
      },
      availableProjectIds,
    );

    setScopedProjectId(nextFilters.projectId);
    setSearchQuery(nextFilters.search);
    setEnvironmentFilter(nextFilters.environment);
    setStatusFilter(nextFilters.status);
    setProbeFilter(nextFilters.coverage);
    setSortMode(nextFilters.sort);
    setInventorySearchQuery(nextFilters.inventorySearch);
    setInventoryAreaFilter(nextFilters.inventoryArea);
    setInventorySecurityFilter(nextFilters.inventorySecurity);
    clearFeedback();
  }

  useUrlFilterHistory({
    pathname,
    currentState: currentFilterState,
    getCurrentHref: () => currentFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushIntegrationsHistory,
  });

  function clearScopedProject() {
    clearFeedback();
    setScopedProjectId('');
  }

  function resetEndpointFilters() {
    clearFeedback();
    setSearchQuery('');
    setEnvironmentFilter('all');
    setStatusFilter('all');
    setProbeFilter('all');
    setSortMode('risk');
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('dashboard.integrations.copyFiltersSuccess'));
    } catch {
      showError(t('dashboard.integrations.copyFiltersError'));
    }
  }

  return {
    clearScopedProject,
    endpointSummary,
    environmentFilter,
    filteredCriticalCount,
    filteredEndpoints,
    filteredHealthCount,
    filteredOperations,
    filteredWarningCount,
    handleCopyCurrentView,
    inventoryAreaFilter,
    inventorySearchQuery,
    inventorySecurityFilter,
    probeFilter,
    resetEndpointFilters,
    resultTags,
    scopedProject,
    scopedProjectId,
    searchQuery,
    setEnvironmentFilter,
    setInventoryAreaFilter,
    setInventorySearchQuery,
    setInventorySecurityFilter,
    setProbeFilter,
    setSearchQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
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

function shouldPushIntegrationsHistory(
  previousFilters: IntegrationsFilterState | null,
  nextFilters: IntegrationsFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.projectId !== nextFilters.projectId ||
    previousFilters.environment !== nextFilters.environment ||
    previousFilters.status !== nextFilters.status ||
    previousFilters.coverage !== nextFilters.coverage ||
    previousFilters.sort !== nextFilters.sort ||
    previousFilters.inventoryArea !== nextFilters.inventoryArea ||
    previousFilters.inventorySecurity !== nextFilters.inventorySecurity
  );
}
