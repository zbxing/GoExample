import type {
  ApiInventorySummary,
  EnvironmentGovernanceItem,
  IntegrationEndpointEntry,
  IntegrationsGovernanceView,
  ManagedProject,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
  ServiceCategorySummary,
  ServiceHealthEntry,
  ServicesGovernanceView,
} from '@/lib/types/management';

const serviceCategories: ManagedServiceCategory[] = [
  'api',
  'worker',
  'queue',
  'storage',
  'database',
];

const environments: ProjectEnvironment[] = ['production', 'staging', 'development'];

export function buildServicesGovernanceView(projects: ManagedProject[]): ServicesGovernanceView {
  const services = projects.flatMap<ServiceHealthEntry>((project) =>
    project.services.map((service) => ({
      id: `${project.id}:${service.id}`,
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      version: project.version,
      name: service.name,
      category: service.category,
      status: service.status,
      uptime: service.uptime,
      environment: project.environment,
      owner: project.owner,
      region: project.region,
      activeUsers: project.activeUsers,
      requestPerMinute: project.requestPerMinute,
      serverCount: project.servers.length,
    })),
  );

  const categorySummary = serviceCategories.map<ServiceCategorySummary>((category) => {
    const categoryServices = services.filter((service) => service.category === category);

    return {
      category,
      totalServices: categoryServices.length,
      healthyServices: countByStatus(categoryServices.map((service) => service.status), 'healthy'),
      warningServices: countByStatus(categoryServices.map((service) => service.status), 'warning'),
      criticalServices: countByStatus(categoryServices.map((service) => service.status), 'critical'),
      productionServices: categoryServices.filter((service) => service.environment === 'production')
        .length,
      stagingServices: categoryServices.filter((service) => service.environment === 'staging').length,
      developmentServices: categoryServices.filter(
        (service) => service.environment === 'development',
      ).length,
    };
  });

  return {
    services,
    categorySummary,
  };
}

export function buildEnvironmentGovernanceView(projects: ManagedProject[]) {
  return environments.map<EnvironmentGovernanceItem>((environment) => {
    const environmentProjects = projects.filter((project) => project.environment === environment);
    const allServers = environmentProjects.flatMap((project) => project.servers);
    const allServices = environmentProjects.flatMap((project) => project.services);
    const totalErrorRate = environmentProjects.reduce((sum, project) => sum + project.errorRate, 0);
    const latestDeployAt = environmentProjects
      .map((project) => project.lastDeployedAt)
      .sort((left, right) => new Date(right).valueOf() - new Date(left).valueOf())[0] ?? null;

    return {
      environment,
      projectCount: environmentProjects.length,
      healthyProjects: countByStatus(environmentProjects.map((project) => project.status), 'healthy'),
      warningProjects: countByStatus(environmentProjects.map((project) => project.status), 'warning'),
      criticalProjects: countByStatus(
        environmentProjects.map((project) => project.status),
        'critical',
      ),
      totalServers: allServers.length,
      totalServices: allServices.length,
      totalActiveUsers: environmentProjects.reduce((sum, project) => sum + project.activeUsers, 0),
      totalRequestPerMinute: environmentProjects.reduce(
        (sum, project) => sum + project.requestPerMinute,
        0,
      ),
      averageErrorRate:
        environmentProjects.length > 0 ? totalErrorRate / environmentProjects.length : 0,
      ownerCoverage: Array.from(new Set(environmentProjects.map((project) => project.owner))).sort(),
      regionCoverage: Array.from(new Set(environmentProjects.map((project) => project.region))).sort(),
      latestDeployAt,
      projects: [...environmentProjects].sort((left, right) => {
        const statusRank = statusWeight(right.status) - statusWeight(left.status);

        if (statusRank !== 0) {
          return statusRank;
        }

        return right.requestPerMinute - left.requestPerMinute;
      }),
    };
  });
}

export function buildIntegrationsGovernanceView(
  projects: ManagedProject[],
  inventory: ApiInventorySummary | null,
): IntegrationsGovernanceView {
  const endpoints = [...projects]
    .sort((left, right) => {
      const statusRank = statusWeight(right.status) - statusWeight(left.status);

      if (statusRank !== 0) {
        return statusRank;
      }

      return right.requestPerMinute - left.requestPerMinute;
    })
    .map<IntegrationEndpointEntry>((project) => ({
      id: project.id,
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      environment: project.environment,
      status: project.status,
      baseUrl: project.baseUrl,
      apiBaseUrl: project.apiBaseUrl,
      probeBaseUrl: project.probeBaseUrl ?? null,
      owner: project.owner,
      region: project.region,
      tags: project.tags,
      activeUsers: project.activeUsers,
      requestPerMinute: project.requestPerMinute,
      serverCount: project.servers.length,
      serviceCount: project.services.length,
      version: project.version,
    }));

  const summary = {
    totalEndpoints: endpoints.length,
    productionEndpoints: endpoints.filter((endpoint) => endpoint.environment === 'production').length,
    attentionEndpoints: endpoints.filter((endpoint) => endpoint.status !== 'healthy').length,
    probeReadyEndpoints: endpoints.filter((endpoint) => Boolean(endpoint.probeBaseUrl)).length,
    uniqueOwners: new Set(endpoints.map((endpoint) => endpoint.owner)).size,
    uniqueRegions: new Set(endpoints.map((endpoint) => endpoint.region)).size,
  };

  return {
    endpoints,
    summary,
    inventory,
  };
}

function countByStatus(statuses: ProjectStatus[], targetStatus: ProjectStatus) {
  return statuses.filter((status) => status === targetStatus).length;
}

function statusWeight(status: ProjectStatus) {
  if (status === 'critical') {
    return 3;
  }

  if (status === 'warning') {
    return 2;
  }

  return 1;
}
