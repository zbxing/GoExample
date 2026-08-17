'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
} from '@/lib/types/management';
import {
  buildContextualRolesHref,
  buildContextualSecurityHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import type { UserEditorDraft } from '@/lib/utils/use-users-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UsersRegistryEditorRoleSelectionOption {
  id: string;
  checked: boolean;
  title: string;
  description: string;
  inputAriaLabel: string;
  roleDetailsHref: Route;
  securityContextHref: Route;
}

interface UseUsersPageRegistryEditorRolesSurfaceControllerOptions {
  accessNavigationContext: AccessNavigationContext;
  draft: UserEditorDraft | null;
  roles: readonly AccessManagedRoleEntry[];
  selectedUser: AccessManagedUserEntry | null;
  t: TranslationFn;
}

export function useUsersPageRegistryEditorRolesSurfaceController({
  accessNavigationContext,
  draft,
  roles,
  selectedUser,
  t,
}: UseUsersPageRegistryEditorRolesSurfaceControllerOptions) {
  const primaryRoleHref = useMemo(
    () =>
      draft?.roles[0]
        ? buildContextualRolesHref(accessNavigationContext, {
            roleId: draft.roles[0],
            userId: draft.id,
          })
        : buildContextualRolesHref(accessNavigationContext),
    [accessNavigationContext, draft],
  );
  const roleSelectionOptions = useMemo<UsersRegistryEditorRoleSelectionOption[]>(
    () =>
      roles.map((role) => ({
        id: role.id,
        checked: Boolean(draft?.roles.includes(role.id)),
        title: role.name,
        description: role.description,
        inputAriaLabel: t('users.actions.toggleRoleSelection', {
          role: role.name,
        }),
        roleDetailsHref: buildContextualRolesHref(accessNavigationContext, {
          roleId: role.id,
          userId: selectedUser?.id ?? draft?.id ?? '',
        }),
        securityContextHref: buildContextualSecurityHref(accessNavigationContext, {
          focus: 'users',
          role: role.id,
          search: buildUserSearchToken(selectedUser),
        }),
      })),
    [accessNavigationContext, draft?.id, draft?.roles, roles, selectedUser, t],
  );

  return {
    primaryRoleHref,
    roleSelectionOptions,
  };
}

function buildUserSearchToken(user: AccessManagedUserEntry | null) {
  if (!user) {
    return '';
  }

  return user.username || user.displayName || user.id;
}
