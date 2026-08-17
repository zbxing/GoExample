'use client';

import { SummaryCard } from '@/components/common/management-primitives';
import { OverviewSummarySection } from '@/components/common/overview-summary-section';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';
import { useLocale } from '@/providers/locale-provider';

interface IntegrationsPageOverviewContentProps {
  endpointSummaryCards: ReturnType<
    typeof useIntegrationsPageSurfaceController
  >['endpointSummaryCards'];
}

export function IntegrationsPageOverviewContent({
  endpointSummaryCards,
}: IntegrationsPageOverviewContentProps) {
  const { t } = useLocale();

  return (
    <OverviewSummarySection
      title={t('dashboard.integrations.cardsTitle')}
      description={t('dashboard.integrations.cardsDescription')}
    >
      {endpointSummaryCards.map((card) => (
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
