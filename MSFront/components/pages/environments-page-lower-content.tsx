'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import { EnvironmentsPageResultsWorkspaceShell } from '@/components/pages/environments-page-results-workspace-shell';
import type { useEnvironmentsPageController } from '@/lib/utils/use-environments-page-controller';
import type { useEnvironmentsPageSurfaceController } from '@/lib/utils/use-environments-page-surface-controller';

interface EnvironmentsPageLowerContentProps {
  clearEnvironmentFilter: ReturnType<typeof useEnvironmentsPageController>['clearEnvironmentFilter'];
  environmentCards: ReturnType<typeof useEnvironmentsPageSurfaceController>['environmentCards'];
  environmentFilter: ReturnType<typeof useEnvironmentsPageController>['environmentFilter'];
  environmentStatusGroups: ReturnType<
    typeof useEnvironmentsPageSurfaceController
  >['environmentStatusGroups'];
  feedback: FeedbackState | null;
  focusedEnvironment: ReturnType<typeof useEnvironmentsPageController>['focusedEnvironment'];
  groupedEnvironments: ReturnType<typeof useEnvironmentsPageController>['groupedEnvironments'];
  handleCopyCurrentView: ReturnType<typeof useEnvironmentsPageController>['handleCopyCurrentView'];
  resetFilters: ReturnType<typeof useEnvironmentsPageController>['resetFilters'];
  resultTags: ReturnType<typeof useEnvironmentsPageController>['resultTags'];
  searchQuery: ReturnType<typeof useEnvironmentsPageController>['searchQuery'];
  setEnvironmentFilter: ReturnType<typeof useEnvironmentsPageController>['setEnvironmentFilter'];
  setSearchQuery: ReturnType<typeof useEnvironmentsPageController>['setSearchQuery'];
  setSortMode: ReturnType<typeof useEnvironmentsPageController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useEnvironmentsPageController>['setStatusFilter'];
  sortMode: ReturnType<typeof useEnvironmentsPageController>['sortMode'];
  statusFilter: ReturnType<typeof useEnvironmentsPageController>['statusFilter'];
}

export function EnvironmentsPageLowerContent({
  clearEnvironmentFilter,
  environmentCards,
  environmentFilter,
  environmentStatusGroups,
  feedback,
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
}: EnvironmentsPageLowerContentProps) {
  return (
    <EnvironmentsPageResultsWorkspaceShell
      clearEnvironmentFilter={clearEnvironmentFilter}
      environmentCards={environmentCards}
      environmentFilter={environmentFilter}
      environmentStatusGroups={environmentStatusGroups}
      feedback={feedback}
      focusedEnvironment={focusedEnvironment}
      groupedEnvironments={groupedEnvironments}
      handleCopyCurrentView={handleCopyCurrentView}
      resetFilters={resetFilters}
      resultTags={resultTags}
      searchQuery={searchQuery}
      setEnvironmentFilter={setEnvironmentFilter}
      setSearchQuery={setSearchQuery}
      setSortMode={setSortMode}
      setStatusFilter={setStatusFilter}
      sortMode={sortMode}
      statusFilter={statusFilter}
    />
  );
}
