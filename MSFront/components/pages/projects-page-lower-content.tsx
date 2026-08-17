'use client';

import { PortfolioGrid } from '@/components/dashboard/portfolio-grid';
import { ProjectManagementConsole } from '@/components/projects/project-management-console';
import type { ManagedProject, ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import type {
  ProjectSortMode,
  ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';

interface ProjectsPageLowerContentProps {
  initialPortfolioEnvironment: 'all' | ProjectEnvironment;
  initialPortfolioSearch: string;
  initialPortfolioSort: ProjectSortMode;
  initialPortfolioStatus: 'all' | ProjectStatus;
  initialProjectId: string;
  initialRegistryEnvironment: 'all' | ProjectEnvironment;
  initialRegistryMode: ProjectsRegistryMode;
  initialRegistrySearch: string;
  initialRegistrySort: ProjectSortMode;
  initialRegistryStatus: 'all' | ProjectStatus;
  projectConsoleKey: string;
  projects: ManagedProject[];
}

export function ProjectsPageLowerContent({
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
}: ProjectsPageLowerContentProps) {
  return (
    <>
      <PortfolioGrid
        projects={projects}
        initialSearch={initialPortfolioSearch}
        initialEnvironment={initialPortfolioEnvironment}
        initialStatus={initialPortfolioStatus}
        initialSort={initialPortfolioSort}
        enableUrlSync
        urlSyncScope="projects"
      />
      <ProjectManagementConsole
        key={projectConsoleKey}
        projects={projects}
        selectedProjectId={initialProjectId}
        initialSearch={initialRegistrySearch}
        initialEnvironment={initialRegistryEnvironment}
        initialStatus={initialRegistryStatus}
        initialSort={initialRegistrySort}
        initialMode={initialRegistryMode}
        enableUrlSync
      />
    </>
  );
}
