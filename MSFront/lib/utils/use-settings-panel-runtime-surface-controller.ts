'use client';

import { useMemo } from 'react';
import type { ManagementTone } from '@/components/common/management-primitives';
import type { WorkspaceSettingsSummary } from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SettingsSourceCardModel {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  footnote: string;
  tone: ManagementTone;
  badgeLabel: string;
}

interface SettingsFactField {
  id: string;
  label: string;
  value: string;
}

interface UseSettingsPanelRuntimeSurfaceControllerOptions {
  summary: WorkspaceSettingsSummary;
  t: TranslationFn;
}

export function useSettingsPanelRuntimeSurfaceController({
  summary,
  t,
}: UseSettingsPanelRuntimeSurfaceControllerOptions) {
  const configuredDriverLabel = t(
    `settingsPanel.storageDrivers.${summary.configuredStorageDriver}`,
  );
  const projectSourceLabel = t(`settingsPanel.sourceValues.${summary.effectiveProjectSource}`);
  const projectSourceTone = toneFromProjectSourceStatus(summary.projectSourceStatus);
  const runtimeFacts = useMemo<SettingsFactField[]>(
    () => [
      {
        id: 'default-locale',
        label: t('settingsPanel.defaultLocaleLabel'),
        value: t(`common.locales.${summary.defaultLocale}`),
      },
      {
        id: 'default-theme',
        label: t('settingsPanel.defaultThemeLabel'),
        value: t(`common.themes.${summary.defaultTheme}`),
      },
      {
        id: 'api-base-url',
        label: t('settingsPanel.apiBaseUrlLabel'),
        value: summary.apiBaseUrl,
      },
      {
        id: 'live-probes',
        label: t('settingsPanel.liveProbesLabel'),
        value: summary.enableLiveProbes ? t('common.enabled') : t('common.disabled'),
      },
    ],
    [summary.apiBaseUrl, summary.defaultLocale, summary.defaultTheme, summary.enableLiveProbes, t],
  );
  const workspaceStatus = {
    label:
      summary.projectSourceStatus === 'ready'
        ? t('settingsPanel.sourceStates.ready')
        : summary.projectSourceStatus === 'fallback'
          ? t('settingsPanel.sourceStates.fallback')
          : t('settingsPanel.sourceStates.blocked'),
    tone: projectSourceTone,
    footnote: `${configuredDriverLabel} / ${projectSourceLabel}`,
  };
  const workspaceFacts = useMemo<SettingsFactField[]>(
    () => [
      {
        id: 'configured-driver',
        label: t('settingsPanel.configuredDriverLabel'),
        value: configuredDriverLabel,
      },
      {
        id: 'effective-source',
        label: t('settingsPanel.effectiveSourceLabel'),
        value: projectSourceLabel,
      },
      {
        id: 'msfront-db',
        label: t('settingsPanel.msfrontDatabaseLabel'),
        value: summary.msFrontDatabaseUrlConfigured ? t('common.enabled') : t('common.disabled'),
      },
      {
        id: 'shared-db',
        label: t('settingsPanel.sharedDatabaseLabel'),
        value: summary.sharedDatabaseUrlConfigured ? t('common.enabled') : t('common.disabled'),
      },
      {
        id: 'catalog-path',
        label: t('settingsPanel.projectCatalogPathLabel'),
        value: summary.projectCatalogPath,
      },
      {
        id: 'inventory-path',
        label: t('settingsPanel.inventoryPathLabel'),
        value: summary.inventoryDocumentPath,
      },
    ],
    [
      configuredDriverLabel,
      projectSourceLabel,
      summary.inventoryDocumentPath,
      summary.msFrontDatabaseUrlConfigured,
      summary.projectCatalogPath,
      summary.sharedDatabaseUrlConfigured,
      t,
    ],
  );
  const sourceCards = useMemo<SettingsSourceCardModel[]>(
    () => [
      {
        id: 'projects',
        eyebrow: t('settingsPanel.sources.projectRegistry'),
        title: projectSourceLabel,
        description: t('settingsPanel.sourceDescriptions.projectRegistry'),
        footnote: summary.projectCatalogPath,
        tone: projectSourceTone,
        badgeLabel: workspaceStatus.label,
      },
      {
        id: 'database',
        eyebrow: t('settingsPanel.sources.securityDatabase'),
        title: summary.databaseConfigured ? t('common.enabled') : t('common.disabled'),
        description: t('settingsPanel.sourceDescriptions.securityDatabase'),
        footnote: summary.msFrontDatabaseUrlConfigured
          ? t('settingsPanel.databaseSelection.msfront')
          : summary.sharedDatabaseUrlConfigured
            ? t('settingsPanel.databaseSelection.shared')
            : t('settingsPanel.databaseSelection.none'),
        tone: summary.databaseConfigured ? 'success' : 'warning',
        badgeLabel: summary.databaseConfigured ? t('common.enabled') : t('common.disabled'),
      },
      {
        id: 'inventory',
        eyebrow: t('settingsPanel.sources.apiInventory'),
        title: summary.apiInventoryAvailable ? t('common.enabled') : t('common.disabled'),
        description: t('settingsPanel.sourceDescriptions.apiInventory'),
        footnote: summary.inventoryDocumentPath,
        tone: summary.apiInventoryAvailable ? 'success' : 'warning',
        badgeLabel: summary.apiInventoryAvailable ? t('common.enabled') : t('common.disabled'),
      },
    ],
    [
      projectSourceLabel,
      projectSourceTone,
      summary.apiInventoryAvailable,
      summary.databaseConfigured,
      summary.inventoryDocumentPath,
      summary.msFrontDatabaseUrlConfigured,
      summary.projectCatalogPath,
      summary.sharedDatabaseUrlConfigured,
      t,
      workspaceStatus.label,
    ],
  );

  return {
    runtimeFacts,
    sourceCards,
    workspaceFacts,
    workspaceStatus,
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
