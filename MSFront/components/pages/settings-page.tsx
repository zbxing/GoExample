'use client';

import { SectionHeader } from '@/components/common/section-header';
import { SettingsPanel } from '@/components/settings/settings-panel';
import { useLocale } from '@/providers/locale-provider';
import type { WorkspaceSettingsSummary } from '@/lib/types/management';

interface SettingsPageProps {
  summary: WorkspaceSettingsSummary;
}

export function SettingsPage({ summary }: SettingsPageProps) {
  const { t } = useLocale();

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.settings')}
        title={t('pages.settingsTitle')}
        description={t('pages.settingsDescription')}
      />
      <SettingsPanel summary={summary} />
    </div>
  );
}
