'use client';

import type { ReactNode } from 'react';

interface SecuritySummaryCardMetric {
  id?: string;
  label: string;
  value: string;
}

interface SecuritySummaryCardProps {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
  tags?: ReactNode;
  metrics: readonly SecuritySummaryCardMetric[];
  footer?: ReactNode;
  className?: string;
}

export function SecuritySummaryCard({
  eyebrow,
  title,
  badge,
  tags,
  metrics,
  footer,
  className = 'securitySurfaceCard',
}: SecuritySummaryCardProps) {
  return (
    <article className={className}>
      <div className="securityHeaderRow">
        <div>
          <span className="serviceCategory">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        {badge}
      </div>

      {tags ? <div className="tagList">{tags}</div> : null}

      <div className="summaryMetricList">
        {metrics.map((metric) => (
          <div key={metric.id ?? metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      {footer}
    </article>
  );
}
