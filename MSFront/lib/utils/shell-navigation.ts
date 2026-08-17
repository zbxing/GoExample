import type { Route } from 'next';
import type { ManagedProject } from '@/lib/types/management';
import {
  buildContextualRolesHref,
  buildContextualSecurityHref,
  buildContextualUsersHref,
  resolveAccessNavigationContext,
} from '@/lib/utils/access-navigation';
import {
  buildEnvironmentsHref,
  buildIntegrationsHref,
  buildProjectDetailHref,
  buildProjectsHref,
  buildServicesHref,
  resolveEnvironmentsFilterState,
  resolveIntegrationsFilterState,
  resolveProjectsPortfolioFilterState,
  resolveProjectsRegistryFilterState,
  resolveServicesFilterState,
} from '@/lib/utils/governance-filters';

type ProjectNavigationContext = Pick<ManagedProject, 'id' | 'environment'>;

interface BuildProjectSelectionSurfaceHrefOptions {
  pathname: string;
  searchParams: URLSearchParams;
  project: ProjectNavigationContext | null;
  availableProjectIds: readonly string[];
}

interface BuildContextualShellHrefOptions {
  route: Route;
  pathname: string;
  searchParams: URLSearchParams;
  project: ProjectNavigationContext | null;
}

export function buildContextualGovernanceHref(
  route: Route,
  project: ProjectNavigationContext | null,
): Route {
  if (!project) {
    return route;
  }

  if (route === '/projects') {
    return buildProjectsHref({
      projectId: project.id,
      mode: 'browse',
    }) as Route;
  }

  if (route === '/services') {
    return buildServicesHref({
      projectId: project.id,
    }) as Route;
  }

  if (route === '/integrations') {
    return buildIntegrationsHref({
      projectId: project.id,
    }) as Route;
  }

  if (route === '/environments') {
    return buildEnvironmentsHref({
      environment: project.environment,
    }) as Route;
  }

  return route;
}

export function buildContextualShellHref({
  route,
  pathname,
  searchParams,
  project,
}: BuildContextualShellHrefOptions): Route {
  const accessNavigationContext = resolveAccessNavigationContext(pathname, searchParams);

  if (route === '/security') {
    return buildContextualSecurityHref(accessNavigationContext);
  }

  if (route === '/users') {
    return buildContextualUsersHref(accessNavigationContext);
  }

  if (route === '/roles') {
    return buildContextualRolesHref(accessNavigationContext);
  }

  return buildContextualGovernanceHref(route, project);
}

export function buildProjectSelectionSurfaceHref({
  pathname,
  searchParams,
  project,
  availableProjectIds,
}: BuildProjectSelectionSurfaceHrefOptions): Route | null {
  if (!project) {
    return null;
  }

  if (pathname.startsWith('/projects/')) {
    return buildProjectDetailHref(project.id);
  }

  if (pathname === '/projects') {
    const portfolioFilters = resolveProjectsPortfolioFilterState({
      portfolioSearch: searchParams.get('portfolioSearch'),
      portfolioEnvironment: searchParams.get('portfolioEnvironment'),
      environment: searchParams.get('environment'),
      portfolioStatus: searchParams.get('portfolioStatus'),
      portfolioSort: searchParams.get('portfolioSort'),
    });
    const registryFilters = resolveProjectsRegistryFilterState(
      {
        projectId: searchParams.get('projectId'),
        registrySearch: searchParams.get('registrySearch'),
        registryEnvironment: searchParams.get('registryEnvironment'),
        registryStatus: searchParams.get('registryStatus'),
        registrySort: searchParams.get('registrySort'),
        mode: searchParams.get('mode'),
      },
      availableProjectIds,
    );

    return buildProjectsHref({
      portfolioSearch: portfolioFilters.search,
      portfolioEnvironment: portfolioFilters.environment,
      portfolioStatus: portfolioFilters.status,
      portfolioSort: portfolioFilters.sort,
      projectId: project.id,
      registrySearch: registryFilters.search,
      registryEnvironment: registryFilters.environment,
      registryStatus: registryFilters.status,
      registrySort: registryFilters.sort,
      mode: 'browse',
    }) as Route;
  }

  if (pathname === '/services') {
    const filters = resolveServicesFilterState(
      {
        projectId: searchParams.get('projectId'),
        search: searchParams.get('search'),
        category: searchParams.get('category'),
        environment: searchParams.get('environment'),
        status: searchParams.get('status'),
        sort: searchParams.get('sort'),
      },
      availableProjectIds,
    );

    return buildServicesHref({
      projectId: project.id,
      search: filters.search,
      category: filters.category,
      environment: filters.environment,
      status: filters.status,
      sort: filters.sort,
    }) as Route;
  }

  if (pathname === '/integrations') {
    const filters = resolveIntegrationsFilterState(
      {
        projectId: searchParams.get('projectId'),
        search: searchParams.get('search'),
        environment: searchParams.get('environment'),
        status: searchParams.get('status'),
        coverage: searchParams.get('coverage'),
        sort: searchParams.get('sort'),
        inventorySearch: searchParams.get('inventorySearch'),
        inventoryArea: searchParams.get('inventoryArea'),
        inventorySecurity: searchParams.get('inventorySecurity'),
      },
      availableProjectIds,
    );

    return buildIntegrationsHref({
      projectId: project.id,
      search: filters.search,
      environment: filters.environment,
      status: filters.status,
      coverage: filters.coverage,
      sort: filters.sort,
      inventorySearch: filters.inventorySearch,
      inventoryArea: filters.inventoryArea,
      inventorySecurity: filters.inventorySecurity,
    }) as Route;
  }

  if (pathname === '/environments') {
    const filters = resolveEnvironmentsFilterState({
      search: searchParams.get('search'),
      environment: searchParams.get('environment'),
      status: searchParams.get('status'),
      sort: searchParams.get('sort'),
    });

    return buildEnvironmentsHref({
      search: filters.search,
      environment: project.environment,
      status: filters.status,
      sort: filters.sort,
    }) as Route;
  }

  return null;
}
