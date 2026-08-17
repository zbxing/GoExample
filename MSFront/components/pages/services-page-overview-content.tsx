'use client';

import { SummaryCard } from '@/components/common/management-primitives';
import { OverviewSummarySection } from '@/components/common/overview-summary-section';
import { ServicesPageSummaryContent } from '@/components/pages/services-page-summary-content';
import { useLocale } from '@/providers/locale-provider';
import type { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

interface ServicesPageOverviewContentProps {
  overviewSummaryCards: ReturnType<typeof useServicesPageSurfaceController>['overviewSummaryCards'];
  categorySummaryCards: ReturnType<typeof useServicesPageSurfaceController>['categorySummaryCards'];
}

export function ServicesPageOverviewContent({
  overviewSummaryCards,
  categorySummaryCards,
}: ServicesPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <>
      <OverviewSummarySection
        title={t('dashboard.services.overviewTitle')}
        description={t('dashboard.services.overviewDescription')}
      >
        {overviewSummaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </OverviewSummarySection>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>{t('dashboard.services.summaryTitle')}</h2>
            <p>{t('dashboard.services.summaryDescription')}</p>
          </div>
        </div>
        <ServicesPageSummaryContent categorySummaryCards={categorySummaryCards} />
      </section>
    </>
  );
}
