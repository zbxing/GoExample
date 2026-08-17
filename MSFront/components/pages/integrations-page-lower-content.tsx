'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import {
  IntegrationsPageInventorySectionShell,
} from '@/components/pages/integrations-page-inventory-section-shell';
import { IntegrationsPageResultsWorkspaceShell } from '@/components/pages/integrations-page-results-workspace-shell';
import type {
  ApiInventoryArea,
  IntegrationsGovernanceView,
} from '@/lib/types/management';
import type { InventorySecurityFilter } from '@/lib/utils/governance-filters';
import type { useIntegrationsPageController } from '@/lib/utils/use-integrations-page-controller';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

interface IntegrationsPageLowerContentProps {
  clearScopedProject: ReturnType<typeof useIntegrationsPageController>['clearScopedProject'];
  endpointPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['endpointPresentationCards'];
  environmentFilter: ReturnType<typeof useIntegrationsPageController>['environmentFilter'];
  feedback: FeedbackState | null;
  filteredEndpoints: ReturnType<typeof useIntegrationsPageController>['filteredEndpoints'];
  handleCopyCurrentView: ReturnType<typeof useIntegrationsPageController>['handleCopyCurrentView'];
  inventory: IntegrationsGovernanceView['inventory'];
  inventoryAreaFilter: 'all' | ApiInventoryArea;
  inventorySearchQuery: string;
  inventorySecurityFilter: InventorySecurityFilter;
  inventorySummaryCards: ReturnType<typeof useIntegrationsPageSurfaceController>['inventorySummaryCards'];
  operationPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['operationPresentationCards'];
  probeFilter: ReturnType<typeof useIntegrationsPageController>['probeFilter'];
  resetEndpointFilters: ReturnType<typeof useIntegrationsPageController>['resetEndpointFilters'];
  resultTags: ReturnType<typeof useIntegrationsPageController>['resultTags'];
  scopedProject: ReturnType<typeof useIntegrationsPageController>['scopedProject'];
  searchQuery: string;
  securitySchemePresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['securitySchemePresentationCards'];
  setEnvironmentFilter: ReturnType<typeof useIntegrationsPageController>['setEnvironmentFilter'];
  setInventoryAreaFilter: (value: 'all' | ApiInventoryArea) => void;
  setInventorySearchQuery: (value: string) => void;
  setInventorySecurityFilter: (value: InventorySecurityFilter) => void;
  setProbeFilter: ReturnType<typeof useIntegrationsPageController>['setProbeFilter'];
  setSearchQuery: ReturnType<typeof useIntegrationsPageController>['setSearchQuery'];
  setSortMode: ReturnType<typeof useIntegrationsPageController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useIntegrationsPageController>['setStatusFilter'];
  sortMode: ReturnType<typeof useIntegrationsPageController>['sortMode'];
  statusFilter: ReturnType<typeof useIntegrationsPageController>['statusFilter'];
}

export function IntegrationsPageLowerContent({
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
}: IntegrationsPageLowerContentProps) {
  return (
    <>
      <IntegrationsPageResultsWorkspaceShell
        clearScopedProject={clearScopedProject}
        endpointPresentationCards={endpointPresentationCards}
        environmentFilter={environmentFilter}
        feedback={feedback}
        filteredEndpoints={filteredEndpoints}
        handleCopyCurrentView={handleCopyCurrentView}
        probeFilter={probeFilter}
        resetEndpointFilters={resetEndpointFilters}
        resultTags={resultTags}
        scopedProject={scopedProject}
        searchQuery={searchQuery}
        setEnvironmentFilter={setEnvironmentFilter}
        setProbeFilter={setProbeFilter}
        setSearchQuery={setSearchQuery}
        setSortMode={setSortMode}
        setStatusFilter={setStatusFilter}
        sortMode={sortMode}
        statusFilter={statusFilter}
      />
      <IntegrationsPageInventorySectionShell
        inventory={inventory}
        inventoryAreaFilter={inventoryAreaFilter}
        inventorySearchQuery={inventorySearchQuery}
        inventorySecurityFilter={inventorySecurityFilter}
        inventorySummaryCards={inventorySummaryCards}
        operationPresentationCards={operationPresentationCards}
        securitySchemePresentationCards={securitySchemePresentationCards}
        setInventoryAreaFilter={setInventoryAreaFilter}
        setInventorySearchQuery={setInventorySearchQuery}
        setInventorySecurityFilter={setInventorySecurityFilter}
      />
    </>
  );
}
