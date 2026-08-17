'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Route } from 'next';
import type {
  LocaleCode,
  SecurityAuditEventEntry,
  SecurityPermissionCoverage,
  SecurityRoleCoverage,
} from '@/lib/types/management';
import {
  type AccessNavigationContext,
  buildContextualRolesHref,
  buildContextualSecurityHref,
} from '@/lib/utils/access-navigation';
import {
  formatDateTime,
  formatNumber,
  humanizeIdentifier,
  joinDetails,
} from '@/lib/utils/format';
import type {
  SecurityCoverageMetric,
  SecurityExposureSignal,
  SecuritySourceBadge,
} from '@/lib/utils/security-surface';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

export interface SecuritySummaryCardData {
  label: string;
  value: string;
  footnote: string;
}

export interface SecurityOverviewPanelProps {
  title: string;
  description: string;
  sourceBadge: SecuritySourceBadge;
  auditBadge?: {
    label: string;
    tone: SecuritySourceBadge['tone'];
  } | null;
  summaryCards: readonly SecuritySummaryCardData[];
  coverageEyebrow: string;
  coverageTitle: string;
  coverageDescription: string;
  coverageMetrics: readonly SecurityCoverageMetric[];
  roleTags: readonly {
    label: string;
    href?: Route;
  }[];
  emptyRoleTagLabel: string;
  latestAuditLabel: string;
  latestAuditValue: string;
  riskEyebrow: string;
  riskTitle: string;
  riskDescription: string;
  riskSignals: readonly SecurityExposureSignal[];
  riskSummaryTitle: string;
  riskSummaryValue: string;
  riskSummaryMeta: string;
  actions: ReactNode;
}

export interface SecurityRoleResultCardModel {
  id: string;
  eyebrow: string;
  title: string;
  badgeLabel: string;
  filterHref: Route;
  filterLabel: string;
  metrics: readonly SecurityCoverageMetric[];
  openRoleHref: Route;
  openRoleLabel: string;
}

export interface SecurityPermissionResultCardModel {
  id: string;
  eyebrow: string;
  title: string;
  badgeLabel: string;
  metrics: readonly SecurityCoverageMetric[];
}

interface BuildSecurityOverviewPanelOptions {
  t: Translate;
  locale: LocaleCode;
  sourceBadge: SecuritySourceBadge;
  auditBadge?: {
    label: string;
    tone: SecuritySourceBadge['tone'];
  } | null;
  summaryCards: readonly SecuritySummaryCardData[];
  coverageDescription: string;
  coverageMetrics: readonly SecurityCoverageMetric[];
  roleCoverages: readonly SecurityRoleCoverage[];
  latestAuditEvent: SecurityAuditEventEntry | null;
  roleHrefBuilder?: (roleId: string) => Route;
  emptyRoleTagLabel: string;
  riskSignals: readonly SecurityExposureSignal[];
  actions: ReactNode;
  riskDescriptionFallback: string;
}

interface UseSecurityGovernanceWorkbenchPresentationControllerOptions {
  roleEntries: readonly SecurityRoleCoverage[];
  permissionEntries: readonly SecurityPermissionCoverage[];
  locale: LocaleCode;
  t: Translate;
  accessNavigationContext: AccessNavigationContext;
}

export function useSecurityGovernanceWorkbenchPresentationController({
  roleEntries,
  permissionEntries,
  locale,
  t,
  accessNavigationContext,
}: UseSecurityGovernanceWorkbenchPresentationControllerOptions) {
  const roleCards = useMemo<SecurityRoleResultCardModel[]>(
    () =>
      roleEntries.map((role) => ({
        id: role.role,
        eyebrow: humanizeIdentifier(role.role),
        title: humanizeIdentifier(role.role),
        badgeLabel: t('security.membersLabel', {
          count: formatNumber(role.memberCount, locale),
        }),
        filterHref: buildContextualSecurityHref(accessNavigationContext, {
          focus: 'users',
          role: role.role,
        }),
        filterLabel: t('security.actions.filterRole'),
        metrics: [
          {
            label: t('security.activeLabel'),
            value: formatNumber(role.activeMemberCount, locale),
          },
          {
            label: t('security.disabledLabel'),
            value: formatNumber(role.disabledMemberCount, locale),
          },
        ],
        openRoleHref: buildContextualRolesHref(accessNavigationContext, {
          roleId: role.role,
        }),
        openRoleLabel: t('security.actions.openRole'),
      })),
    [accessNavigationContext, locale, roleEntries, t],
  );
  const permissionCards = useMemo<SecurityPermissionResultCardModel[]>(
    () =>
      permissionEntries.map((permission) => ({
        id: permission.permission,
        eyebrow: permission.permission,
        title: humanizeIdentifier(permission.permission),
        badgeLabel: formatNumber(permission.totalAssignments, locale),
        metrics: [
          {
            label: t('labels.users'),
            value: formatNumber(permission.userAssignments, locale),
          },
          {
            label: t('labels.apiKeys'),
            value: formatNumber(permission.apiKeyAssignments, locale),
          },
        ],
      })),
    [locale, permissionEntries, t],
  );

  return {
    permissionCards,
    roleCards,
  };
}

export function buildSecurityOverviewPanelProps({
  t,
  locale,
  sourceBadge,
  auditBadge = null,
  summaryCards,
  coverageDescription,
  coverageMetrics,
  roleCoverages,
  latestAuditEvent,
  roleHrefBuilder,
  emptyRoleTagLabel,
  riskSignals,
  actions,
  riskDescriptionFallback,
}: BuildSecurityOverviewPanelOptions): SecurityOverviewPanelProps {
  const roleTags = roleCoverages.slice(0, 4).map((role) => ({
    label: `${humanizeIdentifier(role.role)} ${formatNumber(role.memberCount, locale)}`,
    href: roleHrefBuilder ? roleHrefBuilder(role.role) : undefined,
  }));

  const latestAuditValue = latestAuditEvent
    ? joinDetails([
        humanizeIdentifier(latestAuditEvent.category),
        humanizeIdentifier(latestAuditEvent.action),
        formatDateTime(latestAuditEvent.createdAt, locale),
      ])
    : t('dashboard.security.latestAuditEmpty');

  const riskSummaryValue = latestAuditEvent
    ? joinDetails([
        humanizeIdentifier(latestAuditEvent.category),
        humanizeIdentifier(latestAuditEvent.action),
        humanizeIdentifier(latestAuditEvent.result),
      ])
    : t('dashboard.security.latestAuditEmpty');

  const riskSummaryMeta = latestAuditEvent
    ? joinDetails([
        latestAuditEvent.actor,
        latestAuditEvent.target,
        formatDateTime(latestAuditEvent.createdAt, locale),
      ])
    : riskDescriptionFallback;

  return {
    title: t('dashboard.security.title'),
    description: t('dashboard.security.description'),
    sourceBadge,
    auditBadge,
    summaryCards,
    coverageEyebrow: t('rbac.eyebrow'),
    coverageTitle: t('dashboard.security.coverageTitle'),
    coverageDescription,
    coverageMetrics,
    roleTags,
    emptyRoleTagLabel,
    latestAuditLabel: t('dashboard.security.latestAuditLabel'),
    latestAuditValue,
    riskEyebrow: t('nav.security'),
    riskTitle: t('dashboard.security.riskTitle'),
    riskDescription: t('dashboard.security.riskDescription'),
    riskSignals,
    riskSummaryTitle: t('dashboard.security.latestAuditLabel'),
    riskSummaryValue,
    riskSummaryMeta,
    actions,
  };
}
