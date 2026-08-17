'use client';

import type { ReactNode } from 'react';

interface EditorSectionProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  descriptionClassName?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function EditorSection({
  icon,
  title,
  description,
  descriptionClassName = 'fieldHint',
  actions,
  children,
}: EditorSectionProps) {
  return (
    <section className="editorSection">
      <div className="editorSectionHeader">
        <div className="sectionTitle">
          {icon}
          <h3>{title}</h3>
        </div>
        {actions}
      </div>
      {description ? <p className={descriptionClassName}>{description}</p> : null}
      {children}
    </section>
  );
}
