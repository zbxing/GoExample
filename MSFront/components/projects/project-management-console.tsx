'use client';
import { ProjectManagementConsoleLowerContent } from '@/components/projects/project-management-console-lower-content';
import {
  type ManagedProject,
  type ProjectEnvironment,
  type ProjectStatus,
} from '@/lib/types/management';
import {
  type ProjectSortMode,
  type ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';
import { useProjectManagementConsoleBridgeController } from '@/lib/utils/use-project-management-console-bridge-controller';

interface ProjectManagementConsoleProps {
  projects: ManagedProject[];
  selectedProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ProjectSortMode;
  initialMode?: ProjectsRegistryMode;
  enableUrlSync?: boolean;
  allowCreate?: boolean;
}

export function ProjectManagementConsole({
  projects,
  selectedProjectId,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  initialMode = 'browse',
  enableUrlSync = false,
  allowCreate = true,
}: ProjectManagementConsoleProps) {
  const {
    projectManagementConsoleLowerContentProps,
  } = useProjectManagementConsoleBridgeController({
    projects,
    selectedProjectId,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialSort,
    initialMode,
    allowCreate,
    enableUrlSync,
  });

  return <ProjectManagementConsoleLowerContent {...projectManagementConsoleLowerContentProps} />;
}
