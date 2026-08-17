'use client';

import { usePathname } from 'next/navigation';
import type {
  LocaleCode,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
  ServiceCategorySummary,
  ServiceHealthEntry,
} from '@/lib/types/management';
import type { ServiceSortMode } from '@/lib/utils/governance-filters';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useServicesPageController } from '@/lib/utils/use-services-page-controller';
import { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseServicesPageBridgeControllerOptions {
  services: ServiceHealthEntry[];
  categorySummary: ServiceCategorySummary[];
  locale: LocaleCode;
  t: TranslationFn;
  initialProjectId?: string;
  initialSearch?: string;
  initialCategory?: 'all' | ManagedServiceCategory;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ServiceSortMode;
}

export function useServicesPageBridgeController({
  services,
  categorySummary,
  locale,
  t,
  initialProjectId = '',
  initialSearch = '',
  initialCategory = 'all',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
}: UseServicesPageBridgeControllerOptions) {
  const pathname = usePathname();
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback();
  const {
    categoryFilter,
    clearScopedProject,
    environmentFilter,
    filteredCategoryCount,
    filteredCriticalCount,
    filteredHealthyCount,
    filteredOwnerCount,
    filteredProjectCount,
    filteredServices,
    filteredWarningCount,
    groupedServices,
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
    visibleCategorySummary,
  } = useServicesPageController({
    pathname,
    locale,
    t,
    services,
    categorySummary,
    initialProjectId,
    initialSearch,
    initialCategory,
    initialEnvironment,
    initialStatus,
    initialSort,
    clearFeedback,
    showError,
    showSuccess,
  });
  const {
    categorySummaryCards,
    overviewSummaryCards,
    serviceCardMap,
    serviceStatusGroups,
  } = useServicesPageSurfaceController({
    filteredServices,
    filteredProjectCount,
    filteredHealthyCount,
    filteredWarningCount,
    filteredCriticalCount,
    filteredOwnerCount,
    filteredCategoryCount,
    visibleCategorySummary,
    groupedServices,
    locale,
    t,
  });

  return {
    servicesPageOverviewContentProps: {
      overviewSummaryCards,
      categorySummaryCards,
    },
    servicesPageLowerContentProps: {
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
    },
  };
}
