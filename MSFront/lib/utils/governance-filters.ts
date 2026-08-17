import type { Route } from 'next';
import type {
  ApiInventoryArea,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';

export type ServiceSortMode = 'risk' | 'traffic' | 'name';
export type ProjectSortMode = 'risk' | 'traffic' | 'deploy' | 'name';
export type EnvironmentSortMode = 'risk' | 'traffic' | 'deploy' | 'name';
export type ProbeCoverageFilter = 'all' | 'ready' | 'missing';
export type EndpointSortMode = 'risk' | 'traffic' | 'name';
export type InventorySecurityFilter = 'all' | 'secured' | 'unsecured';
export type ProjectsRegistryMode = 'browse' | 'create';

export interface ProjectsPortfolioFilterState {
  search: string;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  sort: ProjectSortMode;
}

export interface ProjectsRegistryFilterState {
  projectId: string;
  search: string;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  sort: ProjectSortMode;
  mode: ProjectsRegistryMode;
}

export interface ServicesFilterState {
  projectId: string;
  search: string;
  category: 'all' | ManagedServiceCategory;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  sort: ServiceSortMode;
}

export interface EnvironmentsFilterState {
  search: string;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  sort: EnvironmentSortMode;
}

export interface IntegrationsFilterState {
  projectId: string;
  search: string;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  coverage: ProbeCoverageFilter;
  sort: EndpointSortMode;
  inventorySearch: string;
  inventoryArea: 'all' | ApiInventoryArea;
  inventorySecurity: InventorySecurityFilter;
}

interface BuildServicesHrefOptions {
  projectId?: string;
  search?: string;
  category?: 'all' | ManagedServiceCategory;
  environment?: 'all' | ProjectEnvironment;
  status?: 'all' | ProjectStatus;
  sort?: ServiceSortMode;
}

interface BuildEnvironmentsHrefOptions {
  search?: string;
  environment?: 'all' | ProjectEnvironment;
  status?: 'all' | ProjectStatus;
  sort?: EnvironmentSortMode;
}

interface BuildProjectsHrefOptions {
  portfolioSearch?: string;
  portfolioEnvironment?: 'all' | ProjectEnvironment;
  portfolioStatus?: 'all' | ProjectStatus;
  portfolioSort?: ProjectSortMode;
  projectId?: string;
  registrySearch?: string;
  registryEnvironment?: 'all' | ProjectEnvironment;
  registryStatus?: 'all' | ProjectStatus;
  registrySort?: ProjectSortMode;
  mode?: ProjectsRegistryMode;
}

interface BuildDashboardHrefOptions {
  portfolioSearch?: string;
  portfolioEnvironment?: 'all' | ProjectEnvironment;
  portfolioStatus?: 'all' | ProjectStatus;
  portfolioSort?: ProjectSortMode;
}

interface BuildIntegrationsHrefOptions {
  projectId?: string;
  search?: string;
  environment?: 'all' | ProjectEnvironment;
  status?: 'all' | ProjectStatus;
  coverage?: ProbeCoverageFilter;
  sort?: EndpointSortMode;
  inventorySearch?: string;
  inventoryArea?: 'all' | ApiInventoryArea;
  inventorySecurity?: InventorySecurityFilter;
}

const projectEnvironmentFilters = new Set<'all' | ProjectEnvironment>([
  'all',
  'production',
  'staging',
  'development',
]);

const projectStatusFilters = new Set<'all' | ProjectStatus>([
  'all',
  'healthy',
  'warning',
  'critical',
]);

const managedServiceCategoryFilters = new Set<'all' | ManagedServiceCategory>([
  'all',
  'api',
  'worker',
  'queue',
  'storage',
  'database',
]);

const serviceSortModes = new Set<ServiceSortMode>(['risk', 'traffic', 'name']);
const projectSortModes = new Set<ProjectSortMode>(['risk', 'traffic', 'deploy', 'name']);
const environmentSortModes = new Set<EnvironmentSortMode>([
  'risk',
  'traffic',
  'deploy',
  'name',
]);
const endpointSortModes = new Set<EndpointSortMode>(['risk', 'traffic', 'name']);
const probeCoverageFilters = new Set<ProbeCoverageFilter>(['all', 'ready', 'missing']);
const apiInventoryAreaFilters = new Set<'all' | ApiInventoryArea>([
  'all',
  'auth',
  'example',
  'platform',
  'other',
]);
const inventorySecurityFilters = new Set<InventorySecurityFilter>([
  'all',
  'secured',
  'unsecured',
]);
const projectsRegistryModes = new Set<ProjectsRegistryMode>(['browse', 'create']);

export function normalizeGovernanceSearch(value?: string | null) {
  return `${value ?? ''}`.trim();
}

export function resolveScopedProjectId(
  availableProjectIds: readonly string[],
  value?: string | null,
) {
  const normalizedValue = `${value ?? ''}`.trim();

  if (normalizedValue && availableProjectIds.includes(normalizedValue)) {
    return normalizedValue;
  }

  return '';
}

export function resolveProjectEnvironmentFilter(value?: string | null): 'all' | ProjectEnvironment {
  const normalizedValue = `${value ?? ''}`.trim();

  if (projectEnvironmentFilters.has(normalizedValue as 'all' | ProjectEnvironment)) {
    return normalizedValue as 'all' | ProjectEnvironment;
  }

  return 'all';
}

export function resolveProjectStatusFilter(value?: string | null): 'all' | ProjectStatus {
  const normalizedValue = `${value ?? ''}`.trim();

  if (projectStatusFilters.has(normalizedValue as 'all' | ProjectStatus)) {
    return normalizedValue as 'all' | ProjectStatus;
  }

  return 'all';
}

export function resolveManagedServiceCategoryFilter(
  value?: string | null,
): 'all' | ManagedServiceCategory {
  const normalizedValue = `${value ?? ''}`.trim();

  if (managedServiceCategoryFilters.has(normalizedValue as 'all' | ManagedServiceCategory)) {
    return normalizedValue as 'all' | ManagedServiceCategory;
  }

  return 'all';
}

export function resolveServiceSortMode(value?: string | null): ServiceSortMode {
  const normalizedValue = `${value ?? ''}`.trim();

  if (serviceSortModes.has(normalizedValue as ServiceSortMode)) {
    return normalizedValue as ServiceSortMode;
  }

  return 'risk';
}

export function resolveProjectSortMode(value?: string | null): ProjectSortMode {
  const normalizedValue = `${value ?? ''}`.trim();

  if (projectSortModes.has(normalizedValue as ProjectSortMode)) {
    return normalizedValue as ProjectSortMode;
  }

  return 'risk';
}

export function resolveEnvironmentSortMode(value?: string | null): EnvironmentSortMode {
  const normalizedValue = `${value ?? ''}`.trim();

  if (environmentSortModes.has(normalizedValue as EnvironmentSortMode)) {
    return normalizedValue as EnvironmentSortMode;
  }

  return 'risk';
}

export function resolveEndpointSortMode(value?: string | null): EndpointSortMode {
  const normalizedValue = `${value ?? ''}`.trim();

  if (endpointSortModes.has(normalizedValue as EndpointSortMode)) {
    return normalizedValue as EndpointSortMode;
  }

  return 'risk';
}

export function resolveProbeCoverageFilter(value?: string | null): ProbeCoverageFilter {
  const normalizedValue = `${value ?? ''}`.trim();

  if (probeCoverageFilters.has(normalizedValue as ProbeCoverageFilter)) {
    return normalizedValue as ProbeCoverageFilter;
  }

  return 'all';
}

export function resolveApiInventoryAreaFilter(
  value?: string | null,
): 'all' | ApiInventoryArea {
  const normalizedValue = `${value ?? ''}`.trim();

  if (apiInventoryAreaFilters.has(normalizedValue as 'all' | ApiInventoryArea)) {
    return normalizedValue as 'all' | ApiInventoryArea;
  }

  return 'all';
}

export function resolveInventorySecurityFilter(
  value?: string | null,
): InventorySecurityFilter {
  const normalizedValue = `${value ?? ''}`.trim();

  if (inventorySecurityFilters.has(normalizedValue as InventorySecurityFilter)) {
    return normalizedValue as InventorySecurityFilter;
  }

  return 'all';
}

export function resolveProjectsRegistryMode(value?: string | null): ProjectsRegistryMode {
  const normalizedValue = `${value ?? ''}`.trim();

  if (projectsRegistryModes.has(normalizedValue as ProjectsRegistryMode)) {
    return normalizedValue as ProjectsRegistryMode;
  }

  return 'browse';
}

export function resolveProjectsPortfolioFilterState(values: {
  portfolioSearch?: string | null;
  portfolioEnvironment?: string | null;
  environment?: string | null;
  portfolioStatus?: string | null;
  portfolioSort?: string | null;
}): ProjectsPortfolioFilterState {
  return {
    search: normalizeGovernanceSearch(values.portfolioSearch),
    environment: resolveProjectEnvironmentFilter(
      values.portfolioEnvironment ?? values.environment,
    ),
    status: resolveProjectStatusFilter(values.portfolioStatus),
    sort: resolveProjectSortMode(values.portfolioSort),
  };
}

export function resolveProjectsRegistryFilterState(
  values: {
    projectId?: string | null;
    registrySearch?: string | null;
    registryEnvironment?: string | null;
    registryStatus?: string | null;
    registrySort?: string | null;
    mode?: string | null;
  },
  availableProjectIds: readonly string[],
): ProjectsRegistryFilterState {
  const mode = resolveProjectsRegistryMode(values.mode);

  return {
    projectId:
      mode === 'create' ? '' : resolveScopedProjectId(availableProjectIds, values.projectId),
    search: normalizeGovernanceSearch(values.registrySearch),
    environment: resolveProjectEnvironmentFilter(values.registryEnvironment),
    status: resolveProjectStatusFilter(values.registryStatus),
    sort: resolveProjectSortMode(values.registrySort),
    mode,
  };
}

export function resolveServicesFilterState(
  values: {
    projectId?: string | null;
    search?: string | null;
    category?: string | null;
    environment?: string | null;
    status?: string | null;
    sort?: string | null;
  },
  availableProjectIds: readonly string[],
): ServicesFilterState {
  return {
    projectId: resolveScopedProjectId(availableProjectIds, values.projectId),
    search: normalizeGovernanceSearch(values.search),
    category: resolveManagedServiceCategoryFilter(values.category),
    environment: resolveProjectEnvironmentFilter(values.environment),
    status: resolveProjectStatusFilter(values.status),
    sort: resolveServiceSortMode(values.sort),
  };
}

export function resolveEnvironmentsFilterState(values: {
  search?: string | null;
  environment?: string | null;
  status?: string | null;
  sort?: string | null;
}): EnvironmentsFilterState {
  return {
    search: normalizeGovernanceSearch(values.search),
    environment: resolveProjectEnvironmentFilter(values.environment),
    status: resolveProjectStatusFilter(values.status),
    sort: resolveEnvironmentSortMode(values.sort),
  };
}

export function resolveIntegrationsFilterState(
  values: {
    projectId?: string | null;
    search?: string | null;
    environment?: string | null;
    status?: string | null;
    coverage?: string | null;
    sort?: string | null;
    inventorySearch?: string | null;
    inventoryArea?: string | null;
    inventorySecurity?: string | null;
  },
  availableProjectIds: readonly string[],
): IntegrationsFilterState {
  return {
    projectId: resolveScopedProjectId(availableProjectIds, values.projectId),
    search: normalizeGovernanceSearch(values.search),
    environment: resolveProjectEnvironmentFilter(values.environment),
    status: resolveProjectStatusFilter(values.status),
    coverage: resolveProbeCoverageFilter(values.coverage),
    sort: resolveEndpointSortMode(values.sort),
    inventorySearch: normalizeGovernanceSearch(values.inventorySearch),
    inventoryArea: resolveApiInventoryAreaFilter(values.inventoryArea),
    inventorySecurity: resolveInventorySecurityFilter(values.inventorySecurity),
  };
}

export function buildServicesHref({
  projectId,
  search,
  category = 'all',
  environment = 'all',
  status = 'all',
  sort = 'risk',
}: BuildServicesHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedProjectId = `${projectId ?? ''}`.trim();
  const normalizedSearch = normalizeGovernanceSearch(search);

  if (normalizedProjectId) {
    params.set('projectId', normalizedProjectId);
  }

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  if (category !== 'all') {
    params.set('category', category);
  }

  if (environment !== 'all') {
    params.set('environment', environment);
  }

  if (status !== 'all') {
    params.set('status', status);
  }

  if (sort !== 'risk') {
    params.set('sort', sort);
  }

  const query = params.toString();

  return query ? `/services?${query}` : '/services';
}

export function buildEnvironmentsHref({
  search,
  environment = 'all',
  status = 'all',
  sort = 'risk',
}: BuildEnvironmentsHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedSearch = normalizeGovernanceSearch(search);

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  if (environment !== 'all') {
    params.set('environment', environment);
  }

  if (status !== 'all') {
    params.set('status', status);
  }

  if (sort !== 'risk') {
    params.set('sort', sort);
  }

  const query = params.toString();

  return query ? `/environments?${query}` : '/environments';
}

export function buildProjectDetailHref(projectId?: string | null): Route {
  const normalizedProjectId = `${projectId ?? ''}`.trim();

  if (!normalizedProjectId) {
    return '/projects';
  }

  return `/projects/${encodeURIComponent(normalizedProjectId)}` as Route;
}

export function buildProjectsHref({
  portfolioSearch,
  portfolioEnvironment = 'all',
  portfolioStatus = 'all',
  portfolioSort = 'risk',
  projectId,
  registrySearch,
  registryEnvironment = 'all',
  registryStatus = 'all',
  registrySort = 'risk',
  mode = 'browse',
}: BuildProjectsHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedProjectId = `${projectId ?? ''}`.trim();
  const normalizedRegistrySearch = normalizeGovernanceSearch(registrySearch);

  appendProjectsPortfolioSearchParams(params, {
    portfolioSearch,
    portfolioEnvironment,
    portfolioStatus,
    portfolioSort,
  });

  if (normalizedProjectId && mode !== 'create') {
    params.set('projectId', normalizedProjectId);
  }

  if (normalizedRegistrySearch) {
    params.set('registrySearch', normalizedRegistrySearch);
  }

  if (registryEnvironment !== 'all') {
    params.set('registryEnvironment', registryEnvironment);
  }

  if (registryStatus !== 'all') {
    params.set('registryStatus', registryStatus);
  }

  if (registrySort !== 'risk') {
    params.set('registrySort', registrySort);
  }

  if (mode === 'create') {
    params.set('mode', mode);
  }

  const query = params.toString();

  return query ? `/projects?${query}` : '/projects';
}

export function buildDashboardHref({
  portfolioSearch,
  portfolioEnvironment = 'all',
  portfolioStatus = 'all',
  portfolioSort = 'risk',
}: BuildDashboardHrefOptions = {}) {
  const params = new URLSearchParams();

  appendProjectsPortfolioSearchParams(params, {
    portfolioSearch,
    portfolioEnvironment,
    portfolioStatus,
    portfolioSort,
  });

  const query = params.toString();

  return query ? `/dashboard?${query}` : '/dashboard';
}

export function buildIntegrationsHref({
  projectId,
  search,
  environment = 'all',
  status = 'all',
  coverage = 'all',
  sort = 'risk',
  inventorySearch,
  inventoryArea = 'all',
  inventorySecurity = 'all',
}: BuildIntegrationsHrefOptions = {}) {
  const params = new URLSearchParams();
  const normalizedProjectId = `${projectId ?? ''}`.trim();
  const normalizedSearch = normalizeGovernanceSearch(search);
  const normalizedInventorySearch = normalizeGovernanceSearch(inventorySearch);

  if (normalizedProjectId) {
    params.set('projectId', normalizedProjectId);
  }

  if (normalizedSearch) {
    params.set('search', normalizedSearch);
  }

  if (environment !== 'all') {
    params.set('environment', environment);
  }

  if (status !== 'all') {
    params.set('status', status);
  }

  if (coverage !== 'all') {
    params.set('coverage', coverage);
  }

  if (sort !== 'risk') {
    params.set('sort', sort);
  }

  if (normalizedInventorySearch) {
    params.set('inventorySearch', normalizedInventorySearch);
  }

  if (inventoryArea !== 'all') {
    params.set('inventoryArea', inventoryArea);
  }

  if (inventorySecurity !== 'all') {
    params.set('inventorySecurity', inventorySecurity);
  }

  const query = params.toString();

  return query ? `/integrations?${query}` : '/integrations';
}

function appendProjectsPortfolioSearchParams(
  params: URLSearchParams,
  {
    portfolioSearch,
    portfolioEnvironment = 'all',
    portfolioStatus = 'all',
    portfolioSort = 'risk',
  }: BuildDashboardHrefOptions,
) {
  const normalizedPortfolioSearch = normalizeGovernanceSearch(portfolioSearch);

  if (normalizedPortfolioSearch) {
    params.set('portfolioSearch', normalizedPortfolioSearch);
  }

  if (portfolioEnvironment !== 'all') {
    params.set('portfolioEnvironment', portfolioEnvironment);
  }

  if (portfolioStatus !== 'all') {
    params.set('portfolioStatus', portfolioStatus);
  }

  if (portfolioSort !== 'risk') {
    params.set('portfolioSort', portfolioSort);
  }
}
