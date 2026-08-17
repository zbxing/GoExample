'use client';

import { WorkbenchResultsBar } from '@/components/common/workbench-results-bar';
import { useLocale } from '@/providers/locale-provider';
import type { useIntegrationsPageController } from '@/lib/utils/use-integrations-page-controller';

interface IntegrationsPageWorkbenchResultsBarContentProps {
  clearScopedProject: ReturnType<typeof useIntegrationsPageController>['clearScopedProject'];
  handleCopyCurrentView: ReturnType<typeof useIntegrationsPageController>['handleCopyCurrentView'];
  resetEndpointFilters: ReturnType<typeof useIntegrationsPageController>['resetEndpointFilters'];
  resultTags: ReturnType<typeof useIntegrationsPageController>['resultTags'];
  scopedProject: ReturnType<typeof useIntegrationsPageController>['scopedProject'];
}

export function IntegrationsPageWorkbenchResultsBarContent({
  clearScopedProject,
  handleCopyCurrentView,
  resetEndpointFilters,
  resultTags,
  scopedProject,
}: IntegrationsPageWorkbenchResultsBarContentProps) {
  const { t } = useLocale();

  return (
    <WorkbenchResultsBar
      tags={resultTags}
      actions={
        <>
          {scopedProject ? (
            <button type="button" className="ghostButton" onClick={clearScopedProject}>
              {t('dashboard.integrations.context.clearProjectFilter')}
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
            {t('dashboard.integrations.copyLink')}
          </button>
          <button type="button" className="secondaryButton" onClick={resetEndpointFilters}>
            {t('actions.resetFilters')}
          </button>
        </>
      }
    />
  );
}
