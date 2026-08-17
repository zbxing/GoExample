import { EnvironmentsPage } from '@/components/pages/environments-page';
import { getEnvironmentGovernance } from '@/lib/api/management';
import { resolveEnvironmentsFilterState } from '@/lib/utils/governance-filters';

export const dynamic = 'force-dynamic';

export default async function EnvironmentsRoute({
  searchParams,
}: {
  searchParams: Promise<{
    environment?: string;
    search?: string;
    status?: string;
    sort?: string;
  }>;
}) {
  const environments = await getEnvironmentGovernance();
  const resolvedSearchParams = await searchParams;
  const initialFilters = resolveEnvironmentsFilterState(resolvedSearchParams);
  const pageKey = `environments:${initialFilters.search}:${initialFilters.environment}:${initialFilters.status}:${initialFilters.sort}`;

  return (
    <EnvironmentsPage
      key={pageKey}
      environments={environments}
      initialSearch={initialFilters.search}
      initialEnvironment={initialFilters.environment}
      initialStatus={initialFilters.status}
      initialSort={initialFilters.sort}
    />
  );
}
