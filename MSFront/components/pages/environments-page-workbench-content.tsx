'use client';

import { ResultsWorkbenchControls } from '@/components/common/results-workbench-controls';
import {
  EnvironmentsPageWorkbenchFiltersContent,
} from '@/components/pages/environments-page-workbench-filters-content';
import {
  EnvironmentsPageWorkbenchResultsBarContent,
} from '@/components/pages/environments-page-workbench-results-bar-content';
import type {
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { EnvironmentSortMode } from '@/lib/utils/governance-filters';
import type { useEnvironmentsPageController } from '@/lib/utils/use-environments-page-controller';

interface EnvironmentsPageWorkbenchContentProps {
  clearEnvironmentFilter: () => void;
  environmentFilter: 'all' | ProjectEnvironment;
  focusedEnvironment: ProjectEnvironment | null;
  handleCopyCurrentView: () => void;
  resetFilters: () => void;
  resultTags: ReturnType<typeof useEnvironmentsPageController>['resultTags'];
  searchQuery: string;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: EnvironmentSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: EnvironmentSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function EnvironmentsPageWorkbenchContent({
  clearEnvironmentFilter,
  environmentFilter,
  focusedEnvironment,
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
}: EnvironmentsPageWorkbenchContentProps) {
  return (
    <ResultsWorkbenchControls
      filters={
        <EnvironmentsPageWorkbenchFiltersContent
          environmentFilter={environmentFilter}
          searchQuery={searchQuery}
          setEnvironmentFilter={setEnvironmentFilter}
          setSearchQuery={setSearchQuery}
          setSortMode={setSortMode}
          setStatusFilter={setStatusFilter}
          sortMode={sortMode}
          statusFilter={statusFilter}
        />
      }
      resultsBar={
        <EnvironmentsPageWorkbenchResultsBarContent
          clearEnvironmentFilter={clearEnvironmentFilter}
          focusedEnvironment={focusedEnvironment}
          handleCopyCurrentView={handleCopyCurrentView}
          resetFilters={resetFilters}
          resultTags={resultTags}
        />
      }
    />
  );
}
