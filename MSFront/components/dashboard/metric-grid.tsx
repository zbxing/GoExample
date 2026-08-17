import type { OverviewMetric } from '@/lib/types/management';

interface MetricGridProps {
  metrics: OverviewMetric[];
}

export function MetricGrid({ metrics }: MetricGridProps) {
  return (
    <div className="metricGrid">
      {metrics.map((metric) => (
        <article key={metric.id} className="metricCard">
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <p className={`trend trend-${metric.trend}`}>{metric.delta}</p>
        </article>
      ))}
    </div>
  );
}
