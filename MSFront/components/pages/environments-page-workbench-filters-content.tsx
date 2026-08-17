'use client';

import { Search } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';
import type {
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { EnvironmentSortMode } from '@/lib/utils/governance-filters';

interface EnvironmentsPageWorkbenchFiltersContentProps {
  environmentFilter: 'all' | ProjectEnvironment;
  searchQuery: string;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: EnvironmentSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: EnvironmentSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function EnvironmentsPageWorkbenchFiltersContent({
  environmentFilter,
  searchQuery,
  setEnvironmentFilter,
  setSearchQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: EnvironmentsPageWorkbenchFiltersContentProps) {
  const { t } = useLocale();

  return (
    <div className="portfolioFilters">
      <label className="filterField filterFieldWide">
        <span>{t('dashboard.portfolio.searchLabel')}</span>
        <div className="filterFieldInline">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('dashboard.environments.filters.searchPlaceholder')}
          />
        </div>
      </label>
      <label className="filterField">
        <span>{t('dashboard.portfolio.environmentLabel')}</span>
        <select
          value={environmentFilter}
          onChange={(event) =>
            setEnvironmentFilter(event.target.value as 'all' | ProjectEnvironment)
          }
        >
          <option value="all">{t('dashboard.environments.allEnvironments')}</option>
          <option value="production">{t('status.production')}</option>
          <option value="staging">{t('status.staging')}</option>
          <option value="development">{t('status.development')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('dashboard.portfolio.statusLabel')}</span>
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
        <span>{t('dashboard.portfolio.sortLabel')}</span>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as EnvironmentSortMode)}
        >
          <option value="risk">{t('dashboard.portfolio.sortRisk')}</option>
          <option value="traffic">{t('dashboard.portfolio.sortTraffic')}</option>
          <option value="deploy">{t('dashboard.portfolio.sortDeploy')}</option>
          <option value="name">{t('dashboard.portfolio.sortName')}</option>
        </select>
      </label>
    </div>
  );
}
