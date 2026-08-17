'use client';

import { useMemo } from 'react';
import type { RoleEditorDraft } from '@/lib/utils/use-roles-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface RolesPermissionSelectionOption {
  id: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
}

interface UseRolesPageRegistryEditorPermissionsSurfaceControllerOptions {
  canEditRole: boolean;
  draft: RoleEditorDraft | null;
  suggestedPermissions: readonly string[];
  t: TranslationFn;
}

export function useRolesPageRegistryEditorPermissionsSurfaceController({
  canEditRole,
  draft,
  suggestedPermissions,
  t,
}: UseRolesPageRegistryEditorPermissionsSurfaceControllerOptions) {
  const permissionOptions = useMemo<RolesPermissionSelectionOption[]>(
    () =>
      suggestedPermissions.map((permission) => ({
        id: permission,
        checked: Boolean(draft?.permissions.includes(permission)),
        disabled: !canEditRole,
        title: permission,
        description: t('roles.suggestedPermissionTag'),
      })),
    [canEditRole, draft, suggestedPermissions, t],
  );

  return {
    permissionOptions,
  };
}
