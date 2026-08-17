'use client';

import { EditorSection } from '@/components/common/editor-section';
import { useLocale } from '@/providers/locale-provider';
import type { IntegrationsGovernanceView } from '@/lib/types/management';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';

interface IntegrationsPageInventorySecuritySchemesContentProps {
  inventoryTitle: NonNullable<IntegrationsGovernanceView['inventory']>['title'];
  securitySchemePresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['securitySchemePresentationCards'];
}

export function IntegrationsPageInventorySecuritySchemesContent({
  inventoryTitle,
  securitySchemePresentationCards,
}: IntegrationsPageInventorySecuritySchemesContentProps) {
  const { t } = useLocale();

  return (
    <div className="editorStack">
      <EditorSection
        title={t('dashboard.integrations.schemesTitle')}
        description={inventoryTitle}
      >
        {securitySchemePresentationCards.length === 0 ? (
          <div className="emptyStatePanel">
            <strong>{t('dashboard.integrations.inventoryUnavailableTitle')}</strong>
            <p>{t('dashboard.integrations.inventoryUnavailableDescription')}</p>
          </div>
        ) : (
          <div className="integrationSchemeGrid">
            {securitySchemePresentationCards.map((scheme) => (
              <SecuritySchemeCard key={scheme.name} scheme={scheme} />
            ))}
          </div>
        )}
      </EditorSection>
    </div>
  );
}

function SecuritySchemeCard({
  scheme,
}: {
  scheme: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['securitySchemePresentationCards'][number];
}) {
  return (
    <article className="integrationSchemeCard">
      <div className="serviceCardHeader">
        <div>
          <span className="serviceCategory">{scheme.type}</span>
          <h3>{scheme.name}</h3>
          <p>{scheme.scheme}</p>
        </div>
      </div>
      <div className="summaryMetricList">
        {scheme.metrics.map((metric) => (
          <div key={metric.id}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}
