'use client';

import type { Route } from 'next';
import type { RegistryEntryModel } from '@/components/pages/users-page-workspaces-content';
import { type BulkSummaryModel } from '@/components/pages/users-page-registry-workbench-content';
import { type PermissionSectionModel } from '@/components/pages/users-page-editor-permissions-content';
import { type ProfileSectionModel } from '@/components/pages/users-page-editor-profile-content';
import { type RoleSectionModel } from '@/components/pages/users-page-editor-roles-content';
import { UsersPageLowerContent } from '@/components/pages/users-page-lower-content';
import { UsersPageOverviewContent } from '@/components/pages/users-page-overview-content';
import type { FeedbackState } from '@/components/common/feedback-banner';
import type {
  AccessManagedUserEntry,
} from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSignal,
  AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';
import type { OverviewMetric } from '@/lib/types/management';

interface UsersPageContentProps {
  accessMessage: string;
  accessNavigationContext: AccessNavigationContext;
  bulkRoleId: string;
  bulkSummary: BulkSummaryModel;
  bulkUpdateRole: (mode: 'assign' | 'remove') => void;
  bulkUpdateStatus: (status: 'active' | 'disabled') => void;
  canBulkAssignRole: boolean;
  canBulkDisable: boolean;
  canBulkEnable: boolean;
  canBulkRemoveRole: boolean;
  commandCenterSummaryCards: readonly AccessSurfaceSummaryCard[];
  commandCenterTags: readonly string[];
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
  metrics: OverviewMetric[];
  permissionSection: PermissionSectionModel;
  priorityUser: AccessManagedUserEntry | null;
  priorityUserBadges: readonly AccessSurfaceBadge[];
  priorityUserFootnote: string;
  priorityUserMetrics: readonly AccessSurfaceMetric[];
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
  sourceStatusLabel: string;
  sourceTone: AccessSurfaceBadge['tone'];
  statusFilter: AccessUserStatusFilter;
  toggleExtraPermission: (permission: string) => void;
  toggleRole: (roleId: string) => void;
  toggleUserSelection: (userId: string) => void;
  toggleVisibleSelection: (users: readonly AccessManagedUserEntry[]) => void;
  userCoverageFootnote: string;
  userCoverageMetrics: readonly AccessSurfaceMetric[];
  userPostureSignals: readonly AccessSurfaceSignal[];
  usersContextRolesHref: Route;
  usersContextSecurityHref: Route;
  usersContextTags: readonly string[];
}

export function UsersPageContent({
  accessMessage,
  accessNavigationContext,
  bulkRoleId,
  bulkSummary,
  bulkUpdateRole,
  bulkUpdateStatus,
  canBulkAssignRole,
  canBulkDisable,
  canBulkEnable,
  canBulkRemoveRole,
  commandCenterSummaryCards,
  commandCenterTags,
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
  metrics,
  permissionSection,
  priorityUser,
  priorityUserBadges,
  priorityUserFootnote,
  priorityUserMetrics,
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
  sourceStatusLabel,
  sourceTone,
  statusFilter,
  toggleExtraPermission,
  toggleRole,
  toggleUserSelection,
  toggleVisibleSelection,
  userCoverageFootnote,
  userCoverageMetrics,
  userPostureSignals,
  usersContextRolesHref,
  usersContextSecurityHref,
  usersContextTags,
}: UsersPageContentProps) {
  return (
    <>
      <UsersPageOverviewContent
        accessMessage={accessMessage}
        accessNavigationContext={accessNavigationContext}
        commandCenterSummaryCards={commandCenterSummaryCards}
        commandCenterTags={commandCenterTags}
        metrics={metrics}
        priorityUser={priorityUser}
        priorityUserBadges={priorityUserBadges}
        priorityUserFootnote={priorityUserFootnote}
        priorityUserMetrics={priorityUserMetrics}
        sourceStatusLabel={sourceStatusLabel}
        sourceTone={sourceTone}
        userCoverageFootnote={userCoverageFootnote}
        userCoverageMetrics={userCoverageMetrics}
        userPostureSignals={userPostureSignals}
      />
      <UsersPageLowerContent
        accessMessage={accessMessage}
        bulkRoleId={bulkRoleId}
        bulkSummary={bulkSummary}
        bulkUpdateRole={bulkUpdateRole}
        bulkUpdateStatus={bulkUpdateStatus}
        canBulkAssignRole={canBulkAssignRole}
        canBulkDisable={canBulkDisable}
        canBulkEnable={canBulkEnable}
        canBulkRemoveRole={canBulkRemoveRole}
        draft={draft}
        editorDescription={editorDescription}
        feedback={feedback}
        filteredUsers={filteredUsers}
        focusUser={focusUser}
        handleBulkRoleChange={handleBulkRoleChange}
        handleCopyCurrentView={handleCopyCurrentView}
        handleRoleFilterChange={handleRoleFilterChange}
        handleSearchChange={handleSearchChange}
        handleStatusFilterChange={handleStatusFilterChange}
        isPending={isPending}
        permissionSection={permissionSection}
        profileSection={profileSection}
        registryEntries={registryEntries}
        roleFilter={roleFilter}
        roleOptions={roleOptions}
        rolesSection={rolesSection}
        saveUser={saveUser}
        search={search}
        selectedCount={selectedCount}
        selectedUser={selectedUser}
        selectedUserId={selectedUserId}
        selectedUserIds={selectedUserIds}
        statusFilter={statusFilter}
        toggleExtraPermission={toggleExtraPermission}
        toggleRole={toggleRole}
        toggleUserSelection={toggleUserSelection}
        toggleVisibleSelection={toggleVisibleSelection}
        usersContextRolesHref={usersContextRolesHref}
        usersContextSecurityHref={usersContextSecurityHref}
        usersContextTags={usersContextTags}
      />
    </>
  );
}
