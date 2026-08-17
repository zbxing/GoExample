'use client';

import { Search } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';
import type {
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { ServiceSortMode } from '@/lib/utils/governance-filters';

interface ServicesPageWorkbenchFiltersContentProps {
  categoryFilter: 'all' | ManagedServiceCategory;
  environmentFilter: 'all' | ProjectEnvironment;
  searchQuery: string;
  setCategoryFilter: (value: 'all' | ManagedServiceCategory) => void;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: ServiceSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: ServiceSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function ServicesPageWorkbenchFiltersContent({
  categoryFilter,
  environmentFilter,
  searchQuery,
  setCategoryFilter,
  setEnvironmentFilter,
  setSearchQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: ServicesPageWorkbenchFiltersContentProps) {
  const { t } = useLocale();

  return (
    <div className="serviceFilterGrid">
      <label className="filterField filterFieldWide">
        <span>{t('dashboard.services.filters.searchLabel')}</span>
        <div className="filterFieldInline">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('dashboard.services.filters.searchPlaceholder')}
          />
        </div>
      </label>
      <label className="filterField">
        <span>{t('labels.serviceCategory')}</span>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as 'all' | ManagedServiceCategory)}
        >
          <option value="all">{t('dashboard.services.allCategories')}</option>
          <option value="api">{t('dashboard.services.categories.api')}</option>
          <option value="worker">{t('dashboard.services.categories.worker')}</option>
          <option value="queue">{t('dashboard.services.categories.queue')}</option>
          <option value="storage">{t('dashboard.services.categories.storage')}</option>
          <option value="database">{t('dashboard.services.categories.database')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('dashboard.services.filters.environmentLabel')}</span>
        <select
          value={environmentFilter}
          onChange={(event) =>
            setEnvironmentFilter(event.target.value as 'all' | ProjectEnvironment)
          }
        >
          <option value="all">{t('dashboard.portfolio.allEnvironments')}</option>
          <option value="production">{t('status.production')}</option>
          <option value="staging">{t('status.staging')}</option>
          <option value="development">{t('status.development')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('dashboard.services.filters.statusLabel')}</span>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | ProjectStatus)}
        >
          <option value="all">{t('dashboard.portfolio.allStatuses')}</option>
          <option value="healthy">{t('status.healthy')}</option>
          <option value="warning">{t('status.warning')}</option>
          <option value="critical">{t('status.critical')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('dashboard.services.filters.sortLabel')}</span>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as ServiceSortMode)}
        >
          <option value="risk">{t('dashboard.services.filters.sortRisk')}</option>
          <option value="traffic">{t('dashboard.services.filters.sortTraffic')}</option>
          <option value="name">{t('dashboard.services.filters.sortName')}</option>
        </select>
      </label>
    </div>
  );
}
