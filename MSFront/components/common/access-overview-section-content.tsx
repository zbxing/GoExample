'use client';

import type { ComponentType, ReactNode } from 'react';
import type { ManagementTone } from '@/components/common/management-primitives';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSignal,
} from '@/components/common/access-governance-surface';

interface TonePillProps {
  label: string;
  tone: ManagementTone;
}

interface AttentionCardProps {
  label: string;
  value: string;
  detail: string;
  tone: ManagementTone;
}

interface AccessSurfaceMetricGridProps {
  metrics: readonly AccessSurfaceMetric[];
}

interface AccessSourceCardContentProps {
  eyebrow: string;
  title: string;
  description: string;
  badge: AccessSurfaceBadge;
  TonePillComponent: ComponentType<TonePillProps>;
}

interface AccessCoverageCardContentProps {
  eyebrow: string;
  metrics: readonly AccessSurfaceMetric[];
  footnote: string;
  MetricGridComponent: ComponentType<AccessSurfaceMetricGridProps>;
}

interface AccessPosturePanelContentProps {
  eyebrow: string;
  title: string;
  description: string;
  signals: readonly AccessSurfaceSignal[];
  actions: ReactNode;
  AttentionCardComponent: ComponentType<AttentionCardProps>;
}

interface AccessOverviewSectionContentProps {
  title: string;
  description: string;
  sourceCard: ReactNode;
  coverageCard: ReactNode;
  posturePanel: ReactNode;
}

export function AccessSourceCardContent({
  eyebrow,
  title,
  description,
  badge,
  TonePillComponent,
}: AccessSourceCardContentProps) {
  return (
    <article className="securitySurfaceCard">
      <span className="serviceCategory">{eyebrow}</span>
      <div className="securityHeaderRow">
        <h3>{title}</h3>
        <TonePillComponent label={badge.label} tone={badge.tone} />
      </div>
      <p>{description}</p>
    </article>
  );
}

export function AccessCoverageCardContent({
  eyebrow,
  metrics,
  footnote,
  MetricGridComponent,
}: AccessCoverageCardContentProps) {
  return (
    <article className="securitySurfaceCard">
      <span className="serviceCategory">{eyebrow}</span>
      <MetricGridComponent metrics={metrics} />
      <p className="summaryFootnote">{footnote}</p>
    </article>
  );
}

export function AccessPosturePanelContent({
  eyebrow,
  title,
  description,
  signals,
  actions,
  AttentionCardComponent,
}: AccessPosturePanelContentProps) {
  return (
    <article className="securitySurfaceCard dashboardSecurityWorkbench">
      <span className="serviceCategory">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>

      <div className="dashboardSecurityRiskList">
        {signals.map((signal) => (
          <AttentionCardComponent
            key={signal.label}
            label={signal.label}
            value={signal.value}
            detail={signal.detail}
            tone={signal.tone}
          />
        ))}
      </div>

      <div className="dashboardSecurityActionGrid">{actions}</div>
    </article>
  );
}

export function AccessOverviewSectionContent({
  title,
  description,
  sourceCard,
  coverageCard,
  posturePanel,
}: AccessOverviewSectionContentProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="dashboardSecurityLayout">
        <div className="dashboardSecurityStack">
          {sourceCard}
          {coverageCard}
        </div>
        {posturePanel}
      </div>
    </section>
  );
}
