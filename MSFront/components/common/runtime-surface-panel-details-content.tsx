'use client';

import type { RuntimeSurfaceSummary } from '@/lib/management/runtime';
import { useLocale } from '@/providers/locale-provider';

interface RuntimeSurfacePanelDetailsContentProps {
  summary: RuntimeSurfaceSummary;
}

export function RuntimeSurfacePanelDetailsContent({
  summary,
}: RuntimeSurfacePanelDetailsContentProps) {
  const { t } = useLocale();

  return (
    <div className="runtimeDetailGrid">
      <article className="securitySurfaceCard runtimeDetailCard">
        <div className="sectionTitle">
          <h3>{t('dashboard.runtime.sections.health')}</h3>
        </div>
        <div className="summaryMetricList runtimeMetricList">
          {summary.detailMetrics.map((metric) => (
            <RuntimeMetricField key={metric.id} label={metric.label} value={metric.value} />
          ))}
        </div>
      </article>

      <article className="securitySurfaceCard runtimeDetailCard">
        <div className="sectionTitle">
          <h3>{t('dashboard.runtime.sections.diagnostics')}</h3>
        </div>
        <div className="summaryMetricList runtimeMetricList">
          {summary.diagnosticMetrics.map((metric) => (
            <RuntimeMetricField key={metric.id} label={metric.label} value={metric.value} />
          ))}
        </div>
      </article>

      {summary.endpointMetrics ? (
        <article className="securitySurfaceCard runtimeDetailCard runtimeDetailWide">
          <div className="sectionTitle">
            <h3>{t('dashboard.runtime.sections.endpoints')}</h3>
          </div>
          <div className="integrationEndpointGrid runtimeEndpointGrid">
            {summary.endpointMetrics.map((metric) => (
              <div key={metric.id} className="endpointField">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}

function RuntimeMetricField({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtimeMetricField">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
