'use client';

import { useMemo } from 'react';
import type { UserEditorDraft } from '@/lib/utils/use-users-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UsersPermissionSelectionOption {
  id: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
}

export interface UsersPermissionTag {
  id: string;
  label: string;
}

interface UseUsersPageRegistryEditorPermissionsSurfaceControllerOptions {
  draft: UserEditorDraft | null;
  effectivePermissions: readonly string[];
  inheritedPermissions: readonly string[];
  suggestedPermissions: readonly string[];
  t: TranslationFn;
}

export function useUsersPageRegistryEditorPermissionsSurfaceController({
  draft,
  effectivePermissions,
  inheritedPermissions,
  suggestedPermissions,
  t,
}: UseUsersPageRegistryEditorPermissionsSurfaceControllerOptions) {
  const permissionOptions = useMemo<UsersPermissionSelectionOption[]>(
    () =>
      suggestedPermissions.map((permission) => {
        const disabled = inheritedPermissions.includes(permission);
        const checked = disabled || Boolean(draft?.extraPermissions.includes(permission));

        return {
          id: permission,
          checked,
          disabled,
          title: permission,
          description: disabled ? t('users.inheritedTag') : t('users.directGrantTag'),
        };
      }),
    [draft?.extraPermissions, inheritedPermissions, suggestedPermissions, t],
  );
  const inheritedPermissionTags = useMemo(
    () => buildPermissionTags('inherited', inheritedPermissions, t('security.emptyValue')),
    [inheritedPermissions, t],
  );
  const effectivePermissionTags = useMemo(
    () => buildPermissionTags('effective', effectivePermissions, t('security.emptyValue')),
    [effectivePermissions, t],
  );

  return {
    effectivePermissionTags,
    inheritedPermissionTags,
    permissionOptions,
  };
}

function buildPermissionTags(
  prefix: string,
  permissions: readonly string[],
  emptyLabel: string,
): UsersPermissionTag[] {
  if (permissions.length === 0) {
    return [
      {
        id: `${prefix}:empty`,
        label: emptyLabel,
      },
    ];
  }

  return permissions.map((permission) => ({
    id: `${prefix}:${permission}`,
    label: permission,
  }));
}
