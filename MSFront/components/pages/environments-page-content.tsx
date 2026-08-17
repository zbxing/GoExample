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
import type {
  ProjectEnvironment,
} from '@/lib/types/management';
import {
  buildProjectDetailHref,
  buildProjectsHref,
} from '@/lib/utils/governance-filters';
import type { useEnvironmentsPageSurfaceController } from '@/lib/utils/use-environments-page-surface-controller';

type EnvironmentCardModel =
  ReturnType<typeof useEnvironmentsPageSurfaceController>['environmentCards'] extends Map<
    ProjectEnvironment,
    infer TValue
  >
    ? TValue
    : never;

type EnvironmentStatusGroupModel =
  ReturnType<typeof useEnvironmentsPageSurfaceController>['environmentStatusGroups'][number];

interface EnvironmentsPageResultsContentProps {
  environmentCards: ReturnType<typeof useEnvironmentsPageSurfaceController>['environmentCards'];
  environmentStatusGroups: ReturnType<
    typeof useEnvironmentsPageSurfaceController
  >['environmentStatusGroups'];
}

export function EnvironmentsPageResultsContent({
  environmentCards,
  environmentStatusGroups,
}: EnvironmentsPageResultsContentProps) {
  if (environmentStatusGroups.length === 0) {
    return null;
  }

  return (
    <WorkbenchStatusGroupStack>
      {environmentStatusGroups.map((group) => (
        <EnvironmentStatusGroup
          key={group.status}
          group={group}
          environmentCards={environmentCards}
        />
      ))}
    </WorkbenchStatusGroupStack>
  );
}

function EnvironmentStatusGroup({
  environmentCards,
  group,
}: {
  environmentCards: ReturnType<typeof useEnvironmentsPageSurfaceController>['environmentCards'];
  group: EnvironmentStatusGroupModel;
}) {
  return (
    <WorkbenchStatusGroupSection
      eyebrow={group.eyebrow}
      title={group.title}
      description={group.description}
      summary={group.summary}
      bodyClassName="environmentGrid"
    >
      {group.entries.map((item) => {
        const environmentCard = environmentCards.get(item.environment);

        if (!environmentCard) {
          return null;
        }

        return <EnvironmentCard key={item.environment} item={environmentCard} />;
      })}
    </WorkbenchStatusGroupSection>
  );
}

function EnvironmentCard({ item }: { item: EnvironmentCardModel }) {
  const { t } = useLocale();

  return (
    <article className="environmentCard">
      <div className="serviceCardHeader">
        <div>
          <span className="serviceCategory">{item.eyebrow}</span>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </div>
        <ProjectBadgeGroup status={item.status} environment={item.environment} />
      </div>
      <ProjectMetricList metrics={item.metrics} />
      <ul>
        <li>{item.healthLine}</li>
        <li>{item.capacityLine}</li>
        <li>{item.coverageLine}</li>
        <li>{item.deployLine}</li>
      </ul>
      <div className="environmentProjectStack">
        {item.projectCards.map((project) => (
          <ProjectRegistryItem key={project.id} project={project} />
        ))}
      </div>
      <div className="entityCardFooter">
        <Link
          href={buildProjectsHref({ portfolioEnvironment: item.environment }) as Route}
          className="securityInlineLinkStrong"
        >
          {t('dashboard.environments.context.openProjectRegistry')}
        </Link>
      </div>
    </article>
  );
}

function ProjectRegistryItem({
  project,
}: {
  project: EnvironmentCardModel['projectCards'][number];
}) {
  const { t } = useLocale();

  return (
    <article className="registryItem registryItemStatic">
      <div className="securityHeaderRow">
        <div>
          <strong>{project.title}</strong>
          <span>{project.owner}</span>
          <small>{project.meta}</small>
        </div>
        <ProjectBadgeGroup status={project.status} />
      </div>
      <ProjectMetricList metrics={project.metrics} />
      <div className="entityCardFooter">
        <Link
          href={buildProjectDetailHref(project.projectId)}
          className="securityInlineLinkStrong"
        >
          {t('dashboard.environments.context.viewProjectDetail')}
        </Link>
      </div>
    </article>
  );
}
