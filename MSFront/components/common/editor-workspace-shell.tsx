'use client';

import type { ReactNode } from 'react';
import { FeedbackBanner, type FeedbackState } from '@/components/common/feedback-banner';

interface EditorWorkspaceShellProps {
  title: string;
  description: string;
  detail?: ReactNode;
  actions?: ReactNode;
  feedback: FeedbackState | null;
  emptyState: ReactNode;
  hasContent: boolean;
  children: ReactNode;
}

export function EditorWorkspaceShell({
  title,
  description,
  detail,
  actions,
  feedback,
  emptyState,
  hasContent,
  children,
}: EditorWorkspaceShellProps) {
  return (
    <section className="panel editorPanel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
          {detail}
        </div>
        {actions}
      </div>

      <FeedbackBanner feedback={feedback} />

      {hasContent ? <div className="editorStack">{children}</div> : emptyState}
    </section>
  );
}
