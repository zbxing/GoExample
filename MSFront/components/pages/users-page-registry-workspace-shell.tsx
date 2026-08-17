'use client';

import type { Route } from 'next';
import { RegistryWorkspaceShell } from '@/components/common/registry-workspace-shell';
import {
  UsersRegistryWorkbenchContent,
  type BulkSummaryModel,
} from '@/components/pages/users-page-registry-workbench-content';
import {
  UsersRegistryWorkspaceContent,
  type RegistryEntryModel,
} from '@/components/pages/users-page-workspaces-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';

interface UsersPageRegistryWorkspaceShellProps {
  accessMessage: string;
  bulkRoleId: string;
  bulkSummary: BulkSummaryModel;
  bulkUpdateRole: (mode: 'assign' | 'remove') => void;
  bulkUpdateStatus: (status: 'active' | 'disabled') => void;
  canBulkAssignRole: boolean;
  canBulkDisable: boolean;
  canBulkEnable: boolean;
  canBulkRemoveRole: boolean;
  filteredUsers: readonly AccessManagedUserEntry[];
  focusUser: (user: AccessManagedUserEntry) => void;
  handleBulkRoleChange: (value: string) => void;
  handleCopyCurrentView: () => void | Promise<void>;
  handleRoleFilterChange: (value: string) => void;
  handleSearchChange: (value: string) => void;
  handleStatusFilterChange: (value: AccessUserStatusFilter) => void;
  isPending: boolean;
  registryEntries: readonly RegistryEntryModel[];
  roleFilter: string;
  roleOptions: readonly string[];
  search: string;
  selectedCount: number;
  selectedUserId: string;
  selectedUserIds: readonly string[];
  statusFilter: AccessUserStatusFilter;
  toggleUserSelection: (userId: string) => void;
  toggleVisibleSelection: (users: readonly AccessManagedUserEntry[]) => void;
  usersContextRolesHref: Route;
  usersContextSecurityHref: Route;
  usersContextTags: readonly string[];
}

export function UsersPageRegistryWorkspaceShell({
  accessMessage,
  bulkRoleId,
  bulkSummary,
  bulkUpdateRole,
  bulkUpdateStatus,
  canBulkAssignRole,
  canBulkDisable,
  canBulkEnable,
  canBulkRemoveRole,
  filteredUsers,
  focusUser,
  handleBulkRoleChange,
  handleCopyCurrentView,
  handleRoleFilterChange,
  handleSearchChange,
  handleStatusFilterChange,
  isPending,
  registryEntries,
  roleFilter,
  roleOptions,
  search,
  selectedCount,
  selectedUserId,
  selectedUserIds,
  statusFilter,
  toggleUserSelection,
  toggleVisibleSelection,
  usersContextRolesHref,
  usersContextSecurityHref,
  usersContextTags,
}: UsersPageRegistryWorkspaceShellProps) {
  const { t } = useLocale();

  return (
    <RegistryWorkspaceShell
      title={t('users.registryTitle')}
      description={accessMessage}
      workbench={
        <UsersRegistryWorkbenchContent
          bulkRoleId={bulkRoleId}
          bulkSummary={bulkSummary}
          bulkUpdateRole={bulkUpdateRole}
          bulkUpdateStatus={bulkUpdateStatus}
          canBulkAssignRole={canBulkAssignRole}
          canBulkDisable={canBulkDisable}
          canBulkEnable={canBulkEnable}
          canBulkRemoveRole={canBulkRemoveRole}
          filteredUsers={filteredUsers}
          handleBulkRoleChange={handleBulkRoleChange}
          handleCopyCurrentView={handleCopyCurrentView}
          handleRoleFilterChange={handleRoleFilterChange}
          handleSearchChange={handleSearchChange}
          handleStatusFilterChange={handleStatusFilterChange}
          isPending={isPending}
          roleFilter={roleFilter}
          roleOptions={roleOptions}
          search={search}
          selectedCount={selectedCount}
          statusFilter={statusFilter}
          toggleVisibleSelection={toggleVisibleSelection}
          usersContextRolesHref={usersContextRolesHref}
          usersContextSecurityHref={usersContextSecurityHref}
          usersContextTags={usersContextTags}
        />
      }
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('users.emptyTitle')}</strong>
          <p>{t('users.emptyDescription')}</p>
        </div>
      }
      hasContent={filteredUsers.length > 0}
    >
      <UsersRegistryWorkspaceContent
        focusUser={focusUser}
        registryEntries={registryEntries}
        selectedUserId={selectedUserId}
        selectedUserIds={selectedUserIds}
        toggleUserSelection={toggleUserSelection}
      />
    </RegistryWorkspaceShell>
  );
}
