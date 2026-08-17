'use client';

import type { Route } from 'next';
import Link from 'next/link';
import {
  WorkbenchStatusGroupSection,
  WorkbenchStatusGroupStack,
} from '@/components/common/workbench-status-group';
import {
  ProjectBadgeGroup,
  ProjectMetricList,
} from '@/components/common/project-surface';
import { useLocale } from '@/providers/locale-provider';
import {
  buildProjectDetailHref,
} from '@/lib/utils/governance-filters';
import type { useServicesPageSurfaceController } from '@/lib/utils/use-services-page-surface-controller';

type ServiceCardModel =
  ReturnType<typeof useServicesPageSurfaceController>['serviceCardMap'] extends Map<
    string,
    infer TValue
  >
    ? TValue
    : never;

type ServiceStatusGroupModel =
  ReturnType<typeof useServicesPageSurfaceController>['serviceStatusGroups'][number];

interface ServicesPageResultsContentProps {
  serviceCardMap: ReturnType<typeof useServicesPageSurfaceController>['serviceCardMap'];
  serviceStatusGroups: ReturnType<typeof useServicesPageSurfaceController>['serviceStatusGroups'];
}

export function ServicesPageResultsContent({
  serviceCardMap,
  serviceStatusGroups,
}: ServicesPageResultsContentProps) {
  if (serviceStatusGroups.length === 0) {
    return null;
  }

  return (
    <WorkbenchStatusGroupStack>
      {serviceStatusGroups.map((group) => (
        <ServiceStatusGroup
          key={group.status}
          group={group}
          serviceCardMap={serviceCardMap}
        />
      ))}
    </WorkbenchStatusGroupStack>
  );
}

function ServiceStatusGroup({
  group,
  serviceCardMap,
}: {
  group: ServiceStatusGroupModel;
  serviceCardMap: ReturnType<typeof useServicesPageSurfaceController>['serviceCardMap'];
}) {
  return (
    <WorkbenchStatusGroupSection
      eyebrow={group.eyebrow}
      title={group.title}
      description={group.description}
      summary={group.summary}
      bodyClassName="serviceGrid"
    >
      {group.entries.map((service) => {
        const serviceCard = serviceCardMap.get(service.id);

        if (!serviceCard) {
          return null;
        }

        return <ServiceCard key={service.id} service={serviceCard} />;
      })}
    </WorkbenchStatusGroupSection>
  );
}

function ServiceCard({ service }: { service: ServiceCardModel }) {
  const { t } = useLocale();

  return (
    <article className="serviceCard">
      <div className="serviceCardHeader">
        <div>
          <span className="serviceCategory">{service.categoryLabel}</span>
          <h3>{service.title}</h3>
          <p>{service.description}</p>
        </div>
        <ProjectBadgeGroup status={service.status} environment={service.environment} />
      </div>
      <ProjectMetricList metrics={service.metrics} />
      <p className="summaryFootnote">{service.footnote}</p>
      <div className="entityCardFooter">
        <Link
          href={buildProjectDetailHref(service.projectId) as Route}
          className="securityInlineLinkStrong"
        >
          {t('dashboard.services.context.viewProjectDetail')}
        </Link>
      </div>
    </article>
  );
}
