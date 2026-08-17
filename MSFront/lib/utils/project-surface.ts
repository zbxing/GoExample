import type { ManagedProject } from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';
import { joinDetails } from '@/lib/utils/format';

type ProjectRiskComparable = Pick<ManagedProject, 'status' | 'errorRate' | 'servers'>;

type ProjectIdentityComparable = Pick<ManagedProject, 'code' | 'owner' | 'region'>;

export function projectNeedsAttention(project: Pick<ManagedProject, 'status' | 'errorRate'>) {
  return project.status !== 'healthy' || project.errorRate >= 0.8;
}

export function calculateProjectRiskScore(project: ProjectRiskComparable) {
  const projectScore = project.status === 'critical' ? 12 : project.status === 'warning' ? 6 : 0;
  const serverScore = project.servers.reduce((sum, server) => {
    if (server.status === 'critical') {
      return sum + 5;
    }

    if (server.status === 'warning') {
      return sum + 2;
    }

    return sum;
  }, 0);

  return projectScore + serverScore + project.errorRate * 10;
}

export function compareProjectsBySortMode(
  left: ManagedProject,
  right: ManagedProject,
  sortMode: ProjectSortMode,
  locale: string,
) {
  if (sortMode === 'traffic') {
    return (
      right.requestPerMinute - left.requestPerMinute ||
      calculateProjectRiskScore(right) - calculateProjectRiskScore(left) ||
      left.name.localeCompare(right.name, locale)
    );
  }

  if (sortMode === 'deploy') {
    return (
      new Date(right.lastDeployedAt).valueOf() - new Date(left.lastDeployedAt).valueOf() ||
      calculateProjectRiskScore(right) - calculateProjectRiskScore(left) ||
      left.name.localeCompare(right.name, locale)
    );
  }

  if (sortMode === 'name') {
    return left.name.localeCompare(right.name, locale);
  }

  return (
    calculateProjectRiskScore(right) - calculateProjectRiskScore(left) ||
    right.requestPerMinute - left.requestPerMinute ||
    left.name.localeCompare(right.name, locale)
  );
}

export function sortProjectsBySortMode(
  projects: readonly ManagedProject[],
  sortMode: ProjectSortMode,
  locale: string,
) {
  return [...projects].sort((left, right) =>
    compareProjectsBySortMode(left, right, sortMode, locale),
  );
}

export function buildProjectIdentityMeta(project: ProjectIdentityComparable) {
  return joinDetails([project.code, project.owner, project.region]);
}
