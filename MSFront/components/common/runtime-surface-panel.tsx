'use client';

import type { CSSProperties } from 'react';
import { RuntimeSurfacePanelDetailsContent } from '@/components/common/runtime-surface-panel-details-content';
import { RuntimeSurfacePanelSummaryContent } from '@/components/common/runtime-surface-panel-summary-content';
import type { RuntimeSurfaceSummary } from '@/lib/management/runtime';
import { useLocale } from '@/providers/locale-provider';

interface RuntimeSurfacePanelProps {
  title: string;
  description: string;
  summary: RuntimeSurfaceSummary;
}

interface RuntimeSurfacePreviewProps {
  title: string;
  description: string;
  summary: RuntimeSurfaceSummary;
}

export function RuntimeSurfacePanel({
  title,
  description,
  summary,
}: RuntimeSurfacePanelProps) {
  const toneStyle = getToneStyle(summary.tone);

  return (
    <section className="panel runtimeSurfacePanel">
      <RuntimeSurfacePanelSummaryContent
        title={title}
        description={description}
        summary={summary}
        toneStyle={toneStyle}
      />
      <RuntimeSurfacePanelDetailsContent summary={summary} />
    </section>
  );
}

export function RuntimeSurfacePreview({
  title,
  description,
  summary,
}: RuntimeSurfacePreviewProps) {
  const { t } = useLocale();
  const toneStyle = getToneStyle(summary.tone);

  return (
    <div className="runtimePreviewCard">
      <div className="runtimePreviewHeader">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span style={toneStyle} className="runtimeStatusPill">
          {summary.statusLabel}
        </span>
      </div>

      <div className="runtimeSummaryCopy">
        <strong>{t(`dashboard.runtime.summary.${summary.summaryKey}Title`)}</strong>
        <p>
          {t(
            `dashboard.runtime.summary.${summary.summaryKey}Description`,
            summary.summaryVariables,
          )}
        </p>
      </div>

      {summary.tags.length > 0 ? (
        <div className="tagList">
          {summary.tags.map((tag) => (
            <span key={tag} className="securityTag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="runtimePreviewGrid">
        {Object.values(summary.primaryMetrics).map((metric) => (
          <article key={metric.id} className="portfolioSummaryCard">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}

function getToneStyle(tone: RuntimeSurfaceSummary['tone']): CSSProperties {
  const value =
    tone === 'success'
      ? 'var(--tone-success)'
      : tone === 'warning'
        ? 'var(--tone-warning)'
        : tone === 'danger'
          ? 'var(--tone-danger)'
          : 'var(--tone-info)';

  return { '--runtime-tone': value } as CSSProperties;
}
