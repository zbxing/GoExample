'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import { ResultsWorkspaceShell } from '@/components/common/results-workspace-shell';
import { ServicesPageResultsContent } from '@/components/pages/services-page-content';
import { ServicesPageWorkbenchContent } from '@/components/pages/services-page-workbench-content';
import { useLocale } from '@/providers/locale-provider';
import type { useServicesPageController } from '@/lib/utils/use-services-page-controller';
import type { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

interface ServicesPageResultsWorkspaceShellProps {
  categoryFilter: ReturnType<typeof useServicesPageController>['categoryFilter'];
  clearScopedProject: ReturnType<typeof useServicesPageController>['clearScopedProject'];
  environmentFilter: ReturnType<typeof useServicesPageController>['environmentFilter'];
  feedback: FeedbackState | null;
  groupedServices: ReturnType<typeof useServicesPageController>['groupedServices'];
  handleCopyCurrentView: ReturnType<typeof useServicesPageController>['handleCopyCurrentView'];
  resetFilters: ReturnType<typeof useServicesPageController>['resetFilters'];
  resultTags: ReturnType<typeof useServicesPageController>['resultTags'];
  scopedProject: ReturnType<typeof useServicesPageController>['scopedProject'];
  searchQuery: ReturnType<typeof useServicesPageController>['searchQuery'];
  serviceCardMap: ReturnType<typeof useServicesPageSurfaceController>['serviceCardMap'];
  serviceStatusGroups: ReturnType<typeof useServicesPageSurfaceController>['serviceStatusGroups'];
  setCategoryFilter: ReturnType<typeof useServicesPageController>['setCategoryFilter'];
  setEnvironmentFilter: ReturnType<typeof useServicesPageController>['setEnvironmentFilter'];
  setSearchQuery: ReturnType<typeof useServicesPageController>['setSearchQuery'];
  setSortMode: ReturnType<typeof useServicesPageController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useServicesPageController>['setStatusFilter'];
  sortMode: ReturnType<typeof useServicesPageController>['sortMode'];
  statusFilter: ReturnType<typeof useServicesPageController>['statusFilter'];
}

export function ServicesPageResultsWorkspaceShell({
  categoryFilter,
  clearScopedProject,
  environmentFilter,
  feedback,
  groupedServices,
  handleCopyCurrentView,
  resetFilters,
  resultTags,
  scopedProject,
  searchQuery,
  serviceCardMap,
  serviceStatusGroups,
  setCategoryFilter,
  setEnvironmentFilter,
  setSearchQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: ServicesPageResultsWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <ResultsWorkspaceShell
      title={t('dashboard.services.registryTitle')}
      description={t('dashboard.services.registryDescription')}
      workbench={
        <ServicesPageWorkbenchContent
          categoryFilter={categoryFilter}
          clearScopedProject={clearScopedProject}
          environmentFilter={environmentFilter}
          handleCopyCurrentView={handleCopyCurrentView}
          resetFilters={resetFilters}
          resultTags={resultTags}
          scopedProject={scopedProject}
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
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('dashboard.services.emptyTitle')}</strong>
          <p>{t('dashboard.services.emptyDescription')}</p>
        </div>
      }
      hasContent={groupedServices.length > 0}
    >
      <ServicesPageResultsContent
        serviceCardMap={serviceCardMap}
        serviceStatusGroups={serviceStatusGroups}
      />
    </ResultsWorkspaceShell>
  );
}
