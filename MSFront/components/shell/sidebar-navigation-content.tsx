'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';

interface SidebarNavigationLink {
  href: Route;
  icon: LucideIcon;
  isActive: boolean;
  label: string;
  level?: 0 | 1;
  isGroup?: boolean;
}

interface SidebarNavigationContentProps {
  footerDescription: string;
  footerEyebrow: string;
  footerTags: readonly string[];
  footerTitle: string;
  isCollapsed: boolean;
  navigationLinks: readonly SidebarNavigationLink[];
  onNavigate: () => void;
}

export function SidebarNavigationContent({
  footerDescription,
  footerEyebrow,
  footerTags,
  footerTitle,
  isCollapsed,
  navigationLinks,
  onNavigate,
}: SidebarNavigationContentProps) {
  return (
    <>
      <nav className="sidebarNav">
        {navigationLinks.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={item.isActive ? 'navItem active' : 'navItem'}
              data-level={item.level ?? 0}
              data-group={item.isGroup ? 'true' : 'false'}
              onClick={onNavigate}
              aria-current={item.isActive ? 'page' : undefined}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.isGroup ? <ChevronDown className="navItemChevron" size={15} aria-hidden="true" /> : null}
            </Link>
          );
        })}
      </nav>

      <section className="sidebarFooterCard">
        <span className="serviceCategory">{footerEyebrow}</span>
        <strong>{footerTitle}</strong>
        <p>{footerDescription}</p>
        <div className="tagList">
          {footerTags.map((tag) => (
            <span key={tag} className="securityTag">
              {tag}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
