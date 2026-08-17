'use client';

import {
  type UseRolesPageEditorWorkspaceContentSurfaceControllerOptions,
  useRolesPageEditorWorkspaceContentSurfaceController,
} from '@/lib/utils/use-roles-page-editor-workspace-content-surface-controller';
import {
  type UseRolesPageRegistryWorkspaceContentSurfaceControllerOptions,
  useRolesPageRegistryWorkspaceContentSurfaceController,
} from '@/lib/utils/use-roles-page-registry-workspace-content-surface-controller';

export type UseRolesPageLowerContentSurfaceControllerOptions =
  UseRolesPageRegistryWorkspaceContentSurfaceControllerOptions &
  UseRolesPageEditorWorkspaceContentSurfaceControllerOptions;

export function useRolesPageLowerContentSurfaceController({
  accessMessage,
  beginCreateRole,
  canEditRole,
  draft,
  editorDescription,
  editorDetail,
  feedback,
  filteredRoles,
  handleCopyCurrentView,
  handleCreateRole,
  handleSearchChange,
  handleSelectRole,
  isCreating,
  isPending,
  membersSection,
  permissionSection,
  profileSection,
  registryEntries,
  removeRole,
  rolesContextSecurityHref,
  rolesContextTags,
  rolesContextUsersHref,
  saveRole,
  search,
  selectedRoleId,
  togglePermission,
}: UseRolesPageLowerContentSurfaceControllerOptions) {
  const { rolesPageRegistryWorkspaceShellProps } =
    useRolesPageRegistryWorkspaceContentSurfaceController({
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
    });
  const { rolesPageEditorWorkspaceContentProps } =
    useRolesPageEditorWorkspaceContentSurfaceController({
      canEditRole,
      draft,
      editorDescription,
      editorDetail,
      feedback,
      isCreating,
      isPending,
      membersSection,
      permissionSection,
      profileSection,
      removeRole,
      saveRole,
      togglePermission,
    });

  return {
    rolesPageEditorWorkspaceContentProps,
    rolesPageLowerContentProps: {
      ...rolesPageRegistryWorkspaceShellProps,
      ...rolesPageEditorWorkspaceContentProps,
    },
    rolesPageRegistryWorkspaceShellProps,
  };
}
