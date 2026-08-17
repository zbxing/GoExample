'use client';

import type { ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface ProjectEntityEditorSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}

interface ProjectEntityEditorCardProps {
  title: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}

export function ProjectEntityEditorSection({
  icon,
  title,
  description,
  addLabel,
  onAdd,
  children,
}: ProjectEntityEditorSectionProps) {
  return (
    <section className="editorSection">
      <div className="editorSectionHeader">
        <div className="sectionTitle">
          {icon}
          <h3>{title}</h3>
        </div>
        <button type="button" className="secondaryButton" onClick={onAdd}>
          <Plus size={14} />
          {addLabel}
        </button>
      </div>
      <p className="fieldHint">{description}</p>
      <div className="entityList">{children}</div>
    </section>
  );
}

export function ProjectEntityEditorCard({
  title,
  removeLabel,
  onRemove,
  children,
}: ProjectEntityEditorCardProps) {
  return (
    <article className="entityCard">
      <div className="entityCardHeader">
        <strong>{title}</strong>
        <button type="button" className="ghostButton" onClick={onRemove}>
          <Trash2 size={14} />
          {removeLabel}
        </button>
      </div>
      <div className="entityGrid">{children}</div>
    </article>
  );
}
