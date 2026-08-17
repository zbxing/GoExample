'use client';

import type { ReactNode } from 'react';
import {
  AttentionCard,
  TonePill,
} from '@/components/common/management-primitives';
import { ProjectEndpointSurfaceCard } from '@/components/common/project-endpoint-surface';
import { ProjectDetailPanelSection } from '@/components/common/project-detail-panel-section';
import { RuntimeSurfacePanel } from '@/components/common/runtime-surface-panel';
import { ServerTable } from '@/components/projects/server-table';
import { ServiceGrid } from '@/components/projects/service-grid';
import { useLocale } from '@/providers/locale-provider';
import type { ManagedProject } from '@/lib/types/management';
import type { useProjectDetailPageController } from '@/lib/utils/use-project-detail-page-controller';
import type { useProjectDetailPageSurfaceController } from '@/lib/utils/use-project-detail-page-surface-controller';

interface ProjectDetailPageContentProps {
  attentionCards: ReturnType<typeof useProjectDetailPageController>['attentionCards'];
  endpointCard: ReturnType<typeof useProjectDetailPageSurfaceController>['endpointCard'];
  endpointSignal: ReturnType<typeof useProjectDetailPageSurfaceController>['endpointSignal'];
  project: ManagedProject;
  railContent?: ReactNode;
  runtimeSummary: ReturnType<typeof useProjectDetailPageController>['runtimeSummary'];
  serverPanelTags: ReturnType<typeof useProjectDetailPageSurfaceController>['serverPanelTags'];
  servicePanelTags: ReturnType<typeof useProjectDetailPageSurfaceController>['servicePanelTags'];
}

export function ProjectDetailPageContent({
  attentionCards,
  endpointCard,
  endpointSignal,
  project,
  railContent,
  runtimeSummary,
  serverPanelTags,
  servicePanelTags,
}: ProjectDetailPageContentProps) {
  const { t } = useLocale();

  return (
    <>
      <div className="projectWorkbenchLayout">
        <div className="projectWorkbenchStack">
          <ProjectDetailPanelSection
            title={t('projectDetail.endpointTitle')}
            description={t('projectDetail.endpointDescription')}
            headerAside={<TonePill label={endpointSignal.label} tone={endpointSignal.tone} />}
          >
            <ProjectEndpointSurfaceCard
              identity={endpointCard.identity}
              status={endpointCard.status}
              environment={endpointCard.environment}
              metrics={endpointCard.metrics}
              fields={endpointCard.fields}
            />
          </ProjectDetailPanelSection>

          <RuntimeSurfacePanel
            title={t('projectDetail.runtimeTitle')}
            description={t('projectDetail.runtimeDescription')}
            summary={runtimeSummary}
          />

          <ProjectDetailPanelSection
            title={t('sections.servers')}
            description={t('projectDetail.serversDescription')}
            headerAside={
              <div className="tagList">
                {serverPanelTags.map((tag) => (
                  <span key={tag.id} className="securityTag">
                    {tag.label}
                  </span>
                ))}
              </div>
            }
          >
            <ServerTable servers={project.servers} />
          </ProjectDetailPanelSection>

          <ProjectDetailPanelSection
            title={t('sections.services')}
            description={t('projectDetail.servicesDescription')}
            headerAside={
              <div className="tagList">
                {servicePanelTags.map((tag) => (
                  <span key={tag.id} className="securityTag">
                    {tag.label}
                  </span>
                ))}
              </div>
            }
          >
            <ServiceGrid services={project.services} />
          </ProjectDetailPanelSection>
        </div>

        <div className="projectWorkbenchRail">
          <ProjectDetailAttentionSection attentionCards={attentionCards} />
          {railContent}
        </div>
      </div>
    </>
  );
}

function ProjectDetailAttentionSection({
  attentionCards,
}: {
  attentionCards: ReturnType<typeof useProjectDetailPageController>['attentionCards'];
}) {
  const { t } = useLocale();

  return (
    <ProjectDetailPanelSection
      title={t('projectDetail.attentionTitle')}
      description={t('projectDetail.attentionDescription')}
    >
      <div className="dashboardSecurityRiskList projectAttentionGrid">
        {attentionCards.map((card) => (
          <AttentionCard
            key={card.label}
            label={card.label}
            value={card.value}
            detail={card.detail}
            tone={card.tone}
          />
        ))}
      </div>
    </ProjectDetailPanelSection>
  );
}
