'use client';

import { ResultsWorkbenchControls } from '@/components/common/results-workbench-controls';
import {
  ServicesPageWorkbenchFiltersContent,
} from '@/components/pages/services-page-workbench-filters-content';
import {
  ServicesPageWorkbenchResultsBarContent,
} from '@/components/pages/services-page-workbench-results-bar-content';
import type {
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { ServiceSortMode } from '@/lib/utils/governance-filters';
import type { useServicesPageController } from '@/lib/utils/use-services-page-controller';

interface ServicesPageWorkbenchContentProps {
  categoryFilter: 'all' | ManagedServiceCategory;
  clearScopedProject: ReturnType<typeof useServicesPageController>['clearScopedProject'];
  environmentFilter: 'all' | ProjectEnvironment;
  handleCopyCurrentView: ReturnType<typeof useServicesPageController>['handleCopyCurrentView'];
  resetFilters: ReturnType<typeof useServicesPageController>['resetFilters'];
  resultTags: ReturnType<typeof useServicesPageController>['resultTags'];
  scopedProject: ReturnType<typeof useServicesPageController>['scopedProject'];
  searchQuery: string;
  setCategoryFilter: (value: 'all' | ManagedServiceCategory) => void;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: ServiceSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: ServiceSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function ServicesPageWorkbenchContent({
  categoryFilter,
  clearScopedProject,
  environmentFilter,
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
}: ServicesPageWorkbenchContentProps) {
  return (
    <ResultsWorkbenchControls
      filters={
        <ServicesPageWorkbenchFiltersContent
          categoryFilter={categoryFilter}
          environmentFilter={environmentFilter}
          searchQuery={searchQuery}
          setCategoryFilter={setCategoryFilter}
          setEnvironmentFilter={setEnvironmentFilter}
          setSearchQuery={setSearchQuery}
          setSortMode={setSortMode}
          setStatusFilter={setStatusFilter}
          sortMode={sortMode}
          statusFilter={statusFilter}
        />
      }
      resultsBar={
        <ServicesPageWorkbenchResultsBarContent
          clearScopedProject={clearScopedProject}
          handleCopyCurrentView={handleCopyCurrentView}
          resetFilters={resetFilters}
          resultTags={resultTags}
          scopedProject={scopedProject}
        />
      }
    />
  );
}
