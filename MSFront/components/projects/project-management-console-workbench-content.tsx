'use client';

import { ResultsWorkbenchControls } from '@/components/common/results-workbench-controls';
import { SummaryCard } from '@/components/common/management-primitives';
import {
  ProjectManagementConsoleRegistryWorkbenchFiltersContent,
} from '@/components/projects/project-management-console-workbench-filters-content';
import {
  ProjectManagementConsoleRegistryWorkbenchResultsBarContent,
} from '@/components/projects/project-management-console-workbench-results-bar-content';
import type {
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface ProjectManagementConsoleRegistryWorkbenchContentProps {
  activeProjectFocusTag: string;
  clearProjectFilter: () => void;
  enableUrlSync: boolean;
  environmentFilter: 'all' | ProjectEnvironment;
  handleCopyCurrentView: () => void;
  isCreating: boolean;
  linkedProjectId: string;
  registryQuery: string;
  registrySummaryCards: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['registrySummaryCards'];
  registryTags: ReturnType<typeof useProjectManagementConsoleSurfaceController>['registryTags'];
  resetRegistryFilters: () => void;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setRegistryQuery: (value: string) => void;
  setSortMode: (value: ProjectSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: ProjectSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function ProjectManagementConsoleRegistryWorkbenchContent({
  activeProjectFocusTag,
  clearProjectFilter,
  enableUrlSync,
  environmentFilter,
  handleCopyCurrentView,
  isCreating,
  linkedProjectId,
  registryQuery,
  registrySummaryCards,
  registryTags,
  resetRegistryFilters,
  setEnvironmentFilter,
  setRegistryQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: ProjectManagementConsoleRegistryWorkbenchContentProps) {
  return (
    <>
      <div className="portfolioSummaryGrid">
        {registrySummaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </div>

      <ResultsWorkbenchControls
        filters={
          <ProjectManagementConsoleRegistryWorkbenchFiltersContent
            environmentFilter={environmentFilter}
            registryQuery={registryQuery}
            setEnvironmentFilter={setEnvironmentFilter}
            setRegistryQuery={setRegistryQuery}
            setSortMode={setSortMode}
            setStatusFilter={setStatusFilter}
            sortMode={sortMode}
            statusFilter={statusFilter}
          />
        }
        resultsBar={
          <ProjectManagementConsoleRegistryWorkbenchResultsBarContent
            activeProjectFocusTag={activeProjectFocusTag}
            clearProjectFilter={clearProjectFilter}
            enableUrlSync={enableUrlSync}
            handleCopyCurrentView={handleCopyCurrentView}
            isCreating={isCreating}
            linkedProjectId={linkedProjectId}
            registryTags={registryTags}
            resetRegistryFilters={resetRegistryFilters}
          />
        }
      />
    </>
  );
}
