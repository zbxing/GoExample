'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  LocaleCode,
  ThemeMode,
  WorkspaceSettingsSummary,
} from '@/lib/types/management';
import {
  buildContextualShellHref,
  buildProjectSelectionSurfaceHref,
} from '@/lib/utils/shell-navigation';
import { formatWorkspaceProjectMeta } from '@/lib/utils/workspace-surface';
import { useLocale } from '@/providers/locale-provider';
import { useProjectSelection } from '@/providers/project-provider';
import { useTheme } from '@/providers/theme-provider';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseSettingsPanelControllerOptions {
  summary: WorkspaceSettingsSummary;
  t: TranslationFn;
}

type SettingsActionLink = {
  href: Route;
  label: string;
  icon: 'projects' | 'integrations' | 'security' | 'users';
};

export function useSettingsPanelController({
  summary,
  t,
}: UseSettingsPanelControllerOptions) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { projects, selectedProjectId, selectedProject, isLoading, setSelectedProjectId } =
    useProjectSelection();
  const [preferenceFeedback, setPreferenceFeedback] = useState<{
    tone: 'success' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!preferenceFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPreferenceFeedback(null);
    }, 2800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [preferenceFeedback]);

  const projectPlaceholder = useMemo(() => {
    if (isLoading) {
      return t('labels.loadingProjects');
    }

    if (projects.length === 0) {
      return t('labels.noProjectsAvailable');
    }

    return t('labels.emptySelection');
  }, [isLoading, projects.length, t]);
  const selectedProjectMeta = useMemo(
    () =>
      formatWorkspaceProjectMeta(
        selectedProject,
        t,
        ['code', 'owner', 'region'],
        t('settingsPanel.projectMetaEmpty'),
      ),
    [selectedProject, t],
  );
  const actionLinks = useMemo<SettingsActionLink[]>(
    () => [
      {
        href: buildContextualShellHref({
          route: '/projects' as Route,
          pathname,
          searchParams: new URLSearchParams(searchParams.toString()),
          project: selectedProject,
        }) as Route,
        label: t('settingsPanel.quickActions.projects'),
        icon: 'projects',
      },
      {
        href: buildContextualShellHref({
          route: '/integrations' as Route,
          pathname,
          searchParams: new URLSearchParams(searchParams.toString()),
          project: selectedProject,
        }) as Route,
        label: t('settingsPanel.quickActions.integrations'),
        icon: 'integrations',
      },
      {
        href: buildContextualShellHref({
          route: '/security' as Route,
          pathname,
          searchParams: new URLSearchParams(searchParams.toString()),
          project: selectedProject,
        }) as Route,
        label: t('settingsPanel.quickActions.security'),
        icon: 'security',
      },
      {
        href: buildContextualShellHref({
          route: '/users' as Route,
          pathname,
          searchParams: new URLSearchParams(searchParams.toString()),
          project: selectedProject,
        }) as Route,
        label: t('settingsPanel.quickActions.users'),
        icon: 'users',
      },
    ],
    [pathname, searchParams, selectedProject, t],
  );

  function showPreferenceFeedback(tone: 'success' | 'info', message: string) {
    setPreferenceFeedback({ tone, message });
  }

  function handleLocaleChange(nextLocale: LocaleCode) {
    setLocale(nextLocale);
    showPreferenceFeedback(
      'success',
      t('settingsPanel.feedback.localeApplied', {
        locale: t(`common.locales.${nextLocale}`),
      }),
    );
  }

  function handleThemeChange(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    showPreferenceFeedback(
      'success',
      t('settingsPanel.feedback.themeApplied', {
        theme: t(`common.themes.${nextTheme}`),
      }),
    );
  }

  function handleProjectChange(nextProjectId: string) {
    setSelectedProjectId(nextProjectId);
    const nextProject = projects.find((project) => project.id === nextProjectId) ?? null;
    const nextHref = buildProjectSelectionSurfaceHref({
      pathname,
      searchParams: new URLSearchParams(searchParams.toString()),
      project: nextProject,
      availableProjectIds: projects.map((project) => project.id),
    });

    if (nextHref) {
      router.replace(nextHref as Route);
    }

    showPreferenceFeedback(
      'success',
      nextProject
        ? t('settingsPanel.feedback.projectApplied', {
            project: nextProject.name,
          })
        : t('settingsPanel.feedback.projectCleared'),
    );
  }

  function resetLocalePreference() {
    if (locale === summary.defaultLocale) {
      showPreferenceFeedback('info', t('settingsPanel.feedback.localeAlreadyDefault'));
      return;
    }

    handleLocaleChange(summary.defaultLocale);
    showPreferenceFeedback(
      'success',
      t('settingsPanel.feedback.localeReset', {
        locale: t(`common.locales.${summary.defaultLocale}`),
      }),
    );
  }

  function resetThemePreference() {
    if (theme === summary.defaultTheme) {
      showPreferenceFeedback('info', t('settingsPanel.feedback.themeAlreadyDefault'));
      return;
    }

    handleThemeChange(summary.defaultTheme);
    showPreferenceFeedback(
      'success',
      t('settingsPanel.feedback.themeReset', {
        theme: t(`common.themes.${summary.defaultTheme}`),
      }),
    );
  }

  function resetProjectPreference() {
    const defaultProjectId = projects[0]?.id ?? '';

    if (!defaultProjectId) {
      showPreferenceFeedback('info', t('settingsPanel.feedback.projectUnavailable'));
      return;
    }

    if (selectedProjectId === defaultProjectId) {
      showPreferenceFeedback('info', t('settingsPanel.feedback.projectAlreadyDefault'));
      return;
    }

    handleProjectChange(defaultProjectId);
    showPreferenceFeedback(
      'success',
      t('settingsPanel.feedback.projectReset', {
        project: projects[0]?.name ?? t('labels.emptySelection'),
      }),
    );
  }

  return {
    actionLinks,
    handleLocaleChange,
    handleProjectChange,
    handleThemeChange,
    isLoading,
    locale,
    preferenceFeedback,
    projectPlaceholder,
    projects,
    resetLocalePreference,
    resetProjectPreference,
    resetThemePreference,
    selectedProject,
    selectedProjectId,
    selectedProjectMeta,
    theme,
  };
}
