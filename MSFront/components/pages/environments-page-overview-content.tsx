'use client';

import { SummaryCard } from '@/components/common/management-primitives';
import { OverviewSummarySection } from '@/components/common/overview-summary-section';
import type { useEnvironmentsPageSurfaceController } from '@/lib/utils/use-environments-page-surface-controller';
import { useLocale } from '@/providers/locale-provider';

interface EnvironmentsPageOverviewContentProps {
  overviewSummaryCards: ReturnType<
    typeof useEnvironmentsPageSurfaceController
  >['overviewSummaryCards'];
}

export function EnvironmentsPageOverviewContent({
  overviewSummaryCards,
}: EnvironmentsPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <OverviewSummarySection
      title={t('dashboard.environments.overviewTitle')}
      description={t('dashboard.environments.overviewDescription')}
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
  );
}
