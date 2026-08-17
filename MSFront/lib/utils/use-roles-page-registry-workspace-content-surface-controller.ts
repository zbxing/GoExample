'use client';

import type { Route } from 'next';
import type {
  RolesRegistryEntryModel,
} from '@/components/pages/roles-page-workspaces-content';
import type { AccessManagedRoleEntry } from '@/lib/types/management';

export interface UseRolesPageRegistryWorkspaceContentSurfaceControllerOptions {
  accessMessage: string;
  beginCreateRole: () => void;
  filteredRoles: readonly AccessManagedRoleEntry[];
  handleCopyCurrentView: () => void | Promise<void>;
  handleCreateRole: () => void;
  handleSearchChange: (value: string) => void;
  handleSelectRole: (role: AccessManagedRoleEntry) => void;
  isCreating: boolean;
  registryEntries: readonly RolesRegistryEntryModel[];
  rolesContextSecurityHref: Route;
  rolesContextTags: readonly string[];
  rolesContextUsersHref: Route;
  search: string;
  selectedRoleId: string;
}

export function useRolesPageRegistryWorkspaceContentSurfaceController({
  accessMessage,
  beginCreateRole,
  filteredRoles,
  handleCopyCurrentView,
  handleCreateRole,
  handleSearchChange,
  handleSelectRole,
  isCreating,
  registryEntries,
  rolesContextSecurityHref,
  rolesContextTags,
  rolesContextUsersHref,
  search,
  selectedRoleId,
}: UseRolesPageRegistryWorkspaceContentSurfaceControllerOptions) {
  return {
    rolesPageRegistryWorkspaceShellProps: {
      accessMessage,
      beginCreateRole,
      filteredRoles,
      handleCopyCurrentView,
      handleCreateRole,
      handleSearchChange,
      handleSelectRole,
      isCreating,
      registryEntries,
      rolesContextSecurityHref,
      rolesContextTags,
      rolesContextUsersHref,
      search,
      selectedRoleId,
    },
  };
}
