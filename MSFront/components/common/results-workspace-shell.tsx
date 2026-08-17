'use client';

import type { ReactNode } from 'react';
import { FeedbackBanner, type FeedbackState } from '@/components/common/feedback-banner';

interface ResultsWorkspaceShellProps {
  title: string;
  description: string;
  workbench?: ReactNode;
  feedback?: FeedbackState | null;
  emptyState: ReactNode;
  hasContent: boolean;
  children: ReactNode;
}

export function ResultsWorkspaceShell({
  title,
  description,
  workbench,
  feedback = null,
  emptyState,
  hasContent,
  children,
}: ResultsWorkspaceShellProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {workbench}
      <FeedbackBanner feedback={feedback} />
      {hasContent ? children : emptyState}
    </section>
  );
}
