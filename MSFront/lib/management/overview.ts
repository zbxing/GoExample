import type {
  ManagedProject,
  ManagementActivitySignal,
  ManagementAlertSignal,
  ManagementOverview,
  ManagementPortfolioSummary,
  ManagedProjectServer,
  ProjectStatus,
} from '@/lib/types/management';

const highSeverityThresholds = {
  errorRate: 1.5,
  cpuUsage: 85,
  memoryUsage: 88,
  responseTimeMs: 320,
  staleDeployDays: 14,
};

const mediumSeverityThresholds = {
  errorRate: 0.8,
  cpuUsage: 70,
  memoryUsage: 75,
  responseTimeMs: 220,
};

export function buildManagementOverview(projects: ManagedProject[]): ManagementOverview {
  const summaryDraft = createSummaryDraft(projects);
  const alerts = buildAlertSignals(projects).slice(0, 6);
  const activity = buildActivitySignals(projects).slice(0, 6);

  const summary: ManagementPortfolioSummary = {
    ...summaryDraft,
    totalAlerts: alerts.length,
    highSeverityAlerts: alerts.filter((alert) => alert.severity === 'high').length,
    mediumSeverityAlerts: alerts.filter((alert) => alert.severity === 'medium').length,
  };

  return {
    summary,
    alerts,
    activity,
  };
}

function createSummaryDraft(projects: ManagedProject[]) {
  const allServers = projects.flatMap((project) => project.servers);
  const totalErrorRate = projects.reduce((sum, project) => sum + project.errorRate, 0);

  return {
    totalProjects: projects.length,
    healthyProjects: countByStatus(projects.map((project) => project.status), 'healthy'),
    warningProjects: countByStatus(projects.map((project) => project.status), 'warning'),
    criticalProjects: countByStatus(projects.map((project) => project.status), 'critical'),
    productionProjects: projects.filter((project) => project.environment === 'production').length,
    stagingProjects: projects.filter((project) => project.environment === 'staging').length,
    developmentProjects: projects.filter((project) => project.environment === 'development').length,
    totalServers: allServers.length,
    healthyServers: countByStatus(allServers.map((server) => server.status), 'healthy'),
    warningServers: countByStatus(allServers.map((server) => server.status), 'warning'),
    criticalServers: countByStatus(allServers.map((server) => server.status), 'critical'),
    totalActiveUsers: projects.reduce((sum, project) => sum + project.activeUsers, 0),
    totalRequestPerMinute: projects.reduce((sum, project) => sum + project.requestPerMinute, 0),
    averageErrorRate: projects.length > 0 ? totalErrorRate / projects.length : 0,
    ownerCount: new Set(projects.map((project) => project.owner)).size,
    regionCount: new Set(projects.map((project) => project.region)).size,
    totalAlerts: 0,
    highSeverityAlerts: 0,
    mediumSeverityAlerts: 0,
  };
}

function buildAlertSignals(projects: ManagedProject[]) {
  const now = Date.now();
  const alerts: ManagementAlertSignal[] = [];

  for (const project of projects) {
    if (project.status === 'critical') {
      alerts.push({
        id: `${project.id}:critical-project`,
        code: 'critical-project',
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        owner: project.owner,
        region: project.region,
        severity: 'high',
        timestamp: project.lastDeployedAt,
      });
    } else if (project.status === 'warning') {
      alerts.push({
        id: `${project.id}:warning-project`,
        code: 'warning-project',
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        owner: project.owner,
        region: project.region,
        severity: 'medium',
        timestamp: project.lastDeployedAt,
      });
    }

    if (project.errorRate >= highSeverityThresholds.errorRate) {
      alerts.push({
        id: `${project.id}:elevated-error-rate:high`,
        code: 'elevated-error-rate',
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        owner: project.owner,
        region: project.region,
        errorRate: project.errorRate,
        severity: 'high',
        timestamp: project.lastDeployedAt,
      });
    } else if (project.errorRate >= mediumSeverityThresholds.errorRate) {
      alerts.push({
        id: `${project.id}:elevated-error-rate:medium`,
        code: 'elevated-error-rate',
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        owner: project.owner,
        region: project.region,
        errorRate: project.errorRate,
        severity: 'medium',
        timestamp: project.lastDeployedAt,
      });
    }

    const hottestServer = findHottestServer(project.servers);

    if (hottestServer) {
      const severity = resolveServerPressureSeverity(hottestServer);

      if (severity) {
        alerts.push({
          id: `${project.id}:server-pressure:${hottestServer.id}`,
          code: 'server-pressure',
          projectId: project.id,
          projectName: project.name,
          environment: project.environment,
          owner: project.owner,
          region: project.region,
          serverName: hottestServer.name,
          cpuUsage: hottestServer.cpuUsage,
          memoryUsage: hottestServer.memoryUsage,
          responseTimeMs: hottestServer.responseTimeMs,
          severity,
          timestamp: project.lastDeployedAt,
        });
      }
    }

    const daysSinceDeploy = Math.floor((now - new Date(project.lastDeployedAt).valueOf()) / 86_400_000);

    if (project.environment === 'production' && daysSinceDeploy >= highSeverityThresholds.staleDeployDays) {
      alerts.push({
        id: `${project.id}:stale-production-deploy`,
        code: 'stale-production-deploy',
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        owner: project.owner,
        region: project.region,
        daysSinceDeploy,
        severity: 'low',
        timestamp: project.lastDeployedAt,
      });
    }
  }

  return alerts.sort((left, right) => {
    const severityRank = rankSeverity(right.severity) - rankSeverity(left.severity);

    if (severityRank !== 0) {
      return severityRank;
    }

    return new Date(right.timestamp).valueOf() - new Date(left.timestamp).valueOf();
  });
}

function buildActivitySignals(projects: ManagedProject[]) {
  const recentDeploy = [...projects]
    .sort((left, right) => new Date(right.lastDeployedAt).valueOf() - new Date(left.lastDeployedAt).valueOf())
    .slice(0, 2)
    .map<ManagementActivitySignal>((project) => ({
      id: `${project.id}:recent-deploy`,
      code: 'recent-deploy',
      projectId: project.id,
      projectName: project.name,
      environment: project.environment,
      owner: project.owner,
      region: project.region,
      actor: 'release-radar',
      timestamp: project.lastDeployedAt,
    }));

  const highestTrafficProject = [...projects].sort(
    (left, right) => right.requestPerMinute - left.requestPerMinute,
  )[0];

  const healthiestServiceMesh = [...projects].sort((left, right) => {
    const leftScore = healthScore(left);
    const rightScore = healthScore(right);
    return rightScore - leftScore;
  })[0];

  const largestServerFootprint = [...projects].sort(
    (left, right) => right.servers.length - left.servers.length || right.requestPerMinute - left.requestPerMinute,
  )[0];

  const activity = [...recentDeploy];

  if (highestTrafficProject) {
    activity.push({
      id: `${highestTrafficProject.id}:highest-traffic`,
      code: 'highest-traffic',
      projectId: highestTrafficProject.id,
      projectName: highestTrafficProject.name,
      environment: highestTrafficProject.environment,
      owner: highestTrafficProject.owner,
      region: highestTrafficProject.region,
      actor: 'traffic-monitor',
      requestPerMinute: highestTrafficProject.requestPerMinute,
      activeUsers: highestTrafficProject.activeUsers,
      timestamp: highestTrafficProject.lastDeployedAt,
    });
  }

  if (healthiestServiceMesh) {
    const healthyServiceCount = healthiestServiceMesh.services.filter(
      (service) => service.status === 'healthy',
    ).length;

    activity.push({
      id: `${healthiestServiceMesh.id}:healthiest-service-mesh`,
      code: 'healthiest-service-mesh',
      projectId: healthiestServiceMesh.id,
      projectName: healthiestServiceMesh.name,
      environment: healthiestServiceMesh.environment,
      owner: healthiestServiceMesh.owner,
      region: healthiestServiceMesh.region,
      actor: 'service-lens',
      healthyServiceCount,
      totalServiceCount: healthiestServiceMesh.services.length,
      timestamp: healthiestServiceMesh.lastDeployedAt,
    });
  }

  if (largestServerFootprint) {
    activity.push({
      id: `${largestServerFootprint.id}:largest-server-footprint`,
      code: 'largest-server-footprint',
      projectId: largestServerFootprint.id,
      projectName: largestServerFootprint.name,
      environment: largestServerFootprint.environment,
      owner: largestServerFootprint.owner,
      region: largestServerFootprint.region,
      actor: 'topology-lens',
      serverCount: largestServerFootprint.servers.length,
      timestamp: largestServerFootprint.lastDeployedAt,
    });
  }

  return Array.from(new Map(activity.map((item) => [item.id, item])).values()).sort(
    (left, right) => new Date(right.timestamp).valueOf() - new Date(left.timestamp).valueOf(),
  );
}

function countByStatus(statuses: ProjectStatus[], targetStatus: ProjectStatus) {
  return statuses.filter((status) => status === targetStatus).length;
}

function findHottestServer(servers: ManagedProjectServer[]) {
  return [...servers].sort((left, right) => serverPressureScore(right) - serverPressureScore(left))[0];
}

function resolveServerPressureSeverity(server: ManagedProjectServer) {
  if (
    server.cpuUsage >= highSeverityThresholds.cpuUsage ||
    server.memoryUsage >= highSeverityThresholds.memoryUsage ||
    server.responseTimeMs >= highSeverityThresholds.responseTimeMs ||
    server.status === 'critical'
  ) {
    return 'high' as const;
  }

  if (
    server.cpuUsage >= mediumSeverityThresholds.cpuUsage ||
    server.memoryUsage >= mediumSeverityThresholds.memoryUsage ||
    server.responseTimeMs >= mediumSeverityThresholds.responseTimeMs ||
    server.status === 'warning'
  ) {
    return 'medium' as const;
  }

  return null;
}

function serverPressureScore(server: ManagedProjectServer) {
  return server.cpuUsage + server.memoryUsage + server.responseTimeMs / 10;
}

function healthScore(project: ManagedProject) {
  const healthyServices = project.services.filter((service) => service.status === 'healthy').length;
  const healthyServers = project.servers.filter((server) => server.status === 'healthy').length;
  const statusBonus = project.status === 'healthy' ? 4 : project.status === 'warning' ? 2 : 0;
  return healthyServices * 3 + healthyServers * 2 + statusBonus - project.errorRate;
}

function rankSeverity(severity: 'high' | 'medium' | 'low') {
  if (severity === 'high') {
    return 3;
  }

  if (severity === 'medium') {
    return 2;
  }

  return 1;
}
