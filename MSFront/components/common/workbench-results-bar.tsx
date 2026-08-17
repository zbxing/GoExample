'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

export interface WorkbenchResultsTag {
  label: string;
  href?: Route;
  className?: string;
}

interface WorkbenchResultsBarProps {
  tags: readonly WorkbenchResultsTag[];
  actions?: ReactNode;
}

export function WorkbenchResultsBar({
  tags,
  actions,
}: WorkbenchResultsBarProps) {
  return (
    <div className="accessActionBar">
      <div className="tagList">
        {tags.map((tag) =>
          tag.href ? (
            <Link
              key={`${tag.label}:${tag.href}`}
              href={tag.href}
              className={tag.className ?? 'securityTag securityTagLink'}
            >
              {tag.label}
            </Link>
          ) : (
            <span key={tag.label} className={tag.className ?? 'securityTag'}>
              {tag.label}
            </span>
          ),
        )}
      </div>
      {actions ? <div className="projectEditorActions">{actions}</div> : null}
    </div>
  );
}
