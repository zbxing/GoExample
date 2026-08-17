'use client';

import { RotateCcw } from 'lucide-react';
import { WorkbenchResultsBar } from '@/components/common/workbench-results-bar';
import { useLocale } from '@/providers/locale-provider';
import type { useEnvironmentsPageController } from '@/lib/utils/use-environments-page-controller';

interface EnvironmentsPageWorkbenchResultsBarContentProps {
  clearEnvironmentFilter: () => void;
  focusedEnvironment: ReturnType<typeof useEnvironmentsPageController>['focusedEnvironment'];
  handleCopyCurrentView: () => void;
  resetFilters: () => void;
  resultTags: ReturnType<typeof useEnvironmentsPageController>['resultTags'];
}

export function EnvironmentsPageWorkbenchResultsBarContent({
  clearEnvironmentFilter,
  focusedEnvironment,
  handleCopyCurrentView,
  resetFilters,
  resultTags,
}: EnvironmentsPageWorkbenchResultsBarContentProps) {
  const { t } = useLocale();

  return (
    <WorkbenchResultsBar
      tags={resultTags}
      actions={
        <>
          {focusedEnvironment ? (
            <button
              type="button"
              className="ghostButton"
              onClick={clearEnvironmentFilter}
            >
              {t('dashboard.environments.context.clearEnvironmentFilter')}
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
            {t('dashboard.environments.copyLink')}
          </button>
          <button type="button" className="ghostButton" onClick={resetFilters}>
            <RotateCcw size={14} />
            {t('actions.resetFilters')}
          </button>
        </>
      }
    />
  );
}
