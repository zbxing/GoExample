'use client';

import { RotateCcw } from 'lucide-react';
import { WorkbenchResultsBar } from '@/components/common/workbench-results-bar';
import { useLocale } from '@/providers/locale-provider';
import type { useServicesPageController } from '@/lib/utils/use-services-page-controller';

interface ServicesPageWorkbenchResultsBarContentProps {
  clearScopedProject: ReturnType<typeof useServicesPageController>['clearScopedProject'];
  handleCopyCurrentView: ReturnType<typeof useServicesPageController>['handleCopyCurrentView'];
  resetFilters: ReturnType<typeof useServicesPageController>['resetFilters'];
  resultTags: ReturnType<typeof useServicesPageController>['resultTags'];
  scopedProject: ReturnType<typeof useServicesPageController>['scopedProject'];
}

export function ServicesPageWorkbenchResultsBarContent({
  clearScopedProject,
  handleCopyCurrentView,
  resetFilters,
  resultTags,
  scopedProject,
}: ServicesPageWorkbenchResultsBarContentProps) {
  const { t } = useLocale();

  return (
    <WorkbenchResultsBar
      tags={resultTags}
      actions={
        <>
          {scopedProject ? (
            <button type="button" className="ghostButton" onClick={clearScopedProject}>
              {t('dashboard.services.context.clearProjectFilter')}
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
            {t('dashboard.services.copyLink')}
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
