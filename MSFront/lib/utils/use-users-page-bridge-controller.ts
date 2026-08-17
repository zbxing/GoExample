'use client';

import {
  useState,
  useTransition,
} from 'react';
import { usePathname } from 'next/navigation';
import type {
  AccessManagedUserEntry,
  AccessManagementView,
  LocaleCode,
} from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';
import { useUsersPageEditorPresentationController } from '@/lib/utils/use-users-page-editor-presentation-controller';
import { useUsersPageEditorController } from '@/lib/utils/use-users-page-editor-controller';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useUsersPageBulkController } from '@/lib/utils/use-users-page-bulk-controller';
import { useUsersPageController } from '@/lib/utils/use-users-page-controller';
import { useUsersPageContentSurfaceController } from '@/lib/utils/use-users-page-content-surface-controller';
import { useUsersPageRegistryEditorSurfaceController } from '@/lib/utils/use-users-page-registry-editor-surface-controller';
import { useUsersPageRegistrySurfaceController } from '@/lib/utils/use-users-page-registry-surface-controller';
import { useUsersPageSurfaceController } from '@/lib/utils/use-users-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageBridgeControllerOptions {
  accessManagement: AccessManagementView;
  locale: LocaleCode;
  t: TranslationFn;
  initialUserId?: string;
  initialRoleId?: string;
  initialStatus?: AccessUserStatusFilter;
  initialSearch?: string;
}

export function useUsersPageBridgeController({
  accessManagement,
  locale,
  t,
  initialUserId = '',
  initialRoleId = '',
  initialStatus = 'all',
  initialSearch = '',
}: UseUsersPageBridgeControllerOptions) {
  const pathname = usePathname();
  const initialSelectedUser = selectManagedUser(accessManagement.users, initialUserId);
  const [isPending, startTransition] = useTransition();
  const [currentAccessManagement, setCurrentAccessManagement] =
    useState<AccessManagementView>(accessManagement);
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback({ durationMs: 4200 });
  const accessMessage =
    currentAccessManagement.source === 'database' ? t('rbac.sourceLive') : t('rbac.sourceUnavailable');

  const users = currentAccessManagement.users;
  const roles = currentAccessManagement.roles;
  const {
    accessNavigationContext,
    applyAccessManagementSnapshot,
    focusUser,
    handleCopyCurrentView,
    handleRoleFilterChange,
    handleSearchChange,
    handleStatusFilterChange,
    roleFilter,
    search,
    selectedUserId,
    statusFilter,
    usersContextRolesHref,
    usersContextSecurityHref,
    usersContextTags,
  } = useUsersPageController({
    pathname,
    users,
    roles,
    initialUserId,
    initialRoleId,
    initialStatus,
    initialSearch,
    clearFeedback,
    showError,
    showSuccess,
    t,
  });
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const {
    applyAccessManagementBulkSnapshot,
    bulkRoleId,
    bulkUpdateRole,
    bulkUpdateStatus,
    canBulkAssignRole,
    canBulkDisable,
    canBulkEnable,
    canBulkRemoveRole,
    handleBulkRoleChange,
    selectedCount,
    selectedUserIds,
    toggleUserSelection,
    toggleVisibleSelection,
  } = useUsersPageBulkController({
    users,
    roles,
    initialSelectedUserId: initialSelectedUser?.id ?? '',
    clearFeedback,
    showError,
    showSuccess,
    t,
    startTransition: (callback) => startTransition(callback),
    refreshAccessManagement,
    selectedUserId,
    onApplyAccessManagement: (nextAccessManagement, preferredUserId) => {
      setCurrentAccessManagement(nextAccessManagement);
      applyAccessManagementSnapshot(nextAccessManagement, preferredUserId);
    },
  });
  const {
    customPermissionValue,
    draft,
    effectivePermissions,
    inheritedPermissions,
    saveUser,
    suggestedPermissions,
    toggleExtraPermission,
    toggleRole,
    updateCustomPermissions,
    updateDraft,
  } = useUsersPageEditorController({
    selectedUser,
    users,
    roles,
    supportedPermissions: currentAccessManagement.supportedPermissions,
    clearFeedback,
    showError,
    showSuccess,
    t,
    startTransition: (callback) => startTransition(callback),
    refreshAccessManagement,
    onApplyAccessManagement: (nextAccessManagement, preferredUserId) => {
      setCurrentAccessManagement(nextAccessManagement);
      applyAccessManagementSnapshot(nextAccessManagement, preferredUserId);
      applyAccessManagementBulkSnapshot(nextAccessManagement);
    },
  });
  const {
    bulkSummary,
    filteredUsers,
    registryEntries,
    roleOptions,
  } = useUsersPageRegistrySurfaceController({
    locale,
    roleFilter,
    roles,
    search,
    selectedCount,
    statusFilter,
    t,
    users,
  });
  const {
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    priorityUser,
    priorityUserBadges,
    priorityUserFootnote,
    priorityUserMetrics,
    sourceStatusLabel,
    sourceTone,
    userCoverageFootnote,
    userCoverageMetrics,
    userPostureSignals,
  } = useUsersPageSurfaceController({
    accessManagement: currentAccessManagement,
    locale,
    roles,
    t,
    users,
  });
  const {
    editorDescription,
    effectivePermissionTags,
    inheritedPermissionTags,
    permissionOptions,
    primaryRoleHref,
    profileSummaryFields,
    roleSelectionOptions,
  } = useUsersPageRegistryEditorSurfaceController({
    accessNavigationContext,
    draft,
    effectivePermissions,
    inheritedPermissions,
    locale,
    roles: currentAccessManagement.roles,
    selectedUser,
    suggestedPermissions,
    t,
  });
  const {
    permissionsSection,
    profileSection,
    rolesSection,
  } = useUsersPageEditorPresentationController({
    customPermissionValue,
    draft,
    effectiveTags: effectivePermissionTags,
    inheritedTags: inheritedPermissionTags,
    permissionSelectionOptions: permissionOptions,
    primaryRoleRoute: primaryRoleHref,
    profileSummaryFields,
    roleSelectionOptions,
    selectedUser,
    t,
    updateCustomPermissions,
    updateDraft,
  });
  const { usersPageContentProps } = useUsersPageContentSurfaceController({
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
    permissionSection: permissionsSection,
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
  });

  return {
    usersPageContentProps,
  };
}

async function refreshAccessManagement(message: string) {
  const response = await fetch('/api/management/security/users', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(message);
  }

  return (await response.json()) as AccessManagementView;
}

function selectManagedUser(
  users: readonly AccessManagedUserEntry[],
  preferredUserId?: string,
) {
  return (
    users.find((user) => user.id === preferredUserId) ??
    users[0] ??
    null
  );
}
