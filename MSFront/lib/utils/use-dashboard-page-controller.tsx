'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { buildBackendRuntimeSummary } from '@/lib/management/runtime';
import type {
  LocaleCode,
  ManagedProject,
  ManagementActivitySignal,
  ManagementAlertSignal,
  ManagementBackendProbe,
  ManagementOverview,
  OverviewMetric,
  SecurityGovernanceView,
  TimelineItem,
} from '@/lib/types/management';
import {
  formatNumber,
  formatPercent,
  humanizeIdentifier,
} from '@/lib/utils/format';
import {
  calculateProjectRiskScore,
  projectNeedsAttention,
} from '@/lib/utils/project-surface';
import { buildSecurityHref } from '@/lib/utils/security-filters';
import {
  buildSecurityExposureSignals,
  buildSecurityOverviewMetrics,
  resolveSecuritySourceBadge,
} from '@/lib/utils/security-surface';
import { useDashboardPagePresentationController } from '@/lib/utils/use-dashboard-page-presentation-controller';
import { buildSecurityOverviewPanelProps } from '@/lib/utils/use-security-governance-surface-presentation-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseDashboardPageControllerOptions {
  overview: ManagementOverview & {
    backend: ManagementBackendProbe;
  };
  projects: ManagedProject[];
  security: SecurityGovernanceView;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useDashboardPageController({
  overview,
  projects,
  security,
  locale,
  t,
}: UseDashboardPageControllerOptions) {
  const securitySummary = security.summary;
  const metrics = useMemo<OverviewMetric[]>(() => {
    const summary = overview.summary;

    return [
      {
        id: 'projects',
        label: t('dashboard.metrics.projectsLabel'),
        value: formatNumber(summary.totalProjects, locale),
        delta: t('dashboard.metrics.projectsDelta', {
          production: formatNumber(summary.productionProjects, locale),
          staging: formatNumber(summary.stagingProjects, locale),
          development: formatNumber(summary.developmentProjects, locale),
        }),
        trend: 'up',
      },
      {
        id: 'servers',
        label: t('dashboard.metrics.serversLabel'),
        value: `${formatNumber(summary.healthyServers, locale)} / ${formatNumber(summary.totalServers, locale)}`,
        delta: t('dashboard.metrics.serversDelta', {
          warning: formatNumber(summary.warningServers, locale),
          critical: formatNumber(summary.criticalServers, locale),
        }),
        trend:
          summary.criticalServers > 0 ? 'down' : summary.warningServers > 0 ? 'steady' : 'up',
      },
      {
        id: 'traffic',
        label: t('dashboard.metrics.trafficLabel'),
        value: formatNumber(summary.totalRequestPerMinute, locale),
        delta: t('dashboard.metrics.trafficDelta', {
          activeUsers: formatNumber(summary.totalActiveUsers, locale),
        }),
        trend: summary.totalRequestPerMinute > 0 ? 'up' : 'steady',
      },
      {
        id: 'alerts',
        label: t('dashboard.metrics.alertsLabel'),
        value: formatNumber(summary.totalAlerts, locale),
        delta: t('dashboard.metrics.alertsDelta', {
          high: formatNumber(summary.highSeverityAlerts, locale),
          medium: formatNumber(summary.mediumSeverityAlerts, locale),
        }),
        trend:
          summary.highSeverityAlerts > 0 ? 'down' : summary.totalAlerts > 0 ? 'steady' : 'up',
      },
    ];
  }, [locale, overview.summary, t]);
  const alertItems = useMemo<TimelineItem[]>(
    () => overview.alerts.map((signal) => mapAlertSignal(signal, t, locale)),
    [locale, overview.alerts, t],
  );
  const activityItems = useMemo<TimelineItem[]>(
    () => overview.activity.map((signal) => mapActivitySignal(signal, t, locale)),
    [locale, overview.activity, t],
  );
  const backendRuntime = useMemo(
    () => buildBackendRuntimeSummary(overview.backend, locale, t),
    [locale, overview.backend, t],
  );
  const attentionProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => projectNeedsAttention(project))
        .sort(compareProjectsByRiskThenTraffic),
    [projects],
  );
  const priorityProject = attentionProjects[0] ?? null;
  const highestTrafficProject = useMemo(
    () => [...projects].sort(compareProjectsByTrafficThenRisk)[0] ?? null,
    [projects],
  );
  const latestDeployProject = useMemo(
    () => [...projects].sort(compareProjectsByLatestDeploy)[0] ?? null,
    [projects],
  );
  const {
    commandCenterSummaryCards,
    commandCenterTags,
    spotlightCards,
  } = useDashboardPagePresentationController({
    overview,
    attentionProjectsCount: attentionProjects.length,
    priorityProject,
    highestTrafficProject,
    latestDeployProject,
    locale,
    t,
  });
  const securitySourceLabel = resolveSecuritySourceBadge(security.source, t, 'info');
  const securityCoverageDescription =
    security.source === 'database'
      ? t('dashboard.security.coverageDescriptionLive')
      : t('dashboard.security.coverageDescriptionUnavailable');
  const latestAuditEvent = security.auditEvents[0] ?? null;
  const securityOverviewMetrics = useMemo(
    () => buildSecurityOverviewMetrics(securitySummary, locale, t),
    [locale, securitySummary, t],
  );
  const securityCoverageMetrics = useMemo(
    () => [
      {
        label: t('labels.roles'),
        value: formatNumber(securitySummary.roleCount, locale),
      },
      {
        label: t('labels.permissions'),
        value: formatNumber(securitySummary.permissionCount, locale),
      },
      {
        label: t('dashboard.security.adminUsersLabel'),
        value: formatNumber(securitySummary.adminUsers, locale),
      },
      {
        label: t('dashboard.security.auditActorsLabel'),
        value: formatNumber(securitySummary.uniqueAuditActors, locale),
      },
    ],
    [
      locale,
      securitySummary.adminUsers,
      securitySummary.permissionCount,
      securitySummary.roleCount,
      securitySummary.uniqueAuditActors,
      t,
    ],
  );
  const securityExposureSignals = useMemo(
    () => buildSecurityExposureSignals(securitySummary, locale, t),
    [locale, securitySummary, t],
  );
  const securityOverviewPanelProps = useMemo(
    () =>
      buildSecurityOverviewPanelProps({
        t,
        locale,
        sourceBadge: securitySourceLabel,
        auditBadge: latestAuditEvent
          ? {
              label: humanizeIdentifier(latestAuditEvent.result),
              tone: toneFromAuditTone(latestAuditEvent.tone),
            }
          : null,
        summaryCards: securityOverviewMetrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          footnote: metric.delta,
        })),
        coverageDescription: securityCoverageDescription,
        coverageMetrics: securityCoverageMetrics,
        roleCoverages: security.roles,
        latestAuditEvent,
        roleHrefBuilder: (roleId) => buildSecurityHref({ focus: 'users', role: roleId }) as Route,
        emptyRoleTagLabel: t('dashboard.security.rolesEmpty'),
        riskSignals: securityExposureSignals,
        actions: (
          <>
            <Link href={'/security' as Route} className="secondaryButton">
              {t('dashboard.security.actions.openSecurity')}
              <ArrowRight size={14} />
            </Link>
            <Link href={'/users' as Route} className="secondaryButton">
              {t('dashboard.security.actions.manageUsers')}
              <ArrowRight size={14} />
            </Link>
            <Link href={'/roles' as Route} className="secondaryButton">
              {t('dashboard.security.actions.manageRoles')}
              <ArrowRight size={14} />
            </Link>
          </>
        ),
        riskDescriptionFallback: securityCoverageDescription,
      }),
    [
      latestAuditEvent,
      locale,
      security.roles,
      securityCoverageDescription,
      securityCoverageMetrics,
      securityExposureSignals,
      securityOverviewMetrics,
      securitySourceLabel,
      t,
    ],
  );

  return {
    activityItems,
    alertItems,
    backendRuntime,
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    securityOverviewPanelProps,
    spotlightCards,
  };
}

function compareProjectsByRiskThenTraffic(left: ManagedProject, right: ManagedProject) {
  return (
    calculateProjectRiskScore(right) - calculateProjectRiskScore(left) ||
    right.requestPerMinute - left.requestPerMinute
  );
}

function compareProjectsByTrafficThenRisk(left: ManagedProject, right: ManagedProject) {
  return (
    right.requestPerMinute - left.requestPerMinute ||
    calculateProjectRiskScore(right) - calculateProjectRiskScore(left)
  );
}

function compareProjectsByLatestDeploy(left: ManagedProject, right: ManagedProject) {
  return new Date(right.lastDeployedAt).valueOf() - new Date(left.lastDeployedAt).valueOf();
}

function toneFromAuditTone(tone: SecurityGovernanceView['auditEvents'][number]['tone']) {
  if (tone === 'high') {
    return 'danger' as const;
  }

  if (tone === 'medium') {
    return 'warning' as const;
  }

  if (tone === 'info') {
    return 'info' as const;
  }

  return 'success' as const;
}

function mapAlertSignal(
  signal: ManagementAlertSignal,
  t: TranslationFn,
  locale: LocaleCode,
): TimelineItem {
  const environmentLabel = t(`status.${signal.environment}`);
  const severityLabel = t(`dashboard.alerts.severity.${signal.severity}`);

  if (signal.code === 'critical-project') {
    return {
      id: signal.id,
      title: t('dashboard.alerts.criticalProjectTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.alerts.criticalProjectDescription', {
        projectName: signal.projectName,
        environment: environmentLabel,
      }),
      severity: signal.severity,
      tone: 'high',
      meta: severityLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  if (signal.code === 'warning-project') {
    return {
      id: signal.id,
      title: t('dashboard.alerts.warningProjectTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.alerts.warningProjectDescription', {
        projectName: signal.projectName,
        environment: environmentLabel,
      }),
      severity: signal.severity,
      tone: 'medium',
      meta: severityLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  if (signal.code === 'elevated-error-rate') {
    return {
      id: signal.id,
      title: t('dashboard.alerts.elevatedErrorRateTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.alerts.elevatedErrorRateDescription', {
        projectName: signal.projectName,
        errorRate: `${formatPercent(signal.errorRate ?? 0, locale)}%`,
      }),
      severity: signal.severity,
      tone: signal.severity === 'high' ? 'high' : 'medium',
      meta: severityLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  if (signal.code === 'server-pressure') {
    return {
      id: signal.id,
      title: t('dashboard.alerts.serverPressureTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.alerts.serverPressureDescription', {
        serverName: signal.serverName ?? signal.projectName,
        cpuUsage: formatNumber(signal.cpuUsage ?? 0, locale),
        memoryUsage: formatNumber(signal.memoryUsage ?? 0, locale),
        responseTimeMs: formatNumber(signal.responseTimeMs ?? 0, locale),
      }),
      severity: signal.severity,
      tone: signal.severity === 'high' ? 'high' : 'medium',
      meta: severityLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  return {
    id: signal.id,
    title: t('dashboard.alerts.staleDeployTitle', {
      projectName: signal.projectName,
    }),
    description: t('dashboard.alerts.staleDeployDescription', {
      projectName: signal.projectName,
      daysSinceDeploy: formatNumber(signal.daysSinceDeploy ?? 0, locale),
    }),
    severity: signal.severity,
    tone: 'low',
    meta: severityLabel,
    projectId: signal.projectId,
    timestamp: signal.timestamp,
  };
}

function mapActivitySignal(
  signal: ManagementActivitySignal,
  t: TranslationFn,
  locale: LocaleCode,
): TimelineItem {
  const actorLabel = t(`dashboard.activity.actors.${signal.actor}`);

  if (signal.code === 'recent-deploy') {
    return {
      id: signal.id,
      title: t('dashboard.activity.recentDeployTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.activity.recentDeployDescription', {
        projectName: signal.projectName,
        owner: signal.owner,
      }),
      severity: 'low',
      tone: 'info',
      meta: actorLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  if (signal.code === 'highest-traffic') {
    return {
      id: signal.id,
      title: t('dashboard.activity.highestTrafficTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.activity.highestTrafficDescription', {
        requestPerMinute: formatNumber(signal.requestPerMinute ?? 0, locale),
        activeUsers: formatNumber(signal.activeUsers ?? 0, locale),
      }),
      severity: 'low',
      tone: 'info',
      meta: actorLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  if (signal.code === 'healthiest-service-mesh') {
    return {
      id: signal.id,
      title: t('dashboard.activity.healthiestServiceMeshTitle', {
        projectName: signal.projectName,
      }),
      description: t('dashboard.activity.healthiestServiceMeshDescription', {
        healthyServices: formatNumber(signal.healthyServiceCount ?? 0, locale),
        totalServices: formatNumber(signal.totalServiceCount ?? 0, locale),
      }),
      severity: 'low',
      tone: 'info',
      meta: actorLabel,
      projectId: signal.projectId,
      timestamp: signal.timestamp,
    };
  }

  return {
    id: signal.id,
    title: t('dashboard.activity.largestServerFootprintTitle', {
      projectName: signal.projectName,
    }),
    description: t('dashboard.activity.largestServerFootprintDescription', {
      serverCount: formatNumber(signal.serverCount ?? 0, locale),
      region: signal.region,
    }),
    severity: 'low',
    tone: 'info',
    meta: actorLabel,
    projectId: signal.projectId,
    timestamp: signal.timestamp,
  };
}
