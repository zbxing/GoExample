'use client';

import {
  ProjectBadgeGroup,
  ProjectMetricList,
} from '@/components/common/project-surface';
import type {
  ManagedProject,
} from '@/lib/types/management';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface ProjectManagementConsoleRegistryContentProps {
  activeProjectId: string;
  filteredProjectList: readonly ManagedProject[];
  projectRegistryEntries: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['projectRegistryEntries'];
  selectProject: (project: ManagedProject) => void;
}

export function ProjectManagementConsoleRegistryContent({
  activeProjectId,
  filteredProjectList,
  projectRegistryEntries,
  selectProject,
}: ProjectManagementConsoleRegistryContentProps) {
  if (projectRegistryEntries.length === 0) {
    return null;
  }

  return (
    <div className="registryList">
      {projectRegistryEntries.map((project) => (
        <button
          key={project.id}
          type="button"
          className={project.id === activeProjectId ? 'registryItem active' : 'registryItem'}
          onClick={() => selectProject(filteredProjectList.find((item) => item.id === project.id)!)}
        >
          <div className="securityHeaderRow">
            <div>
              <strong>{project.name}</strong>
              <span>{project.identity}</span>
              <small>{project.detail}</small>
            </div>
            <ProjectBadgeGroup status={project.status} environment={project.environment} />
          </div>
          <ProjectMetricList metrics={project.metrics} />
        </button>
      ))}
    </div>
  );
}
