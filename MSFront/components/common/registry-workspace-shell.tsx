'use client';

import type { ReactNode } from 'react';
import { FeedbackBanner, type FeedbackState } from '@/components/common/feedback-banner';

interface RegistryWorkspaceShellProps {
  title: string;
  description: string;
  actions?: ReactNode;
  workbench?: ReactNode;
  feedback?: FeedbackState | null;
  emptyState: ReactNode;
  hasContent: boolean;
  children: ReactNode;
}

export function RegistryWorkspaceShell({
  title,
  description,
  actions,
  workbench,
  feedback = null,
  emptyState,
  hasContent,
  children,
}: RegistryWorkspaceShellProps) {
  return (
    <section className="panel registryPanel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions}
      </div>

      {workbench}
      <FeedbackBanner feedback={feedback} />
      {hasContent ? children : emptyState}
    </section>
  );
}
