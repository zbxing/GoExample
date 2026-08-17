'use client';

import { ProjectDetailActionsContent } from '@/components/pages/project-detail-page-actions-content';
import { ProjectDetailPageContent } from '@/components/pages/project-detail-page-content';
import { ProjectManagementConsole } from '@/components/projects/project-management-console';
import type { ManagedProject } from '@/lib/types/management';
import type { useProjectDetailPageController } from '@/lib/utils/use-project-detail-page-controller';
import type { useProjectDetailPageSurfaceController } from '@/lib/utils/use-project-detail-page-surface-controller';

interface ProjectDetailPageLowerContentProps {
  actionLinks: ReturnType<typeof useProjectDetailPageSurfaceController>['actionLinks'];
  attentionCards: ReturnType<typeof useProjectDetailPageController>['attentionCards'];
  endpointCard: ReturnType<typeof useProjectDetailPageSurfaceController>['endpointCard'];
  endpointSignal: ReturnType<typeof useProjectDetailPageSurfaceController>['endpointSignal'];
  feedback: ReturnType<typeof useProjectDetailPageController>['feedback'];
  handleCopyApi: ReturnType<typeof useProjectDetailPageController>['handleCopyApi'];
  handleCopyCurrentView: ReturnType<typeof useProjectDetailPageController>['handleCopyCurrentView'];
  project: ManagedProject;
  projectConsoleKey: string;
  runtimeSummary: ReturnType<typeof useProjectDetailPageController>['runtimeSummary'];
  serverPanelTags: ReturnType<typeof useProjectDetailPageSurfaceController>['serverPanelTags'];
  servicePanelTags: ReturnType<typeof useProjectDetailPageSurfaceController>['servicePanelTags'];
}

export function ProjectDetailPageLowerContent({
  actionLinks,
  attentionCards,
  endpointCard,
  endpointSignal,
  feedback,
  handleCopyApi,
  handleCopyCurrentView,
  project,
  projectConsoleKey,
  runtimeSummary,
  serverPanelTags,
  servicePanelTags,
}: ProjectDetailPageLowerContentProps) {
  return (
    <>
      <ProjectDetailPageContent
        attentionCards={attentionCards}
        endpointCard={endpointCard}
        endpointSignal={endpointSignal}
        project={project}
        railContent={
          <ProjectDetailActionsContent
            actionLinks={actionLinks}
            feedback={feedback}
            handleCopyApi={handleCopyApi}
            handleCopyCurrentView={handleCopyCurrentView}
            project={project}
          />
        }
        runtimeSummary={runtimeSummary}
        serverPanelTags={serverPanelTags}
        servicePanelTags={servicePanelTags}
      />
      <ProjectManagementConsole
        key={`${project.id}:${projectConsoleKey}`}
        allowCreate={false}
        projects={[project]}
        selectedProjectId={project.id}
      />
    </>
  );
}
