'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ManagedProjectCatalogEntry } from '@/lib/types/management';

interface ProjectContextValue {
  projects: ManagedProjectCatalogEntry[];
  selectedProject: ManagedProjectCatalogEntry | null;
  selectedProjectId: string;
  isLoading: boolean;
  setSelectedProjectId: (projectId: string) => void;
  refreshProjects: (options?: { selectedProjectId?: string }) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);
const storageKey = 'msfront:selected-project-id';
const noopAsync = async () => {};

export function ProjectProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [projects, setProjects] = useState<ManagedProjectCatalogEntry[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    async function syncProjects() {
      setIsLoading(true);

      try {
        const nextProjects = await requestProjects();

        if (cancelled) {
          return;
        }

        const nextSelectedProjectId = resolveProjectSelection(
          nextProjects,
          readStoredProjectId(),
        );

        setProjects(nextProjects);
        persistSelectedProjectId(nextSelectedProjectId);
        setSelectedProjectIdState(nextSelectedProjectId);
      } catch {
        if (cancelled) {
          return;
        }

        setProjects([]);
        persistSelectedProjectId('');
        setSelectedProjectIdState('');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void syncProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  const navigationProjectId = extractProjectIdFromLocation(
    pathname,
    new URLSearchParams(searchParamsKey),
  );
  const activeProjectId =
    navigationProjectId && projects.some((project) => project.id === navigationProjectId)
      ? navigationProjectId
      : selectedProjectId;
  const selectedProject =
    projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (navigationProjectId && selectedProject?.id === navigationProjectId) {
      persistSelectedProjectId(navigationProjectId);
    }
  }, [navigationProjectId, selectedProject?.id]);

  async function refreshProjects(options?: { selectedProjectId?: string }) {
    setIsLoading(true);

    try {
      const nextProjects = await requestProjects();
      const navigationProjectId = extractProjectIdFromLocation(pathname, searchParams);
      const nextSelectedProjectId = resolveProjectSelection(
        nextProjects,
        options?.selectedProjectId ?? navigationProjectId ?? selectedProjectId,
      );

      setProjects(nextProjects);
      persistSelectedProjectId(nextSelectedProjectId);
      setSelectedProjectIdState(nextSelectedProjectId);
    } catch {} finally {
      setIsLoading(false);
    }
  }

  function setSelectedProjectId(projectId: string) {
    const nextSelectedProjectId = resolveProjectSelection(projects, projectId);
    persistSelectedProjectId(nextSelectedProjectId);
    setSelectedProjectIdState(nextSelectedProjectId);
  }

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        selectedProjectId: selectedProject?.id ?? '',
        isLoading,
        setSelectedProjectId,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function ProjectProviderFallback({ children }: PropsWithChildren) {
  return (
    <ProjectContext.Provider
      value={{
        projects: [],
        selectedProject: null,
        selectedProjectId: '',
        isLoading: true,
        setSelectedProjectId: () => {},
        refreshProjects: noopAsync,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectSelection() {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error('useProjectSelection must be used within ProjectProvider.');
  }

  return context;
}

async function requestProjects() {
  const response = await fetch('/api/management/projects?view=catalog', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to load managed projects.');
  }

  return (await response.json()) as ManagedProjectCatalogEntry[];
}

function resolveProjectSelection(projects: ManagedProjectCatalogEntry[], preferredProjectId?: string | null) {
  const candidateProjectId = `${preferredProjectId ?? ''}`.trim();

  if (candidateProjectId && projects.some((project) => project.id === candidateProjectId)) {
    return candidateProjectId;
  }

  return projects[0]?.id ?? '';
}

function extractProjectIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)$/);
  return match?.[1] ?? null;
}

function extractProjectIdFromLocation(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>,
) {
  const detailProjectId = extractProjectIdFromPathname(pathname);

  if (detailProjectId) {
    return detailProjectId;
  }

  if (pathname === '/projects') {
    if (searchParams.get('mode') === 'create') {
      return null;
    }

    return searchParams.get('projectId');
  }

  if (pathname === '/services' || pathname === '/integrations') {
    return searchParams.get('projectId');
  }

  return null;
}

function readStoredProjectId() {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.localStorage.getItem(storageKey) ?? '';
}

function persistSelectedProjectId(projectId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  if (projectId) {
    window.localStorage.setItem(storageKey, projectId);
    return;
  }

  window.localStorage.removeItem(storageKey);
}
