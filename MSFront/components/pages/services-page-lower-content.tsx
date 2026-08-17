'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import { ServicesPageResultsWorkspaceShell } from '@/components/pages/services-page-results-workspace-shell';
import type { useServicesPageController } from '@/lib/utils/use-services-page-controller';
import type { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

interface ServicesPageLowerContentProps {
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

export function ServicesPageLowerContent({
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
}: ServicesPageLowerContentProps) {
  return (
    <ServicesPageResultsWorkspaceShell
      categoryFilter={categoryFilter}
      clearScopedProject={clearScopedProject}
      environmentFilter={environmentFilter}
      feedback={feedback}
      groupedServices={groupedServices}
      handleCopyCurrentView={handleCopyCurrentView}
      resetFilters={resetFilters}
      resultTags={resultTags}
      scopedProject={scopedProject}
      searchQuery={searchQuery}
      serviceCardMap={serviceCardMap}
      serviceStatusGroups={serviceStatusGroups}
      setCategoryFilter={setCategoryFilter}
      setEnvironmentFilter={setEnvironmentFilter}
      setSearchQuery={setSearchQuery}
      setSortMode={setSortMode}
      setStatusFilter={setStatusFilter}
      sortMode={sortMode}
      statusFilter={statusFilter}
    />
  );
}
