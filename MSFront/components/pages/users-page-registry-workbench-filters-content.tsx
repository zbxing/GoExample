'use client';

import { useLocale } from '@/providers/locale-provider';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';
import { humanizeIdentifier } from '@/lib/utils/format';

interface UsersPageRegistryWorkbenchFiltersContentProps {
  handleRoleFilterChange: (value: string) => void;
  handleSearchChange: (value: string) => void;
  handleStatusFilterChange: (value: AccessUserStatusFilter) => void;
  roleFilter: string;
  roleOptions: readonly string[];
  search: string;
  statusFilter: AccessUserStatusFilter;
}

export function UsersPageRegistryWorkbenchFiltersContent({
  handleRoleFilterChange,
  handleSearchChange,
  handleStatusFilterChange,
  roleFilter,
  roleOptions,
  search,
  statusFilter,
}: UsersPageRegistryWorkbenchFiltersContentProps) {
  const { t } = useLocale();

  return (
    <div className="portfolioFilters accessFilterGrid">
      <label className="filterField filterFieldWide">
        <span>{t('users.searchLabel')}</span>
        <input
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t('users.searchPlaceholder')}
        />
      </label>
      <label className="filterField">
        <span>{t('labels.status')}</span>
        <select
          value={statusFilter}
          onChange={(event) => handleStatusFilterChange(event.target.value as AccessUserStatusFilter)}
        >
          <option value="all">{t('users.allStatuses')}</option>
          <option value="active">{t('security.status.active')}</option>
          <option value="disabled">{t('security.status.disabled')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('labels.roles')}</span>
        <select
          value={roleFilter}
          onChange={(event) => handleRoleFilterChange(event.target.value)}
        >
          <option value="all">{t('users.allRoles')}</option>
          {roleOptions.map((roleId) => (
            <option key={roleId} value={roleId}>
              {humanizeIdentifier(roleId)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
