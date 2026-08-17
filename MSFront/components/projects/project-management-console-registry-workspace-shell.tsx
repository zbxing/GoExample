'use client';

import { RegistryWorkspaceShell } from '@/components/common/registry-workspace-shell';
import {
  ProjectManagementConsoleRegistryContent,
} from '@/components/projects/project-management-console-content';
import { ProjectManagementConsoleRegistryActionsContent } from '@/components/projects/project-management-console-registry-actions-content';
import {
  ProjectManagementConsoleRegistryWorkbenchContent,
} from '@/components/projects/project-management-console-workbench-content';
import { useLocale } from '@/providers/locale-provider';
import type { useProjectManagementConsoleController } from '@/lib/utils/use-project-management-console-controller';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface ProjectManagementConsoleRegistryWorkspaceShellProps {
  activeProjectFocusTag: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['activeProjectFocusTag'];
  activeProjectId: ReturnType<typeof useProjectManagementConsoleController>['activeProjectId'];
  allowCreate: boolean;
  clearProjectFilter: ReturnType<typeof useProjectManagementConsoleController>['clearProjectFilter'];
  createProject: ReturnType<typeof useProjectManagementConsoleController>['createProject'];
  enableUrlSync: boolean;
  environmentFilter: ReturnType<typeof useProjectManagementConsoleController>['environmentFilter'];
  feedback: ReturnType<typeof useProjectManagementConsoleController>['feedback'];
  filteredProjectList: ReturnType<
    typeof useProjectManagementConsoleController
  >['filteredProjectList'];
  handleCopyCurrentView: ReturnType<
    typeof useProjectManagementConsoleController
  >['handleCopyCurrentView'];
  isCreating: ReturnType<typeof useProjectManagementConsoleController>['isCreating'];
  linkedProjectId: ReturnType<typeof useProjectManagementConsoleController>['linkedProjectId'];
  projectList: ReturnType<typeof useProjectManagementConsoleController>['projectList'];
  projectRegistryEntries: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['projectRegistryEntries'];
  registryQuery: ReturnType<typeof useProjectManagementConsoleController>['registryQuery'];
  registrySummaryCards: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['registrySummaryCards'];
  registryTags: ReturnType<typeof useProjectManagementConsoleSurfaceController>['registryTags'];
  resetRegistryFilters: ReturnType<
    typeof useProjectManagementConsoleController
  >['resetRegistryFilters'];
  selectProject: ReturnType<typeof useProjectManagementConsoleController>['selectProject'];
  setEnvironmentFilter: ReturnType<
    typeof useProjectManagementConsoleController
  >['setEnvironmentFilter'];
  setRegistryQuery: ReturnType<typeof useProjectManagementConsoleController>['setRegistryQuery'];
  setSortMode: ReturnType<typeof useProjectManagementConsoleController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useProjectManagementConsoleController>['setStatusFilter'];
  sortMode: ReturnType<typeof useProjectManagementConsoleController>['sortMode'];
  statusFilter: ReturnType<typeof useProjectManagementConsoleController>['statusFilter'];
}

export function ProjectManagementConsoleRegistryWorkspaceShell({
  activeProjectFocusTag,
  activeProjectId,
  allowCreate,
  clearProjectFilter,
  createProject,
  enableUrlSync,
  environmentFilter,
  feedback,
  filteredProjectList,
  handleCopyCurrentView,
  isCreating,
  linkedProjectId,
  projectList,
  projectRegistryEntries,
  registryQuery,
  registrySummaryCards,
  registryTags,
  resetRegistryFilters,
  selectProject,
  setEnvironmentFilter,
  setRegistryQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: ProjectManagementConsoleRegistryWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <RegistryWorkspaceShell
      title={t('labels.projectRegistry')}
      description={t('projectConsole.registryDescription')}
      actions={
        <ProjectManagementConsoleRegistryActionsContent
          allowCreate={allowCreate}
          createProject={createProject}
        />
      }
      workbench={
        <ProjectManagementConsoleRegistryWorkbenchContent
          activeProjectFocusTag={activeProjectFocusTag}
          clearProjectFilter={clearProjectFilter}
          enableUrlSync={enableUrlSync}
          environmentFilter={environmentFilter}
          handleCopyCurrentView={handleCopyCurrentView}
          isCreating={isCreating}
          linkedProjectId={linkedProjectId}
          registryQuery={registryQuery}
          registrySummaryCards={registrySummaryCards}
          registryTags={registryTags}
          resetRegistryFilters={resetRegistryFilters}
          setEnvironmentFilter={setEnvironmentFilter}
          setRegistryQuery={setRegistryQuery}
          setSortMode={setSortMode}
          setStatusFilter={setStatusFilter}
          sortMode={sortMode}
          statusFilter={statusFilter}
        />
      }
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>
            {projectList.length === 0
              ? t('projectConsole.registryEmptyTitle')
              : t('dashboard.portfolio.noResultsTitle')}
          </strong>
          <p>
            {projectList.length === 0
              ? t('projectConsole.registryEmptyDescription')
              : t('dashboard.portfolio.noResultsDescription')}
          </p>
        </div>
      }
      hasContent={projectList.length > 0 && filteredProjectList.length > 0}
    >
      <ProjectManagementConsoleRegistryContent
        activeProjectId={activeProjectId}
        filteredProjectList={filteredProjectList}
        projectRegistryEntries={projectRegistryEntries}
        selectProject={selectProject}
      />
    </RegistryWorkspaceShell>
  );
}
