'use client';

import { SectionHeader } from '@/components/common/section-header';
import { ProjectsPageLowerContent } from '@/components/pages/projects-page-lower-content';
import { ProjectsPageOverviewContent } from '@/components/pages/projects-page-overview-content';
import type { ManagedProject } from '@/lib/types/management';
import type {
  ProjectSortMode,
  ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';
import type { ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import { useProjectsPageBridgeController } from '@/lib/utils/use-projects-page-bridge-controller';
import { useLocale } from '@/providers/locale-provider';

interface ProjectsPageProps {
  projects: ManagedProject[];
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

export function ProjectsPage({
  projects,
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
}: ProjectsPageProps) {
  const { locale, t } = useLocale();
  const {
    projectsPageLowerContentProps,
    projectsPageOverviewContentProps,
  } = useProjectsPageBridgeController({
    projects,
    locale,
    t,
    initialPortfolioSearch,
    initialPortfolioEnvironment,
    initialPortfolioStatus,
    initialPortfolioSort,
    initialProjectId,
    initialRegistrySearch,
    initialRegistryEnvironment,
    initialRegistryStatus,
    initialRegistrySort,
    initialRegistryMode,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.projects')}
        title={t('pages.projectsTitle')}
        description={t('pages.projectsDescription')}
      />
      <ProjectsPageOverviewContent {...projectsPageOverviewContentProps} />
      <ProjectsPageLowerContent {...projectsPageLowerContentProps} />
    </div>
  );
}
