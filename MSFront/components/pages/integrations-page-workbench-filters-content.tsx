'use client';

import { Search } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';
import type {
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type {
  EndpointSortMode,
  ProbeCoverageFilter,
} from '@/lib/utils/governance-filters';

interface IntegrationsPageWorkbenchFiltersContentProps {
  environmentFilter: 'all' | ProjectEnvironment;
  probeFilter: ProbeCoverageFilter;
  searchQuery: string;
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setProbeFilter: (value: ProbeCoverageFilter) => void;
  setSearchQuery: (value: string) => void;
  setSortMode: (value: EndpointSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: EndpointSortMode;
  statusFilter: 'all' | ProjectStatus;
}

export function IntegrationsPageWorkbenchFiltersContent({
  environmentFilter,
  probeFilter,
  searchQuery,
  setEnvironmentFilter,
  setProbeFilter,
  setSearchQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
}: IntegrationsPageWorkbenchFiltersContentProps) {
  const { t } = useLocale();

  return (
    <div className="portfolioFilters">
      <label className="filterField filterFieldWide">
        <span>{t('dashboard.integrations.filters.searchLabel')}</span>
        <div className="filterFieldInline">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('dashboard.integrations.filters.searchPlaceholder')}
          />
        </div>
      </label>
      <label className="filterField">
        <span>{t('dashboard.integrations.filters.environmentLabel')}</span>
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
        <span>{t('dashboard.integrations.filters.statusLabel')}</span>
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
        <span>{t('dashboard.integrations.filters.coverageLabel')}</span>
        <select
          value={probeFilter}
          onChange={(event) => setProbeFilter(event.target.value as ProbeCoverageFilter)}
        >
          <option value="all">{t('dashboard.integrations.filters.coverageAll')}</option>
          <option value="ready">{t('dashboard.integrations.filters.coverageReady')}</option>
          <option value="missing">{t('dashboard.integrations.filters.coverageMissing')}</option>
        </select>
      </label>
      <label className="filterField">
        <span>{t('dashboard.integrations.filters.sortLabel')}</span>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as EndpointSortMode)}
        >
          <option value="risk">{t('dashboard.integrations.filters.sortRisk')}</option>
          <option value="traffic">{t('dashboard.integrations.filters.sortTraffic')}</option>
          <option value="name">{t('dashboard.integrations.filters.sortName')}</option>
        </select>
      </label>
    </div>
  );
}
