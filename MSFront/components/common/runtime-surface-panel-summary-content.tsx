'use client';

import type { CSSProperties } from 'react';
import type { RuntimeSurfaceSummary } from '@/lib/management/runtime';
import { useLocale } from '@/providers/locale-provider';

interface RuntimeSurfacePanelSummaryContentProps {
  title: string;
  description: string;
  summary: RuntimeSurfaceSummary;
  toneStyle: CSSProperties;
}

export function RuntimeSurfacePanelSummaryContent({
  title,
  description,
  summary,
  toneStyle,
}: RuntimeSurfacePanelSummaryContentProps) {
  const { t } = useLocale();

  return (
    <>
      <div className="panelHeader runtimeSurfaceHeader">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span style={toneStyle} className="runtimeStatusPill">
          {summary.statusLabel}
        </span>
      </div>

      <div className="runtimeHeroBlock">
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
      </div>

      <div className="backendSummaryGrid runtimeSummaryGrid">
        {Object.values(summary.primaryMetrics).map((metric) => (
          <article key={metric.id} className="portfolioSummaryCard">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
    </>
  );
}
