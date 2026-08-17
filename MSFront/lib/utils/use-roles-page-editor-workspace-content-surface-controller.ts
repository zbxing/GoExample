'use client';

import type { FeedbackState } from '@/components/common/feedback-banner';
import type { RolesEditorMembersSectionModel } from '@/components/pages/roles-page-editor-members-content';
import type { RolesEditorPermissionsSectionModel } from '@/components/pages/roles-page-editor-permissions-content';
import type { RolesProfileSectionModel } from '@/components/pages/roles-page-editor-profile-content';

export interface UseRolesPageEditorWorkspaceContentSurfaceControllerOptions {
  canEditRole: boolean;
  draft: {
    locked: boolean;
  } | null;
  editorDescription: string;
  editorDetail: string | null;
  feedback: FeedbackState | null;
  isCreating: boolean;
  isPending: boolean;
  membersSection: RolesEditorMembersSectionModel;
  permissionSection: RolesEditorPermissionsSectionModel;
  profileSection: RolesProfileSectionModel;
  removeRole: () => void;
  saveRole: () => void;
  togglePermission: (permission: string) => void;
}

export function useRolesPageEditorWorkspaceContentSurfaceController({
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
}: UseRolesPageEditorWorkspaceContentSurfaceControllerOptions) {
  return {
    rolesPageEditorWorkspaceContentProps: {
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
    },
  };
}
