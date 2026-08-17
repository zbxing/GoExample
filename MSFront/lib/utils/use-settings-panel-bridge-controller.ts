'use client';

import type { WorkspaceSettingsSummary } from '@/lib/types/management';
import { useSettingsPanelController } from '@/lib/utils/use-settings-panel-controller';
import { useSettingsPanelOperationsSurfaceController } from '@/lib/utils/use-settings-panel-operations-surface-controller';
import { useSettingsPanelRuntimeSurfaceController } from '@/lib/utils/use-settings-panel-runtime-surface-controller';
import { useSettingsPanelSurfaceController } from '@/lib/utils/use-settings-panel-surface-controller';
import { useLocale } from '@/providers/locale-provider';

interface UseSettingsPanelBridgeControllerOptions {
  summary: WorkspaceSettingsSummary;
}

export function useSettingsPanelBridgeController({
  summary,
}: UseSettingsPanelBridgeControllerOptions) {
  const { locale, t } = useLocale();
  const {
    actionLinks,
    handleLocaleChange,
    handleProjectChange,
    handleThemeChange,
    isLoading,
    locale: currentLocale,
    preferenceFeedback,
    projectPlaceholder,
    projects,
    resetLocalePreference,
    resetProjectPreference,
    resetThemePreference,
    selectedProject,
    selectedProjectId,
    selectedProjectMeta,
    theme,
  } = useSettingsPanelController({
    summary,
    t,
  });
  const {
    focusDescription,
    focusPills,
    heroFootnote,
    heroPills,
    heroSummaryCards,
    preferenceStatus,
  } = useSettingsPanelSurfaceController({
    locale,
    preferenceFeedback,
    projectPlaceholder,
    projectsCount: projects.length,
    selectedProject: selectedProject
      ? {
          id: selectedProject.id,
          name: selectedProject.name,
        }
      : null,
    selectedProjectMeta,
    summary,
    t,
    theme,
  });
  const {
    capabilityCards,
    governanceTags,
    settingsActionLinks,
  } = useSettingsPanelOperationsSurfaceController({
    actionLinks,
    summary,
    t,
  });
  const {
    runtimeFacts,
    sourceCards,
    workspaceFacts,
    workspaceStatus,
  } = useSettingsPanelRuntimeSurfaceController({
    summary,
    t,
  });

  return {
    settingsHeroContentProps: {
      heroFootnote,
      heroPills,
      heroSummaryCards,
    },
    settingsPanelLowerContentProps: {
      capabilitiesProps: { capabilityCards },
      governanceProps: {
        governanceTags,
        settingsActionLinks,
      },
      preferencesProps: {
        handleLocaleChange,
        handleProjectChange,
        handleThemeChange,
        focusDescription,
        focusPills,
        isLoading,
        locale: currentLocale,
        preferenceStatus,
        projectPlaceholder,
        projects,
        resetLocalePreference,
        resetProjectPreference,
        resetThemePreference,
        selectedProject,
        selectedProjectId,
        selectedProjectMeta,
        summary,
        theme,
      },
      runtimeProps: {
        runtimeFacts,
        workspaceFacts,
        workspaceStatus,
      },
      sourcesProps: { sourceCards },
    },
  };
}
