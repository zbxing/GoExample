'use client';

import { useLocale } from '@/providers/locale-provider';

interface RolesPageRegistryWorkbenchFiltersContentProps {
  handleSearchChange: (value: string) => void;
  search: string;
}

export function RolesPageRegistryWorkbenchFiltersContent({
  handleSearchChange,
  search,
}: RolesPageRegistryWorkbenchFiltersContentProps) {
  const { t } = useLocale();

  return (
    <div className="portfolioFilters accessFilterGrid accessFilterGridSingle">
      <label className="filterField filterFieldWide">
        <span>{t('roles.searchLabel')}</span>
        <input
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t('roles.searchPlaceholder')}
        />
      </label>
    </div>
  );
}
