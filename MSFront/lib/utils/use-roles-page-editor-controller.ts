'use client';

import {
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementView,
} from '@/lib/types/management';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

const CREATE_ROLE_OWNER_PREFIX = 'create:';

export interface RoleEditorDraft {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  locked: boolean;
}

interface UseRolesPageEditorControllerOptions {
  isCreating: boolean;
  selectedRole: AccessManagedRoleEntry | null;
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
    preferredRoleId?: string,
  ) => void;
}

export function useRolesPageEditorController({
  isCreating,
  selectedRole,
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
}: UseRolesPageEditorControllerOptions) {
  const selectedRoleId = selectedRole?.id ?? '';
  const createSessionRef = useRef(0);
  const [createOwnerKey, setCreateOwnerKey] = useState(`${CREATE_ROLE_OWNER_PREFIX}0`);
  const selectedRoleDraft = useMemo(
    () => (selectedRole ? toDraft(selectedRole) : null),
    [selectedRole],
  );
  const currentOwnerKey = isCreating
    ? createOwnerKey
    : `role:${selectedRoleId}`;
  const fallbackDraft = isCreating ? createRoleDraft() : selectedRoleDraft;
  const [draftState, setDraftState] = useState<RoleEditorDraft | null>(fallbackDraft);
  const [draftOwnerKey, setDraftOwnerKey] = useState(currentOwnerKey);
  const draft =
    draftOwnerKey === currentOwnerKey
      ? draftState
      : fallbackDraft;
  const isLockedRole = Boolean(draft?.locked && !isCreating);
  const canEditRole = Boolean(draft) && !isLockedRole;
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
        ? draft.permissions.filter((permission) => !suggestedPermissions.includes(permission)).join(', ')
        : '',
    [draft, suggestedPermissions],
  );
  const activeRoleId = draft?.id ?? selectedRoleId;
  const roleMembers = useMemo(
    () =>
      activeRoleId
        ? users.filter((user) => user.roles.includes(activeRoleId))
        : [],
    [activeRoleId, users],
  );

  function beginCreateRole() {
    createSessionRef.current += 1;
    const nextOwnerKey = `${CREATE_ROLE_OWNER_PREFIX}${createSessionRef.current}`;

    setCreateOwnerKey(nextOwnerKey);
    setDraftOwnerKey(nextOwnerKey);
    setDraftState(createRoleDraft());
  }

  function updateDraft(nextPartial: Partial<RoleEditorDraft>) {
    if (!canEditRole) {
      return;
    }

    setDraftOwnerKey(currentOwnerKey);
    setDraftState((currentDraft) => {
      const baseDraft = draftOwnerKey === currentOwnerKey ? currentDraft : fallbackDraft;
      return baseDraft ? { ...baseDraft, ...nextPartial } : baseDraft;
    });
  }

  function togglePermission(permission: string) {
    if (!canEditRole) {
      return;
    }

    setDraftOwnerKey(currentOwnerKey);
    setDraftState((currentDraft) => {
      const baseDraft = draftOwnerKey === currentOwnerKey ? currentDraft : fallbackDraft;

      if (!baseDraft) {
        return baseDraft;
      }

      const nextPermissions = baseDraft.permissions.includes(permission)
        ? baseDraft.permissions.filter((item) => item !== permission)
        : [...baseDraft.permissions, permission];

      return {
        ...baseDraft,
        permissions: dedupeStrings(nextPermissions).sort((left, right) =>
          left.localeCompare(right),
        ),
      };
    });
  }

  function updateCustomPermissions(value: string) {
    if (!canEditRole) {
      return;
    }

    setDraftOwnerKey(currentOwnerKey);
    setDraftState((currentDraft) => {
      const baseDraft = draftOwnerKey === currentOwnerKey ? currentDraft : fallbackDraft;

      if (!baseDraft) {
        return baseDraft;
      }

      const retainedSuggestedPermissions = baseDraft.permissions.filter((permission) =>
        suggestedPermissions.includes(permission),
      );
      const customPermissions = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      return {
        ...baseDraft,
        permissions: dedupeStrings([...retainedSuggestedPermissions, ...customPermissions]).sort(
          (left, right) => left.localeCompare(right),
        ),
      };
    });
  }

  function saveRole() {
    if (!draft || !canEditRole) {
      return;
    }

    clearFeedback();

    const method = isCreating ? 'POST' : 'PUT';
    const endpoint = isCreating
      ? '/api/management/security/roles'
      : `/api/management/security/roles/${draft.id}`;

    startTransition(() => {
      void (async () => {
        const response = await fetch(endpoint, {
          method,
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id: draft.id,
            name: draft.name,
            description: draft.description,
            permissions: draft.permissions,
          }),
        });
        const payload = (await response.json()) as AccessManagedRoleEntry | { message?: string };

        if (!response.ok) {
          showError(
            'message' in payload ? payload.message ?? t('roles.saveError') : t('roles.saveError'),
          );
          return;
        }

        const nextAccessManagement = await refreshAccessManagement(t('roles.reloadError'));
        const nextRole =
          nextAccessManagement.roles.find((role) => role.id === draft.id) ??
          (payload as AccessManagedRoleEntry);

        setDraftOwnerKey(`role:${nextRole.id}`);
        setDraftState(toDraft(nextRole));
        onApplyAccessManagement(nextAccessManagement, nextRole.id);
        showSuccess(t('roles.saveSuccess', { role: nextRole.name }));
      })().catch((requestError) => {
        showError(requestError instanceof Error ? requestError.message : t('roles.saveError'));
      });
    });
  }

  function removeRole() {
    if (!draft || draft.locked || !draft.id) {
      return;
    }

    clearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/management/security/roles/${draft.id}`, {
          method: 'DELETE',
        });
        const payload = (await response.json()) as { message?: string };

        if (!response.ok) {
          showError(payload.message ?? t('roles.deleteError'));
          return;
        }

        const nextAccessManagement = await refreshAccessManagement(t('roles.reloadError'));
        const nextSelectedRole = selectManagedRole(
          nextAccessManagement.roles,
          nextAccessManagement.roles[0]?.id,
        );

        setDraftOwnerKey(nextSelectedRole ? `role:${nextSelectedRole.id}` : '');
        setDraftState(nextSelectedRole ? toDraft(nextSelectedRole) : null);
        onApplyAccessManagement(nextAccessManagement, nextSelectedRole?.id);
        showSuccess(t('roles.deleteSuccess', { role: draft.name }));
      })().catch((requestError) => {
        showError(requestError instanceof Error ? requestError.message : t('roles.deleteError'));
      });
    });
  }

  return {
    beginCreateRole,
    canEditRole,
    customPermissionValue,
    draft,
    isLockedRole,
    removeRole,
    roleMembers,
    saveRole,
    suggestedPermissions,
    togglePermission,
    updateCustomPermissions,
    updateDraft,
  };
}

function createRoleDraft(): RoleEditorDraft {
  return {
    id: '',
    name: '',
    description: '',
    permissions: [],
    locked: false,
  };
}

function toDraft(role: AccessManagedRoleEntry): RoleEditorDraft {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: [...role.permissions],
    locked: role.locked,
  };
}

function selectManagedRole(
  roles: readonly AccessManagedRoleEntry[],
  preferredRoleId?: string,
) {
  return (
    roles.find((role) => role.id === preferredRoleId) ??
    roles[0] ??
    null
  );
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
