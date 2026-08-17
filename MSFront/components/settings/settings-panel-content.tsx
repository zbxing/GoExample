'use client';

import {
  Palette,
  RotateCcw,
  Rocket,
  Waypoints,
} from 'lucide-react';
import { TonePill } from '@/components/common/management-primitives';
import { siteConfig } from '@/lib/config/site';
import type { WorkspaceSettingsSummary } from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';
import type { useSettingsPanelController } from '@/lib/utils/use-settings-panel-controller';
import type { useSettingsPanelSurfaceController } from '@/lib/utils/use-settings-panel-surface-controller';

type ThemeMode = Parameters<ReturnType<typeof useSettingsPanelController>['handleThemeChange']>[0];
type LocaleMode = Parameters<ReturnType<typeof useSettingsPanelController>['handleLocaleChange']>[0];

interface SettingsPreferencesContentProps {
  handleLocaleChange: ReturnType<typeof useSettingsPanelController>['handleLocaleChange'];
  handleProjectChange: ReturnType<typeof useSettingsPanelController>['handleProjectChange'];
  handleThemeChange: ReturnType<typeof useSettingsPanelController>['handleThemeChange'];
  focusDescription: ReturnType<typeof useSettingsPanelSurfaceController>['focusDescription'];
  focusPills: ReturnType<typeof useSettingsPanelSurfaceController>['focusPills'];
  isLoading: ReturnType<typeof useSettingsPanelController>['isLoading'];
  locale: ReturnType<typeof useSettingsPanelController>['locale'];
  preferenceStatus: ReturnType<typeof useSettingsPanelSurfaceController>['preferenceStatus'];
  projectPlaceholder: ReturnType<typeof useSettingsPanelController>['projectPlaceholder'];
  projects: ReturnType<typeof useSettingsPanelController>['projects'];
  resetLocalePreference: ReturnType<typeof useSettingsPanelController>['resetLocalePreference'];
  resetProjectPreference: ReturnType<typeof useSettingsPanelController>['resetProjectPreference'];
  resetThemePreference: ReturnType<typeof useSettingsPanelController>['resetThemePreference'];
  selectedProject: ReturnType<typeof useSettingsPanelController>['selectedProject'];
  selectedProjectId: ReturnType<typeof useSettingsPanelController>['selectedProjectId'];
  selectedProjectMeta: ReturnType<typeof useSettingsPanelController>['selectedProjectMeta'];
  summary: WorkspaceSettingsSummary;
  theme: ReturnType<typeof useSettingsPanelController>['theme'];
}

export function SettingsPreferencesContent({
  handleLocaleChange,
  handleProjectChange,
  handleThemeChange,
  focusDescription,
  focusPills,
  isLoading,
  locale,
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
}: SettingsPreferencesContentProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('settingsPanel.preferencesTitle')}</h2>
          <p>{t('settingsPanel.preferencesDescription')}</p>
        </div>
      </div>

      <div className="settingsPreferenceSummary" aria-live="polite">
        <div>
          <span>{t('settingsPanel.preferenceStatusLabel')}</span>
          <strong>{t('settingsPanel.preferenceStatusValue')}</strong>
          <small>{preferenceStatus.message}</small>
        </div>
        <TonePill
          label={preferenceStatus.label}
          tone={preferenceStatus.tone}
          showStatusIcon
        />
      </div>

      <div className="settingsPreferenceGrid">
        <section className="settingsCard settingsCardPanel">
          <div className="settingsCardHeader">
            <span>
              <Waypoints size={16} />
              {t('labels.locale')}
            </span>
            <p>{t('settingsPanel.localeDescription')}</p>
          </div>
          <select
            value={locale}
            onChange={(event) => handleLocaleChange(event.target.value as LocaleMode)}
          >
            {siteConfig.locales.map((item) => (
              <option key={item} value={item}>
                {t(`common.locales.${item}`)}
              </option>
            ))}
          </select>
          <div className="settingsPreferenceFooter">
            <small className="summaryFootnote">
              {t('settingsPanel.defaultLocaleLabel')}:{' '}
              {t(`common.locales.${summary.defaultLocale}`)}
            </small>
            <button
              type="button"
              className="ghostButton"
              onClick={resetLocalePreference}
              disabled={locale === summary.defaultLocale}
            >
              <RotateCcw size={14} />
              {t('settingsPanel.actions.resetLocale')}
            </button>
          </div>
        </section>

        <section className="settingsCard settingsCardPanel">
          <div className="settingsCardHeader">
            <span>
              <Palette size={16} />
              {t('labels.theme')}
            </span>
            <p>{t('settingsPanel.themeDescription')}</p>
          </div>
          <select
            value={theme}
            onChange={(event) => handleThemeChange(event.target.value as ThemeMode)}
          >
            {siteConfig.themes.map((item) => (
              <option key={item} value={item}>
                {t(`common.themes.${item}`)}
              </option>
            ))}
          </select>
          <div className="settingsPreferenceFooter">
            <small className="summaryFootnote">
              {t('settingsPanel.defaultThemeLabel')}:{' '}
              {t(`common.themes.${summary.defaultTheme}`)}
            </small>
            <button
              type="button"
              className="ghostButton"
              onClick={resetThemePreference}
              disabled={theme === summary.defaultTheme}
            >
              <RotateCcw size={14} />
              {t('settingsPanel.actions.resetTheme')}
            </button>
          </div>
        </section>

        <section className="settingsCard settingsCardPanel">
          <div className="settingsCardHeader">
            <span>
              <Rocket size={16} />
              {t('labels.defaultProject')}
            </span>
            <p>{t('settingsPanel.projectDescription')}</p>
          </div>
          <select
            value={selectedProjectId}
            onChange={(event) => handleProjectChange(event.target.value)}
            disabled={isLoading || projects.length === 0}
          >
            {projects.length === 0 ? <option value="">{projectPlaceholder}</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="settingsPreferenceFooter">
            <small className="summaryFootnote">
              {selectedProject
                ? `${t('settingsPanel.projectFocusLabel')}: ${selectedProjectMeta}`
                : t('settingsPanel.projectFocusEmpty')}
            </small>
            <button
              type="button"
              className="ghostButton"
              onClick={resetProjectPreference}
              disabled={
                isLoading ||
                projects.length === 0 ||
                selectedProjectId === (projects[0]?.id ?? '')
              }
            >
              <RotateCcw size={14} />
              {t('settingsPanel.actions.resetProject')}
            </button>
          </div>
        </section>
      </div>

      <div className="settingsFocusStrip">
        <div className="settingsFocusCopy">
          <span className="sectionEyebrow">{t('settingsPanel.focusTitle')}</span>
          <strong>{selectedProject?.name ?? projectPlaceholder}</strong>
          <p>{focusDescription}</p>
        </div>
        <div className="tagList">
          {focusPills.map((pill) => (
            <TonePill key={pill.id} label={pill.label} tone={pill.tone} showStatusIcon />
          ))}
        </div>
      </div>
    </section>
  );
}

