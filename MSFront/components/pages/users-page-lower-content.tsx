'use client';

import type { Route } from 'next';
import type { FeedbackState } from '@/components/common/feedback-banner';
import {
  UsersEditorWorkspaceContent,
} from '@/components/pages/users-page-editor-workspace-content';
import { type PermissionSectionModel } from '@/components/pages/users-page-editor-permissions-content';
import { type ProfileSectionModel } from '@/components/pages/users-page-editor-profile-content';
import { type RoleSectionModel } from '@/components/pages/users-page-editor-roles-content';
import {
  type BulkSummaryModel,
} from '@/components/pages/users-page-registry-workbench-content';
import {
  type RegistryEntryModel,
} from '@/components/pages/users-page-workspaces-content';
import {
  UsersPageRegistryWorkspaceShell,
} from '@/components/pages/users-page-registry-workspace-shell';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';

interface UsersPageLowerContentProps {
  accessMessage: string;
  bulkRoleId: string;
  bulkSummary: BulkSummaryModel;
  bulkUpdateRole: (mode: 'assign' | 'remove') => void;
  bulkUpdateStatus: (status: 'active' | 'disabled') => void;
  canBulkAssignRole: boolean;
  canBulkDisable: boolean;
  canBulkEnable: boolean;
  canBulkRemoveRole: boolean;
  draft: object | null;
  editorDescription: string;
  feedback: FeedbackState | null;
  filteredUsers: readonly AccessManagedUserEntry[];
  focusUser: (user: AccessManagedUserEntry) => void;
  handleBulkRoleChange: (value: string) => void;
  handleCopyCurrentView: () => void | Promise<void>;
  handleRoleFilterChange: (value: string) => void;
  handleSearchChange: (value: string) => void;
  handleStatusFilterChange: (value: AccessUserStatusFilter) => void;
  isPending: boolean;
  permissionSection: PermissionSectionModel;
  profileSection: ProfileSectionModel;
  registryEntries: readonly RegistryEntryModel[];
  roleFilter: string;
  roleOptions: readonly string[];
  rolesSection: RoleSectionModel;
  saveUser: () => void;
  search: string;
  selectedCount: number;
  selectedUser: AccessManagedUserEntry | null;
  selectedUserId: string;
  selectedUserIds: readonly string[];
  statusFilter: AccessUserStatusFilter;
  toggleExtraPermission: (permission: string) => void;
  toggleRole: (roleId: string) => void;
  toggleUserSelection: (userId: string) => void;
  toggleVisibleSelection: (users: readonly AccessManagedUserEntry[]) => void;
  usersContextRolesHref: Route;
  usersContextSecurityHref: Route;
  usersContextTags: readonly string[];
}

export function UsersPageLowerContent({
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
}: UsersPageLowerContentProps) {
  return (
    <div className="projectManagerLayout">
      <UsersPageRegistryWorkspaceShell
        accessMessage={accessMessage}
        bulkRoleId={bulkRoleId}
        bulkSummary={bulkSummary}
        bulkUpdateRole={bulkUpdateRole}
        bulkUpdateStatus={bulkUpdateStatus}
        canBulkAssignRole={canBulkAssignRole}
        canBulkDisable={canBulkDisable}
        canBulkEnable={canBulkEnable}
        canBulkRemoveRole={canBulkRemoveRole}
        filteredUsers={filteredUsers}
        focusUser={focusUser}
        handleBulkRoleChange={handleBulkRoleChange}
        handleCopyCurrentView={handleCopyCurrentView}
        handleRoleFilterChange={handleRoleFilterChange}
        handleSearchChange={handleSearchChange}
        handleStatusFilterChange={handleStatusFilterChange}
        isPending={isPending}
        registryEntries={registryEntries}
        roleFilter={roleFilter}
        roleOptions={roleOptions}
        search={search}
        selectedCount={selectedCount}
        selectedUserId={selectedUserId}
        selectedUserIds={selectedUserIds}
        statusFilter={statusFilter}
        toggleUserSelection={toggleUserSelection}
        toggleVisibleSelection={toggleVisibleSelection}
        usersContextRolesHref={usersContextRolesHref}
        usersContextSecurityHref={usersContextSecurityHref}
        usersContextTags={usersContextTags}
      />

      <UsersEditorWorkspaceContent
        draft={draft}
        editorDescription={editorDescription}
        feedback={feedback}
        isPending={isPending}
        permissionSection={permissionSection}
        profileSection={profileSection}
        rolesSection={rolesSection}
        saveUser={saveUser}
        selectedUser={selectedUser}
        toggleExtraPermission={toggleExtraPermission}
        toggleRole={toggleRole}
      />
    </div>
  );
}
