'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import type { PermissionSectionModel } from '@/components/pages/users-page-editor-permissions-content';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { UserEditorDraft } from '@/lib/utils/use-users-page-editor-controller';
import {
  useUsersPageEditorPermissionsPresentationController,
} from '@/lib/utils/use-users-page-editor-permissions-presentation-controller';
import {
  type UsersProfileSummaryField,
  useUsersPageEditorProfilePresentationController,
} from '@/lib/utils/use-users-page-editor-profile-presentation-controller';
import type {
  UsersRegistryEditorRoleSelectionOption,
} from '@/lib/utils/use-users-page-registry-editor-roles-surface-controller';
import type {
  UsersPermissionSelectionOption,
  UsersPermissionTag,
} from '@/lib/utils/use-users-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UsersEditorRolesSectionModel {
  title: string;
  actionLabel: string;
  actionHref: Route;
  options: readonly UsersRegistryEditorRoleSelectionOption[];
}

interface UseUsersPageEditorPresentationControllerOptions {
  customPermissionValue: string;
  draft: UserEditorDraft | null;
  effectiveTags: readonly UsersPermissionTag[];
  inheritedTags: readonly UsersPermissionTag[];
  permissionSelectionOptions: readonly UsersPermissionSelectionOption[];
  primaryRoleRoute: Route;
  profileSummaryFields: readonly UsersProfileSummaryField[];
  roleSelectionOptions: readonly UsersRegistryEditorRoleSelectionOption[];
  selectedUser: AccessManagedUserEntry | null;
  t: TranslationFn;
  updateCustomPermissions: (value: string) => void;
  updateDraft: (nextPartial: Partial<UserEditorDraft>) => void;
}

export function useUsersPageEditorPresentationController({
  customPermissionValue,
  draft,
  effectiveTags,
  inheritedTags,
  permissionSelectionOptions,
  primaryRoleRoute,
  profileSummaryFields,
  roleSelectionOptions,
  selectedUser,
  t,
  updateCustomPermissions,
  updateDraft,
}: UseUsersPageEditorPresentationControllerOptions) {
  const { profileSection } = useUsersPageEditorProfilePresentationController({
    draft,
    profileSummaryFields,
    selectedUser,
    t,
    updateDraft,
  });
  const rolesSection = useMemo<UsersEditorRolesSectionModel>(
    () => ({
      title: t('users.rolesTitle'),
      actionLabel: t('users.actions.openPrimaryRole'),
      actionHref: primaryRoleRoute,
      options: roleSelectionOptions,
    }),
    [primaryRoleRoute, roleSelectionOptions, t],
  );
  const { permissionsSection }: { permissionsSection: PermissionSectionModel } =
    useUsersPageEditorPermissionsPresentationController({
      customPermissionValue,
      effectiveTags,
      inheritedTags,
      permissionSelectionOptions,
      t,
      updateCustomPermissions,
    });

  return {
    permissionsSection,
    profileSection,
    rolesSection,
  };
}
