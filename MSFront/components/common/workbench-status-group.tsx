'use client';

import type { ReactNode } from 'react';

interface WorkbenchStatusGroupStackProps {
  children: ReactNode;
}

interface WorkbenchStatusGroupSectionProps {
  eyebrow: string;
  title: string;
  description: string;
  summary: string;
  bodyClassName: string;
  children: ReactNode;
}

export function WorkbenchStatusGroupStack({
  children,
}: WorkbenchStatusGroupStackProps) {
  return <div className="serviceGroupStack">{children}</div>;
}

export function WorkbenchStatusGroupSection({
  eyebrow,
  title,
  description,
  summary,
  bodyClassName,
  children,
}: WorkbenchStatusGroupSectionProps) {
  return (
    <section className="serviceGroupSection">
      <div className="credentialGroupHeader">
        <div>
          <span className="serviceCategory">{eyebrow}</span>
          <h3>{title}</h3>
          <p className="fieldHint">{description}</p>
        </div>
        <div className="tagList">
          <span className="securityTag">{summary}</span>
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
