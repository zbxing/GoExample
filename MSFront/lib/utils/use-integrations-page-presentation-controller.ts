'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import { buildProjectDetailHref } from '@/lib/utils/governance-filters';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface IntegrationEndpointPresentationModel {
  id: string;
  projectId: string;
  footerHref: Route;
  footerLabel: string;
  card: ReturnType<typeof useIntegrationsPageSurfaceController>['endpointCards'][number];
}

interface IntegrationOperationBadgeModel {
  id: string;
  label: string;
  className: string;
}

interface IntegrationOperationPresentationModel {
  id: string;
  method: string;
  areaLabel: string;
  path: string;
  securitySchemesLabel: string;
  badges: readonly IntegrationOperationBadgeModel[];
}

interface IntegrationSchemeMetricModel {
  id: string;
  label: string;
  value: string;
}

interface IntegrationSecuritySchemePresentationModel {
  name: string;
  type: string;
  scheme: string;
  metrics: readonly IntegrationSchemeMetricModel[];
}

interface UseIntegrationsPagePresentationControllerOptions {
  endpointCards: ReturnType<typeof useIntegrationsPageSurfaceController>['endpointCards'];
  operationCards: ReturnType<typeof useIntegrationsPageSurfaceController>['operationCards'];
  securitySchemeCards: ReturnType<typeof useIntegrationsPageSurfaceController>['securitySchemeCards'];
  t: TranslationFn;
}

export function useIntegrationsPagePresentationController({
  endpointCards,
  operationCards,
  securitySchemeCards,
  t,
}: UseIntegrationsPagePresentationControllerOptions) {
  const endpointPresentationCards = useMemo<IntegrationEndpointPresentationModel[]>(
    () =>
      endpointCards.map((endpoint) => ({
        id: endpoint.id,
        projectId: endpoint.projectId,
        footerHref: buildProjectDetailHref(endpoint.projectId),
        footerLabel: t('dashboard.integrations.context.viewProjectDetail'),
        card: endpoint,
      })),
    [endpointCards, t],
  );
  const operationPresentationCards = useMemo<IntegrationOperationPresentationModel[]>(
    () =>
      operationCards.map((operation) => ({
        id: operation.id,
        method: operation.method,
        areaLabel: operation.areaLabel,
        path: operation.path,
        securitySchemesLabel: operation.securitySchemesLabel,
        badges: [
          {
            id: `${operation.id}:secured`,
            label: t(
              operation.secured
                ? 'dashboard.integrations.securedPill'
                : 'dashboard.integrations.unsecuredPill',
            ),
            className: operation.secured ? 'timelinePill tone-info' : 'timelinePill tone-low',
          },
          ...(operation.deprecated
            ? [
                {
                  id: `${operation.id}:deprecated`,
                  label: t('dashboard.integrations.deprecatedPill'),
                  className: 'timelinePill tone-warning',
                },
              ]
            : []),
        ],
      })),
    [operationCards, t],
  );
  const securitySchemePresentationCards = useMemo<IntegrationSecuritySchemePresentationModel[]>(
    () =>
      securitySchemeCards.map((scheme) => ({
        name: scheme.name,
        type: scheme.type,
        scheme: scheme.scheme,
        metrics: buildSchemeMetrics(scheme, t),
      })),
    [securitySchemeCards, t],
  );

  return {
    endpointPresentationCards,
    operationPresentationCards,
    securitySchemePresentationCards,
  };
}

function buildSchemeMetrics(
  scheme: ReturnType<typeof useIntegrationsPageSurfaceController>['securitySchemeCards'][number],
  t: TranslationFn,
): IntegrationSchemeMetricModel[] {
  return [
    {
      id: `${scheme.name}:location`,
      label: t('dashboard.integrations.schemeLocation'),
      value: scheme.location,
    },
    {
      id: `${scheme.name}:parameter`,
      label: t('dashboard.integrations.schemeParameter'),
      value: scheme.parameterName,
    },
  ];
}
