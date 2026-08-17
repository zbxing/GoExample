'use client';

import type { ReactNode } from 'react';

interface ProjectSpotlightSectionProps {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  hasContent: boolean;
  children: ReactNode;
}

export function ProjectSpotlightSection({
  title,
  description,
  emptyTitle,
  emptyDescription,
  hasContent,
  children,
}: ProjectSpotlightSectionProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {hasContent ? (
        <div className="dashboardSpotlightGrid">{children}</div>
      ) : (
        <div className="emptyStatePanel">
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      )}
    </section>
  );
}
