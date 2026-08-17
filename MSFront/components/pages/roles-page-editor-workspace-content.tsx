'use client';

import { EditorWorkspaceShell } from '@/components/common/editor-workspace-shell';
import type { FeedbackState } from '@/components/common/feedback-banner';
import {
  RolesEditorProfileContent,
  type RolesProfileSectionModel,
} from '@/components/pages/roles-page-editor-profile-content';
import { RolesEditorActionsContent } from '@/components/pages/roles-page-editor-actions-content';
import {
  RolesEditorPermissionsContent,
  type RolesEditorPermissionsSectionModel,
} from '@/components/pages/roles-page-editor-permissions-content';
import {
  RolesEditorMembersContent,
  type RolesEditorMembersSectionModel,
} from '@/components/pages/roles-page-editor-members-content';
import { useLocale } from '@/providers/locale-provider';

interface RolesEditorWorkspaceContentProps {
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

export function RolesEditorWorkspaceContent({
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
}: RolesEditorWorkspaceContentProps) {
  const { t } = useLocale();

  return (
    <EditorWorkspaceShell
      title={t('roles.editorTitle')}
      description={editorDescription}
      detail={editorDetail ? <small>{editorDetail}</small> : null}
      actions={
        <RolesEditorActionsContent
          canEditRole={canEditRole}
          draft={draft}
          isCreating={isCreating}
          isPending={isPending}
          removeRole={removeRole}
          saveRole={saveRole}
        />
      }
      feedback={feedback}
      emptyState={
        <div className="emptyStatePanel">
          <strong>{t('roles.editorEmptyTitle')}</strong>
          <p>{t('roles.emptyDescription')}</p>
        </div>
      }
      hasContent={Boolean(draft)}
    >
      {draft ? (
        <>
          <RolesEditorProfileContent profileSection={profileSection} />

          <RolesEditorPermissionsContent
            permissionSection={permissionSection}
            togglePermission={togglePermission}
          />

          <RolesEditorMembersContent membersSection={membersSection} />
        </>
      ) : null}
    </EditorWorkspaceShell>
  );
}
