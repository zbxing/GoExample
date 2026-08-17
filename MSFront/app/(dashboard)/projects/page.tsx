import { ProjectsRegistryPage } from '@/components/pages/projects-registry-page';
import { getManagedProjectSummaries } from '@/lib/api/management';
import type { ManagedProjectPage, ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';

export const dynamic = 'force-dynamic';

export default async function ProjectsRoute({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    sort?: string;
    mode?: string;
    environment?: string;
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const environment = normalizeEnvironment(resolvedSearchParams.environment);
  const status = normalizeStatus(resolvedSearchParams.status);
  const sort = normalizeSort(resolvedSearchParams.sort);
  const search = `${resolvedSearchParams.search ?? ''}`.trim();
  const page = Number(resolvedSearchParams.page ?? 1);
  const mode = resolvedSearchParams.mode === 'create' ? 'create' : 'browse';
  const result: ManagedProjectPage =
    mode === 'create'
      ? { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }
      : await getManagedProjectSummaries({ page, pageSize: 20, search, environment, status, sort });

  return (
    <ProjectsRegistryPage
      result={result}
      search={search}
      environment={environment}
      status={status}
      sort={sort}
      mode={mode}
    />
  );
}

function normalizeEnvironment(value?: string): 'all' | ProjectEnvironment {
  return value === 'production' || value === 'staging' || value === 'development' ? value : 'all';
}

function normalizeStatus(value?: string): 'all' | ProjectStatus {
  return value === 'healthy' || value === 'warning' || value === 'critical' ? value : 'all';
}

function normalizeSort(value?: string): ProjectSortMode {
  return value === 'traffic' || value === 'deploy' || value === 'name' ? value : 'risk';
}
