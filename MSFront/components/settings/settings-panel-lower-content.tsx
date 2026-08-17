'use client';

import type { ComponentProps } from 'react';
import { SettingsPreferencesContent } from '@/components/settings/settings-panel-content';
import {
  SettingsCapabilitiesContent,
  SettingsGovernanceContent,
  SettingsRuntimeContent,
  SettingsSourcesContent,
} from '@/components/settings/settings-panel-operations-content';

interface SettingsPanelLowerContentProps {
  capabilitiesProps: ComponentProps<typeof SettingsCapabilitiesContent>;
  governanceProps: ComponentProps<typeof SettingsGovernanceContent>;
  preferencesProps: ComponentProps<typeof SettingsPreferencesContent>;
  runtimeProps: ComponentProps<typeof SettingsRuntimeContent>;
  sourcesProps: ComponentProps<typeof SettingsSourcesContent>;
}

export function SettingsPanelLowerContent({
  capabilitiesProps,
  governanceProps,
  preferencesProps,
  runtimeProps,
  sourcesProps,
}: SettingsPanelLowerContentProps) {
  return (
    <div className="settingsWorkbenchLayout">
      <div className="settingsWorkbenchStack">
        <SettingsPreferencesContent {...preferencesProps} />
        <SettingsRuntimeContent {...runtimeProps} />
      </div>

      <div className="settingsWorkbenchRail">
        <SettingsCapabilitiesContent {...capabilitiesProps} />
        <SettingsSourcesContent {...sourcesProps} />
        <SettingsGovernanceContent {...governanceProps} />
      </div>
    </div>
  );
}
