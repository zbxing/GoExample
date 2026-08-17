'use client';

import { useMemo } from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  LocaleCode,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import {
  formatDateTime,
  formatNumber,
} from '@/lib/utils/format';
import type { UsersProfileSummaryField } from '@/lib/utils/use-users-page-editor-profile-presentation-controller';
import type { UserEditorDraft } from '@/lib/utils/use-users-page-editor-controller';
import {
  useUsersPageRegistryEditorRolesSurfaceController,
} from '@/lib/utils/use-users-page-registry-editor-roles-surface-controller';
import { useUsersPageRegistryEditorPermissionsSurfaceController } from '@/lib/utils/use-users-page-registry-editor-permissions-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageRegistryEditorSurfaceControllerOptions {
  accessNavigationContext: AccessNavigationContext;
  draft: UserEditorDraft | null;
  effectivePermissions: readonly string[];
  inheritedPermissions: readonly string[];
  locale: LocaleCode;
  roles: readonly AccessManagedRoleEntry[];
  selectedUser: AccessManagedUserEntry | null;
  suggestedPermissions: readonly string[];
  t: TranslationFn;
}

export function useUsersPageRegistryEditorSurfaceController({
  accessNavigationContext,
  draft,
  effectivePermissions,
  inheritedPermissions,
  locale,
  roles,
  selectedUser,
  suggestedPermissions,
  t,
}: UseUsersPageRegistryEditorSurfaceControllerOptions) {
  const editorDescription = selectedUser
    ? t('users.editorDescription', { user: selectedUser.displayName })
    : t('users.emptyDescription');
  const profileSummaryFields = useMemo<UsersProfileSummaryField[]>(
    () =>
      selectedUser
        ? [
            {
              id: 'last-seen',
              label: t('labels.lastSeen'),
              value: selectedUser.lastSeenAt
                ? formatDateTime(selectedUser.lastSeenAt, locale)
                : t('security.emptyValue'),
              detail: formatDateTime(selectedUser.updatedAt, locale),
            },
            {
              id: 'sessions',
              label: t('labels.sessions'),
              value: formatNumber(selectedUser.sessionCount, locale),
              detail: t('users.sessionsHelp'),
            },
            {
              id: 'api-keys',
              label: t('labels.apiKeys'),
              value: formatNumber(selectedUser.apiKeyCount, locale),
              detail: t('users.apiKeysHelp'),
            },
          ]
        : [],
    [locale, selectedUser, t],
  );
  const { primaryRoleHref, roleSelectionOptions } =
    useUsersPageRegistryEditorRolesSurfaceController({
      accessNavigationContext,
      draft,
      roles,
      selectedUser,
      t,
    });
  const {
    effectivePermissionTags,
    inheritedPermissionTags,
    permissionOptions,
  } = useUsersPageRegistryEditorPermissionsSurfaceController({
    draft,
    effectivePermissions,
    inheritedPermissions,
    suggestedPermissions,
    t,
  });

  return {
    editorDescription,
    effectivePermissionTags,
    inheritedPermissionTags,
    permissionOptions,
    primaryRoleHref,
    profileSummaryFields,
    roleSelectionOptions,
  };
}
