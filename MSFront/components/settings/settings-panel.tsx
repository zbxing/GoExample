'use client';

import type { WorkspaceSettingsSummary } from '@/lib/types/management';
import { SettingsHeroContent } from '@/components/settings/settings-panel-hero-content';
import { SettingsPanelLowerContent } from '@/components/settings/settings-panel-lower-content';
import { useSettingsPanelBridgeController } from '@/lib/utils/use-settings-panel-bridge-controller';

interface SettingsPanelProps {
  summary: WorkspaceSettingsSummary;
}

export function SettingsPanel({ summary }: SettingsPanelProps) {
  const {
    settingsHeroContentProps,
    settingsPanelLowerContentProps,
  } = useSettingsPanelBridgeController({
    summary,
  });

  return (
    <div className="pageStack">
      <SettingsHeroContent {...settingsHeroContentProps} />
      <SettingsPanelLowerContent {...settingsPanelLowerContentProps} />
    </div>
  );
}
