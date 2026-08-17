'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ProjectBadgeGroup,
  ProjectMetricList,
} from '@/components/common/project-surface';
import type { ProjectEnvironment, ProjectStatus } from '@/lib/types/management';

export interface ProjectEndpointIdentity {
  eyebrow: string;
  title: string;
  description: string;
}

export interface ProjectEndpointField {
  id?: string;
  label: string;
  value: string;
}

export interface ProjectEndpointMetric {
  label: string;
  value: string;
}

interface ProjectEndpointSurfaceCardProps {
  className?: string;
  identity: ProjectEndpointIdentity;
  status: ProjectStatus;
  environment?: ProjectEnvironment;
  metrics: readonly ProjectEndpointMetric[];
  fields: readonly ProjectEndpointField[];
  footnote?: string | null;
  footer?: ReactNode;
}

interface ProjectEndpointFieldGridProps {
  fields: readonly ProjectEndpointField[];
}

interface ProjectEndpointFooterLinkProps {
  href: Route;
  label: string;
}

export function ProjectEndpointSurfaceCard({
  className = 'securitySurfaceCard',
  identity,
  status,
  environment,
  metrics,
  fields,
  footnote,
  footer,
}: ProjectEndpointSurfaceCardProps) {
  return (
    <article className={className}>
      <div className="serviceCardHeader">
        <div>
          <span className="serviceCategory">{identity.eyebrow}</span>
          <h3>{identity.title}</h3>
          <p>{identity.description}</p>
        </div>
        <ProjectBadgeGroup status={status} environment={environment} />
      </div>
      <ProjectMetricList metrics={metrics} />
      <ProjectEndpointFieldGrid fields={fields} />
      {footnote ? <p className="summaryFootnote">{footnote}</p> : null}
      {footer ? <div className="entityCardFooter">{footer}</div> : null}
    </article>
  );
}

export function ProjectEndpointFieldGrid({ fields }: ProjectEndpointFieldGridProps) {
  return (
    <div className="integrationEndpointGrid">
      {fields.map((field) => (
        <div key={field.id ?? field.label} className="endpointField">
          <span>{field.label}</span>
          <strong>{field.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ProjectEndpointFooterLink({ href, label }: ProjectEndpointFooterLinkProps) {
  return (
    <Link href={href} className="securityInlineLinkStrong">
      {label}
    </Link>
  );
}
