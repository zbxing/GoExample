'use client';

import {
  type UseUsersPageEditorWorkspaceContentSurfaceControllerOptions,
  useUsersPageEditorWorkspaceContentSurfaceController,
} from '@/lib/utils/use-users-page-editor-workspace-content-surface-controller';
import {
  type UseUsersPageRegistryWorkspaceContentSurfaceControllerOptions,
  useUsersPageRegistryWorkspaceContentSurfaceController,
} from '@/lib/utils/use-users-page-registry-workspace-content-surface-controller';

export type UseUsersPageLowerContentSurfaceControllerOptions =
  UseUsersPageRegistryWorkspaceContentSurfaceControllerOptions &
  UseUsersPageEditorWorkspaceContentSurfaceControllerOptions;

export function useUsersPageLowerContentSurfaceController({
  accessMessage,
  bulkRoleId,
  bulkSummary,
  bulkUpdateRole,
  bulkUpdateStatus,
  canBulkAssignRole,
  canBulkDisable,
  canBulkEnable,
  canBulkRemoveRole,
  draft,
  editorDescription,
  feedback,
  filteredUsers,
  focusUser,
  handleBulkRoleChange,
  handleCopyCurrentView,
  handleRoleFilterChange,
  handleSearchChange,
  handleStatusFilterChange,
  isPending,
  permissionSection,
  profileSection,
  registryEntries,
  roleFilter,
  roleOptions,
  rolesSection,
  saveUser,
  search,
  selectedCount,
  selectedUser,
  selectedUserId,
  selectedUserIds,
  statusFilter,
  toggleExtraPermission,
  toggleRole,
  toggleUserSelection,
  toggleVisibleSelection,
  usersContextRolesHref,
  usersContextSecurityHref,
  usersContextTags,
}: UseUsersPageLowerContentSurfaceControllerOptions) {
  const { usersPageRegistryWorkspaceShellProps } =
    useUsersPageRegistryWorkspaceContentSurfaceController({
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
    });
  const { usersPageEditorWorkspaceContentProps } =
    useUsersPageEditorWorkspaceContentSurfaceController({
      draft,
      editorDescription,
      feedback,
      isPending,
      permissionSection,
      profileSection,
      rolesSection,
      saveUser,
      selectedUser,
      toggleExtraPermission,
      toggleRole,
    });

  return {
    usersPageEditorWorkspaceContentProps,
    usersPageLowerContentProps: {
      ...usersPageRegistryWorkspaceShellProps,
      ...usersPageEditorWorkspaceContentProps,
    },
    usersPageRegistryWorkspaceShellProps,
  };
}
