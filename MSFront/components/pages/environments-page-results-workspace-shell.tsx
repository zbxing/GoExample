'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import { ResultsWorkspaceShell } from '@/components/common/results-workspace-shell';
import { EnvironmentsPageResultsContent } from '@/components/pages/environments-page-content';
import { EnvironmentsPageWorkbenchContent } from '@/components/pages/environments-page-workbench-content';
import { useLocale } from '@/providers/locale-provider';
import type { useEnvironmentsPageController } from '@/lib/utils/use-environments-page-controller';
import type { useEnvironmentsPageSurfaceController } from '@/lib/utils/use-environments-page-surface-controller';

interface EnvironmentsPageResultsWorkspaceShellProps {
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

export function EnvironmentsPageResultsWorkspaceShell({
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
}: EnvironmentsPageResultsWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <ResultsWorkspaceShell
      title={t('dashboard.environments.registryTitle')}
      description={t('dashboard.environments.registryDescription')}
      workbench={
        <EnvironmentsPageWorkbenchContent
          clearEnvironmentFilter={clearEnvironmentFilter}
          environmentFilter={environmentFilter}
          focusedEnvironment={focusedEnvironment}
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
      }
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('dashboard.environments.emptyTitle')}</strong>
          <p>{t('dashboard.environments.emptyDescription')}</p>
        </div>
      }
      hasContent={groupedEnvironments.length > 0}
    >
      <EnvironmentsPageResultsContent
        environmentCards={environmentCards}
        environmentStatusGroups={environmentStatusGroups}
      />
    </ResultsWorkspaceShell>
  );
}
