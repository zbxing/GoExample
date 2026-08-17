'use client';

import type { ReactNode } from 'react';

interface SecurityPanelSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function SecurityPanelSection({
  title,
  description,
  children,
}: SecurityPanelSectionProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {children}
    </section>
  );
}
