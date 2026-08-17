'use client';

import { PortfolioGridResultsContent } from '@/components/dashboard/portfolio-grid-results-content';
import { PortfolioGridWorkbenchContent } from '@/components/dashboard/portfolio-grid-workbench-content';
import { useLocale } from '@/providers/locale-provider';
import type { ManagedProject, ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import { useFeedback } from '@/lib/utils/use-feedback';
import { type ProjectSortMode } from '@/lib/utils/governance-filters';
import { usePortfolioGridController } from '@/lib/utils/use-portfolio-grid-controller';

interface PortfolioGridProps {
  projects: ManagedProject[];
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ProjectSortMode;
  enableUrlSync?: boolean;
  urlSyncScope?: 'projects' | 'dashboard';
}

export function PortfolioGrid({
  projects,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  enableUrlSync = false,
  urlSyncScope = 'projects',
}: PortfolioGridProps) {
  const { locale, t } = useLocale();
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback();
  const pathname =
    urlSyncScope === 'dashboard'
      ? '/dashboard'
      : '/projects';
  const {
    clearEnvironmentFilter,
    copyApi,
    environmentFilter,
    filteredProjects,
    focusedEnvironment,
    groupedProjects,
    handleCopyCurrentView,
    query,
    resetFilters,
    resultTags,
    setEnvironmentFilter,
    setQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
    summary,
  } = usePortfolioGridController({
    pathname,
    locale,
    t,
    projects,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialSort,
    enableUrlSync,
    urlSyncScope,
    clearFeedback,
    showError,
    showSuccess,
  });

  return (
    <div className="portfolioWorkbench">
      <PortfolioGridWorkbenchContent
        clearEnvironmentFilter={clearEnvironmentFilter}
        enableUrlSync={enableUrlSync}
        environmentFilter={environmentFilter}
        feedback={feedback}
        filteredProjectsCount={filteredProjects.length}
        focusedEnvironment={focusedEnvironment}
        handleCopyCurrentView={handleCopyCurrentView}
        locale={locale}
        query={query}
        resetFilters={resetFilters}
        resultTags={resultTags}
        setEnvironmentFilter={setEnvironmentFilter}
        setQuery={setQuery}
        setSortMode={setSortMode}
        setStatusFilter={setStatusFilter}
        sortMode={sortMode}
        statusFilter={statusFilter}
        summary={summary}
        t={t}
        urlSyncScope={urlSyncScope}
      />
      <PortfolioGridResultsContent groupedProjects={groupedProjects} onCopyApi={copyApi} />
    </div>
  );
}
