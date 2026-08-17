'use client';

import { useMemo } from 'react';
import type {
  ManagedProjectDraft,
  ManagedProjectServer,
  ManagedProjectService,
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

type UpdateDraftFn = <K extends keyof ManagedProjectDraft>(
  key: K,
  value: ManagedProjectDraft[K],
) => void;

type UpdateServerFn = (
  index: number,
  key: keyof ManagedProjectServer,
  value: string | number,
) => void;

type UpdateServiceFn = (
  index: number,
  key: keyof ManagedProjectService,
  value: string,
) => void;

interface SelectOption {
  value: string;
  label: string;
}

interface ProjectEditorFieldBaseModel {
  id: string;
  label: string;
  hint: string;
  className?: string;
}

interface ProjectEditorInputFieldModel extends ProjectEditorFieldBaseModel {
  control: 'input';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputType?: 'text' | 'datetime-local';
  step?: number;
}

interface ProjectEditorTextareaFieldModel extends ProjectEditorFieldBaseModel {
  control: 'textarea';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
}

interface ProjectEditorNumberFieldModel extends ProjectEditorFieldBaseModel {
  control: 'number';
  value: number;
  onChange: (value: number) => void;
  step?: number;
}

interface ProjectEditorSelectFieldModel extends ProjectEditorFieldBaseModel {
  control: 'select';
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
}

export type ProjectEditorFieldModel =
  | ProjectEditorInputFieldModel
  | ProjectEditorTextareaFieldModel
  | ProjectEditorNumberFieldModel
  | ProjectEditorSelectFieldModel;

export interface ProjectEditorSectionPresentationModel {
  id: string;
  title: string;
  description: string;
  fields: readonly ProjectEditorFieldModel[];
}

export interface ProjectEntityEditorCardPresentationModel {
  id: string;
  title: string;
  removeLabel: string;
  onRemove: () => void;
  fields: readonly ProjectEditorFieldModel[];
}

export interface ProjectEntityEditorSectionPresentationModel {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  cards: readonly ProjectEntityEditorCardPresentationModel[];
}

interface UseProjectManagementConsolePresentationControllerOptions {
  draft: ManagedProjectDraft | null;
  addServer: () => void;
  addService: () => void;
  removeServer: (index: number) => void;
  removeService: (index: number) => void;
  updateDraft: UpdateDraftFn;
  updateServer: UpdateServerFn;
  updateService: UpdateServiceFn;
  t: TranslationFn;
}

const environmentOptions: ProjectEnvironment[] = ['production', 'staging', 'development'];
const statusOptions: ProjectStatus[] = ['healthy', 'warning', 'critical'];
const serviceCategoryOptions: ManagedServiceCategory[] = [
  'api',
  'worker',
  'queue',
  'storage',
  'database',
];

export function useProjectManagementConsolePresentationController({
  draft,
  addServer,
  addService,
  removeServer,
  removeService,
  updateDraft,
  updateServer,
  updateService,
  t,
}: UseProjectManagementConsolePresentationControllerOptions) {
  const environmentSelectOptions = useMemo(
    () =>
      environmentOptions.map((option) => ({
        value: option,
        label: t(`status.${option}`),
      })),
    [t],
  );
  const statusSelectOptions = useMemo(
    () =>
      statusOptions.map((option) => ({
        value: option,
        label: t(`status.${option}`),
      })),
    [t],
  );
  const serviceCategorySelectOptions = useMemo(
    () =>
      serviceCategoryOptions.map((option) => ({
        value: option,
        label: t(`dashboard.services.categories.${option}`),
      })),
    [t],
  );

  const editorSections = useMemo<ProjectEditorSectionPresentationModel[]>(
    () => {
      if (!draft) {
        return [];
      }

      return [
        {
          id: 'basics',
          title: t('projectConsole.sections.basics'),
          description: t('projectConsole.sections.basicsDescription'),
          fields: [
            {
              id: 'code',
              control: 'input',
              label: t('labels.code'),
              value: draft.code,
              onChange: (value) => updateDraft('code', value.toUpperCase()),
              placeholder: t('projectConsole.placeholders.code'),
              hint: t('projectConsole.hints.code'),
            },
            {
              id: 'name',
              control: 'input',
              label: t('labels.name'),
              value: draft.name,
              onChange: (value) => updateDraft('name', value),
              placeholder: t('projectConsole.placeholders.name'),
              hint: t('projectConsole.hints.name'),
            },
            {
              id: 'owner',
              control: 'input',
              label: t('labels.owner'),
              value: draft.owner,
              onChange: (value) => updateDraft('owner', value),
              placeholder: t('projectConsole.placeholders.owner'),
              hint: t('projectConsole.hints.owner'),
            },
            {
              id: 'region',
              control: 'input',
              label: t('labels.region'),
              value: draft.region,
              onChange: (value) => updateDraft('region', value),
              placeholder: t('projectConsole.placeholders.region'),
              hint: t('projectConsole.hints.region'),
            },
            {
              id: 'description',
              control: 'textarea',
              label: t('labels.description'),
              value: draft.description,
              onChange: (value) => updateDraft('description', value),
              placeholder: t('projectConsole.placeholders.description'),
              hint: draft.description.trim()
                ? t('projectConsole.hints.description')
                : t('projectConsole.noDescription'),
              rows: 3,
              className: 'fieldWide',
            },
            {
              id: 'environment',
              control: 'select',
              label: t('labels.environment'),
              value: draft.environment,
              onChange: (value) => updateDraft('environment', value as ProjectEnvironment),
              options: environmentSelectOptions,
              hint: '',
            },
            {
              id: 'status',
              control: 'select',
              label: t('labels.status'),
              value: draft.status,
              onChange: (value) => updateDraft('status', value as ProjectStatus),
              options: statusSelectOptions,
              hint: '',
            },
          ],
        },
        {
          id: 'endpoints',
          title: t('projectConsole.sections.endpoints'),
          description: t('projectConsole.sections.endpointsDescription'),
          fields: [
            {
              id: 'baseUrl',
              control: 'input',
              label: t('labels.baseUrl'),
              value: draft.baseUrl,
              onChange: (value) => updateDraft('baseUrl', value),
              placeholder: t('projectConsole.placeholders.baseUrl'),
              hint: t('projectConsole.hints.baseUrl'),
            },
            {
              id: 'apiBaseUrl',
              control: 'input',
              label: t('labels.apiBaseUrl'),
              value: draft.apiBaseUrl,
              onChange: (value) => updateDraft('apiBaseUrl', value),
              placeholder: t('projectConsole.placeholders.apiBaseUrl'),
              hint: t('projectConsole.hints.apiBaseUrl'),
            },
            {
              id: 'probeBaseUrl',
              control: 'input',
              label: t('labels.probeBaseUrl'),
              value: draft.probeBaseUrl ?? '',
              onChange: (value) => updateDraft('probeBaseUrl', value),
              placeholder: t('projectConsole.placeholders.probeBaseUrl'),
              hint: t('projectConsole.hints.probeBaseUrl'),
            },
            {
              id: 'version',
              control: 'input',
              label: t('labels.version'),
              value: draft.version,
              onChange: (value) => updateDraft('version', value),
              placeholder: t('projectConsole.placeholders.version'),
              hint: t('projectConsole.hints.version'),
            },
            {
              id: 'lastDeployedAt',
              control: 'input',
              inputType: 'datetime-local',
              step: 60,
              label: t('labels.lastDeploy'),
              value: toDateTimeLocalValue(draft.lastDeployedAt),
              onChange: (value) => updateDraft('lastDeployedAt', value),
              hint: t('projectConsole.hints.lastDeploy'),
              className: 'fieldWide',
            },
          ],
        },
        {
          id: 'workload',
          title: t('projectConsole.sections.workload'),
          description: t('projectConsole.sections.workloadDescription'),
          fields: [
            {
              id: 'activeUsers',
              control: 'number',
              label: t('labels.activeUsers'),
              value: draft.activeUsers,
              onChange: (value) => updateDraft('activeUsers', value),
              hint: t('projectConsole.hints.activeUsers'),
            },
            {
              id: 'requestPerMinute',
              control: 'number',
              label: t('labels.requests'),
              value: draft.requestPerMinute,
              onChange: (value) => updateDraft('requestPerMinute', value),
              hint: t('projectConsole.hints.requests'),
            },
            {
              id: 'errorRate',
              control: 'number',
              label: t('labels.errorRate'),
              value: draft.errorRate,
              onChange: (value) => updateDraft('errorRate', value),
              step: 0.01,
              hint: t('projectConsole.hints.errorRate'),
            },
            {
              id: 'tags',
              control: 'input',
              label: t('labels.tags'),
              value: draft.tags.join(', '),
              onChange: (value) =>
                updateDraft(
                  'tags',
                  value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              placeholder: t('projectConsole.placeholders.tags'),
              hint: t('projectConsole.hints.tags'),
              className: 'fieldWide',
            },
          ],
        },
      ];
    },
    [draft, environmentSelectOptions, statusSelectOptions, t, updateDraft],
  );

  const removeLabel = t('actions.remove');
  const serverEditorSection = useMemo<ProjectEntityEditorSectionPresentationModel | null>(
    () =>
      draft
        ? {
            title: t('sections.servers'),
            description: t('projectConsole.sections.serversDescription'),
            addLabel: t('actions.addServer'),
            onAdd: addServer,
            cards: draft.servers.map((server, index) => ({
              id: server.id,
              title: server.name,
              removeLabel,
              onRemove: () => removeServer(index),
              fields: [
                {
                  id: `${server.id}-id`,
                  control: 'input',
                  label: t('labels.id'),
                  value: server.id,
                  onChange: (value) => updateServer(index, 'id', value),
                  hint: '',
                },
                {
                  id: `${server.id}-name`,
                  control: 'input',
                  label: t('labels.name'),
                  value: server.name,
                  onChange: (value) => updateServer(index, 'name', value),
                  placeholder: t('projectConsole.placeholders.serverName'),
                  hint: '',
                },
                {
                  id: `${server.id}-region`,
                  control: 'input',
                  label: t('labels.region'),
                  value: server.region,
                  onChange: (value) => updateServer(index, 'region', value),
                  placeholder: t('projectConsole.placeholders.serverRegion'),
                  hint: '',
                },
                {
                  id: `${server.id}-host`,
                  control: 'input',
                  label: t('labels.serverHost'),
                  value: server.host,
                  onChange: (value) => updateServer(index, 'host', value),
                  placeholder: t('projectConsole.placeholders.serverHost'),
                  hint: '',
                },
                {
                  id: `${server.id}-environment`,
                  control: 'select',
                  label: t('labels.environment'),
                  value: server.environment,
                  onChange: (value) => updateServer(index, 'environment', value),
                  options: environmentSelectOptions,
                  hint: '',
                },
                {
                  id: `${server.id}-status`,
                  control: 'select',
                  label: t('labels.status'),
                  value: server.status,
                  onChange: (value) => updateServer(index, 'status', value),
                  options: statusSelectOptions,
                  hint: '',
                },
                {
                  id: `${server.id}-cpuUsage`,
                  control: 'number',
                  label: t('labels.cpuUsage'),
                  value: server.cpuUsage,
                  onChange: (value) => updateServer(index, 'cpuUsage', value),
                  hint: '',
                },
                {
                  id: `${server.id}-memoryUsage`,
                  control: 'number',
                  label: t('labels.memoryUsage'),
                  value: server.memoryUsage,
                  onChange: (value) => updateServer(index, 'memoryUsage', value),
                  hint: '',
                },
                {
                  id: `${server.id}-responseTimeMs`,
                  control: 'number',
                  label: t('labels.responseTime'),
                  value: server.responseTimeMs,
                  onChange: (value) => updateServer(index, 'responseTimeMs', value),
                  hint: '',
                },
              ],
            })),
          }
        : null,
    [addServer, draft, environmentSelectOptions, removeLabel, removeServer, statusSelectOptions, t, updateServer],
  );
  const serviceEditorSection = useMemo<ProjectEntityEditorSectionPresentationModel | null>(
    () =>
      draft
        ? {
            title: t('sections.services'),
            description: t('projectConsole.sections.servicesDescription'),
            addLabel: t('actions.addService'),
            onAdd: addService,
            cards: draft.services.map((service, index) => ({
              id: service.id,
              title: service.name,
              removeLabel,
              onRemove: () => removeService(index),
              fields: [
                {
                  id: `${service.id}-id`,
                  control: 'input',
                  label: t('labels.id'),
                  value: service.id,
                  onChange: (value) => updateService(index, 'id', value),
                  hint: '',
                },
                {
                  id: `${service.id}-name`,
                  control: 'input',
                  label: t('labels.name'),
                  value: service.name,
                  onChange: (value) => updateService(index, 'name', value),
                  placeholder: t('projectConsole.placeholders.serviceName'),
                  hint: '',
                },
                {
                  id: `${service.id}-category`,
                  control: 'select',
                  label: t('labels.serviceCategory'),
                  value: service.category,
                  onChange: (value) => updateService(index, 'category', value),
                  options: serviceCategorySelectOptions,
                  hint: '',
                },
                {
                  id: `${service.id}-uptime`,
                  control: 'input',
                  label: t('labels.uptime'),
                  value: service.uptime,
                  onChange: (value) => updateService(index, 'uptime', value),
                  placeholder: t('projectConsole.placeholders.uptime'),
                  hint: '',
                },
                {
                  id: `${service.id}-status`,
                  control: 'select',
                  label: t('labels.status'),
                  value: service.status,
                  onChange: (value) => updateService(index, 'status', value),
                  options: statusSelectOptions,
                  hint: '',
                },
              ],
            })),
          }
        : null,
    [addService, draft, removeLabel, removeService, serviceCategorySelectOptions, statusSelectOptions, t, updateService],
  );

  return {
    editorSections,
    serverEditorSection,
    serviceEditorSection,
  };
}

function toDateTimeLocalValue(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    return '';
  }

  const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}
