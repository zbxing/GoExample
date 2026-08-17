'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import type { WorkspaceSettingsSummary } from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SettingsSummaryCardModel {
  id: string;
  label: string;
  value: string;
  footnote: string;
}

export interface SettingsActionLinkModel {
  href: Route;
  label: string;
  icon: 'projects' | 'integrations' | 'security' | 'users';
}

interface UseSettingsPanelOperationsSurfaceControllerOptions {
  summary: WorkspaceSettingsSummary;
  actionLinks: readonly SettingsActionLinkModel[];
  t: TranslationFn;
}

export function useSettingsPanelOperationsSurfaceController({
  summary,
  actionLinks,
  t,
}: UseSettingsPanelOperationsSurfaceControllerOptions) {
  const capabilityCards = useMemo<SettingsSummaryCardModel[]>(
    () => [
      {
        id: 'locales',
        label: t('settingsPanel.capabilities.localesLabel'),
        value: `${summary.supportedLocaleCount}`,
        footnote: t('settingsPanel.capabilities.localesFootnote'),
      },
      {
        id: 'themes',
        label: t('settingsPanel.capabilities.themesLabel'),
        value: `${summary.supportedThemeCount}`,
        footnote: t('settingsPanel.capabilities.themesFootnote'),
      },
      {
        id: 'permissions',
        label: t('settingsPanel.capabilities.permissionsLabel'),
        value: `${summary.supportedPermissionCount}`,
        footnote: t('settingsPanel.capabilities.permissionsFootnote'),
      },
      {
        id: 'roles',
        label: t('settingsPanel.capabilities.rolesLabel'),
        value: `${summary.seededRoleCount}`,
        footnote: t('settingsPanel.capabilities.rolesFootnote'),
      },
    ],
    [
      summary.seededRoleCount,
      summary.supportedLocaleCount,
      summary.supportedPermissionCount,
      summary.supportedThemeCount,
      t,
    ],
  );
  const governanceTags = useMemo(
    () => [
      t('settingsPanel.governanceTags.rbacWorkflow'),
      t('settingsPanel.governanceTags.sessionRevoke'),
      t('settingsPanel.governanceTags.apiKeyRevoke'),
      t('settingsPanel.governanceTags.themeAware'),
    ],
    [t],
  );

  return {
    capabilityCards,
    governanceTags,
    settingsActionLinks: actionLinks,
  };
}
