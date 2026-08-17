'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import type { PermissionSectionModel } from '@/components/pages/users-page-editor-permissions-content';
import type { ProfileSectionModel } from '@/components/pages/users-page-editor-profile-content';
import type { RoleSectionModel } from '@/components/pages/users-page-editor-roles-content';
import type { AccessManagedUserEntry } from '@/lib/types/management';

export interface UseUsersPageEditorWorkspaceContentSurfaceControllerOptions {
  draft: object | null;
  editorDescription: string;
  feedback: FeedbackState | null;
  isPending: boolean;
  permissionSection: PermissionSectionModel;
  profileSection: ProfileSectionModel;
  rolesSection: RoleSectionModel;
  saveUser: () => void;
  selectedUser: AccessManagedUserEntry | null;
  toggleExtraPermission: (permission: string) => void;
  toggleRole: (roleId: string) => void;
}

export function useUsersPageEditorWorkspaceContentSurfaceController({
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
}: UseUsersPageEditorWorkspaceContentSurfaceControllerOptions) {
  return {
    usersPageEditorWorkspaceContentProps: {
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
    },
  };
}
