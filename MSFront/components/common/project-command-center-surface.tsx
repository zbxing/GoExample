'use client';

import type { ReactNode } from 'react';

interface ProjectCommandCenterSurfaceProps {
  eyebrow: string;
  title: string;
  description: string;
  summaryCards: ReactNode;
  tags?: ReactNode;
  spotlight: ReactNode;
}

export function ProjectCommandCenterSurface({
  eyebrow,
  title,
  description,
  summaryCards,
  tags,
  spotlight,
}: ProjectCommandCenterSurfaceProps) {
  return (
    <section className="heroCard dashboardCommandCenter">
      <div className="heroInfo dashboardCommandCopy">
        <div>
          <span className="sectionEyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <div className="dashboardCommandSummaryGrid">{summaryCards}</div>

        {tags ? <div className="tagList">{tags}</div> : null}
      </div>

      <div className="heroHealth">{spotlight}</div>
    </section>
  );
}
