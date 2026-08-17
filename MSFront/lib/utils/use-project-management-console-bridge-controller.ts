'use client';

import type {
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';
import type {
  ProjectSortMode,
  ProjectsRegistryMode,
} from '@/lib/utils/governance-filters';
import { useProjectManagementConsoleController } from '@/lib/utils/use-project-management-console-controller';
import { useProjectManagementConsolePresentationController } from '@/lib/utils/use-project-management-console-presentation-controller';
import { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

interface UseProjectManagementConsoleBridgeControllerOptions {
  projects: ManagedProject[];
  selectedProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ProjectSortMode;
  initialMode?: ProjectsRegistryMode;
  enableUrlSync?: boolean;
  allowCreate?: boolean;
}

export function useProjectManagementConsoleBridgeController({
  projects,
  selectedProjectId,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
  initialMode = 'browse',
  enableUrlSync = false,
  allowCreate = true,
}: UseProjectManagementConsoleBridgeControllerOptions) {
  const { locale, t } = useLocale();
  const {
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
    registryAttentionCount,
    registryOwnerCount,
    registryProductionCount,
    registryQuery,
    registryRegionCount,
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
  } = useProjectManagementConsoleController({
    allowCreate,
    enableUrlSync,
    initialEnvironment,
    initialMode,
    initialSearch,
    initialSort,
    initialStatus,
    locale,
    projects,
    selectedProjectId,
    t,
  });
  const {
    activeProjectFocusTag,
    editorSummaryCards,
    editorValidationVisible,
    projectRegistryEntries,
    registrySummaryCards,
    registryTags,
  } = useProjectManagementConsoleSurfaceController({
    activeProject,
    configuredUrlCount,
    draft,
    filteredProjectList,
    locale,
    registryAttentionCount,
    registryOwnerCount,
    registryProductionCount,
    registryRegionCount,
    t,
    validationIssues,
  });
  const {
    editorSections,
    serverEditorSection,
    serviceEditorSection,
  } = useProjectManagementConsolePresentationController({
    draft,
    addServer,
    addService,
    removeServer,
    removeService,
    updateDraft,
    updateServer,
    updateService,
    t,
  });

  return {
    projectManagementConsoleLowerContentProps: {
      activeProject,
      activeProjectFocusTag,
      activeProjectId,
      allowCreate,
      clearProjectFilter,
      createProject,
      draft,
      editorDescription,
      editorSections,
      editorSummaryCards,
      editorValidationVisible,
      enableUrlSync,
      environmentFilter,
      feedback,
      filteredProjectList,
      handleCopyCurrentView,
      isCreating,
      isPending,
      linkedProjectId,
      projectList,
      projectRegistryEntries,
      registryQuery,
      registrySummaryCards,
      registryTags,
      removeProject,
      resetRegistryFilters,
      saveProject,
      selectProject,
      serverEditorSection,
      serviceEditorSection,
      setEnvironmentFilter,
      setRegistryQuery,
      setSortMode,
      setStatusFilter,
      sortMode,
      statusFilter,
      validationIssues,
    },
  };
}
