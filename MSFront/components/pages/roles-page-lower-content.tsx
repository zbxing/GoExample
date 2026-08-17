'use client';

import type { Route } from 'next';
import type { FeedbackState } from '@/components/common/feedback-banner';
import {
  RolesEditorWorkspaceContent,
} from '@/components/pages/roles-page-editor-workspace-content';
import { type RolesEditorMembersSectionModel } from '@/components/pages/roles-page-editor-members-content';
import { type RolesEditorPermissionsSectionModel } from '@/components/pages/roles-page-editor-permissions-content';
import { type RolesProfileSectionModel } from '@/components/pages/roles-page-editor-profile-content';
import {
  type RolesRegistryEntryModel,
} from '@/components/pages/roles-page-workspaces-content';
import {
  RolesPageRegistryWorkspaceShell,
} from '@/components/pages/roles-page-registry-workspace-shell';
import type { AccessManagedRoleEntry } from '@/lib/types/management';

interface RolesPageLowerContentProps {
  accessMessage: string;
  beginCreateRole: () => void;
  canEditRole: boolean;
  draft: {
    locked: boolean;
  } | null;
  editorDescription: string;
  editorDetail: string | null;
  feedback: FeedbackState | null;
  filteredRoles: readonly AccessManagedRoleEntry[];
  handleCopyCurrentView: () => void | Promise<void>;
  handleCreateRole: () => void;
  handleSearchChange: (value: string) => void;
  handleSelectRole: (role: AccessManagedRoleEntry) => void;
  isCreating: boolean;
  isPending: boolean;
  membersSection: RolesEditorMembersSectionModel;
  permissionSection: RolesEditorPermissionsSectionModel;
  profileSection: RolesProfileSectionModel;
  registryEntries: readonly RolesRegistryEntryModel[];
  removeRole: () => void;
  rolesContextSecurityHref: Route;
  rolesContextTags: readonly string[];
  rolesContextUsersHref: Route;
  saveRole: () => void;
  search: string;
  selectedRoleId: string;
  togglePermission: (permission: string) => void;
}

export function RolesPageLowerContent({
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
}: RolesPageLowerContentProps) {
  return (
    <div className="projectManagerLayout">
      <RolesPageRegistryWorkspaceShell
        accessMessage={accessMessage}
        beginCreateRole={beginCreateRole}
        filteredRoles={filteredRoles}
        handleCopyCurrentView={handleCopyCurrentView}
        handleCreateRole={handleCreateRole}
        handleSearchChange={handleSearchChange}
        handleSelectRole={handleSelectRole}
        isCreating={isCreating}
        registryEntries={registryEntries}
        rolesContextSecurityHref={rolesContextSecurityHref}
        rolesContextTags={rolesContextTags}
        rolesContextUsersHref={rolesContextUsersHref}
        search={search}
        selectedRoleId={selectedRoleId}
      />

      <RolesEditorWorkspaceContent
        canEditRole={canEditRole}
        draft={draft}
        editorDescription={editorDescription}
        editorDetail={editorDetail}
        feedback={feedback}
        isCreating={isCreating}
        isPending={isPending}
        membersSection={membersSection}
        permissionSection={permissionSection}
        profileSection={profileSection}
        removeRole={removeRole}
        saveRole={saveRole}
        togglePermission={togglePermission}
      />
    </div>
  );
}
