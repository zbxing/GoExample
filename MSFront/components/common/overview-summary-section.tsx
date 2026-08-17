'use client';

import type { ReactNode } from 'react';

interface OverviewSummarySectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function OverviewSummarySection({
  title,
  description,
  children,
}: OverviewSummarySectionProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="portfolioSummaryGrid">{children}</div>
    </section>
  );
}
