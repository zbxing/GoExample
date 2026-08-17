'use client';

import type { ReactNode } from 'react';
import { AccessCommandCenterSurfaceContent } from '@/components/common/access-command-center-surface-content';
import {
  AccessCoverageCardContent,
  AccessOverviewSectionContent,
  AccessPosturePanelContent,
  AccessSourceCardContent,
} from '@/components/common/access-overview-section-content';
import {
  AttentionCard,
  SummaryCard,
  TonePill,
  type ManagementTone,
} from '@/components/common/management-primitives';

export interface AccessSurfaceSummaryCard {
  label: string;
  value: string;
  footnote: string;
}

export interface AccessSurfaceMetric {
  id?: string;
  label: string;
  value: string;
}

export interface AccessSurfaceBadge {
  label: string;
  tone: ManagementTone;
}

export interface AccessSurfaceSignal {
  label: string;
  value: string;
  detail: string;
  tone: ManagementTone;
}

interface AccessCommandCenterSurfaceProps {
  eyebrow: string;
  title: string;
  description: string;
  summaryCards: readonly AccessSurfaceSummaryCard[];
  highlightBadge: AccessSurfaceBadge;
  tags: readonly string[];
  spotlightEyebrow: string;
  spotlightTitle: string;
  spotlightDescription: string;
  spotlightBadges: readonly AccessSurfaceBadge[];
  spotlightMetrics: readonly AccessSurfaceMetric[];
  spotlightFootnote: string;
}

interface AccessSourceCardProps {
  eyebrow: string;
  title: string;
  description: string;
  badge: AccessSurfaceBadge;
}

interface AccessCoverageCardProps {
  eyebrow: string;
  metrics: readonly AccessSurfaceMetric[];
  footnote: string;
}

interface AccessPosturePanelProps {
  eyebrow: string;
  title: string;
  description: string;
  signals: readonly AccessSurfaceSignal[];
  actions: ReactNode;
}

interface AccessOverviewSectionProps {
  title: string;
  description: string;
  sourceCard: ReactNode;
  coverageCard: ReactNode;
  posturePanel: ReactNode;
}

export function AccessCommandCenterSurface({
  eyebrow,
  title,
  description,
  summaryCards,
  highlightBadge,
  tags,
  spotlightEyebrow,
  spotlightTitle,
  spotlightDescription,
  spotlightBadges,
  spotlightMetrics,
  spotlightFootnote,
}: AccessCommandCenterSurfaceProps) {
  return (
    <AccessCommandCenterSurfaceContent
      eyebrow={eyebrow}
      title={title}
      description={description}
      summaryCards={summaryCards}
      highlightBadge={highlightBadge}
      tags={tags}
      spotlightEyebrow={spotlightEyebrow}
      spotlightTitle={spotlightTitle}
      spotlightDescription={spotlightDescription}
      spotlightBadges={spotlightBadges}
      spotlightMetrics={spotlightMetrics}
      spotlightFootnote={spotlightFootnote}
      SummaryCardComponent={SummaryCard}
      TonePillComponent={TonePill}
      MetricGridComponent={AccessSurfaceMetricGrid}
    />
  );
}

export function AccessSourceCard({
  eyebrow,
  title,
  description,
  badge,
}: AccessSourceCardProps) {
  return (
    <AccessSourceCardContent
      eyebrow={eyebrow}
      title={title}
      description={description}
      badge={badge}
      TonePillComponent={TonePill}
    />
  );
}

export function AccessCoverageCard({
  eyebrow,
  metrics,
  footnote,
}: AccessCoverageCardProps) {
  return (
    <AccessCoverageCardContent
      eyebrow={eyebrow}
      metrics={metrics}
      footnote={footnote}
      MetricGridComponent={AccessSurfaceMetricGrid}
    />
  );
}

export function AccessPosturePanel({
  eyebrow,
  title,
  description,
  signals,
  actions,
}: AccessPosturePanelProps) {
  return (
    <AccessPosturePanelContent
      eyebrow={eyebrow}
      title={title}
      description={description}
      signals={signals}
      actions={actions}
      AttentionCardComponent={AttentionCard}
    />
  );
}

export function AccessOverviewSection({
  title,
  description,
  sourceCard,
  coverageCard,
  posturePanel,
}: AccessOverviewSectionProps) {
  return (
    <AccessOverviewSectionContent
      title={title}
      description={description}
      sourceCard={sourceCard}
      coverageCard={coverageCard}
      posturePanel={posturePanel}
    />
  );
}

function AccessSurfaceMetricGrid({ metrics }: { metrics: readonly AccessSurfaceMetric[] }) {
  return (
    <div className="summaryMetricList">
      {metrics.map((metric) => (
        <div key={metric.id ?? metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}
