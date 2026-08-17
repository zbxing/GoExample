'use client';

import { usePathname } from 'next/navigation';
import type {
  ApiInventoryArea,
  IntegrationsGovernanceView,
  LocaleCode,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type {
  EndpointSortMode,
  InventorySecurityFilter,
  ProbeCoverageFilter,
} from '@/lib/utils/governance-filters';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useIntegrationsPageController } from '@/lib/utils/use-integrations-page-controller';
import { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';
import { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseIntegrationsPageBridgeControllerOptions extends IntegrationsGovernanceView {
  locale: LocaleCode;
  t: TranslationFn;
  initialProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialCoverage?: ProbeCoverageFilter;
  initialSort?: EndpointSortMode;
  initialInventorySearch?: string;
  initialInventoryArea?: 'all' | ApiInventoryArea;
  initialInventorySecurity?: InventorySecurityFilter;
}

export function useIntegrationsPageBridgeController({
  endpoints,
  summary,
  inventory,
  locale,
  t,
  initialProjectId = '',
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialCoverage = 'all',
  initialSort = 'risk',
  initialInventorySearch = '',
  initialInventoryArea = 'all',
  initialInventorySecurity = 'all',
}: UseIntegrationsPageBridgeControllerOptions) {
  const pathname = usePathname();
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback();
  const {
    clearScopedProject,
    endpointSummary,
    environmentFilter,
    filteredEndpoints,
    filteredOperations,
    handleCopyCurrentView,
    inventoryAreaFilter,
    inventorySearchQuery,
    inventorySecurityFilter,
    probeFilter,
    resetEndpointFilters,
    resultTags,
    scopedProject,
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
  } = useIntegrationsPageController({
    pathname,
    locale,
    t,
    endpoints,
    summary,
    inventory,
    initialProjectId,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialCoverage,
    initialSort,
    initialInventorySearch,
    initialInventoryArea,
    initialInventorySecurity,
    clearFeedback,
    showError,
    showSuccess,
  });
  const {
    endpointCards,
    endpointSummaryCards,
    inventorySummaryCards,
    operationCards,
    securitySchemeCards,
  } = useIntegrationsPageSurfaceController({
    endpointSummary,
    filteredEndpoints,
    filteredOperations,
    inventory,
    locale,
    t,
  });
  const {
    endpointPresentationCards,
    operationPresentationCards,
    securitySchemePresentationCards,
  } = useIntegrationsPagePresentationController({
    endpointCards,
    operationCards,
    securitySchemeCards,
    t,
  });

  return {
    integrationsPageOverviewContentProps: {
      endpointSummaryCards,
    },
    integrationsPageLowerContentProps: {
      clearScopedProject,
      endpointPresentationCards,
      environmentFilter,
      feedback,
      filteredEndpoints,
      handleCopyCurrentView,
      inventory,
      inventoryAreaFilter,
      inventorySearchQuery,
      inventorySecurityFilter,
      inventorySummaryCards,
      operationPresentationCards,
      probeFilter,
      resetEndpointFilters,
      resultTags,
      scopedProject,
      searchQuery,
      securitySchemePresentationCards,
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
    },
  };
}
