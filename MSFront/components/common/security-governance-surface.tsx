'use client';

import {
  TonePill,
} from '@/components/common/management-primitives';
import {
  SecurityGovernanceOverviewPanelShell,
} from '@/components/common/security-governance-overview-panel-shell';
import { SectionHeader } from '@/components/common/section-header';
import { MetricGrid } from '@/components/dashboard/metric-grid';
import type {
  OverviewMetric,
} from '@/lib/types/management';
import {
  type SecurityCoverageMetric,
  type SecurityExposureSignal,
  type SecuritySourceBadge,
} from '@/lib/utils/security-surface';
import {
  type SecurityOverviewPanelProps,
} from '@/lib/utils/use-security-governance-surface-presentation-controller';

interface Translate {
  (path: string, variables?: Record<string, string | number>): string;
}

interface SecurityPostureOverviewProps {
  title: string;
  panelDescription: string;
  summaryMetrics: readonly SecurityCoverageMetric[];
  exposureSignals: readonly SecurityExposureSignal[];
  t: Translate;
  sourceBadge: SecuritySourceBadge;
}

interface SecurityHeroOverviewProps {
  eyebrow: string;
  title: string;
  description: string;
  metrics: OverviewMetric[];
  postureTitle: string;
  postureDescription: string;
  postureSummaryMetrics: readonly SecurityCoverageMetric[];
  postureExposureSignals: readonly SecurityExposureSignal[];
  t: Translate;
  sourceBadge: SecuritySourceBadge;
}

export function SecurityOverviewPanel({
  title,
  description,
  sourceBadge,
  auditBadge,
  summaryCards,
  coverageEyebrow,
  coverageTitle,
  coverageDescription,
  coverageMetrics,
  roleTags,
  emptyRoleTagLabel,
  latestAuditLabel,
  latestAuditValue,
  riskEyebrow,
  riskTitle,
  riskDescription,
  riskSignals,
  riskSummaryTitle,
  riskSummaryValue,
  riskSummaryMeta,
  actions,
}: SecurityOverviewPanelProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="tagList">
          <TonePill label={sourceBadge.label} tone={sourceBadge.tone} />
          {auditBadge ? <TonePill label={auditBadge.label} tone={auditBadge.tone} /> : null}
        </div>
      </div>
      <SecurityGovernanceOverviewPanelShell
        actions={actions}
        auditBadge={auditBadge}
        coverageDescription={coverageDescription}
        coverageEyebrow={coverageEyebrow}
        coverageMetrics={coverageMetrics}
        coverageTitle={coverageTitle}
        emptyRoleTagLabel={emptyRoleTagLabel}
        latestAuditLabel={latestAuditLabel}
        latestAuditValue={latestAuditValue}
        riskDescription={riskDescription}
        riskEyebrow={riskEyebrow}
        riskSignals={riskSignals}
        riskSummaryMeta={riskSummaryMeta}
        riskSummaryTitle={riskSummaryTitle}
        riskSummaryValue={riskSummaryValue}
        riskTitle={riskTitle}
        roleTags={roleTags}
        sourceBadge={sourceBadge}
        summaryCards={summaryCards}
      />
    </section>
  );
}

export function SecurityPostureOverview({
  title,
  panelDescription,
  summaryMetrics,
  exposureSignals,
  t,
  sourceBadge,
}: SecurityPostureOverviewProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{panelDescription}</p>
        </div>
      </div>
      <div className="securityOverviewGrid">
        <article className="securitySurfaceCard">
          <span className="serviceCategory">{t('labels.source')}</span>
          <div className="securityHeaderRow">
            <h3>{sourceBadge.label}</h3>
            <TonePill label={sourceBadge.label} tone={sourceBadge.tone} />
          </div>
          <p>{t('security.sourceDescription')}</p>
        </article>

        <article className="securitySurfaceCard">
          <span className="serviceCategory">{t('labels.roles')}</span>
          <div className="summaryMetricList">
            {summaryMetrics.map((metric) => (
              <div key={metric.id ?? metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="securitySurfaceCard">
          <span className="serviceCategory">{t('security.exposureLabel')}</span>
          <div className="securityStackCompact">
            {exposureSignals.map((signal) => (
              <TonePill key={signal.id} label={signal.detail} tone={signal.tone} />
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export function SecurityHeroOverview({
  eyebrow,
  title,
  description,
  metrics,
  postureTitle,
  postureDescription,
  postureSummaryMetrics,
  postureExposureSignals,
  t,
  sourceBadge,
}: SecurityHeroOverviewProps) {
  return (
    <>
      <SectionHeader eyebrow={eyebrow} title={title} description={description} />
      <MetricGrid metrics={metrics} />
      <SecurityPostureOverview
        title={postureTitle}
        panelDescription={postureDescription}
        summaryMetrics={postureSummaryMetrics}
        exposureSignals={postureExposureSignals}
        t={t}
        sourceBadge={sourceBadge}
      />
    </>
  );
}
