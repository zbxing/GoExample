'use client';

import { useMemo } from 'react';
import type {
  AccessManagedRoleEntry,
  LocaleCode,
} from '@/lib/types/management';

interface UseRolesPageSpotlightSelectionSurfaceControllerOptions {
  roles: readonly AccessManagedRoleEntry[];
  locale: LocaleCode;
}

export function useRolesPageSpotlightSelectionSurfaceController({
  roles,
  locale,
}: UseRolesPageSpotlightSelectionSurfaceControllerOptions) {
  const priorityRole = useMemo(
    () =>
      [...roles].sort(
        (left, right) =>
          buildRolePriorityScore(right) - buildRolePriorityScore(left) ||
          right.memberCount - left.memberCount ||
          right.permissionCount - left.permissionCount ||
          left.name.localeCompare(right.name, locale),
      )[0] ?? null,
    [locale, roles],
  );

  return {
    priorityRole,
  };
}

function buildRolePriorityScore(role: AccessManagedRoleEntry) {
  return (
    role.memberCount * 4 +
    role.permissionCount * 3 +
    role.disabledMemberCount * 5 +
    (role.locked ? 1 : 2)
  );
}
