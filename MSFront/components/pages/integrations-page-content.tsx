'use client';

import {
  ProjectEndpointFooterLink,
  ProjectEndpointSurfaceCard,
} from '@/components/common/project-endpoint-surface';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';

interface IntegrationsPageResultsContentProps {
  endpointPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['endpointPresentationCards'];
}

export function IntegrationsPageResultsContent({
  endpointPresentationCards,
}: IntegrationsPageResultsContentProps) {
  if (endpointPresentationCards.length === 0) {
    return null;
  }

  return (
    <div className="integrationStack">
      {endpointPresentationCards.map((endpoint) => (
        <EndpointCard key={endpoint.id} endpoint={endpoint} />
      ))}
    </div>
  );
}

function EndpointCard({
  endpoint,
}: {
  endpoint: ReturnType<typeof useIntegrationsPagePresentationController>['endpointPresentationCards'][number];
}) {
  return (
    <ProjectEndpointSurfaceCard
      className="integrationCard"
      identity={endpoint.card.identity}
      status={endpoint.card.status}
      environment={endpoint.card.environment}
      metrics={endpoint.card.metrics}
      fields={endpoint.card.fields}
      footnote={endpoint.card.footnote}
      footer={
        <ProjectEndpointFooterLink href={endpoint.footerHref} label={endpoint.footerLabel} />
      }
    />
  );
}

