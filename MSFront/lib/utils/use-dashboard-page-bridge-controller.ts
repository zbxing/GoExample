'use client';

import type {
  ManagedProject,
  ManagementBackendProbe,
  ManagementOverview,
  ProjectEnvironment,
  ProjectStatus,
  SecurityGovernanceView,
} from '@/lib/types/management';
import type { LocaleCode } from '@/lib/types/management';
import { useDashboardPageController } from '@/lib/utils/use-dashboard-page-controller';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseDashboardPageBridgeControllerOptions {
  overview: ManagementOverview & {
    backend: ManagementBackendProbe;
  };
  projects: ManagedProject[];
  security: SecurityGovernanceView;
  locale: LocaleCode;
  t: TranslationFn;
  initialPortfolioSearch?: string;
  initialPortfolioEnvironment?: 'all' | ProjectEnvironment;
  initialPortfolioStatus?: 'all' | ProjectStatus;
  initialPortfolioSort?: ProjectSortMode;
}

export function useDashboardPageBridgeController({
  overview,
  projects,
  security,
  locale,
  t,
  initialPortfolioSearch = '',
  initialPortfolioEnvironment = 'all',
  initialPortfolioStatus = 'all',
  initialPortfolioSort = 'risk',
}: UseDashboardPageBridgeControllerOptions) {
  const {
    activityItems,
    alertItems,
    backendRuntime,
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    securityOverviewPanelProps,
    spotlightCards,
  } = useDashboardPageController({
    locale,
    overview,
    projects,
    security,
    t,
  });

  return {
    dashboardPageOverviewContentProps: {
      backendRuntime,
      commandCenterSummaryCards,
      commandCenterTags,
      metrics,
      projects,
      securityOverviewPanelProps,
      spotlightCards,
    },
    dashboardPageContentProps: {
      activityItems,
      alertItems,
      backendRuntime,
      initialPortfolioEnvironment,
      initialPortfolioSearch,
      initialPortfolioSort,
      initialPortfolioStatus,
      projects,
    },
  };
}
