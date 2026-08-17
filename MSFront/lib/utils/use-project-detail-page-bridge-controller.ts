'use client';

import type {
  LocaleCode,
  ManagedProject,
  ManagedProjectRuntimeProbe,
} from '@/lib/types/management';
import { useProjectDetailPageController } from '@/lib/utils/use-project-detail-page-controller';
import { useProjectDetailPageSurfaceController } from '@/lib/utils/use-project-detail-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectDetailPageBridgeControllerOptions {
  project: ManagedProject;
  health: ManagedProjectRuntimeProbe | null;
  generatedAt: string;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectDetailPageBridgeController({
  project,
  health,
  generatedAt,
  locale,
  t,
}: UseProjectDetailPageBridgeControllerOptions) {
  const {
    attentionCards,
    feedback,
    handleCopyApi,
    handleCopyCurrentView,
    overviewCards,
    probeSignal,
    projectConsoleKey,
    runtimeSummary,
    serverAttention,
    serviceAttention,
  } = useProjectDetailPageController({
    generatedAt,
    health,
    locale,
    project,
    t,
  });
  const {
    actionLinks,
    endpointCard,
    endpointSignal,
    heroStats,
    heroTagLabels,
    serverPanelTags,
    servicePanelTags,
  } = useProjectDetailPageSurfaceController({
    locale,
    probeSignal,
    project,
    serverAttentionCount: serverAttention.attentionCount,
    serviceAttentionCount: serviceAttention.attentionCount,
    t,
  });

  return {
    projectDetailPageOverviewContentProps: {
      heroStats,
      heroTagLabels,
      overviewCards,
      project,
      runtimeSummary,
    },
    projectDetailPageLowerContentProps: {
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
    },
  };
}
