import { SettingsPage } from '@/components/pages/settings-page';
import { getWorkspaceSettingsSummary } from '@/lib/api/management';

export const dynamic = 'force-dynamic';

export default async function SettingsRoute() {
  const summary = await getWorkspaceSettingsSummary();
  return <SettingsPage summary={summary} />;
}
