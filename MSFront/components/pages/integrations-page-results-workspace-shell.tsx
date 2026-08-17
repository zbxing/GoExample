'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import { ResultsWorkspaceShell } from '@/components/common/results-workspace-shell';
import { IntegrationsPageResultsContent } from '@/components/pages/integrations-page-content';
import { IntegrationsPageWorkbenchContent } from '@/components/pages/integrations-page-workbench-content';
import { useLocale } from '@/providers/locale-provider';
import type { useIntegrationsPageController } from '@/lib/utils/use-integrations-page-controller';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';

interface IntegrationsPageResultsWorkspaceShellProps {
  clearScopedProject: ReturnType<typeof useIntegrationsPageController>['clearScopedProject'];
  endpointPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['endpointPresentationCards'];
  environmentFilter: ReturnType<typeof useIntegrationsPageController>['environmentFilter'];
  feedback: FeedbackState | null;
  filteredEndpoints: ReturnType<typeof useIntegrationsPageController>['filteredEndpoints'];
  handleCopyCurrentView: ReturnType<typeof useIntegrationsPageController>['handleCopyCurrentView'];
  probeFilter: ReturnType<typeof useIntegrationsPageController>['probeFilter'];
  resetEndpointFilters: ReturnType<typeof useIntegrationsPageController>['resetEndpointFilters'];
  resultTags: ReturnType<typeof useIntegrationsPageController>['resultTags'];
  scopedProject: ReturnType<typeof useIntegrationsPageController>['scopedProject'];
  searchQuery: string;
  setEnvironmentFilter: ReturnType<typeof useIntegrationsPageController>['setEnvironmentFilter'];
  setProbeFilter: ReturnType<typeof useIntegrationsPageController>['setProbeFilter'];
  setSearchQuery: ReturnType<typeof useIntegrationsPageController>['setSearchQuery'];
  setSortMode: ReturnType<typeof useIntegrationsPageController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useIntegrationsPageController>['setStatusFilter'];
  sortMode: ReturnType<typeof useIntegrationsPageController>['sortMode'];
  statusFilter: ReturnType<typeof useIntegrationsPageController>['statusFilter'];
}

export function IntegrationsPageResultsWorkspaceShell({
  clearScopedProject,
  endpointPresentationCards,
  environmentFilter,
  feedback,
  filteredEndpoints,
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
}: IntegrationsPageResultsWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <ResultsWorkspaceShell
      title={t('dashboard.integrations.filters.title')}
      description={t('dashboard.integrations.filters.description')}
      workbench={
        <IntegrationsPageWorkbenchContent
          clearScopedProject={clearScopedProject}
          environmentFilter={environmentFilter}
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
      }
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('dashboard.integrations.emptyTitle')}</strong>
          <p>{t('dashboard.integrations.emptyDescription')}</p>
        </div>
      }
      hasContent={filteredEndpoints.length > 0}
    >
      <IntegrationsPageResultsContent endpointPresentationCards={endpointPresentationCards} />
    </ResultsWorkspaceShell>
  );
}
