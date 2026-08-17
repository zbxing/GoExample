'use client';

import { useMemo } from 'react';
import type { ManagementTone } from '@/components/common/management-primitives';
import type { LocaleCode, ThemeMode, WorkspaceSettingsSummary } from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SettingsSummaryCardModel {
  id: string;
  label: string;
  value: string;
  footnote: string;
}

interface SettingsTonePillModel {
  id: string;
  label: string;
  tone: ManagementTone;
}

interface UseSettingsPanelSurfaceControllerOptions {
  summary: WorkspaceSettingsSummary;
  locale: LocaleCode;
  theme: ThemeMode;
  selectedProject: {
    id: string;
    name: string;
  } | null;
  selectedProjectMeta: string;
  projectPlaceholder: string;
  projectsCount: number;
  preferenceFeedback: {
    tone: 'success' | 'info';
    message: string;
  } | null;
  t: TranslationFn;
}

export function useSettingsPanelSurfaceController({
  summary,
  locale,
  theme,
  selectedProject,
  selectedProjectMeta,
  projectPlaceholder,
  projectsCount,
  preferenceFeedback,
  t,
}: UseSettingsPanelSurfaceControllerOptions) {
  const projectSourceLabel = t(`settingsPanel.sourceValues.${summary.effectiveProjectSource}`);
  const projectSourceTone = toneFromProjectSourceStatus(summary.projectSourceStatus);
  const heroPills = useMemo<SettingsTonePillModel[]>(
    () => [
      {
        id: 'source',
        label: `${t('settingsPanel.projectSourceLabel')}: ${projectSourceLabel}`,
        tone: projectSourceTone,
      },
      {
        id: 'probes',
        label: `${t('settingsPanel.liveProbesLabel')}: ${
          summary.enableLiveProbes ? t('common.enabled') : t('common.disabled')
        }`,
        tone: summary.enableLiveProbes ? 'info' : 'warning',
      },
      {
        id: 'inventory',
        label: `${t('settingsPanel.inventoryStatusLabel')}: ${
          summary.apiInventoryAvailable ? t('common.enabled') : t('common.disabled')
        }`,
        tone: summary.apiInventoryAvailable ? 'success' : 'warning',
      },
    ],
    [
      projectSourceLabel,
      projectSourceTone,
      summary.apiInventoryAvailable,
      summary.enableLiveProbes,
      t,
    ],
  );
  const heroFootnote = selectedProject
    ? `${t('settingsPanel.projectFocusLabel')}: ${selectedProjectMeta}`
    : t('settingsPanel.projectFocusEmpty');
  const heroSummaryCards = useMemo<SettingsSummaryCardModel[]>(
    () => [
      {
        id: 'locale',
        label: t('settingsPanel.currentLocaleLabel'),
        value: t(`common.locales.${locale}`),
        footnote: `${t('settingsPanel.defaultLocaleLabel')}: ${t(`common.locales.${summary.defaultLocale}`)}`,
      },
      {
        id: 'theme',
        label: t('settingsPanel.currentThemeLabel'),
        value: t(`common.themes.${theme}`),
        footnote: `${t('settingsPanel.defaultThemeLabel')}: ${t(`common.themes.${summary.defaultTheme}`)}`,
      },
      {
        id: 'project',
        label: t('settingsPanel.defaultProjectLabel'),
        value: selectedProject?.name ?? projectPlaceholder,
        footnote: selectedProjectMeta,
      },
      {
        id: 'projects-count',
        label: t('settingsPanel.managedProjectsLabel'),
        value: `${projectsCount}`,
        footnote: `${t('settingsPanel.projectSourceLabel')}: ${projectSourceLabel}`,
      },
    ],
    [
      locale,
      projectPlaceholder,
      projectSourceLabel,
      projectsCount,
      selectedProject?.name,
      selectedProjectMeta,
      summary.defaultLocale,
      summary.defaultTheme,
      t,
      theme,
    ],
  );
  const preferenceStatus = {
    message: preferenceFeedback?.message ?? t('settingsPanel.preferenceStatusDescription'),
    label: preferenceFeedback
      ? t('settingsPanel.preferenceStatusApplied')
      : t('settingsPanel.preferenceStatusIdle'),
    tone: preferenceFeedback?.tone === 'info' ? ('info' as const) : ('success' as const),
  };
  const focusDescription = selectedProject
    ? t('settingsPanel.focusDescription', {
        project: selectedProject.name,
      })
    : t('settingsPanel.focusEmptyDescription');
  const focusPills = useMemo<SettingsTonePillModel[]>(
    () => {
      const pills: SettingsTonePillModel[] = [
        {
          id: 'locale',
          label: `${t('labels.locale')}: ${t(`common.locales.${locale}`)}`,
          tone: 'info',
        },
        {
          id: 'theme',
          label: `${t('labels.theme')}: ${t(`common.themes.${theme}`)}`,
          tone: 'info',
        },
      ];

      if (selectedProject) {
        pills.push({
          id: 'project',
          label: `${t('labels.defaultProject')}: ${selectedProject.name}`,
          tone: 'success',
        });
      }

      return pills;
    },
    [locale, selectedProject, t, theme],
  );

  return {
    focusDescription,
    focusPills,
    heroFootnote,
    heroPills,
    heroSummaryCards,
    preferenceStatus,
  };
}

function toneFromProjectSourceStatus(status: WorkspaceSettingsSummary['projectSourceStatus']) {
  if (status === 'blocked') {
    return 'danger' as const;
  }

  if (status === 'fallback') {
    return 'warning' as const;
  }

  return 'success' as const;
}
