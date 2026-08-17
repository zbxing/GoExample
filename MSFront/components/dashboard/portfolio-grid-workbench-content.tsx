'use client';

import { RotateCcw, Search } from 'lucide-react';
import { FeedbackBanner } from '@/components/common/feedback-banner';
import type { FeedbackState } from '@/components/common/feedback-banner';
import { SummaryCard } from '@/components/common/management-primitives';
import type { LocaleCode, ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface PortfolioGridWorkbenchSummary {
  attentionProjects: number;
  criticalProjects: number;
  healthyProjects: number;
  ownerCoverage: number;
  regionCoverage: number;
  warningProjects: number;
}

interface PortfolioGridWorkbenchContentProps {
  clearEnvironmentFilter: () => void;
  enableUrlSync: boolean;
  environmentFilter: 'all' | ProjectEnvironment;
  feedback: FeedbackState | null;
  filteredProjectsCount: number;
  focusedEnvironment: ProjectEnvironment | null;
  handleCopyCurrentView: () => void;
  locale: LocaleCode;
  query: string;
  resetFilters: () => void;
  resultTags: readonly string[];
  setEnvironmentFilter: (value: 'all' | ProjectEnvironment) => void;
  setQuery: (value: string) => void;
  setSortMode: (value: ProjectSortMode) => void;
  setStatusFilter: (value: 'all' | ProjectStatus) => void;
  sortMode: ProjectSortMode;
  statusFilter: 'all' | ProjectStatus;
  summary: PortfolioGridWorkbenchSummary;
  t: TranslationFn;
  urlSyncScope: 'projects' | 'dashboard';
}

export function PortfolioGridWorkbenchContent({
  clearEnvironmentFilter,
  enableUrlSync,
  environmentFilter,
  feedback,
  filteredProjectsCount,
  focusedEnvironment,
  handleCopyCurrentView,
  locale,
  query,
  resetFilters,
  resultTags,
  setEnvironmentFilter,
  setQuery,
  setSortMode,
  setStatusFilter,
  sortMode,
  statusFilter,
  summary,
  t,
  urlSyncScope,
}: PortfolioGridWorkbenchContentProps) {
  return (
    <>
      <div className="portfolioFilters">
        <label className="filterField filterFieldWide">
          <span>{t('dashboard.portfolio.searchLabel')}</span>
          <div className="filterFieldInline">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('dashboard.portfolio.searchPlaceholder')}
            />
          </div>
        </label>
        <label className="filterField">
          <span>{t('dashboard.portfolio.environmentLabel')}</span>
          <select
            value={environmentFilter}
            onChange={(event) => setEnvironmentFilter(event.target.value as 'all' | ProjectEnvironment)}
          >
            <option value="all">{t('dashboard.portfolio.allEnvironments')}</option>
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
            onChange={(event) => setSortMode(event.target.value as ProjectSortMode)}
          >
            <option value="risk">{t('dashboard.portfolio.sortRisk')}</option>
            <option value="traffic">{t('dashboard.portfolio.sortTraffic')}</option>
            <option value="deploy">{t('dashboard.portfolio.sortDeploy')}</option>
            <option value="name">{t('dashboard.portfolio.sortName')}</option>
          </select>
        </label>
      </div>

      <div className="portfolioSummaryGrid">
        <SummaryCard
          label={t('dashboard.portfolio.filteredLabel')}
          value={Intl.NumberFormat(locale).format(filteredProjectsCount)}
          footnote={t('dashboard.portfolio.results.healthyCount', {
            count: Intl.NumberFormat(locale).format(summary.healthyProjects),
          })}
        />
        <SummaryCard
          label={t('dashboard.portfolio.ownerCoverageLabel')}
          value={Intl.NumberFormat(locale).format(summary.ownerCoverage)}
          footnote={t('dashboard.portfolio.results.projectsCount', {
            count: Intl.NumberFormat(locale).format(filteredProjectsCount),
          })}
        />
        <SummaryCard
          label={t('dashboard.portfolio.regionCoverageLabel')}
          value={Intl.NumberFormat(locale).format(summary.regionCoverage)}
          footnote={t('dashboard.portfolio.results.warningCount', {
            count: Intl.NumberFormat(locale).format(summary.warningProjects),
          })}
        />
        <SummaryCard
          label={t('dashboard.portfolio.attentionLabel')}
          value={Intl.NumberFormat(locale).format(summary.attentionProjects)}
          footnote={t('dashboard.portfolio.results.criticalCount', {
            count: Intl.NumberFormat(locale).format(summary.criticalProjects),
          })}
        />
      </div>

      <div className="accessActionBar">
        <div className="tagList">
          {resultTags.map((tag) => (
            <span key={tag} className="securityTag">
              {tag}
            </span>
          ))}
        </div>
        <div className="projectEditorActions">
          {enableUrlSync && focusedEnvironment ? (
            <button type="button" className="ghostButton" onClick={clearEnvironmentFilter}>
              {t('dashboard.portfolio.clearEnvironmentFilter')}
            </button>
          ) : null}
          {enableUrlSync ? (
            <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
              {t(urlSyncScope === 'dashboard' ? 'dashboard.copyLink' : 'projectsHub.copyLink')}
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={resetFilters}>
            <RotateCcw size={14} />
            {t('actions.resetFilters')}
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />
    </>
  );
}
