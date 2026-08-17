'use client';

import { SectionHeader } from '@/components/common/section-header';
import { ProjectDetailPageLowerContent } from '@/components/pages/project-detail-page-lower-content';
import { ProjectDetailPageOverviewContent } from '@/components/pages/project-detail-page-overview-content';
import type { ManagedProject, ManagedProjectRuntimeProbe } from '@/lib/types/management';
import { useProjectDetailPageBridgeController } from '@/lib/utils/use-project-detail-page-bridge-controller';
import { useLocale } from '@/providers/locale-provider';

interface ProjectDetailPageProps {
  project: ManagedProject;
  health: ManagedProjectRuntimeProbe | null;
  generatedAt: string;
}

export function ProjectDetailPage({
  project,
  health,
  generatedAt,
}: ProjectDetailPageProps) {
  const { locale, t } = useLocale();
  const {
    projectDetailPageLowerContentProps,
    projectDetailPageOverviewContentProps,
  } = useProjectDetailPageBridgeController({
    locale,
    t,
    generatedAt,
    health,
    project,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={project.code}
        title={project.name}
        description={project.description || t('projectConsole.noDescription')}
      />
      <ProjectDetailPageOverviewContent {...projectDetailPageOverviewContentProps} />
      <ProjectDetailPageLowerContent {...projectDetailPageLowerContentProps} />
    </div>
  );
}
