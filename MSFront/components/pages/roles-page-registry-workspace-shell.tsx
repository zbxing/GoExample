'use client';

import type { Route } from 'next';
import { RegistryWorkspaceShell } from '@/components/common/registry-workspace-shell';
import { RolesPageRegistryActionsContent } from '@/components/pages/roles-page-registry-actions-content';
import { RolesRegistryWorkbenchContent } from '@/components/pages/roles-page-registry-workbench-content';
import {
  RolesRegistryWorkspaceContent,
  type RolesRegistryEntryModel,
} from '@/components/pages/roles-page-workspaces-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagedRoleEntry } from '@/lib/types/management';

interface RolesPageRegistryWorkspaceShellProps {
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

export function RolesPageRegistryWorkspaceShell({
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
}: RolesPageRegistryWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <RegistryWorkspaceShell
      title={t('roles.registryTitle')}
      description={accessMessage}
      actions={
        <RolesPageRegistryActionsContent
          beginCreateRole={beginCreateRole}
          handleCopyCurrentView={handleCopyCurrentView}
          handleCreateRole={handleCreateRole}
        />
      }
      workbench={
        <RolesRegistryWorkbenchContent
          handleSearchChange={handleSearchChange}
          rolesContextSecurityHref={rolesContextSecurityHref}
          rolesContextTags={rolesContextTags}
          rolesContextUsersHref={rolesContextUsersHref}
          search={search}
        />
      }
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('roles.emptyTitle')}</strong>
          <p>{t('roles.emptyDescription')}</p>
        </div>
      }
      hasContent={filteredRoles.length > 0}
    >
      <RolesRegistryWorkspaceContent
        handleSelectRole={handleSelectRole}
        isCreating={isCreating}
        registryEntries={registryEntries}
        selectedRoleId={selectedRoleId}
      />
    </RegistryWorkspaceShell>
  );
}
