'use client';

import type { Route } from 'next';
import Link from 'next/link';
import {
  Bell,
  ChevronDown,
  CircleUserRound,
  Globe2,
  MoonStar,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SunMedium,
} from 'lucide-react';
import { CommandPalette } from '@/components/shell/command-palette';
import type { LocaleCode, ManagedProject, ThemeMode } from '@/lib/types/management';

interface TopbarSelectOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface TopbarWorkbenchContentProps {
  currentLocaleLabel: string;
  currentThemeLabel: string;
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
  projectLabel: string;
  projectPlaceholder: string;
  projects: readonly Pick<ManagedProject, 'id' | 'name'>[];
  runtimeFootnote: string;
  runtimeLabel: string;
  runtimeStatus: string;
  selectedProjectId: string;
  theme: ThemeMode;
  themeLabel: string;
  themeOptions: readonly TopbarSelectOption<ThemeMode>[];
}

export function TopbarWorkbenchContent({
  currentLocaleLabel,
  currentThemeLabel,
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
  projectLabel,
  projectPlaceholder,
  projects,
  runtimeFootnote,
  runtimeLabel,
  runtimeStatus,
  selectedProjectId,
  theme,
  themeLabel,
  themeOptions,
}: TopbarWorkbenchContentProps) {
  function openCommandPalette() {
    document.querySelector<HTMLButtonElement>('.commandPaletteTrigger')?.click();
  }

  function toggleReferenceTheme() {
    onThemeChange(theme === 'graphite' ? 'system' : 'graphite');
  }

  return (
    <div className="topbarWorkbench">
      <span className="topbarConnection" title={`${runtimeLabel}: ${runtimeFootnote}`}>
        <span aria-hidden="true" />
        {runtimeStatus}
      </span>

      <label className="topbarProjectPicker">
        <span>{projectLabel}</span>
        <select
          value={selectedProjectId}
          onChange={(event) => onProjectChange(event.target.value)}
          disabled={isProjectSelectionDisabled}
        >
          {projects.length === 0 ? <option value="">{projectPlaceholder}</option> : null}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <CommandPalette />

      <div className="referenceHeaderTools">
        <button type="button" className="referenceHeaderIcon" onClick={openCommandPalette} title="Search" aria-label="Search">
          <Search size={18} />
        </button>
        <Link href={openSettingsHref} className="referenceHeaderIcon" title={openSettingsLabel} aria-label={openSettingsLabel}>
          <Settings2 size={18} />
        </Link>
        <button type="button" className="referenceHeaderIcon" onClick={() => window.location.reload()} title="Refresh" aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
        <button type="button" className="referenceHeaderIcon" onClick={toggleReferenceTheme} title={currentThemeLabel} aria-label={currentThemeLabel}>
          {theme === 'graphite' ? <MoonStar size={18} /> : <SunMedium size={18} />}
        </button>
        <span className="referenceHeaderSeparator" aria-hidden="true" />
        <Link href={openSettingsHref} className="referenceUserMenu" title={openSettingsLabel}>
          <span className="referenceUserAvatar"><CircleUserRound size={24} /></span>
          <span>Mr.奇葩</span>
          <ChevronDown size={14} />
        </Link>
      </div>

      <div className="topbarToolGroup">
        <label className="topbarSelectTool" title={currentLocaleLabel}>
          <Globe2 size={16} aria-hidden="true" />
          <select
            value={locale}
            onChange={(event) => onLocaleChange(event.target.value as LocaleCode)}
            aria-label={localeLabel}
          >
            {localeOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="topbarSelectTool" title={currentThemeLabel}>
          {theme === 'graphite' ? <MoonStar size={16} aria-hidden="true" /> : <SunMedium size={16} aria-hidden="true" />}
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
            aria-label={themeLabel}
          >
            {themeOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <Link href={openSecurityHref} className="topbarIconButton" title={openSecurityLabel} aria-label={openSecurityLabel}>
          <ShieldCheck size={17} />
        </Link>
        <button type="button" className="topbarIconButton" title="Notifications" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <Link href={openSettingsHref} className="topbarIconButton" title={openSettingsLabel} aria-label={openSettingsLabel}>
          <Settings2 size={17} />
        </Link>
        <Link href={openSettingsHref} className="topbarProfileButton" title={openSettingsLabel} aria-label={openSettingsLabel}>
          <CircleUserRound size={20} />
        </Link>
      </div>
    </div>
  );
}
