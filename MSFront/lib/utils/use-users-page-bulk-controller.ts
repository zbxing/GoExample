'use client';

import {
  useMemo,
  useState,
} from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementView,
  FrameworkUserStatus,
} from '@/lib/types/management';
import { humanizeIdentifier } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageBulkControllerOptions {
  users: readonly AccessManagedUserEntry[];
  roles: readonly AccessManagedRoleEntry[];
  initialSelectedUserId?: string;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  t: TranslationFn;
  startTransition: (callback: () => void) => void;
  refreshAccessManagement: (message: string) => Promise<AccessManagementView>;
  selectedUserId: string;
  onApplyAccessManagement: (
    nextAccessManagement: AccessManagementView,
    preferredUserId?: string,
  ) => void;
}

export function useUsersPageBulkController({
  users,
  roles,
  initialSelectedUserId = '',
  clearFeedback,
  showError,
  showSuccess,
  t,
  startTransition,
  refreshAccessManagement,
  selectedUserId,
  onApplyAccessManagement,
}: UseUsersPageBulkControllerOptions) {
  const [bulkRoleId, setBulkRoleId] = useState<string>(roles[0]?.id ?? '');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    initialSelectedUserId ? [initialSelectedUserId] : [],
  );
  const selectedUsers = useMemo(
    () => users.filter((user) => selectedUserIds.includes(user.id)),
    [selectedUserIds, users],
  );
  const selectedCount = selectedUsers.length;
  const canBulkEnable = selectedUsers.some((user) => user.status !== 'active');
  const canBulkDisable = selectedUsers.some((user) => user.status !== 'disabled');
  const canBulkAssignRole = Boolean(
    bulkRoleId && selectedUsers.some((user) => !user.roles.includes(bulkRoleId)),
  );
  const canBulkRemoveRole = Boolean(
    bulkRoleId && selectedUsers.some((user) => user.roles.includes(bulkRoleId)),
  );

  function toggleUserSelection(userId: string) {
    setSelectedUserIds((currentSelection) =>
      currentSelection.includes(userId)
        ? currentSelection.filter((currentUserId) => currentUserId !== userId)
        : [...currentSelection, userId],
    );
  }

  function toggleVisibleSelection(visibleUsers: readonly AccessManagedUserEntry[]) {
    const visibleUserIds = visibleUsers.map((user) => user.id);

    if (visibleUserIds.length === 0) {
      return;
    }

    setSelectedUserIds((currentSelection) => {
      const allVisibleSelected = visibleUserIds.every((userId) => currentSelection.includes(userId));

      if (allVisibleSelected) {
        return currentSelection.filter((userId) => !visibleUserIds.includes(userId));
      }

      return dedupeStrings([...currentSelection, ...visibleUserIds]);
    });
  }

  function handleBulkRoleChange(value: string) {
    setBulkRoleId(value);
  }

  function bulkUpdateStatus(nextStatus: FrameworkUserStatus) {
    if (selectedUserIds.length === 0) {
      return;
    }

    const batchUserIds = [...selectedUserIds];

    clearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/management/security/users', {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'batch-status',
            userIds: batchUserIds,
            status: nextStatus,
          }),
        });
        const payload = (await response.json()) as
          | { updatedCount: number; userIds: string[]; status: FrameworkUserStatus }
          | { message?: string };

        if (!response.ok) {
          showError(
            'message' in payload
              ? payload.message ?? t('users.batchStatusError')
              : t('users.batchStatusError'),
          );
          return;
        }

        const nextAccessManagement = await refreshAccessManagement(t('users.reloadError'));
        const nextFocusedUserId =
          selectedUserId && batchUserIds.includes(selectedUserId)
            ? selectedUserId
            : (batchUserIds[0] ?? selectedUserId);

        onApplyAccessManagement(nextAccessManagement, nextFocusedUserId);
        setSelectedUserIds(
          'userIds' in payload
            ? payload.userIds.filter((userId) =>
                nextAccessManagement.users.some((user) => user.id === userId),
              )
            : batchUserIds,
        );
        showSuccess(
          t(
            nextStatus === 'active' ? 'users.batchEnableSuccess' : 'users.batchDisableSuccess',
            {
              count: batchUserIds.length,
            },
          ),
        );
      })().catch((requestError) => {
        showError(
          requestError instanceof Error ? requestError.message : t('users.batchStatusError'),
        );
      });
    });
  }

  function bulkUpdateRole(operation: 'assign' | 'remove') {
    if (selectedUserIds.length === 0 || !bulkRoleId) {
      return;
    }

    const batchUserIds = [...selectedUserIds];
    const targetRoleId = bulkRoleId;

    clearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/management/security/users', {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'batch-role',
            userIds: batchUserIds,
            roleId: targetRoleId,
            operation,
          }),
        });
        const payload = (await response.json()) as
          | {
              updatedCount: number;
              userIds: string[];
              roleId: string;
              operation: 'assign' | 'remove';
            }
          | { message?: string };

        if (!response.ok) {
          showError(
            'message' in payload
              ? payload.message ?? t('users.batchRoleError')
              : t('users.batchRoleError'),
          );
          return;
        }

        const nextAccessManagement = await refreshAccessManagement(t('users.reloadError'));
        const nextFocusedUserId =
          selectedUserId && batchUserIds.includes(selectedUserId)
            ? selectedUserId
            : (batchUserIds[0] ?? selectedUserId);

        onApplyAccessManagement(nextAccessManagement, nextFocusedUserId);
        setSelectedUserIds(
          'userIds' in payload
            ? payload.userIds.filter((userId) =>
                nextAccessManagement.users.some((user) => user.id === userId),
              )
            : batchUserIds,
        );
        showSuccess(
          t(
            operation === 'assign'
              ? 'users.batchAssignRoleSuccess'
              : 'users.batchRemoveRoleSuccess',
            {
              count: batchUserIds.length,
              role: humanizeIdentifier(targetRoleId),
            },
          ),
        );
      })().catch((requestError) => {
        showError(requestError instanceof Error ? requestError.message : t('users.batchRoleError'));
      });
    });
  }

  function applyAccessManagementBulkSnapshot(nextAccessManagement: AccessManagementView) {
    setSelectedUserIds((currentSelection) =>
      currentSelection.filter((userId) =>
        nextAccessManagement.users.some((user) => user.id === userId),
      ),
    );
    setBulkRoleId((currentRoleId) => {
      if (currentRoleId && nextAccessManagement.roles.some((role) => role.id === currentRoleId)) {
        return currentRoleId;
      }

      return nextAccessManagement.roles[0]?.id ?? '';
    });
  }

  return {
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
  };
}

function dedupeStrings(values: readonly string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => `${value}`.trim())
        .filter(Boolean),
    ),
  );
}
