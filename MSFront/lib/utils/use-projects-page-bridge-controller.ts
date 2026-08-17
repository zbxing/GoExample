'use client';

import type {
  LocaleCode,
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type {
  ProjectSortMode,
  ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';
import { useProjectsPageSurfaceController } from '@/lib/utils/use-projects-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectsPageBridgeControllerOptions {
  projects: ManagedProject[];
  locale: LocaleCode;
  t: TranslationFn;
  initialPortfolioSearch?: string;
  initialPortfolioEnvironment?: 'all' | ProjectEnvironment;
  initialPortfolioStatus?: 'all' | ProjectStatus;
  initialPortfolioSort?: ProjectSortMode;
  initialProjectId?: string;
  initialRegistrySearch?: string;
  initialRegistryEnvironment?: 'all' | ProjectEnvironment;
  initialRegistryStatus?: 'all' | ProjectStatus;
  initialRegistrySort?: ProjectSortMode;
  initialRegistryMode?: ProjectsRegistryMode;
}

export function useProjectsPageBridgeController({
  projects,
  locale,
  t,
  initialPortfolioSearch = '',
  initialPortfolioEnvironment = 'all',
  initialPortfolioStatus = 'all',
  initialPortfolioSort = 'risk',
  initialProjectId = '',
  initialRegistrySearch = '',
  initialRegistryEnvironment = 'all',
  initialRegistryStatus = 'all',
  initialRegistrySort = 'risk',
  initialRegistryMode = 'browse',
}: UseProjectsPageBridgeControllerOptions) {
  const {
    commandCenterSpotlightFootnote,
    commandCenterSpotlightMetrics,
    commandCenterSummaryCards,
    commandCenterTags,
    priorityProject,
    projectConsoleKey,
    spotlightCards,
  } = useProjectsPageSurfaceController({
    projects,
    locale,
    t,
  });

  return {
    projectsPageOverviewContentProps: {
      commandCenterSpotlightFootnote,
      commandCenterSpotlightMetrics,
      commandCenterSummaryCards,
      commandCenterTags,
      priorityProject,
      projects,
      spotlightCards,
    },
    projectsPageLowerContentProps: {
      initialPortfolioEnvironment,
      initialPortfolioSearch,
      initialPortfolioSort,
      initialPortfolioStatus,
      initialProjectId,
      initialRegistryEnvironment,
      initialRegistryMode,
      initialRegistrySearch,
      initialRegistrySort,
      initialRegistryStatus,
      projectConsoleKey,
      projects,
    },
  };
}
