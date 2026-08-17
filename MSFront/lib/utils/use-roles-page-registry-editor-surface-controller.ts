'use client';

import type {
  AccessManagedUserEntry,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import type { RoleEditorDraft } from '@/lib/utils/use-roles-page-editor-controller';
import {
  useRolesPageRegistryEditorMembersSurfaceController,
} from '@/lib/utils/use-roles-page-registry-editor-members-surface-controller';
import { useRolesPageRegistryEditorPermissionsSurfaceController } from '@/lib/utils/use-roles-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageRegistryEditorSurfaceControllerOptions {
  accessNavigationContext: AccessNavigationContext;
  canEditRole: boolean;
  draft: RoleEditorDraft | null;
  focusedMemberId: string;
  isCreating: boolean;
  roleMembers: readonly AccessManagedUserEntry[];
  suggestedPermissions: readonly string[];
  t: TranslationFn;
}

export function useRolesPageRegistryEditorSurfaceController({
  accessNavigationContext,
  canEditRole,
  draft,
  focusedMemberId,
  isCreating,
  roleMembers,
  suggestedPermissions,
  t,
}: UseRolesPageRegistryEditorSurfaceControllerOptions) {
  const editorDescription = draft
    ? t('roles.editorDescription', { role: draft.name || draft.id })
    : t('roles.emptyDescription');
  const editorDetail = draft?.locked && !isCreating ? t('roles.lockedDescription') : null;
  const { permissionOptions } = useRolesPageRegistryEditorPermissionsSurfaceController({
    canEditRole,
    draft,
    suggestedPermissions,
    t,
  });
  const { memberCards } = useRolesPageRegistryEditorMembersSurfaceController({
    accessNavigationContext,
    draft,
    focusedMemberId,
    roleMembers,
    t,
  });

  return {
    editorDescription,
    editorDetail,
    memberCards,
    permissionOptions,
  };
}
