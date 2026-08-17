import { DashboardPage } from '@/components/pages/dashboard-page';
import {
  getManagedProjects,
  getManagementOverview,
  getSecurityGovernance,
} from '@/lib/api/management';
import { resolveProjectsPortfolioFilterState } from '@/lib/utils/governance-filters';

export const dynamic = 'force-dynamic';

export default async function DashboardRoute({
  searchParams,
}: {
  searchParams: Promise<{
    portfolioSearch?: string;
    portfolioEnvironment?: string;
    portfolioStatus?: string;
    portfolioSort?: string;
    environment?: string;
  }>;
}) {
  const projects = await getManagedProjects();
  const resolvedSearchParams = await searchParams;
  const initialPortfolioFilters = resolveProjectsPortfolioFilterState(resolvedSearchParams);
  const [overview, security] = await Promise.all([
    getManagementOverview(projects),
    getSecurityGovernance(),
  ]);
  const pageKey = [
    'dashboard',
    initialPortfolioFilters.search,
    initialPortfolioFilters.environment,
    initialPortfolioFilters.status,
    initialPortfolioFilters.sort,
  ].join(':');

  return (
    <DashboardPage
      key={pageKey}
      overview={overview}
      projects={projects}
      security={security}
      initialPortfolioSearch={initialPortfolioFilters.search}
      initialPortfolioEnvironment={initialPortfolioFilters.environment}
      initialPortfolioStatus={initialPortfolioFilters.status}
      initialPortfolioSort={initialPortfolioFilters.sort}
    />
  );
}
