'use client';

import type { RolesEditorPermissionsSectionModel } from '@/components/pages/roles-page-editor-permissions-content';
import type { RoleEditorDraft } from '@/lib/utils/use-roles-page-editor-controller';
import {
  useRolesPageEditorPermissionsPresentationController,
} from '@/lib/utils/use-roles-page-editor-permissions-presentation-controller';
import {
  useRolesPageEditorProfilePresentationController,
} from '@/lib/utils/use-roles-page-editor-profile-presentation-controller';
import type {
  RolesRegistryEditorMemberCardModel,
} from '@/lib/utils/use-roles-page-registry-editor-members-surface-controller';
import type { RolesPermissionSelectionOption } from '@/lib/utils/use-roles-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface RolesEditorMembersSectionModel {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  cards: readonly RolesRegistryEditorMemberCardModel[];
  openMemberLabel: string;
  openMemberSecurityLabel: string;
}

interface UseRolesPageEditorPresentationControllerOptions {
  canEditRole: boolean;
  customPermissionValue: string;
  draft: RoleEditorDraft | null;
  isCreating: boolean;
  memberCards: readonly RolesRegistryEditorMemberCardModel[];
  permissionOptions: readonly RolesPermissionSelectionOption[];
  t: TranslationFn;
  updateCustomPermissions: (value: string) => void;
  updateDraft: (nextPartial: Partial<RoleEditorDraft>) => void;
}

export function useRolesPageEditorPresentationController({
  canEditRole,
  customPermissionValue,
  draft,
  isCreating,
  memberCards,
  permissionOptions,
  t,
  updateCustomPermissions,
  updateDraft,
}: UseRolesPageEditorPresentationControllerOptions) {
  const { profileSection } = useRolesPageEditorProfilePresentationController({
    canEditRole,
    draft,
    isCreating,
    t,
    updateDraft,
  });
  const { permissionsSection }: { permissionsSection: RolesEditorPermissionsSectionModel } =
    useRolesPageEditorPermissionsPresentationController({
      canEditRole,
      customPermissionValue,
      permissionOptions,
      t,
      updateCustomPermissions,
    });
  const membersSection: RolesEditorMembersSectionModel = {
    title: t('roles.membersTitle'),
    emptyTitle: t('roles.membersEmptyTitle'),
    emptyDescription: t('roles.membersEmptyDescription'),
    cards: memberCards,
    openMemberLabel: t('roles.actions.openMember'),
    openMemberSecurityLabel: t('roles.actions.openMemberSecurity'),
  };

  return {
    membersSection,
    permissionsSection,
    profileSection,
  };
}
