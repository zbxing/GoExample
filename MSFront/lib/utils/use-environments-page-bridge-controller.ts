'use client';

import { usePathname } from 'next/navigation';
import type {
  EnvironmentGovernanceItem,
  LocaleCode,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { type EnvironmentSortMode } from '@/lib/utils/governance-filters';
import { useEnvironmentsPageController } from '@/lib/utils/use-environments-page-controller';
import { useEnvironmentsPageSurfaceController } from '@/lib/utils/use-environments-page-surface-controller';
import { useFeedback } from '@/lib/utils/use-feedback';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseEnvironmentsPageBridgeControllerOptions {
  environments: EnvironmentGovernanceItem[];
  locale: LocaleCode;
  t: TranslationFn;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: EnvironmentSortMode;
}

export function useEnvironmentsPageBridgeController({
  environments,
  locale,
  t,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
}: UseEnvironmentsPageBridgeControllerOptions) {
  const pathname = usePathname();
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback();
  const {
    clearEnvironmentFilter,
    environmentFilter,
    filteredCriticalCount,
    filteredEnvironments,
    filteredHealthyCount,
    filteredOwnerCount,
    filteredProjectCount,
    filteredRegionCount,
    filteredWarningCount,
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
  } = useEnvironmentsPageController({
    pathname,
    locale,
    t,
    environments,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialSort,
    clearFeedback,
    showError,
    showSuccess,
  });
  const {
    environmentCards,
    environmentStatusGroups,
    overviewSummaryCards,
  } = useEnvironmentsPageSurfaceController({
    filteredEnvironments,
    filteredProjectCount,
    filteredHealthyCount,
    filteredWarningCount,
    filteredCriticalCount,
    filteredOwnerCount,
    filteredRegionCount,
    groupedEnvironments,
    locale,
    t,
  });

  return {
    environmentsPageOverviewContentProps: {
      overviewSummaryCards,
    },
    environmentsPageLowerContentProps: {
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
    },
  };
}
