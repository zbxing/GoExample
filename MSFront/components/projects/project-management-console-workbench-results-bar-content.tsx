'use client';

import { RotateCcw } from 'lucide-react';
import { WorkbenchResultsBar } from '@/components/common/workbench-results-bar';
import { useLocale } from '@/providers/locale-provider';

interface ProjectManagementConsoleRegistryWorkbenchResultsBarContentProps {
  activeProjectFocusTag: string;
  clearProjectFilter: () => void;
  enableUrlSync: boolean;
  handleCopyCurrentView: () => void;
  isCreating: boolean;
  linkedProjectId: string;
  registryTags: readonly string[];
  resetRegistryFilters: () => void;
}

export function ProjectManagementConsoleRegistryWorkbenchResultsBarContent({
  activeProjectFocusTag,
  clearProjectFilter,
  enableUrlSync,
  handleCopyCurrentView,
  isCreating,
  linkedProjectId,
  registryTags,
  resetRegistryFilters,
}: ProjectManagementConsoleRegistryWorkbenchResultsBarContentProps) {
  const { t } = useLocale();
  const tags = [
    ...(linkedProjectId && !isCreating && activeProjectFocusTag
      ? [{ label: activeProjectFocusTag }]
      : []),
    ...registryTags.map((tag) => ({ label: tag })),
  ];

  return (
    <WorkbenchResultsBar
      tags={tags}
      actions={
        <>
          {enableUrlSync && linkedProjectId && !isCreating ? (
            <button type="button" className="ghostButton" onClick={clearProjectFilter}>
              {t('projectConsole.context.clearProjectFilter')}
            </button>
          ) : null}
          {enableUrlSync ? (
            <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
              {t('projectsHub.copyLink')}
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={resetRegistryFilters}>
            <RotateCcw size={14} />
            {t('actions.resetFilters')}
          </button>
        </>
      }
    />
  );
}
