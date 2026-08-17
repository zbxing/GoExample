'use client';

import { useMemo } from 'react';
import type { RolesEditorPermissionsSectionModel } from '@/components/pages/roles-page-editor-permissions-content';
import type { RolesPermissionSelectionOption } from '@/lib/utils/use-roles-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageEditorPermissionsPresentationControllerOptions {
  canEditRole: boolean;
  customPermissionValue: string;
  permissionOptions: readonly RolesPermissionSelectionOption[];
  t: TranslationFn;
  updateCustomPermissions: (value: string) => void;
}

export function useRolesPageEditorPermissionsPresentationController({
  canEditRole,
  customPermissionValue,
  permissionOptions,
  t,
  updateCustomPermissions,
}: UseRolesPageEditorPermissionsPresentationControllerOptions) {
  const permissionsSection = useMemo<RolesEditorPermissionsSectionModel>(
    () => ({
      title: t('roles.permissionsTitle'),
      description: t('roles.permissionHelp'),
      options: permissionOptions,
      customPermissionField: {
        label: t('roles.customPermissionsLabel'),
        value: customPermissionValue,
        placeholder: t('roles.customPermissionsPlaceholder'),
        disabled: !canEditRole,
        onChange: updateCustomPermissions,
      },
    }),
    [
      canEditRole,
      customPermissionValue,
      permissionOptions,
      t,
      updateCustomPermissions,
    ],
  );

  return {
    permissionsSection,
  };
}
