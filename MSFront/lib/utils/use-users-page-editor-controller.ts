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

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UserEditorDraft {
  id: string;
  displayName: string;
  status: FrameworkUserStatus;
  roles: string[];
  extraPermissions: string[];
}

interface UseUsersPageEditorControllerOptions {
  selectedUser: AccessManagedUserEntry | null;
  users: readonly AccessManagedUserEntry[];
  roles: readonly AccessManagedRoleEntry[];
  supportedPermissions: readonly string[];
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  t: TranslationFn;
  startTransition: (callback: () => void) => void;
  refreshAccessManagement: (message: string) => Promise<AccessManagementView>;
  onApplyAccessManagement: (
    nextAccessManagement: AccessManagementView,
    preferredUserId?: string,
  ) => void;
}

export function useUsersPageEditorController({
  selectedUser,
  users,
  roles,
  supportedPermissions,
  clearFeedback,
  showError,
  showSuccess,
  t,
  startTransition,
  refreshAccessManagement,
  onApplyAccessManagement,
}: UseUsersPageEditorControllerOptions) {
  const selectedUserId = selectedUser?.id ?? '';
  const selectedUserDraft = useMemo(
    () => (selectedUser ? toDraft(selectedUser) : null),
    [selectedUser],
  );
  const [draftState, setDraftState] = useState<UserEditorDraft | null>(selectedUserDraft);
  const [draftOwnerId, setDraftOwnerId] = useState(selectedUserId);
  const draft =
    draftOwnerId === selectedUserId
      ? draftState
      : selectedUserDraft;

  const inheritedPermissions = useMemo(
    () =>
      draft
        ? collectPermissionsForRoles(
            draft.roles,
            roles.map((role) => ({
              id: role.id,
              permissions: role.permissions,
            })),
          )
        : [],
    [draft, roles],
  );
  const effectivePermissions = useMemo(
    () =>
      draft
        ? dedupeStrings([...inheritedPermissions, ...draft.extraPermissions]).sort((left, right) =>
            left.localeCompare(right),
          )
        : [],
    [draft, inheritedPermissions],
  );
  const suggestedPermissions = useMemo(
    () =>
      dedupeStrings([
        ...supportedPermissions,
        ...roles.flatMap((role) => role.permissions),
        ...users.flatMap((user) => user.effectivePermissions),
      ]).sort((left, right) => left.localeCompare(right)),
    [roles, supportedPermissions, users],
  );
  const customPermissionValue = useMemo(
    () =>
      draft
        ? draft.extraPermissions
            .filter((permission) => !suggestedPermissions.includes(permission))
            .join(', ')
        : '',
    [draft, suggestedPermissions],
  );

  function updateDraft(nextPartial: Partial<UserEditorDraft>) {
    setDraftOwnerId(selectedUserId);
    setDraftState((currentDraft) => (currentDraft ? { ...currentDraft, ...nextPartial } : currentDraft));
  }

  function toggleRole(roleId: string) {
    setDraftOwnerId(selectedUserId);
    setDraftState((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const nextRoles = currentDraft.roles.includes(roleId)
        ? currentDraft.roles.filter((role) => role !== roleId)
        : [...currentDraft.roles, roleId];

      return {
        ...currentDraft,
        roles: dedupeStrings(nextRoles).sort((left, right) => left.localeCompare(right)),
      };
    });
  }

  function toggleExtraPermission(permission: string) {
    setDraftOwnerId(selectedUserId);
    setDraftState((currentDraft) => {
      if (!currentDraft || inheritedPermissions.includes(permission)) {
        return currentDraft;
      }

      const nextExtraPermissions = currentDraft.extraPermissions.includes(permission)
        ? currentDraft.extraPermissions.filter((item) => item !== permission)
        : [...currentDraft.extraPermissions, permission];

      return {
        ...currentDraft,
        extraPermissions: dedupeStrings(nextExtraPermissions).sort((left, right) =>
          left.localeCompare(right),
        ),
      };
    });
  }

  function updateCustomPermissions(value: string) {
    setDraftOwnerId(selectedUserId);
    setDraftState((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const retainedSuggestedPermissions = currentDraft.extraPermissions.filter((permission) =>
        suggestedPermissions.includes(permission),
      );
      const customPermissions = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      return {
        ...currentDraft,
        extraPermissions: dedupeStrings([
          ...retainedSuggestedPermissions,
          ...customPermissions,
        ]).sort((left, right) => left.localeCompare(right)),
      };
    });
  }

  function saveUser() {
    if (!draft) {
      return;
    }

    clearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/management/security/users/${draft.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            displayName: draft.displayName,
            status: draft.status,
            roles: draft.roles,
            extraPermissions: draft.extraPermissions,
          }),
        });
        const payload = (await response.json()) as AccessManagedUserEntry | { message?: string };

        if (!response.ok) {
          showError(
            'message' in payload ? payload.message ?? t('users.saveError') : t('users.saveError'),
          );
          return;
        }

        const nextAccessManagement = await refreshAccessManagement(t('users.reloadError'));
        const nextUser =
          nextAccessManagement.users.find((user) => user.id === draft.id) ??
          (payload as AccessManagedUserEntry);

        setDraftOwnerId(nextUser.id);
        setDraftState(toDraft(nextUser));
        onApplyAccessManagement(nextAccessManagement, nextUser.id);
        showSuccess(t('users.saveSuccess', { user: nextUser.displayName }));
      })().catch((requestError) => {
        showError(requestError instanceof Error ? requestError.message : t('users.saveError'));
      });
    });
  }

  return {
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
  };
}

function toDraft(user: AccessManagedUserEntry): UserEditorDraft {
  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    roles: [...user.roles],
    extraPermissions: [...user.extraPermissions],
  };
}

function collectPermissionsForRoles(
  roleIds: readonly string[],
  roles: readonly Pick<AccessManagedRoleEntry, 'id' | 'permissions'>[],
) {
  return dedupeStrings(
    roleIds.flatMap((roleId) => roles.find((role) => role.id === roleId)?.permissions ?? []),
  ).sort((left, right) => left.localeCompare(right));
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
