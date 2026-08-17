'use client';

import {
  useState,
  useTransition,
} from 'react';
import { usePathname } from 'next/navigation';
import type {
  AccessManagementView,
  LocaleCode,
} from '@/lib/types/management';
import { useRolesPageEditorPresentationController } from '@/lib/utils/use-roles-page-editor-presentation-controller';
import { useRolesPageController } from '@/lib/utils/use-roles-page-controller';
import { useRolesPageContentSurfaceController } from '@/lib/utils/use-roles-page-content-surface-controller';
import { useRolesPageEditorController } from '@/lib/utils/use-roles-page-editor-controller';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useRolesPageRegistryEditorSurfaceController } from '@/lib/utils/use-roles-page-registry-editor-surface-controller';
import { useRolesPageRegistrySurfaceController } from '@/lib/utils/use-roles-page-registry-surface-controller';
import { useRolesPageSurfaceController } from '@/lib/utils/use-roles-page-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageBridgeControllerOptions {
  accessManagement: AccessManagementView;
  locale: LocaleCode;
  t: TranslationFn;
  initialRoleId?: string;
  initialMemberId?: string;
  initialSearch?: string;
}

export function useRolesPageBridgeController({
  accessManagement,
  locale,
  t,
  initialRoleId = '',
  initialMemberId = '',
  initialSearch = '',
}: UseRolesPageBridgeControllerOptions) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [currentAccessManagement, setCurrentAccessManagement] =
    useState<AccessManagementView>(accessManagement);
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback({ durationMs: 4200 });
  const accessMessage =
    currentAccessManagement.source === 'database' ? t('rbac.sourceLive') : t('rbac.sourceUnavailable');

  const roles = currentAccessManagement.roles;
  const {
    accessNavigationContext,
    applyAccessManagementSnapshot,
    focusedMemberId,
    handleCopyCurrentView,
    handleCreateRole,
    handleSearchChange,
    handleSelectRole,
    isCreating,
    rolesContextSecurityHref,
    rolesContextTags,
    rolesContextUsersHref,
    search,
    selectedRoleId,
  } = useRolesPageController({
    pathname,
    roles,
    users: currentAccessManagement.users,
    initialRoleId,
    initialMemberId,
    initialSearch,
    clearFeedback,
    showError,
    showSuccess,
    t,
  });
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const {
    beginCreateRole,
    canEditRole,
    customPermissionValue,
    draft,
    removeRole,
    roleMembers,
    saveRole,
    suggestedPermissions,
    togglePermission,
    updateCustomPermissions,
    updateDraft,
  } = useRolesPageEditorController({
    isCreating,
    selectedRole,
    users: currentAccessManagement.users,
    roles,
    supportedPermissions: currentAccessManagement.supportedPermissions,
    clearFeedback,
    showError,
    showSuccess,
    t,
    startTransition: (callback) => startTransition(callback),
    refreshAccessManagement,
    onApplyAccessManagement: (nextAccessManagement, preferredRoleId) => {
      setCurrentAccessManagement(nextAccessManagement);
      applyAccessManagementSnapshot(nextAccessManagement, preferredRoleId);
    },
  });
  const {
    filteredRoles,
    registryEntries,
  } = useRolesPageRegistrySurfaceController({
    locale,
    roles,
    search,
    t,
  });
  const {
    commandCenterSummaryCards,
    commandCenterTags,
    metrics,
    priorityRole,
    priorityRoleBadges,
    priorityRoleFootnote,
    priorityRoleMetrics,
    roleCoverageFootnote,
    roleCoverageMetrics,
    rolePostureSignals,
    sourceStatusLabel,
    sourceTone,
  } = useRolesPageSurfaceController({
    accessManagement: currentAccessManagement,
    locale,
    roles,
    t,
  });
  const {
    editorDescription,
    editorDetail,
    memberCards,
    permissionOptions,
  } = useRolesPageRegistryEditorSurfaceController({
    accessNavigationContext,
    canEditRole,
    draft,
    focusedMemberId,
    isCreating,
    roleMembers,
    suggestedPermissions,
    t,
  });
  const {
    membersSection,
    permissionsSection,
    profileSection,
  } = useRolesPageEditorPresentationController({
    canEditRole,
    customPermissionValue,
    draft,
    isCreating,
    memberCards,
    permissionOptions,
    t,
    updateCustomPermissions,
    updateDraft,
  });
  const { rolesPageContentProps } = useRolesPageContentSurfaceController({
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
    permissionSection: permissionsSection,
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
  });

  return {
    rolesPageContentProps,
  };
}

async function refreshAccessManagement(message: string) {
  const response = await fetch('/api/management/security/roles', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(message);
  }

  return (await response.json()) as AccessManagementView;
}
