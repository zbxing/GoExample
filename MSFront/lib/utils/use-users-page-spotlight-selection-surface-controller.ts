'use client';

import { useMemo } from 'react';
import type {
  AccessManagedUserEntry,
  LocaleCode,
} from '@/lib/types/management';

interface UseUsersPageSpotlightSelectionSurfaceControllerOptions {
  users: readonly AccessManagedUserEntry[];
  locale: LocaleCode;
}

export function useUsersPageSpotlightSelectionSurfaceController({
  users,
  locale,
}: UseUsersPageSpotlightSelectionSurfaceControllerOptions) {
  const priorityUser = useMemo(
    () =>
      [...users].sort(
        (left, right) =>
          buildUserPriorityScore(right) - buildUserPriorityScore(left) ||
          right.effectivePermissions.length - left.effectivePermissions.length ||
          right.sessionCount - left.sessionCount ||
          left.displayName.localeCompare(right.displayName, locale),
      )[0] ?? null,
    [locale, users],
  );

  return {
    priorityUser,
  };
}

function buildUserPriorityScore(user: AccessManagedUserEntry) {
  const unassignedScore = user.roles.length === 0 ? 8 : 0;
  const statusScore = user.status === 'disabled' ? 3 : 0;

  return (
    unassignedScore +
    statusScore +
    user.extraPermissions.length * 5 +
    user.effectivePermissions.length +
    user.sessionCount * 2 +
    user.apiKeyCount * 2
  );
}
