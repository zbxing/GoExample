'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { FeedbackBanner } from '@/components/common/feedback-banner';
import { ProjectDetailPanelSection } from '@/components/common/project-detail-panel-section';
import { useLocale } from '@/providers/locale-provider';
import type { ManagedProject } from '@/lib/types/management';
import type { useProjectDetailPageController } from '@/lib/utils/use-project-detail-page-controller';
import type { useProjectDetailPageSurfaceController } from '@/lib/utils/use-project-detail-page-surface-controller';

interface ProjectDetailActionsContentProps {
  actionLinks: ReturnType<typeof useProjectDetailPageSurfaceController>['actionLinks'];
  feedback: ReturnType<typeof useProjectDetailPageController>['feedback'];
  handleCopyApi: ReturnType<typeof useProjectDetailPageController>['handleCopyApi'];
  handleCopyCurrentView: ReturnType<typeof useProjectDetailPageController>['handleCopyCurrentView'];
  project: ManagedProject;
}

export function ProjectDetailActionsContent({
  actionLinks,
  feedback,
  handleCopyApi,
  handleCopyCurrentView,
  project,
}: ProjectDetailActionsContentProps) {
  const { t } = useLocale();

  return (
    <ProjectDetailPanelSection
      title={t('projectDetail.actionsTitle')}
      description={t('projectDetail.actionsDescription')}
    >
      <FeedbackBanner feedback={feedback} />
      <div className="projectActionGrid">
        <a
          href={project.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="primaryButton projectActionPrimary"
        >
          {t('actions.openConsole')}
          <ExternalLink size={14} />
        </a>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => {
            void handleCopyApi();
          }}
        >
          <Copy size={14} />
          {t('actions.copyApi')}
        </button>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => {
            void handleCopyCurrentView();
          }}
        >
          <Copy size={14} />
          {t('projectDetail.actions.copyLink')}
        </button>
        {actionLinks.map((item) => (
          <Link key={item.href} href={item.href} className="secondaryButton">
            {item.label}
            <ArrowRight size={14} />
          </Link>
        ))}
      </div>
    </ProjectDetailPanelSection>
  );
}
