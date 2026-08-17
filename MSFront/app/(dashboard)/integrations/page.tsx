import { IntegrationsPage } from '@/components/pages/integrations-page';
import { getIntegrationsGovernance } from '@/lib/api/management';
import { resolveIntegrationsFilterState } from '@/lib/utils/governance-filters';

export const dynamic = 'force-dynamic';

export default async function IntegrationsRoute({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    search?: string;
    environment?: string;
    status?: string;
    coverage?: string;
    sort?: string;
    inventorySearch?: string;
    inventoryArea?: string;
    inventorySecurity?: string;
  }>;
}) {
  const integrations = await getIntegrationsGovernance();
  const resolvedSearchParams = await searchParams;
  const initialFilters = resolveIntegrationsFilterState(
    resolvedSearchParams,
    Array.from(new Set(integrations.endpoints.map((endpoint) => endpoint.projectId))),
  );
  const pageKey = [
    'integrations',
    initialFilters.projectId,
    initialFilters.search,
    initialFilters.environment,
    initialFilters.status,
    initialFilters.coverage,
    initialFilters.sort,
    initialFilters.inventorySearch,
    initialFilters.inventoryArea,
    initialFilters.inventorySecurity,
  ].join(':');

  return (
    <IntegrationsPage
      key={pageKey}
      {...integrations}
      initialProjectId={initialFilters.projectId}
      initialSearch={initialFilters.search}
      initialEnvironment={initialFilters.environment}
      initialStatus={initialFilters.status}
      initialCoverage={initialFilters.coverage}
      initialSort={initialFilters.sort}
      initialInventorySearch={initialFilters.inventorySearch}
      initialInventoryArea={initialFilters.inventoryArea}
      initialInventorySecurity={initialFilters.inventorySecurity}
    />
  );
}
