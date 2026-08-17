'use client';

import type { Route } from 'next';
import { RegistryWorkbenchControls } from '@/components/common/registry-workbench-controls';
import {
  RolesPageRegistryWorkbenchContextActionsContent,
} from '@/components/pages/roles-page-registry-workbench-context-actions-content';
import {
  RolesPageRegistryWorkbenchFiltersContent,
} from '@/components/pages/roles-page-registry-workbench-filters-content';
import { useLocale } from '@/providers/locale-provider';

interface RolesRegistryWorkbenchContentProps {
  handleSearchChange: (value: string) => void;
  rolesContextSecurityHref: Route;
  rolesContextTags: readonly string[];
  rolesContextUsersHref: Route;
  search: string;
}

export function RolesRegistryWorkbenchContent({
  handleSearchChange,
  rolesContextSecurityHref,
  rolesContextTags,
  rolesContextUsersHref,
  search,
}: RolesRegistryWorkbenchContentProps) {
  const { t } = useLocale();

  return (
    <RegistryWorkbenchControls
      contextLabel={`${t('nav.security')} / ${t('labels.roles')}`}
      contextTags={rolesContextTags}
      contextActions={
        <RolesPageRegistryWorkbenchContextActionsContent
          rolesContextSecurityHref={rolesContextSecurityHref}
          rolesContextUsersHref={rolesContextUsersHref}
        />
      }
      filters={
        <RolesPageRegistryWorkbenchFiltersContent
          handleSearchChange={handleSearchChange}
          search={search}
        />
      }
    />
  );
}
