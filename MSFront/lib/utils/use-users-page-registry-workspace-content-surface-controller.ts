'use client';

import type { Route } from 'next';
import type {
  BulkSummaryModel,
} from '@/components/pages/users-page-registry-workbench-content';
import type {
  RegistryEntryModel,
} from '@/components/pages/users-page-workspaces-content';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';

export interface UseUsersPageRegistryWorkspaceContentSurfaceControllerOptions {
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

export function useUsersPageRegistryWorkspaceContentSurfaceController({
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
}: UseUsersPageRegistryWorkspaceContentSurfaceControllerOptions) {
  return {
    usersPageRegistryWorkspaceShellProps: {
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
    },
  };
}
