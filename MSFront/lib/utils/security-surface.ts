'use client';

import type {
  LocaleCode,
  OverviewMetric,
  SecurityAuditEventEntry,
  SecurityOverviewSummary,
  TimelineItem,
} from '@/lib/types/management';
import {
  formatNumber,
  humanizeIdentifier,
} from '@/lib/utils/format';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

export interface SecuritySourceBadge {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

export interface SecurityCoverageMetric {
  id?: string;
  label: string;
  value: string;
}

export interface SecurityExposureSignal {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

export interface SecurityHeroPresentationModel {
  overviewMessage: string;
  sourceBadge: SecuritySourceBadge;
  metrics: OverviewMetric[];
  postureSummaryMetrics: SecurityCoverageMetric[];
  postureExposureSignals: SecurityExposureSignal[];
}

function resolveSecurityAuditSeverity(
  tone: SecurityAuditEventEntry['tone'],
): TimelineItem['severity'] {
  if (tone === 'high') {
    return 'high';
  }

  if (tone === 'medium') {
    return 'medium';
  }

  return 'low';
}

export function buildSecurityOverviewMetrics(
  summary: SecurityOverviewSummary,
  locale: LocaleCode,
  t: Translate,
): OverviewMetric[] {
  return [
    {
      id: 'access',
      label: t('security.metrics.accessLabel'),
      value: `${formatNumber(summary.activeUsers, locale)} / ${formatNumber(summary.totalUsers, locale)}`,
      delta: t('security.metrics.accessDelta', {
        admins: formatNumber(summary.adminUsers, locale),
        disabled: formatNumber(summary.disabledUsers, locale),
      }),
      trend: summary.disabledUsers > 0 ? 'steady' : 'up',
    },
    {
      id: 'sessions',
      label: t('security.metrics.sessionsLabel'),
      value: `${formatNumber(summary.activeSessions, locale)} / ${formatNumber(summary.totalSessions, locale)}`,
      delta: t('security.metrics.sessionsDelta', {
        revoked: formatNumber(summary.revokedSessions, locale),
        expired: formatNumber(summary.expiredSessions, locale),
      }),
      trend:
        summary.revokedSessions > 0 ? 'down' : summary.expiredSessions > 0 ? 'steady' : 'up',
    },
    {
      id: 'keys',
      label: t('security.metrics.keysLabel'),
      value: `${formatNumber(summary.activeApiKeys, locale)} / ${formatNumber(summary.totalApiKeys, locale)}`,
      delta: t('security.metrics.keysDelta', {
        revoked: formatNumber(summary.revokedApiKeys, locale),
        expired: formatNumber(summary.expiredApiKeys, locale),
      }),
      trend:
        summary.revokedApiKeys > 0 ? 'down' : summary.expiredApiKeys > 0 ? 'steady' : 'up',
    },
    {
      id: 'audit',
      label: t('security.metrics.auditLabel'),
      value: formatNumber(summary.recentAuditEvents, locale),
      delta: t('security.metrics.auditDelta', {
        failed: formatNumber(summary.failedAuditEvents, locale),
        actors: formatNumber(summary.uniqueAuditActors, locale),
      }),
      trend: summary.failedAuditEvents > 0 ? 'down' : 'up',
    },
  ];
}

export function buildSecurityExposureSignals(
  summary: SecurityOverviewSummary,
  locale: LocaleCode,
  t: Translate,
): SecurityExposureSignal[] {
  return [
    {
      id: 'users',
      label: t('labels.users'),
      value: formatNumber(summary.disabledUsers, locale),
      detail: t('security.exposureUsers', {
        count: formatNumber(summary.disabledUsers, locale),
      }),
      tone: summary.disabledUsers > 0 ? 'warning' : 'success',
    },
    {
      id: 'sessions',
      label: t('labels.sessions'),
      value: formatNumber(summary.revokedSessions + summary.expiredSessions, locale),
      detail: t('security.exposureSessions', {
        count: formatNumber(summary.revokedSessions + summary.expiredSessions, locale),
      }),
      tone:
        summary.revokedSessions > 0
          ? 'danger'
          : summary.expiredSessions > 0
            ? 'warning'
            : 'success',
    },
    {
      id: 'api-keys',
      label: t('labels.apiKeys'),
      value: formatNumber(summary.revokedApiKeys + summary.expiredApiKeys, locale),
      detail: t('security.exposureKeys', {
        count: formatNumber(summary.revokedApiKeys + summary.expiredApiKeys, locale),
      }),
      tone:
        summary.revokedApiKeys > 0
          ? 'danger'
          : summary.expiredApiKeys > 0
            ? 'warning'
            : 'success',
    },
    {
      id: 'audit',
      label: t('labels.auditEvents'),
      value: formatNumber(summary.failedAuditEvents, locale),
      detail: t('security.exposureAudit', {
        count: formatNumber(summary.failedAuditEvents, locale),
      }),
      tone: summary.failedAuditEvents > 0 ? 'danger' : 'info',
    },
  ];
}

export function buildSecurityHeroPresentationModel(
  summary: SecurityOverviewSummary,
  source: 'database' | 'unavailable',
  locale: LocaleCode,
  t: Translate,
): SecurityHeroPresentationModel {
  return {
    overviewMessage:
      source === 'database'
        ? t('security.overviewMessageLive')
        : t('security.overviewMessageUnavailable'),
    sourceBadge: resolveSecuritySourceBadge(source, t),
    metrics: buildSecurityOverviewMetrics(summary, locale, t),
    postureSummaryMetrics: [
      {
        label: t('labels.roles'),
        value: formatNumber(summary.roleCount, locale),
      },
      {
        label: t('labels.permissions'),
        value: formatNumber(summary.permissionCount, locale),
      },
      {
        label: t('labels.users'),
        value: formatNumber(summary.totalUsers, locale),
      },
      {
        label: t('labels.auditEvents'),
        value: formatNumber(summary.uniqueAuditActors, locale),
      },
    ],
    postureExposureSignals: buildSecurityExposureSignals(summary, locale, t),
  };
}

export function buildSecurityAuditTimelineItems(
  auditEvents: readonly SecurityAuditEventEntry[],
): TimelineItem[] {
  return auditEvents.map((event) => ({
    id: event.id,
    title: `${humanizeIdentifier(event.category)} / ${humanizeIdentifier(event.action)}`,
    description: `${event.actor} / ${event.target} / ${humanizeIdentifier(event.result)}`,
    severity: resolveSecurityAuditSeverity(event.tone),
    tone: event.tone,
    meta: event.scope ?? event.clientIp ?? humanizeIdentifier(event.result),
    projectId: event.id,
    timestamp: event.createdAt,
  }));
}

export function resolveSecuritySourceBadge(
  source: 'database' | 'unavailable',
  t: Translate,
  connectedTone: SecuritySourceBadge['tone'] = 'success',
): SecuritySourceBadge {
  return source === 'database'
    ? { label: t('security.sourceLive'), tone: connectedTone }
    : { label: t('security.sourceUnavailable'), tone: 'warning' };
}
