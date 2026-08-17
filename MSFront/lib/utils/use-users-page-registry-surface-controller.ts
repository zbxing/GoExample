'use client';

import { useMemo } from 'react';
import type { BulkSummaryModel } from '@/components/pages/users-page-registry-workbench-content';
import type { RegistryEntryModel } from '@/components/pages/users-page-workspaces-content';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
} from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';
import {
  formatNumber,
  humanizeIdentifier,
} from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageRegistrySurfaceControllerOptions {
  users: readonly AccessManagedUserEntry[];
  roles: readonly AccessManagedRoleEntry[];
  search: string;
  statusFilter: AccessUserStatusFilter;
  roleFilter: string;
  selectedCount: number;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useUsersPageRegistrySurfaceController({
  users,
  roles,
  search,
  statusFilter,
  roleFilter,
  selectedCount,
  locale,
  t,
}: UseUsersPageRegistrySurfaceControllerOptions) {
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return users.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) {
        return false;
      }

      if (roleFilter !== 'all' && !user.roles.includes(roleFilter)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        user.displayName,
        user.username,
        user.status,
        ...user.roles,
        ...user.effectivePermissions,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [roleFilter, search, statusFilter, users]);

  const roleOptions = useMemo(
    () => roles.map((role) => role.id).sort((left, right) => left.localeCompare(right)),
    [roles],
  );

  const bulkSummary = useMemo<BulkSummaryModel>(
    () => ({
      selectVisibleLabel: t('users.bulk.selectVisible', {
        count: formatNumber(filteredUsers.length, locale),
      }),
      selectedCountLabel: t('users.bulk.selectedCount', {
        count: formatNumber(selectedCount, locale),
      }),
    }),
    [filteredUsers.length, locale, selectedCount, t],
  );

  const registryEntries = useMemo<RegistryEntryModel[]>(
    () =>
      filteredUsers.map((user) => ({
        id: user.id,
        user,
        displayName: user.displayName,
        usernameLabel: `@${user.username}`,
        roleSummary:
          user.roles.length > 0
            ? humanizeIdentifier(user.roles.join(', '))
            : t('users.unassignedRole'),
        selectionAriaLabel: t('users.bulk.toggleSelection', {
          user: user.displayName,
        }),
        tags: [
          t(`security.status.${user.status}`),
          `${formatNumber(user.effectivePermissions.length, locale)} ${t('labels.permissions')}`,
        ],
      })),
    [filteredUsers, locale, t],
  );

  return {
    bulkSummary,
    filteredUsers,
    registryEntries,
    roleOptions,
  };
}
