'use client';

import type { ReactNode } from 'react';

interface ProjectDetailPanelSectionProps {
  title: string;
  description: string;
  headerAside?: ReactNode;
  children: ReactNode;
}

export function ProjectDetailPanelSection({
  title,
  description,
  headerAside,
  children,
}: ProjectDetailPanelSectionProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {headerAside}
      </div>

      {children}
    </section>
  );
}
