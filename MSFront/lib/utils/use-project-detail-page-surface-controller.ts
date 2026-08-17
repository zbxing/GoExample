'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import type { ManagementTone } from '@/components/common/management-primitives';
import type {
  ProjectEndpointField,
  ProjectEndpointIdentity,
  ProjectEndpointMetric,
} from '@/components/common/project-endpoint-surface';
import type {
  LocaleCode,
  ManagedProject,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  joinDetails,
} from '@/lib/utils/format';
import {
  buildEnvironmentsHref,
  buildIntegrationsHref,
  buildProjectsHref,
  buildServicesHref,
} from '@/lib/utils/governance-filters';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface ProjectDetailHeroStat {
  label: string;
  value: string;
}

interface ProjectDetailPanelTag {
  id: string;
  label: string;
}

interface ProjectDetailActionLink {
  href: Route;
  label: string;
}

interface ProjectDetailEndpointCardModel {
  identity: ProjectEndpointIdentity;
  status: ManagedProject['status'];
  environment: ManagedProject['environment'];
  metrics: readonly ProjectEndpointMetric[];
  fields: readonly ProjectEndpointField[];
}

interface UseProjectDetailPageSurfaceControllerOptions {
  project: ManagedProject;
  locale: LocaleCode;
  probeSignal: {
    label: string;
    tone: ManagementTone;
  };
  serverAttentionCount: number;
  serviceAttentionCount: number;
  t: TranslationFn;
}

export function useProjectDetailPageSurfaceController({
  project,
  locale,
  probeSignal,
  serverAttentionCount,
  serviceAttentionCount,
  t,
}: UseProjectDetailPageSurfaceControllerOptions) {
  const heroStats = useMemo<ProjectDetailHeroStat[]>(
    () => [
      {
        label: t('labels.owner'),
        value: project.owner,
      },
      {
        label: t('labels.region'),
        value: project.region,
      },
      {
        label: t('labels.version'),
        value: project.version,
      },
      {
        label: t('labels.lastDeploy'),
        value: formatDateTime(project.lastDeployedAt, locale),
      },
    ],
    [locale, project.lastDeployedAt, project.owner, project.region, project.version, t],
  );
  const heroTagLabels = useMemo(
    () => (project.tags.length > 0 ? project.tags : [t('projectDetail.noTags')]),
    [project.tags, t],
  );
  const endpointCard = useMemo<ProjectDetailEndpointCardModel>(
    () => ({
      identity: {
        eyebrow: t(`status.${project.environment}`),
        title: project.name,
        description: joinDetails([project.owner, project.region, project.version]),
      },
      status: project.status,
      environment: project.environment,
      metrics: [
        {
          label: t('labels.activeUsers'),
          value: formatNumber(project.activeUsers, locale),
        },
        {
          label: t('labels.requests'),
          value: formatNumber(project.requestPerMinute, locale),
        },
        {
          label: t('projectConsole.overview.servers'),
          value: formatNumber(project.servers.length, locale),
        },
        {
          label: t('projectConsole.overview.services'),
          value: formatNumber(project.services.length, locale),
        },
      ],
      fields: [
        {
          label: t('labels.baseUrl'),
          value: project.baseUrl,
        },
        {
          label: t('labels.apiBaseUrl'),
          value: project.apiBaseUrl,
        },
        {
          label: t('labels.probeBaseUrl'),
          value: project.probeBaseUrl ?? t('dashboard.integrations.probeEmpty'),
        },
      ],
    }),
    [
      locale,
      project.activeUsers,
      project.apiBaseUrl,
      project.baseUrl,
      project.environment,
      project.name,
      project.owner,
      project.probeBaseUrl,
      project.region,
      project.requestPerMinute,
      project.servers.length,
      project.services.length,
      project.status,
      project.version,
      t,
    ],
  );
  const serverPanelTags = useMemo<ProjectDetailPanelTag[]>(
    () => [
      {
        id: 'servers',
        label: `${formatNumber(project.servers.length, locale)} ${t('projectConsole.overview.servers')}`,
      },
      {
        id: 'server-attention',
        label: `${formatNumber(serverAttentionCount, locale)} ${t('dashboard.portfolio.attentionLabel')}`,
      },
    ],
    [locale, project.servers.length, serverAttentionCount, t],
  );
  const servicePanelTags = useMemo<ProjectDetailPanelTag[]>(
    () => [
      {
        id: 'services',
        label: `${formatNumber(project.services.length, locale)} ${t('projectConsole.overview.services')}`,
      },
      {
        id: 'service-attention',
        label: `${formatNumber(serviceAttentionCount, locale)} ${t('dashboard.portfolio.attentionLabel')}`,
      },
    ],
    [locale, project.services.length, serviceAttentionCount, t],
  );
  const actionLinks = useMemo<ProjectDetailActionLink[]>(
    () => [
      {
        href: buildIntegrationsHref({
          projectId: project.id,
        }) as Route,
        label: t('projectDetail.actions.openIntegrations'),
      },
      {
        href: buildServicesHref({
          projectId: project.id,
        }) as Route,
        label: t('projectDetail.actions.openServices'),
      },
      {
        href: buildEnvironmentsHref({
          environment: project.environment,
        }) as Route,
        label: t('projectDetail.actions.openEnvironment'),
      },
      {
        href: buildProjectsHref({
          projectId: project.id,
          mode: 'browse',
        }) as Route,
        label: t('projectDetail.actions.openProjects'),
      },
    ],
    [project.environment, project.id, t],
  );

  return {
    actionLinks,
    endpointCard,
    endpointSignal: probeSignal,
    heroStats,
    heroTagLabels,
    serverPanelTags,
    servicePanelTags,
  };
}
