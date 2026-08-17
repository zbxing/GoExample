'use client';

import { ProjectManagementConsoleEditorWorkspaceShell } from '@/components/projects/project-management-console-editor-workspace-shell';
import { ProjectManagementConsoleRegistryWorkspaceShell } from '@/components/projects/project-management-console-registry-workspace-shell';
import type { useProjectManagementConsoleController } from '@/lib/utils/use-project-management-console-controller';
import type { useProjectManagementConsolePresentationController } from '@/lib/utils/use-project-management-console-presentation-controller';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface ProjectManagementConsoleLowerContentProps {
  activeProject: ReturnType<typeof useProjectManagementConsoleController>['activeProject'];
  activeProjectFocusTag: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['activeProjectFocusTag'];
  activeProjectId: ReturnType<typeof useProjectManagementConsoleController>['activeProjectId'];
  allowCreate: boolean;
  clearProjectFilter: ReturnType<typeof useProjectManagementConsoleController>['clearProjectFilter'];
  createProject: ReturnType<typeof useProjectManagementConsoleController>['createProject'];
  draft: ReturnType<typeof useProjectManagementConsoleController>['draft'];
  editorDescription: ReturnType<typeof useProjectManagementConsoleController>['editorDescription'];
  editorSections: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['editorSections'];
  editorSummaryCards: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['editorSummaryCards'];
  editorValidationVisible: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['editorValidationVisible'];
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
  isPending: ReturnType<typeof useProjectManagementConsoleController>['isPending'];
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
  removeProject: ReturnType<typeof useProjectManagementConsoleController>['removeProject'];
  resetRegistryFilters: ReturnType<
    typeof useProjectManagementConsoleController
  >['resetRegistryFilters'];
  saveProject: ReturnType<typeof useProjectManagementConsoleController>['saveProject'];
  selectProject: ReturnType<typeof useProjectManagementConsoleController>['selectProject'];
  serverEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serverEditorSection'];
  serviceEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serviceEditorSection'];
  setEnvironmentFilter: ReturnType<
    typeof useProjectManagementConsoleController
  >['setEnvironmentFilter'];
  setRegistryQuery: ReturnType<typeof useProjectManagementConsoleController>['setRegistryQuery'];
  setSortMode: ReturnType<typeof useProjectManagementConsoleController>['setSortMode'];
  setStatusFilter: ReturnType<typeof useProjectManagementConsoleController>['setStatusFilter'];
  sortMode: ReturnType<typeof useProjectManagementConsoleController>['sortMode'];
  statusFilter: ReturnType<typeof useProjectManagementConsoleController>['statusFilter'];
  validationIssues: ReturnType<typeof useProjectManagementConsoleController>['validationIssues'];
}

export function ProjectManagementConsoleLowerContent({
  activeProject,
  activeProjectFocusTag,
  activeProjectId,
  allowCreate,
  clearProjectFilter,
  createProject,
  draft,
  editorDescription,
  editorSections,
  editorSummaryCards,
  editorValidationVisible,
  enableUrlSync,
  environmentFilter,
  feedback,
  filteredProjectList,
  handleCopyCurrentView,
  isCreating,
  isPending,
  linkedProjectId,
  projectList,
  projectRegistryEntries,
  registryQuery,
  registrySummaryCards,
  registryTags,
  removeProject,
  resetRegistryFilters,
  saveProject,
  selectProject,
  serverEditorSection,
  serviceEditorSection,
  setEnvironmentFilter,
  setRegistryQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
  validationIssues,
}: ProjectManagementConsoleLowerContentProps) {
  return (
    <div className="projectManagerLayout">
      <ProjectManagementConsoleRegistryWorkspaceShell
        activeProjectFocusTag={activeProjectFocusTag}
        activeProjectId={activeProjectId}
        allowCreate={allowCreate}
        clearProjectFilter={clearProjectFilter}
        createProject={createProject}
        enableUrlSync={enableUrlSync}
        environmentFilter={environmentFilter}
        feedback={feedback}
        filteredProjectList={filteredProjectList}
        handleCopyCurrentView={handleCopyCurrentView}
        isCreating={isCreating}
        linkedProjectId={linkedProjectId}
        projectList={projectList}
        projectRegistryEntries={projectRegistryEntries}
        registryQuery={registryQuery}
        registrySummaryCards={registrySummaryCards}
        registryTags={registryTags}
        resetRegistryFilters={resetRegistryFilters}
        selectProject={selectProject}
        setEnvironmentFilter={setEnvironmentFilter}
        setRegistryQuery={setRegistryQuery}
        setSortMode={setSortMode}
        setStatusFilter={setStatusFilter}
        sortMode={sortMode}
        statusFilter={statusFilter}
      />

      <ProjectManagementConsoleEditorWorkspaceShell
        activeProject={activeProject}
        draft={draft}
        editorDescription={editorDescription}
        editorSections={editorSections}
        editorSummaryCards={editorSummaryCards}
        editorValidationVisible={editorValidationVisible}
        isCreating={isCreating}
        isPending={isPending}
        removeProject={removeProject}
        saveProject={saveProject}
        serverEditorSection={serverEditorSection}
        serviceEditorSection={serviceEditorSection}
        validationIssues={validationIssues}
      />
    </div>
  );
}
