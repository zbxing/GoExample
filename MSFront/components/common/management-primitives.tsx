'use client';

import type { CSSProperties, ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

export type ManagementTone = 'success' | 'warning' | 'danger' | 'info';

interface SummaryCardProps {
  label: string;
  value: string;
  footnote: string;
}

interface AttentionCardProps {
  label: string;
  value: string;
  detail: string;
  tone: ManagementTone;
}

interface TonePillProps {
  label: string;
  tone: ManagementTone;
  className?: string;
  showStatusIcon?: boolean;
}

interface ManagementContextStripProps {
  label: string;
  tags: readonly string[];
  actions?: ReactNode;
}

export function SummaryCard({ label, value, footnote }: SummaryCardProps) {
  return (
    <article className="portfolioSummaryCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className="summaryFootnote">{footnote}</small>
    </article>
  );
}

export function AttentionCard({ label, value, detail, tone }: AttentionCardProps) {
  return (
    <article className="dashboardSecurityRiskCard" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function TonePill({
  label,
  tone,
  className = 'statusBadge',
  showStatusIcon = false,
}: TonePillProps) {
  return (
    <span
      style={{ '--badge-tone': toneValueFromManagementTone(tone) } as CSSProperties}
      className={className}
    >
      {showStatusIcon && (tone === 'success' || tone === 'info') ? (
        <CheckCircle2 size={14} />
      ) : null}
      {label}
    </span>
  );
}

export function ManagementContextStrip({
  label,
  tags,
  actions,
}: ManagementContextStripProps) {
  return (
    <div className="accessActionBar accessContextStrip">
      <div className="accessContextSummary">
        <span className="serviceCategory">{label}</span>
        {tags.length > 0 ? (
          <div className="tagList">
            {tags.map((tag) => (
              <span key={tag} className="securityTag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className="projectEditorActions">{actions}</div> : null}
    </div>
  );
}

function toneValueFromManagementTone(tone: ManagementTone) {
  if (tone === 'success') {
    return 'var(--tone-success)';
  }

  if (tone === 'warning') {
    return 'var(--tone-warning)';
  }

  if (tone === 'danger') {
    return 'var(--tone-danger)';
  }

  return 'var(--tone-info)';
}
