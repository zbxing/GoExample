'use client';

import type { ComponentType } from 'react';
import type { ManagementTone } from '@/components/common/management-primitives';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';

interface SummaryCardProps {
  label: string;
  value: string;
  footnote: string;
}

interface TonePillProps {
  label: string;
  tone: ManagementTone;
}

interface AccessSurfaceMetricGridProps {
  metrics: readonly AccessSurfaceMetric[];
}

interface AccessCommandCenterSurfaceContentProps {
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
  SummaryCardComponent: ComponentType<SummaryCardProps>;
  TonePillComponent: ComponentType<TonePillProps>;
  MetricGridComponent: ComponentType<AccessSurfaceMetricGridProps>;
}

export function AccessCommandCenterSurfaceContent({
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
  SummaryCardComponent,
  TonePillComponent,
  MetricGridComponent,
}: AccessCommandCenterSurfaceContentProps) {
  return (
    <section className="heroCard dashboardCommandCenter">
      <div className="heroInfo dashboardCommandCopy">
        <div>
          <span className="sectionEyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <div className="dashboardCommandSummaryGrid">
          {summaryCards.map((card) => (
            <SummaryCardComponent
              key={card.label}
              label={card.label}
              value={card.value}
              footnote={card.footnote}
            />
          ))}
        </div>

        <div className="tagList">
          <TonePillComponent label={highlightBadge.label} tone={highlightBadge.tone} />
          {tags.map((tag) => (
            <span key={tag} className="securityTag">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="heroHealth">
        <article className="dashboardSpotlightCard">
          <div className="dashboardSpotlightHeader">
            <div>
              <span className="serviceCategory">{spotlightEyebrow}</span>
              <h3>{spotlightTitle}</h3>
              <p>{spotlightDescription}</p>
            </div>
            {spotlightBadges.length > 0 ? (
              <div className="projectBadges">
                {spotlightBadges.map((badge) => (
                  <TonePillComponent
                    key={`${badge.label}:${badge.tone}`}
                    label={badge.label}
                    tone={badge.tone}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <MetricGridComponent metrics={spotlightMetrics} />

          <p className="summaryFootnote">{spotlightFootnote}</p>
        </article>
      </div>
    </section>
  );
}
