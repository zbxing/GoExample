'use client';

import { useMemo } from 'react';
import type { PermissionSectionModel } from '@/components/pages/users-page-editor-permissions-content';
import type {
  UsersPermissionSelectionOption,
  UsersPermissionTag,
} from '@/lib/utils/use-users-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageEditorPermissionsPresentationControllerOptions {
  customPermissionValue: string;
  effectiveTags: readonly UsersPermissionTag[];
  inheritedTags: readonly UsersPermissionTag[];
  permissionSelectionOptions: readonly UsersPermissionSelectionOption[];
  t: TranslationFn;
  updateCustomPermissions: (value: string) => void;
}

export function useUsersPageEditorPermissionsPresentationController({
  customPermissionValue,
  effectiveTags,
  inheritedTags,
  permissionSelectionOptions,
  t,
  updateCustomPermissions,
}: UseUsersPageEditorPermissionsPresentationControllerOptions) {
  const permissionsSection = useMemo<PermissionSectionModel>(
    () => ({
      title: t('users.permissionsTitle'),
      panels: [
        {
          id: 'inherited',
          title: t('users.inheritedPermissionsLabel'),
          description: t('users.inheritedPermissionsHelp'),
          tags: inheritedTags,
        },
        {
          id: 'extra',
          title: t('users.extraPermissionsLabel'),
          description: t('users.extraPermissionsHelp'),
          options: permissionSelectionOptions,
          customField: {
            label: t('users.customPermissionsLabel'),
            value: customPermissionValue,
            placeholder: t('users.customPermissionsPlaceholder'),
            onChange: updateCustomPermissions,
          },
        },
        {
          id: 'effective',
          title: t('users.effectivePermissionsLabel'),
          description: t('users.effectivePermissionsHelp'),
          tags: effectiveTags,
        },
      ],
    }),
    [
      customPermissionValue,
      effectiveTags,
      inheritedTags,
      permissionSelectionOptions,
      t,
      updateCustomPermissions,
    ],
  );

  return {
    permissionsSection,
  };
}
