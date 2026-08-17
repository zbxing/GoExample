'use client';

import { useMemo } from 'react';
import type { Route } from 'next';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import {
  buildContextualSecurityHref,
  buildContextualUsersHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import type { RoleEditorDraft } from '@/lib/utils/use-roles-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface RolesRegistryEditorMemberTagModel {
  id: string;
  label: string;
}

export interface RolesRegistryEditorMemberCardModel {
  id: string;
  displayName: string;
  usernameLabel: string;
  memberHref: Route;
  securityHref: Route;
  tags: readonly RolesRegistryEditorMemberTagModel[];
}

interface UseRolesPageRegistryEditorMembersSurfaceControllerOptions {
  accessNavigationContext: AccessNavigationContext;
  draft: RoleEditorDraft | null;
  focusedMemberId: string;
  roleMembers: readonly AccessManagedUserEntry[];
  t: TranslationFn;
}

export function useRolesPageRegistryEditorMembersSurfaceController({
  accessNavigationContext,
  draft,
  focusedMemberId,
  roleMembers,
  t,
}: UseRolesPageRegistryEditorMembersSurfaceControllerOptions) {
  const memberCards = useMemo<RolesRegistryEditorMemberCardModel[]>(
    () =>
      roleMembers.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        usernameLabel: `@${member.username}`,
        memberHref: buildContextualUsersHref(accessNavigationContext, {
          userId: member.id,
          roleId: draft?.id,
        }),
        securityHref: buildContextualSecurityHref(accessNavigationContext, {
          focus: 'users',
          role: draft?.id,
          search: member.username || member.displayName || member.id,
        }),
        tags: [
          {
            id: `${member.id}:status`,
            label: t(`security.status.${member.status}`),
          },
          ...(focusedMemberId === member.id
            ? [
                {
                  id: `${member.id}:focused`,
                  label: t('roles.actions.focusedMember'),
                },
              ]
            : []),
          ...member.effectivePermissions.map((permission) => ({
            id: `${member.id}:${permission}`,
            label: permission,
          })),
        ],
      })),
    [accessNavigationContext, draft, focusedMemberId, roleMembers, t],
  );

  return {
    memberCards,
  };
}
