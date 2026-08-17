'use client';

import Link from 'next/link';
import {
  AttentionCard,
  SummaryCard,
  TonePill,
} from '@/components/common/management-primitives';
import type { SecurityOverviewPanelProps } from '@/lib/utils/use-security-governance-surface-presentation-controller';

type SecurityGovernanceOverviewPanelShellProps = Pick<
  SecurityOverviewPanelProps,
  | 'actions'
  | 'auditBadge'
  | 'coverageDescription'
  | 'coverageEyebrow'
  | 'coverageMetrics'
  | 'coverageTitle'
  | 'emptyRoleTagLabel'
  | 'latestAuditLabel'
  | 'latestAuditValue'
  | 'riskDescription'
  | 'riskEyebrow'
  | 'riskSignals'
  | 'riskSummaryMeta'
  | 'riskSummaryTitle'
  | 'riskSummaryValue'
  | 'riskTitle'
  | 'roleTags'
  | 'sourceBadge'
  | 'summaryCards'
>;

function SecurityGovernanceOverviewCoverageStack({
  coverageDescription,
  coverageEyebrow,
  coverageMetrics,
  coverageTitle,
  emptyRoleTagLabel,
  latestAuditLabel,
  latestAuditValue,
  roleTags,
  sourceBadge,
  summaryCards,
}: Pick<
  SecurityGovernanceOverviewPanelShellProps,
  | 'coverageDescription'
  | 'coverageEyebrow'
  | 'coverageMetrics'
  | 'coverageTitle'
  | 'emptyRoleTagLabel'
  | 'latestAuditLabel'
  | 'latestAuditValue'
  | 'roleTags'
  | 'sourceBadge'
  | 'summaryCards'
>) {
  return (
    <div className="dashboardSecurityStack">
      <div className="portfolioSummaryGrid">
        {summaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </div>

      <article className="securitySurfaceCard dashboardSecurityOverviewCard">
        <div className="securityHeaderRow">
          <div>
            <span className="serviceCategory">{coverageEyebrow}</span>
            <h3>{coverageTitle}</h3>
            <p>{coverageDescription}</p>
          </div>
          <TonePill label={sourceBadge.label} tone={sourceBadge.tone} />
        </div>

        <div className="summaryMetricList">
          {coverageMetrics.map((metric) => (
            <div key={metric.id ?? metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>

        <div className="tagList">
          {roleTags.length > 0 ? (
            roleTags.map((role) =>
              role.href ? (
                <Link
                  key={`${role.label}:${role.href}`}
                  href={role.href}
                  className="securityTag securityTagLink"
                >
                  {role.label}
                </Link>
              ) : (
                <span key={role.label} className="securityTag">
                  {role.label}
                </span>
              ),
            )
          ) : (
            <span className="securityTag">{emptyRoleTagLabel}</span>
          )}
        </div>

        <p className="summaryFootnote">
          {latestAuditLabel}: {latestAuditValue}
        </p>
      </article>
    </div>
  );
}

function SecurityGovernanceOverviewRiskWorkbench({
  actions,
  auditBadge,
  riskDescription,
  riskEyebrow,
  riskSignals,
  riskSummaryMeta,
  riskSummaryTitle,
  riskSummaryValue,
  riskTitle,
}: Pick<
  SecurityGovernanceOverviewPanelShellProps,
  | 'actions'
  | 'auditBadge'
  | 'riskDescription'
  | 'riskEyebrow'
  | 'riskSignals'
  | 'riskSummaryMeta'
  | 'riskSummaryTitle'
  | 'riskSummaryValue'
  | 'riskTitle'
>) {
  return (
    <article className="securitySurfaceCard dashboardSecurityWorkbench">
      <div className="securityHeaderRow">
        <div>
          <span className="serviceCategory">{riskEyebrow}</span>
          <h3>{riskTitle}</h3>
          <p>{riskDescription}</p>
        </div>
        {auditBadge ? <TonePill label={auditBadge.label} tone={auditBadge.tone} /> : null}
      </div>

      <div className="dashboardSecurityRiskList">
        {riskSignals.map((signal) => (
          <AttentionCard
            key={signal.id}
            label={signal.label}
            value={signal.value}
            detail={signal.detail}
            tone={signal.tone}
          />
        ))}
      </div>

      <div className="inlineSummary">
        <div>
          <strong>{riskSummaryTitle}</strong>
          <small>{riskSummaryValue}</small>
        </div>
        <small>{riskSummaryMeta}</small>
      </div>

      <div className="dashboardSecurityActionGrid">{actions}</div>
    </article>
  );
}

export function SecurityGovernanceOverviewPanelShell({
  actions,
  auditBadge,
  coverageDescription,
  coverageEyebrow,
  coverageMetrics,
  coverageTitle,
  emptyRoleTagLabel,
  latestAuditLabel,
  latestAuditValue,
  riskDescription,
  riskEyebrow,
  riskSignals,
  riskSummaryMeta,
  riskSummaryTitle,
  riskSummaryValue,
  riskTitle,
  roleTags,
  sourceBadge,
  summaryCards,
}: SecurityGovernanceOverviewPanelShellProps) {
  return (
    <div className="dashboardSecurityLayout">
      <SecurityGovernanceOverviewCoverageStack
        coverageDescription={coverageDescription}
        coverageEyebrow={coverageEyebrow}
        coverageMetrics={coverageMetrics}
        coverageTitle={coverageTitle}
        emptyRoleTagLabel={emptyRoleTagLabel}
        latestAuditLabel={latestAuditLabel}
        latestAuditValue={latestAuditValue}
        roleTags={roleTags}
        sourceBadge={sourceBadge}
        summaryCards={summaryCards}
      />
      <SecurityGovernanceOverviewRiskWorkbench
        actions={actions}
        auditBadge={auditBadge}
        riskDescription={riskDescription}
        riskEyebrow={riskEyebrow}
        riskSignals={riskSignals}
        riskSummaryMeta={riskSummaryMeta}
        riskSummaryTitle={riskSummaryTitle}
        riskSummaryValue={riskSummaryValue}
        riskTitle={riskTitle}
      />
    </div>
  );
}
