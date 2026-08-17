'use client';

import { ResultsWorkbenchControls } from '@/components/common/results-workbench-controls';
import {
  IntegrationsPageWorkbenchFiltersContent,
} from '@/components/pages/integrations-page-workbench-filters-content';
import {
  IntegrationsPageWorkbenchResultsBarContent,
} from '@/components/pages/integrations-page-workbench-results-bar-content';
import type {
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type {
  EndpointSortMode,
  ProbeCoverageFilter,
} from '@/lib/utils/governance-filters';
import type { useIntegrationsPageController } from '@/lib/utils/use-integrations-page-controller';

interface IntegrationsPageWorkbenchContentProps {
  clearScopedProject: ReturnType<typeof useIntegrationsPageController>['clearScopedProject'];
  environmentFilter: 'all' | ProjectEnvironment;
  handleCopyCurrentView: ReturnType<typeof useIntegrationsPageController>['handleCopyCurrentView'];
  probeFilter: ProbeCoverageFilter;
  resetEndpointFilters: ReturnType<typeof useIntegrationsPageController>['resetEndpointFilters'];
  resultTags: ReturnType<typeof useIntegrationsPageController>['resultTags'];
  scopedProject: ReturnType<typeof useIntegrationsPageController>['scopedProject'];
  searchQuery: string;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setProbeFilter: (value: ProbeCoverageFilter) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: EndpointSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: EndpointSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function IntegrationsPageWorkbenchContent({
  clearScopedProject,
  environmentFilter,
  handleCopyCurrentView,
  probeFilter,
  resetEndpointFilters,
  resultTags,
  scopedProject,
  searchQuery,
  setEnvironmentFilter,
  setProbeFilter,
  setSearchQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: IntegrationsPageWorkbenchContentProps) {
  return (
    <ResultsWorkbenchControls
      filters={
        <IntegrationsPageWorkbenchFiltersContent
          environmentFilter={environmentFilter}
          probeFilter={probeFilter}
          searchQuery={searchQuery}
          setEnvironmentFilter={setEnvironmentFilter}
          setProbeFilter={setProbeFilter}
          setSearchQuery={setSearchQuery}
          setSortMode={setSortMode}
          setStatusFilter={setStatusFilter}
          sortMode={sortMode}
          statusFilter={statusFilter}
        />
      }
      resultsBar={
        <IntegrationsPageWorkbenchResultsBarContent
          clearScopedProject={clearScopedProject}
          handleCopyCurrentView={handleCopyCurrentView}
          resetEndpointFilters={resetEndpointFilters}
          resultTags={resultTags}
          scopedProject={scopedProject}
        />
      }
    />
  );
}
