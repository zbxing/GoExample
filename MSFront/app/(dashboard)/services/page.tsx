import { ServicesPage } from '@/components/pages/services-page';
import { getServicesGovernance } from '@/lib/api/management';
import { resolveServicesFilterState } from '@/lib/utils/governance-filters';

export const dynamic = 'force-dynamic';

export default async function ServicesRoute({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    search?: string;
    category?: string;
    environment?: string;
    status?: string;
    sort?: string;
  }>;
}) {
  const { services, categorySummary } = await getServicesGovernance();
  const resolvedSearchParams = await searchParams;
  const initialFilters = resolveServicesFilterState(
    resolvedSearchParams,
    Array.from(new Set(services.map((service) => service.projectId))),
  );
  const pageKey = `services:${initialFilters.projectId}:${initialFilters.search}:${initialFilters.category}:${initialFilters.environment}:${initialFilters.status}:${initialFilters.sort}`;

  return (
    <ServicesPage
      key={pageKey}
      services={services}
      categorySummary={categorySummary}
      initialProjectId={initialFilters.projectId}
      initialSearch={initialFilters.search}
      initialCategory={initialFilters.category}
      initialEnvironment={initialFilters.environment}
      initialStatus={initialFilters.status}
      initialSort={initialFilters.sort}
    />
  );
}
