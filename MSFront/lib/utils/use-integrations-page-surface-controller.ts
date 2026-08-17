'use client';

import { useMemo } from 'react';
import type {
  ProjectEndpointField,
  ProjectEndpointIdentity,
  ProjectEndpointMetric,
} from '@/components/common/project-endpoint-surface';
import type {
  ApiInventoryOperationEntry,
  ApiInventorySecurityScheme,
  IntegrationEndpointEntry,
  IntegrationsGovernanceSummary,
  IntegrationsGovernanceView,
  LocaleCode,
} from '@/lib/types/management';
import { formatNumber, joinDetails } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SummaryCardDescriptor {
  label: string;
  value: string;
  footnote: string;
}

interface IntegrationEndpointCardDescriptor {
  id: string;
  projectId: string;
  identity: ProjectEndpointIdentity;
  status: IntegrationEndpointEntry['status'];
  environment: IntegrationEndpointEntry['environment'];
  metrics: ProjectEndpointMetric[];
  fields: ProjectEndpointField[];
  footnote: string;
}

interface IntegrationOperationCardDescriptor {
  id: string;
  method: string;
  areaLabel: string;
  path: string;
  securitySchemesLabel: string;
  secured: boolean;
  deprecated: boolean;
}

interface IntegrationSecuritySchemeDescriptor {
  name: string;
  type: string;
  scheme: string;
  location: string;
  parameterName: string;
}

interface UseIntegrationsPageSurfaceControllerOptions {
  endpointSummary: IntegrationsGovernanceSummary;
  filteredEndpoints: readonly IntegrationEndpointEntry[];
  filteredOperations: readonly ApiInventoryOperationEntry[];
  inventory: IntegrationsGovernanceView['inventory'];
  locale: LocaleCode;
  t: TranslationFn;
}

export function useIntegrationsPageSurfaceController({
  endpointSummary,
  filteredEndpoints,
  filteredOperations,
  inventory,
  locale,
  t,
}: UseIntegrationsPageSurfaceControllerOptions) {
  const endpointSummaryCards = useMemo<SummaryCardDescriptor[]>(
    () => [
      {
        label: t('dashboard.integrations.summary.endpoints'),
        value: formatNumber(endpointSummary.totalEndpoints, locale),
        footnote: `${formatNumber(endpointSummary.productionEndpoints, locale)} ${t('status.production')}`,
      },
      {
        label: t('dashboard.integrations.summary.probes'),
        value: formatNumber(endpointSummary.probeReadyEndpoints, locale),
        footnote: `${formatNumber(endpointSummary.attentionEndpoints, locale)} ${t('dashboard.portfolio.attentionLabel')}`,
      },
      {
        label: t('dashboard.integrations.summary.owners'),
        value: formatNumber(endpointSummary.uniqueOwners, locale),
        footnote: `${formatNumber(endpointSummary.uniqueRegions, locale)} ${t('labels.region')}`,
      },
      {
        label: t('dashboard.integrations.summary.operations'),
        value: formatNumber(inventory?.operations.length ?? 0, locale),
        footnote: inventory
          ? `${inventory.version} / OpenAPI ${inventory.specVersion}`
          : t('dashboard.integrations.inventoryUnavailableTitle'),
      },
    ],
    [endpointSummary, inventory, locale, t],
  );
  const endpointCards = useMemo<IntegrationEndpointCardDescriptor[]>(
    () =>
      filteredEndpoints.map((endpoint) => ({
        id: endpoint.id,
        projectId: endpoint.projectId,
        identity: {
          eyebrow: endpoint.projectCode,
          title: endpoint.projectName,
          description: joinDetails([endpoint.owner, endpoint.region]),
        },
        status: endpoint.status,
        environment: endpoint.environment,
        metrics: [
          {
            label: t('labels.activeUsers'),
            value: formatNumber(endpoint.activeUsers, locale),
          },
          {
            label: t('labels.requests'),
            value: formatNumber(endpoint.requestPerMinute, locale),
          },
          {
            label: t('projectConsole.overview.servers'),
            value: formatNumber(endpoint.serverCount, locale),
          },
          {
            label: t('projectConsole.overview.services'),
            value: formatNumber(endpoint.serviceCount, locale),
          },
        ],
        fields: [
          {
            label: t('labels.baseUrl'),
            value: endpoint.baseUrl,
          },
          {
            label: t('labels.apiBaseUrl'),
            value: endpoint.apiBaseUrl,
          },
          {
            label: t('labels.probeBaseUrl'),
            value: endpoint.probeBaseUrl ?? t('dashboard.integrations.probeEmpty'),
          },
        ],
        footnote: joinDetails(endpoint.tags) || endpoint.version,
      })),
    [filteredEndpoints, locale, t],
  );
  const inventorySummaryCards = useMemo<SummaryCardDescriptor[]>(
    () =>
      inventory
        ? [
            {
              label: t('dashboard.integrations.inventoryStats.secured'),
              value: formatNumber(inventory.securedOperationCount, locale),
              footnote: t('dashboard.integrations.methodsTitle'),
            },
            {
              label: t('dashboard.integrations.inventoryStats.schemes'),
              value: formatNumber(inventory.securitySchemes.length, locale),
              footnote: inventory.title,
            },
            {
              label: t('dashboard.integrations.inventoryStats.authPaths'),
              value: formatNumber(inventory.authPaths.length, locale),
              footnote: inventory.version,
            },
            {
              label: t('dashboard.integrations.inventoryStats.examplePaths'),
              value: formatNumber(inventory.examplePaths.length, locale),
              footnote: `OpenAPI ${inventory.specVersion}`,
            },
          ]
        : [],
    [inventory, locale, t],
  );
  const operationCards = useMemo<IntegrationOperationCardDescriptor[]>(
    () =>
      filteredOperations.map((operation) => ({
        id: operation.id,
        method: operation.method,
        areaLabel: t(`dashboard.integrations.inventoryAreas.${operation.area}`),
        path: operation.path,
        securitySchemesLabel:
          joinDetails(operation.securitySchemes) || t('dashboard.integrations.unsecuredPill'),
        secured: operation.secured,
        deprecated: operation.deprecated,
      })),
    [filteredOperations, t],
  );
  const securitySchemeCards = useMemo<IntegrationSecuritySchemeDescriptor[]>(
    () =>
      (inventory?.securitySchemes ?? []).map((scheme) => mapSecurityScheme(scheme, t)),
    [inventory, t],
  );

  return {
    endpointCards,
    endpointSummaryCards,
    inventorySummaryCards,
    operationCards,
    securitySchemeCards,
  };
}

function mapSecurityScheme(
  scheme: ApiInventorySecurityScheme,
  t: TranslationFn,
): IntegrationSecuritySchemeDescriptor {
  return {
    name: scheme.name,
    type: scheme.type,
    scheme: scheme.scheme ?? t('dashboard.integrations.schemeImplicit'),
    location: scheme.location ?? t('dashboard.integrations.schemeImplicit'),
    parameterName: scheme.parameterName ?? t('dashboard.integrations.schemeImplicit'),
  };
}
