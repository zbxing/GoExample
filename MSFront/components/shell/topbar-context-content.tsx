'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { Blocks, CircleHelp } from 'lucide-react';

interface TopbarQuickLink {
  href: Route;
  isActive: boolean;
  label: string;
}

interface TopbarContextContentProps {
  focusBadgeLabel: string;
  pageDescription: string;
  pageEyebrow: string;
  pageTitle: string;
  projectDescription: string;
  projectFocusLabel: string;
  projectName: string;
  projectSummary: string;
  quickLinks: readonly TopbarQuickLink[];
}

export function TopbarContextContent({
  focusBadgeLabel,
  pageDescription,
  pageEyebrow,
  pageTitle,
  projectDescription,
  projectFocusLabel,
  projectName,
  projectSummary,
  quickLinks,
}: TopbarContextContentProps) {
  return (
    <div className="topbarContext">
      <div className="referenceTopbarBrand">
        <Blocks size={27} strokeWidth={2.2} aria-hidden="true" />
        <strong>Gin-Vue-Admin</strong>
        <span><CircleHelp size={14} aria-hidden="true" />仪表盘</span>
      </div>
      <div className="topbarBreadcrumb" title={pageDescription}>
        <span>{pageEyebrow}</span>
        <span aria-hidden="true">/</span>
        <strong>{pageTitle}</strong>
      </div>

      <div className="topbarProjectBrief" title={projectDescription}>
        <span className="topbarProjectLabel">{projectFocusLabel}</span>
        <strong>{projectName}</strong>
        <span className="topbarRuntimeDot" aria-label={focusBadgeLabel} title={focusBadgeLabel} />
        <small title={projectSummary}>{projectSummary}</small>
      </div>

      <nav className="topbarTabs" aria-label={pageEyebrow}>
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={link.isActive ? 'topbarTab active' : 'topbarTab'}
            aria-current={link.isActive ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
