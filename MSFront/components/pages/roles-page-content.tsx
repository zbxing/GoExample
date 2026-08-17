'use client';

import type { Route } from 'next';
import type { RolesRegistryEntryModel } from '@/components/pages/roles-page-workspaces-content';
import { type RolesEditorMembersSectionModel } from '@/components/pages/roles-page-editor-members-content';
import { type RolesEditorPermissionsSectionModel } from '@/components/pages/roles-page-editor-permissions-content';
import { type RolesProfileSectionModel } from '@/components/pages/roles-page-editor-profile-content';
import { RolesPageLowerContent } from '@/components/pages/roles-page-lower-content';
import type { FeedbackState } from '@/components/common/feedback-banner';
import { RolesPageOverviewContent } from '@/components/pages/roles-page-overview-content';
import type {
  AccessManagedRoleEntry,
  OverviewMetric,
} from '@/lib/types/management';
import {
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import type {
  AccessSurfaceBadge,
  AccessSurfaceMetric,
  AccessSurfaceSignal,
  AccessSurfaceSummaryCard,
} from '@/components/common/access-governance-surface';

interface RolesPageContentProps {
  accessMessage: string;
  accessNavigationContext: AccessNavigationContext;
  beginCreateRole: () => void;
  canEditRole: boolean;
  commandCenterSummaryCards: readonly AccessSurfaceSummaryCard[];
  commandCenterTags: readonly string[];
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
  metrics: OverviewMetric[];
  permissionSection: RolesEditorPermissionsSectionModel;
  priorityRole: AccessManagedRoleEntry | null;
  priorityRoleBadges: readonly AccessSurfaceBadge[];
  priorityRoleFootnote: string;
  priorityRoleMetrics: readonly AccessSurfaceMetric[];
  profileSection: RolesProfileSectionModel;
  registryEntries: readonly RolesRegistryEntryModel[];
  removeRole: () => void;
  roleCoverageFootnote: string;
  roleCoverageMetrics: readonly AccessSurfaceMetric[];
  rolePostureSignals: readonly AccessSurfaceSignal[];
  rolesContextSecurityHref: Route;
  rolesContextTags: readonly string[];
  rolesContextUsersHref: Route;
  saveRole: () => void;
  search: string;
  selectedRoleId: string;
  sourceStatusLabel: string;
  sourceTone: AccessSurfaceBadge['tone'];
  togglePermission: (permission: string) => void;
}

export function RolesPageContent({
  accessMessage,
  accessNavigationContext,
  beginCreateRole,
  canEditRole,
  commandCenterSummaryCards,
  commandCenterTags,
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
  metrics,
  permissionSection,
  priorityRole,
  priorityRoleBadges,
  priorityRoleFootnote,
  priorityRoleMetrics,
  profileSection,
  registryEntries,
  removeRole,
  roleCoverageFootnote,
  roleCoverageMetrics,
  rolePostureSignals,
  rolesContextSecurityHref,
  rolesContextTags,
  rolesContextUsersHref,
  saveRole,
  search,
  selectedRoleId,
  sourceStatusLabel,
  sourceTone,
  togglePermission,
}: RolesPageContentProps) {
  return (
    <>
      <RolesPageOverviewContent
        accessMessage={accessMessage}
        accessNavigationContext={accessNavigationContext}
        commandCenterSummaryCards={commandCenterSummaryCards}
        commandCenterTags={commandCenterTags}
        metrics={metrics}
        priorityRole={priorityRole}
        priorityRoleBadges={priorityRoleBadges}
        priorityRoleFootnote={priorityRoleFootnote}
        priorityRoleMetrics={priorityRoleMetrics}
        roleCoverageFootnote={roleCoverageFootnote}
        roleCoverageMetrics={roleCoverageMetrics}
        rolePostureSignals={rolePostureSignals}
        sourceStatusLabel={sourceStatusLabel}
        sourceTone={sourceTone}
      />
      <RolesPageLowerContent
        accessMessage={accessMessage}
        beginCreateRole={beginCreateRole}
        canEditRole={canEditRole}
        draft={draft}
        editorDescription={editorDescription}
        editorDetail={editorDetail}
        feedback={feedback}
        filteredRoles={filteredRoles}
        handleCopyCurrentView={handleCopyCurrentView}
        handleCreateRole={handleCreateRole}
        handleSearchChange={handleSearchChange}
        handleSelectRole={handleSelectRole}
        isCreating={isCreating}
        isPending={isPending}
        membersSection={membersSection}
        permissionSection={permissionSection}
        profileSection={profileSection}
        registryEntries={registryEntries}
        removeRole={removeRole}
        rolesContextSecurityHref={rolesContextSecurityHref}
        rolesContextTags={rolesContextTags}
        rolesContextUsersHref={rolesContextUsersHref}
        saveRole={saveRole}
        search={search}
        selectedRoleId={selectedRoleId}
        togglePermission={togglePermission}
      />
    </>
  );
}
