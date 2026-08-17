import type { Route } from 'next';
import type { ManagedProject } from '@/lib/types/management';
import { joinDetails } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;
type ProjectMetaField = 'code' | 'environment' | 'owner' | 'region';

type ProjectMetaProject = Pick<ManagedProject, 'code' | 'environment' | 'owner' | 'region'>;

export interface WorkspacePageCopy {
  eyebrow: string;
  title: string;
  description: string;
}

export function resolveWorkspacePageCopy(
  pathname: string | Route,
  t: TranslationFn,
): WorkspacePageCopy {
  if (pathname === '/dashboard') {
    return {
      eyebrow: t('nav.dashboard'),
      title: t('pages.dashboardTitle'),
      description: t('pages.dashboardDescription'),
    };
  }

  if (pathname === '/projects') {
    return {
      eyebrow: t('nav.projects'),
      title: t('pages.projectsTitle'),
      description: t('pages.projectsDescription'),
    };
  }

  if (`${pathname}`.startsWith('/projects/')) {
    return {
      eyebrow: t('nav.projects'),
      title: t('projectDetail.overviewTitle'),
      description: t('projectDetail.overviewDescription'),
    };
  }

  if (pathname === '/services') {
    return {
      eyebrow: t('nav.services'),
      title: t('pages.servicesTitle'),
      description: t('pages.servicesDescription'),
    };
  }

  if (pathname === '/environments') {
    return {
      eyebrow: t('nav.environments'),
      title: t('pages.environmentsTitle'),
      description: t('pages.environmentsDescription'),
    };
  }

  if (pathname === '/integrations') {
    return {
      eyebrow: t('nav.integrations'),
      title: t('pages.integrationsTitle'),
      description: t('pages.integrationsDescription'),
    };
  }

  if (pathname === '/security') {
    return {
      eyebrow: t('nav.security'),
      title: t('pages.securityTitle'),
      description: t('pages.securityDescription'),
    };
  }

  if (pathname === '/users') {
    return {
      eyebrow: t('rbac.eyebrow'),
      title: t('users.title'),
      description: t('users.description'),
    };
  }

  if (pathname === '/roles') {
    return {
      eyebrow: t('rbac.eyebrow'),
      title: t('roles.title'),
      description: t('roles.description'),
    };
  }

  return {
    eyebrow: t('nav.settings'),
    title: t('pages.settingsTitle'),
    description: t('pages.settingsDescription'),
  };
}

export function describeWorkspaceRoute(route: Route, t: TranslationFn) {
  return resolveWorkspacePageCopy(route, t).description;
}

export function formatWorkspaceProjectMeta(
  project: ProjectMetaProject | null | undefined,
  t: TranslationFn,
  fields: readonly ProjectMetaField[],
  emptyLabel: string,
) {
  if (!project) {
    return emptyLabel;
  }

  return joinDetails(
    fields.map((field) => {
      if (field === 'environment') {
        return t(`status.${project.environment}`);
      }

      return project[field];
    }),
  );
}
