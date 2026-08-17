'use client';

import type { Route } from 'next';
import { TopbarContextContent } from '@/components/shell/topbar-context-content';
import { TopbarWorkbenchContent } from '@/components/shell/topbar-workbench-content';
import type { LocaleCode, ManagedProject, ThemeMode } from '@/lib/types/management';

interface TopbarQuickLink {
  href: Route;
  isActive: boolean;
  label: string;
}

interface TopbarSelectOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface TopbarShellProps {
  currentLocaleLabel: string;
  currentThemeLabel: string;
  focusBadgeLabel: string;
  isProjectSelectionDisabled: boolean;
  locale: LocaleCode;
  localeLabel: string;
  localeOptions: readonly TopbarSelectOption<LocaleCode>[];
  onLocaleChange: (value: LocaleCode) => void;
  onProjectChange: (projectId: string) => void;
  onThemeChange: (value: ThemeMode) => void;
  openSecurityHref: Route;
  openSecurityLabel: string;
  openSettingsHref: Route;
  openSettingsLabel: string;
  pageDescription: string;
  pageEyebrow: string;
  pageTitle: string;
  projectDescription: string;
  projectFocusLabel: string;
  projectLabel: string;
  projectName: string;
  projectPlaceholder: string;
  projects: readonly Pick<ManagedProject, 'id' | 'name'>[];
  projectSummary: string;
  quickLinks: readonly TopbarQuickLink[];
  runtimeFootnote: string;
  runtimeLabel: string;
  runtimeStatus: string;
  selectedProjectId: string;
  theme: ThemeMode;
  themeLabel: string;
  themeOptions: readonly TopbarSelectOption<ThemeMode>[];
}

export function TopbarShell({
  currentLocaleLabel,
  currentThemeLabel,
  focusBadgeLabel,
  isProjectSelectionDisabled,
  locale,
  localeLabel,
  localeOptions,
  onLocaleChange,
  onProjectChange,
  onThemeChange,
  openSecurityHref,
  openSecurityLabel,
  openSettingsHref,
  openSettingsLabel,
  pageDescription,
  pageEyebrow,
  pageTitle,
  projectDescription,
  projectFocusLabel,
  projectLabel,
  projectName,
  projectPlaceholder,
  projects,
  projectSummary,
  quickLinks,
  runtimeFootnote,
  runtimeLabel,
  runtimeStatus,
  selectedProjectId,
  theme,
  themeLabel,
  themeOptions,
}: TopbarShellProps) {
  return (
    <div className="topbarFrame">
      <TopbarContextContent
        focusBadgeLabel={focusBadgeLabel}
        pageDescription={pageDescription}
        pageEyebrow={pageEyebrow}
        pageTitle={pageTitle}
        projectDescription={projectDescription}
        projectFocusLabel={projectFocusLabel}
        projectName={projectName}
        projectSummary={projectSummary}
        quickLinks={quickLinks}
      />
      <TopbarWorkbenchContent
        currentLocaleLabel={currentLocaleLabel}
        currentThemeLabel={currentThemeLabel}
        isProjectSelectionDisabled={isProjectSelectionDisabled}
        locale={locale}
        localeLabel={localeLabel}
        localeOptions={localeOptions}
        onLocaleChange={onLocaleChange}
        onProjectChange={onProjectChange}
        onThemeChange={onThemeChange}
        openSecurityHref={openSecurityHref}
        openSecurityLabel={openSecurityLabel}
        openSettingsHref={openSettingsHref}
        openSettingsLabel={openSettingsLabel}
        projectLabel={projectLabel}
        projectPlaceholder={projectPlaceholder}
        projects={projects}
        runtimeFootnote={runtimeFootnote}
        runtimeLabel={runtimeLabel}
        runtimeStatus={runtimeStatus}
        selectedProjectId={selectedProjectId}
        theme={theme}
        themeLabel={themeLabel}
        themeOptions={themeOptions}
      />
    </div>
  );
}
