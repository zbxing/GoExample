'use client';

import { EditorWorkspaceShell } from '@/components/common/editor-workspace-shell';
import { ProjectManagementConsoleEditorActionsContent } from '@/components/projects/project-management-console-editor-actions-content';
import { ProjectManagementConsoleEditorContent } from '@/components/projects/project-management-console-editor-content';
import { useLocale } from '@/providers/locale-provider';
import type { useProjectManagementConsoleController } from '@/lib/utils/use-project-management-console-controller';
import type { useProjectManagementConsolePresentationController } from '@/lib/utils/use-project-management-console-presentation-controller';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface ProjectManagementConsoleEditorWorkspaceShellProps {
  activeProject: ReturnType<typeof useProjectManagementConsoleController>['activeProject'];
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
  isCreating: ReturnType<typeof useProjectManagementConsoleController>['isCreating'];
  isPending: ReturnType<typeof useProjectManagementConsoleController>['isPending'];
  removeProject: ReturnType<typeof useProjectManagementConsoleController>['removeProject'];
  saveProject: ReturnType<typeof useProjectManagementConsoleController>['saveProject'];
  serverEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serverEditorSection'];
  serviceEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serviceEditorSection'];
  validationIssues: ReturnType<typeof useProjectManagementConsoleController>['validationIssues'];
}

export function ProjectManagementConsoleEditorWorkspaceShell({
  activeProject,
  draft,
  editorDescription,
  editorSections,
  editorSummaryCards,
  editorValidationVisible,
  isCreating,
  isPending,
  removeProject,
  saveProject,
  serverEditorSection,
  serviceEditorSection,
  validationIssues,
}: ProjectManagementConsoleEditorWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <EditorWorkspaceShell
      title={t('labels.projectEditor')}
      description={editorDescription}
      actions={
        <ProjectManagementConsoleEditorActionsContent
          activeProject={activeProject}
          draft={draft}
          isCreating={isCreating}
          isPending={isPending}
          removeProject={removeProject}
          saveProject={saveProject}
        />
      }
      feedback={null}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('projectConsole.registryEmptyTitle')}</strong>
          <p>{t('projectConsole.registryEmptyDescription')}</p>
        </div>
      }
      hasContent={Boolean(draft)}
    >
      <ProjectManagementConsoleEditorContent
        draft={draft}
        editorSections={editorSections}
        editorSummaryCards={editorSummaryCards}
        editorValidationVisible={editorValidationVisible}
        serverEditorSection={serverEditorSection}
        serviceEditorSection={serviceEditorSection}
        t={t}
        validationIssues={validationIssues}
      />
    </EditorWorkspaceShell>
  );
}
