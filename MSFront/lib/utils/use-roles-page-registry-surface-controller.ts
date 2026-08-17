'use client';

import { useMemo } from 'react';
import type { RolesRegistryEntryModel } from '@/components/pages/roles-page-workspaces-content';
import type { AccessManagedRoleEntry } from '@/lib/types/management';
import { formatNumber } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageRegistrySurfaceControllerOptions {
  roles: readonly AccessManagedRoleEntry[];
  search: string;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
}

export function useRolesPageRegistrySurfaceController({
  roles,
  search,
  locale,
  t,
}: UseRolesPageRegistrySurfaceControllerOptions) {
  const filteredRoles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return roles.filter((role) => {
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [role.id, role.name, role.description, ...role.permissions]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [roles, search]);

  const registryEntries = useMemo<RolesRegistryEntryModel[]>(
    () =>
      filteredRoles.map((role) => ({
        id: role.id,
        role,
        title: role.name,
        identity: role.id,
        description: role.description,
        tags: [
          `${formatNumber(role.memberCount, locale)} ${t('labels.users')}`,
          `${formatNumber(role.permissionCount, locale)} ${t('labels.permissions')}`,
        ],
      })),
    [filteredRoles, locale, t],
  );

  return {
    filteredRoles,
    registryEntries,
  };
}
