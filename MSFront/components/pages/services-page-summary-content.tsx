'use client';

import { ProjectBadgeGroup, ProjectMetricList } from '@/components/common/project-surface';
import type { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

interface ServicesPageSummaryContentProps {
  categorySummaryCards: ReturnType<typeof useServicesPageSurfaceController>['categorySummaryCards'];
}

export function ServicesPageSummaryContent({
  categorySummaryCards,
}: ServicesPageSummaryContentProps) {
  return (
    <div className="serviceSummaryGrid">
      {categorySummaryCards.map((summary) => (
        <ServiceSummaryCard key={summary.category} summary={summary} />
      ))}
    </div>
  );
}

function ServiceSummaryCard({
  summary,
}: {
  summary: ReturnType<typeof useServicesPageSurfaceController>['categorySummaryCards'][number];
}) {
  return (
    <article className="serviceSummaryCard">
      <div className="serviceCardHeader">
        <div>
          <span className="serviceCategory">{summary.category}</span>
          <h3>{summary.title}</h3>
        </div>
        <ProjectBadgeGroup status={summary.status} />
      </div>
      <ProjectMetricList metrics={summary.metrics} />
      <p className="summaryFootnote">{summary.footnote}</p>
    </article>
  );
}
