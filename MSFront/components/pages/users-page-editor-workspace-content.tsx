'use client';

import { EditorWorkspaceShell } from '@/components/common/editor-workspace-shell';
import type { FeedbackState } from '@/components/common/feedback-banner';
import {
  type ProfileSectionModel,
  UsersEditorProfileContent,
} from '@/components/pages/users-page-editor-profile-content';
import { UsersEditorActionsContent } from '@/components/pages/users-page-editor-actions-content';
import {
  type PermissionSectionModel,
  UsersEditorPermissionsContent,
} from '@/components/pages/users-page-editor-permissions-content';
import {
  type RoleSectionModel,
  UsersEditorRolesContent,
} from '@/components/pages/users-page-editor-roles-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagedUserEntry } from '@/lib/types/management';

interface UsersEditorWorkspaceContentProps {
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

export function UsersEditorWorkspaceContent({
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
}: UsersEditorWorkspaceContentProps) {
  const { t } = useLocale();

  return (
    <EditorWorkspaceShell
      title={t('users.editorTitle')}
      description={editorDescription}
      actions={
        <UsersEditorActionsContent
          draft={draft}
          isPending={isPending}
          saveUser={saveUser}
          selectedUser={selectedUser}
        />
      }
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('users.editorEmptyTitle')}</strong>
          <p>{t('users.emptyDescription')}</p>
        </div>
      }
      hasContent={Boolean(draft && selectedUser)}
    >
      {draft && selectedUser ? (
        <>
          <UsersEditorProfileContent profileSection={profileSection} />

          <UsersEditorRolesContent rolesSection={rolesSection} toggleRole={toggleRole} />

          <UsersEditorPermissionsContent
            permissionSection={permissionSection}
            toggleExtraPermission={toggleExtraPermission}
          />
        </>
      ) : null}
    </EditorWorkspaceShell>
  );
}
