'use client';

import {
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';
import {
  buildProjectDetailHref,
  buildProjectsHref,
  resolveProjectsPortfolioFilterState,
  resolveProjectsRegistryFilterState,
  type ProjectSortMode,
  type ProjectsRegistryFilterState,
  type ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';
import {
  compareProjectsBySortMode,
  projectNeedsAttention,
} from '@/lib/utils/project-surface';
import type {
  LocaleCode,
  ManagedProject,
  ManagedProjectDraft,
  ManagedProjectServer,
  ManagedProjectService,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { useProjectSelection } from '@/providers/project-provider';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseProjectManagementConsoleControllerOptions {
  projects: ManagedProject[];
  selectedProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ProjectSortMode;
  initialMode?: ProjectsRegistryMode;
  enableUrlSync?: boolean;
  allowCreate?: boolean;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectManagementConsoleController({
  projects,
  selectedProjectId,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  initialMode = 'browse',
  enableUrlSync = false,
  allowCreate = true,
  locale,
  t,
}: UseProjectManagementConsoleControllerOptions) {
  const initialProject =
    initialMode === 'create'
      ? null
      : projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const { refreshProjects, setSelectedProjectId } = useProjectSelection();
  const [isPending, startTransition] = useTransition();
  const [projectList, setProjectList] = useState<ManagedProject[]>(projects);
  const [linkedProjectId, setLinkedProjectId] = useState<string>(
    initialMode === 'create' ? '' : selectedProjectId ?? '',
  );
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProject?.id ?? '');
  const [isCreating, setIsCreating] = useState<boolean>(
    initialMode === 'create' || (!selectedProjectId && projects.length === 0),
  );
  const [draft, setDraft] = useState<ManagedProjectDraft | null>(
    initialProject ? toDraft(initialProject) : createEmptyDraft(),
  );
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback({ durationMs: 4200 });
  const [registryQuery, setRegistryQuery] = useState<string>(initialSearch);
  const [environmentFilter, setEnvironmentFilter] =
    useState<'all' | ProjectEnvironment>(initialEnvironment);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>(initialStatus);
  const [sortMode, setSortMode] = useState<ProjectSortMode>(initialSort);
  const deferredRegistryQuery = useDeferredValue(registryQuery);

  const activeProject = useMemo(
    () => projectList.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projectList],
  );
  const filteredProjectList = useMemo(() => {
    const normalizedSearch = deferredRegistryQuery.trim().toLowerCase();

    return [...projectList]
      .filter((project) => {
        if (environmentFilter !== 'all' && project.environment !== environmentFilter) {
          return false;
        }

        if (statusFilter !== 'all' && project.status !== statusFilter) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const haystack = [
          project.name,
          project.code,
          project.description,
          project.owner,
          project.region,
          project.version,
          project.environment,
          project.status,
          project.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => compareProjectsBySortMode(left, right, sortMode, locale));
  }, [
    deferredRegistryQuery,
    environmentFilter,
    locale,
    projectList,
    sortMode,
    statusFilter,
  ]);
  const validationIssues = useMemo(
    () => (draft ? validateDraft(draft, t) : []),
    [draft, t],
  );
  const configuredUrlCount = useMemo(() => {
    if (!draft) {
      return 0;
    }

    return [draft.baseUrl, draft.apiBaseUrl, draft.probeBaseUrl]
      .filter((value) => `${value ?? ''}`.trim().length > 0)
      .length;
  }, [draft]);
  const registrySummary = useMemo(() => {
    const owners = new Set<string>();
    const regions = new Set<string>();
    let attentionCount = 0;
    let productionCount = 0;

    for (const project of filteredProjectList) {
      owners.add(project.owner);
      regions.add(project.region);

      if (projectNeedsAttention(project)) {
        attentionCount += 1;
      }

      if (project.environment === 'production') {
        productionCount += 1;
      }
    }

    return {
      attentionCount,
      ownerCount: owners.size,
      productionCount,
      regionCount: regions.size,
    };
  }, [filteredProjectList]);
  const currentFilterState = useMemo<ProjectsRegistryFilterState>(
    () => ({
      projectId: isCreating ? '' : linkedProjectId,
      search: registryQuery,
      environment: environmentFilter,
      status: statusFilter,
      sort: sortMode,
      mode: isCreating ? 'create' : 'browse',
    }),
    [environmentFilter, isCreating, linkedProjectId, registryQuery, sortMode, statusFilter],
  );

  function buildRegistryFilterHref(currentSearch: string) {
    const currentSearchParams = new URLSearchParams(currentSearch);
    const preservedPortfolioFilters = resolveProjectsPortfolioFilterState({
      portfolioSearch: currentSearchParams.get('portfolioSearch'),
      portfolioEnvironment: currentSearchParams.get('portfolioEnvironment'),
      environment: currentSearchParams.get('environment'),
      portfolioStatus: currentSearchParams.get('portfolioStatus'),
      portfolioSort: currentSearchParams.get('portfolioSort'),
    });

    return buildProjectsHref({
      portfolioSearch: preservedPortfolioFilters.search,
      portfolioEnvironment: preservedPortfolioFilters.environment,
      portfolioStatus: preservedPortfolioFilters.status,
      portfolioSort: preservedPortfolioFilters.sort,
      projectId: currentFilterState.projectId,
      registrySearch: currentFilterState.search,
      registryEnvironment: currentFilterState.environment,
      registryStatus: currentFilterState.status,
      registrySort: currentFilterState.sort,
      mode: currentFilterState.mode,
    });
  }

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveProjectsRegistryFilterState(
      {
        projectId: nextSearchParams.get('projectId'),
        registrySearch: nextSearchParams.get('registrySearch'),
        registryEnvironment: nextSearchParams.get('registryEnvironment'),
        registryStatus: nextSearchParams.get('registryStatus'),
        registrySort: nextSearchParams.get('registrySort'),
        mode: nextSearchParams.get('mode'),
      },
      projectList.map((project) => project.id),
    );
    const nextSelectedProject = selectManagedProject(projectList, nextFilters.projectId);
    const fallbackProject = nextSelectedProject ?? projectList[0] ?? null;

    setRegistryQuery(nextFilters.search);
    setEnvironmentFilter(nextFilters.environment);
    setStatusFilter(nextFilters.status);
    setSortMode(nextFilters.sort);
    setLinkedProjectId(nextFilters.projectId);
    setActiveProjectId(fallbackProject?.id ?? '');
    setIsCreating(nextFilters.mode === 'create' || (projectList.length === 0 && !nextFilters.projectId));
    setSelectedProjectId(nextFilters.mode === 'create' ? '' : fallbackProject?.id ?? '');
    setDraft(
      nextFilters.mode === 'create'
        ? createEmptyDraft()
        : fallbackProject
          ? toDraft(fallbackProject)
          : createEmptyDraft(),
    );
    clearFeedback();
  }

  useUrlFilterHistory({
    enabled: enableUrlSync,
    pathname,
    currentState: currentFilterState,
    getCurrentHref: buildRegistryFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushProjectsHistory,
  });

  function updateDraft<K extends keyof ManagedProjectDraft>(key: K, value: ManagedProjectDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateServer(index: number, key: keyof ManagedProjectServer, value: string | number) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextServers = current.servers.map((server, currentIndex) =>
        currentIndex === index ? { ...server, [key]: value } : server,
      );

      return { ...current, servers: nextServers };
    });
  }

  function updateService(index: number, key: keyof ManagedProjectService, value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextServices = current.services.map((service, currentIndex) =>
        currentIndex === index ? { ...service, [key]: value } : service,
      );

      return { ...current, services: nextServices };
    });
  }

  function addServer() {
    setDraft((current) =>
      current
        ? {
            ...current,
            servers: [
              ...current.servers,
              {
                id: `server-${Date.now()}`,
                name: t('projectConsole.entities.serverDraftName'),
                region: t('projectConsole.entities.serverDraftRegion'),
                host: t('projectConsole.entities.serverDraftHost'),
                environment: current.environment,
                status: current.status,
                cpuUsage: 0,
                memoryUsage: 0,
                responseTimeMs: 0,
              },
            ],
          }
        : current,
    );
  }

  function removeServer(index: number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            servers: current.servers.filter((_, currentIndex) => currentIndex !== index),
          }
        : current,
    );
  }

  function addService() {
    setDraft((current) =>
      current
        ? {
            ...current,
            services: [
              ...current.services,
              {
                id: `service-${Date.now()}`,
                name: t('projectConsole.entities.serviceDraftName'),
                category: 'api',
                uptime: t('projectConsole.placeholders.uptime'),
                status: current.status,
              },
            ],
          }
        : current,
    );
  }

  function removeService(index: number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            services: current.services.filter((_, currentIndex) => currentIndex !== index),
          }
        : current,
    );
  }

  function createProject() {
    if (!allowCreate) {
      return;
    }

    setIsCreating(true);
    setLinkedProjectId('');
    setActiveProjectId('');
    setSelectedProjectId('');
    setDraft(createEmptyDraft());
    clearFeedback();
  }

  function selectProject(project: ManagedProject) {
    setIsCreating(false);
    setLinkedProjectId(project.id);
    setActiveProjectId(project.id);
    setSelectedProjectId(project.id);
    setDraft(toDraft(project));
    clearFeedback();
  }

  function clearProjectFilter() {
    const fallbackProject = projectList[0] ?? null;

    clearFeedback();
    setLinkedProjectId('');
    setActiveProjectId(fallbackProject?.id ?? '');
    setDraft(fallbackProject ? toDraft(fallbackProject) : createEmptyDraft());
    setSelectedProjectId(fallbackProject?.id ?? '');
    setIsCreating(projectList.length === 0);
  }

  function resetRegistryFilters() {
    clearFeedback();
    setRegistryQuery('');
    setEnvironmentFilter('all');
    setStatusFilter('all');
    setSortMode('risk');
  }

  async function saveProject() {
    if (!draft) {
      return;
    }

    if (validationIssues.length > 0) {
      clearFeedback();
      showError(t('projectConsole.messages.validationBlocked'));
      return;
    }

    clearFeedback();

    const method = activeProject ? 'PUT' : 'POST';
    const endpoint = activeProject
      ? `/api/management/projects/${activeProject.id}`
      : '/api/management/projects';

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(endpoint, {
            method,
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify(draft),
          });

          const payload = (await response.json()) as ManagedProject | { message?: string };

          if (!response.ok) {
            showError(
              'message' in payload
                ? payload.message ?? t('projectConsole.messages.saveError')
                : t('projectConsole.messages.saveError'),
            );
            return;
          }

          const project = payload as ManagedProject;
          setIsCreating(false);
          setLinkedProjectId(project.id);
          setProjectList((currentProjects) => upsertProject(currentProjects, project));
          setActiveProjectId(project.id);
          setSelectedProjectId(project.id);
          setDraft(toDraft(project));
          await refreshProjects({ selectedProjectId: project.id });
          showSuccess(t('projectConsole.messages.saveSuccess', { project: project.name }));
          if (!enableUrlSync) {
            router.push(buildProjectDetailHref(project.id));
          }
          router.refresh();
        } catch {
          showError(t('projectConsole.messages.saveError'));
        }
      })();
    });
  }

  async function removeProject() {
    if (!activeProject) {
      return;
    }

    clearFeedback();

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/management/projects/${activeProject.id}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            showError(payload.message ?? t('projectConsole.messages.deleteError'));
            return;
          }

          const nextProjects = projectList.filter((project) => project.id !== activeProject.id);
          const fallbackProject = nextProjects[0] ?? null;
          const shouldLinkFallbackProject = Boolean(linkedProjectId);

          showSuccess(t('projectConsole.messages.deleteSuccess', { project: activeProject.name }));
          setProjectList(nextProjects);
          setIsCreating(nextProjects.length === 0);
          setLinkedProjectId(
            nextProjects.length === 0
              ? ''
              : shouldLinkFallbackProject
                ? fallbackProject?.id ?? ''
                : '',
          );
          setActiveProjectId(fallbackProject?.id ?? '');
          setDraft(fallbackProject ? toDraft(fallbackProject) : createEmptyDraft());
          setSelectedProjectId(fallbackProject?.id ?? '');
          await refreshProjects({ selectedProjectId: fallbackProject?.id ?? '' });
          if (!enableUrlSync) {
            router.push(buildProjectDetailHref());
          }
          router.refresh();
        } catch {
          showError(t('projectConsole.messages.deleteError'));
        }
      })();
    });
  }

  const editorDescription =
    isCreating || !activeProject
      ? t('projectConsole.editorCreateDescription')
      : t('projectConsole.editorExistingDescription', { project: activeProject.name });

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('projectConsole.messages.copyFiltersSuccess'));
    } catch {
      showError(t('projectConsole.messages.copyFiltersError'));
    }
  }

  return {
    activeProject,
    activeProjectId,
    addServer,
    addService,
    clearProjectFilter,
    configuredUrlCount,
    createProject,
    draft,
    editorDescription,
    environmentFilter,
    feedback,
    filteredProjectList,
    handleCopyCurrentView,
    isCreating,
    isPending,
    linkedProjectId,
    projectList,
    registryAttentionCount: registrySummary.attentionCount,
    registryOwnerCount: registrySummary.ownerCount,
    registryProductionCount: registrySummary.productionCount,
    registryQuery,
    registryRegionCount: registrySummary.regionCount,
    removeProject,
    removeServer,
    removeService,
    resetRegistryFilters,
    saveProject,
    selectProject,
    setEnvironmentFilter,
    setRegistryQuery,
    setSortMode,
    setStatusFilter,
    sortMode,
    statusFilter,
    updateDraft,
    updateServer,
    updateService,
    validationIssues,
  };
}

function upsertProject(projects: ManagedProject[], project: ManagedProject) {
  const existingIndex = projects.findIndex((item) => item.id === project.id);

  if (existingIndex < 0) {
    return [project, ...projects];
  }

  return projects.map((item, index) => (index === existingIndex ? project : item));
}

function toDraft(project: ManagedProject): ManagedProjectDraft {
  return {
    name: project.name,
    code: project.code,
    description: project.description,
    owner: project.owner,
    environment: project.environment,
    status: project.status,
    region: project.region,
    baseUrl: project.baseUrl,
    apiBaseUrl: project.apiBaseUrl,
    probeBaseUrl: project.probeBaseUrl ?? '',
    tags: project.tags,
    version: project.version,
    lastDeployedAt: project.lastDeployedAt,
    activeUsers: project.activeUsers,
    requestPerMinute: project.requestPerMinute,
    errorRate: project.errorRate,
    servers: project.servers.map((server) => ({ ...server })),
    services: project.services.map((service) => ({ ...service })),
  };
}

function createEmptyDraft(): ManagedProjectDraft {
  const now = new Date().toISOString();

  return {
    name: '',
    code: '',
    description: '',
    owner: '',
    environment: 'development',
    status: 'healthy',
    region: '',
    baseUrl: '',
    apiBaseUrl: '',
    probeBaseUrl: '',
    tags: [],
    version: 'v0.0.1',
    lastDeployedAt: now,
    activeUsers: 0,
    requestPerMinute: 0,
    errorRate: 0,
    servers: [],
    services: [],
  };
}

function validateDraft(
  draft: ManagedProjectDraft,
  t: TranslationFn,
) {
  const issues: string[] = [];

  if (!draft.code.trim()) {
    issues.push(t('projectConsole.validation.codeRequired'));
  }

  if (!draft.name.trim()) {
    issues.push(t('projectConsole.validation.nameRequired'));
  }

  if (!draft.owner.trim()) {
    issues.push(t('projectConsole.validation.ownerRequired'));
  }

  if (!draft.region.trim()) {
    issues.push(t('projectConsole.validation.regionRequired'));
  }

  if (!draft.description.trim()) {
    issues.push(t('projectConsole.validation.descriptionRequired'));
  }

  if (!draft.baseUrl.trim()) {
    issues.push(t('projectConsole.validation.baseUrlRequired'));
  }

  if (!draft.apiBaseUrl.trim()) {
    issues.push(t('projectConsole.validation.apiBaseUrlRequired'));
  }

  if (!draft.version.trim()) {
    issues.push(t('projectConsole.validation.versionRequired'));
  }

  if (!draft.lastDeployedAt.trim()) {
    issues.push(t('projectConsole.validation.lastDeployRequired'));
  } else if (Number.isNaN(new Date(draft.lastDeployedAt).valueOf())) {
    issues.push(t('projectConsole.validation.lastDeployInvalid'));
  }

  if (!Number.isFinite(draft.activeUsers) || draft.activeUsers < 0) {
    issues.push(t('projectConsole.validation.activeUsersInvalid'));
  }

  if (!Number.isFinite(draft.requestPerMinute) || draft.requestPerMinute < 0) {
    issues.push(t('projectConsole.validation.requestsInvalid'));
  }

  if (!Number.isFinite(draft.errorRate) || draft.errorRate < 0) {
    issues.push(t('projectConsole.validation.errorRateInvalid'));
  }

  draft.servers.forEach((server, index) => {
    if (!`${server.id}`.trim()) {
      issues.push(`${t('projectConsole.validation.serverIdRequired')} #${index + 1}`);
    }

    if (!`${server.name}`.trim()) {
      issues.push(`${t('projectConsole.validation.serverNameRequired')} #${index + 1}`);
    }

    if (!`${server.region}`.trim()) {
      issues.push(`${t('projectConsole.validation.serverRegionRequired')} #${index + 1}`);
    }

    if (!`${server.host}`.trim()) {
      issues.push(`${t('projectConsole.validation.serverHostRequired')} #${index + 1}`);
    }
  });

  draft.services.forEach((service, index) => {
    if (!`${service.id}`.trim()) {
      issues.push(`${t('projectConsole.validation.serviceIdRequired')} #${index + 1}`);
    }

    if (!`${service.name}`.trim()) {
      issues.push(`${t('projectConsole.validation.serviceNameRequired')} #${index + 1}`);
    }

    if (!`${service.uptime}`.trim()) {
      issues.push(`${t('projectConsole.validation.serviceUptimeRequired')} #${index + 1}`);
    }
  });

  return issues;
}

function selectManagedProject(projects: readonly ManagedProject[], projectId: string) {
  if (!projectId) {
    return null;
  }

  return projects.find((project) => project.id === projectId) ?? null;
}

function shouldPushProjectsHistory(
  previousFilters: ProjectsRegistryFilterState | null,
  nextFilters: ProjectsRegistryFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.projectId !== nextFilters.projectId ||
    previousFilters.environment !== nextFilters.environment ||
    previousFilters.status !== nextFilters.status ||
    previousFilters.sort !== nextFilters.sort ||
    previousFilters.mode !== nextFilters.mode
  );
}
