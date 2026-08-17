'use client';

import Link from 'next/link';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  Server,
  Workflow,
} from 'lucide-react';
import { SectionHeader } from '@/components/common/section-header';
import { ProjectManagementConsole } from '@/components/projects/project-management-console';
import type {
  ManagedProjectPage,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';
import { useLocale } from '@/providers/locale-provider';

interface ProjectsRegistryPageProps {
  result: ManagedProjectPage;
  search: string;
  environment: 'all' | ProjectEnvironment;
  status: 'all' | ProjectStatus;
  sort: ProjectSortMode;
  mode: 'browse' | 'create';
}

const controlClass =
  'h-10 min-w-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]';

export function ProjectsRegistryPage({
  result,
  search,
  environment,
  status,
  sort,
  mode,
}: ProjectsRegistryPageProps) {
  const { locale, t } = useLocale();

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.projects')}
        title={t('pages.projectsTitle')}
        description={t('pages.projectsDescription')}
      />

      {mode === 'create' ? (
        <ProjectManagementConsole projects={[]} initialMode="create" />
      ) : (
        <section className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] p-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-semibold text-[var(--text-primary)]">
                {t('labels.projectRegistry')}
              </h2>
              <p className="mt-1 mb-0 max-w-3xl text-sm text-[var(--text-secondary)]">
                {t('projectConsole.registryDescription')}
              </p>
            </div>
            <Link
              href="/projects?mode=create"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 text-sm font-semibold text-white transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2"
            >
              <Plus size={16} aria-hidden="true" />
              {t('actions.createProject')}
            </Link>
          </div>

          <form
            action="/projects"
            method="get"
            className="grid gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_160px_160px_auto_auto]"
          >
            <label className="relative min-w-0 sm:col-span-2 xl:col-span-1">
              <span className="srOnly">{t('labels.projectRegistry')}</span>
              <Search className="pointer-events-none absolute top-3 left-3 text-[var(--text-secondary)]" size={16} />
              <input
                name="search"
                defaultValue={search}
                placeholder={`${t('labels.name')} / ${t('labels.code')} / ${t('labels.owner')}`}
                className={`${controlClass} w-full pl-9`}
              />
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="srOnly">{t('labels.environment')}</span>
              <select name="environment" defaultValue={environment} className={controlClass}>
                <option value="all">{t('labels.environment')}</option>
                <option value="production">{t('status.production')}</option>
                <option value="staging">{t('status.staging')}</option>
                <option value="development">{t('status.development')}</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="srOnly">{t('labels.status')}</span>
              <select name="status" defaultValue={status} className={controlClass}>
                <option value="all">{t('labels.status')}</option>
                <option value="healthy">{t('status.healthy')}</option>
                <option value="warning">{t('status.warning')}</option>
                <option value="critical">{t('status.critical')}</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="srOnly">Sort</span>
              <select name="sort" defaultValue={sort} className={controlClass}>
                <option value="risk">{t('dashboard.portfolio.sortRisk')}</option>
                <option value="traffic">{t('dashboard.portfolio.sortTraffic')}</option>
                <option value="deploy">{t('dashboard.portfolio.sortDeploy')}</option>
                <option value="name">{t('dashboard.portfolio.sortName')}</option>
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--accent-primary)] bg-[var(--accent-primary)] px-4 text-sm font-semibold text-white transition hover:brightness-95"
            >
              <Search size={15} aria-hidden="true" />
              {t('actions.applyFilters')}
            </button>
            <Link
              href="/projects"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border-subtle)] px-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-primary)]"
            >
              {t('actions.resetFilters')}
            </Link>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            <span>
              {new Intl.NumberFormat(locale).format(result.totalItems)} {t('labels.projectCount')}
            </span>
            <span>
              {result.page} / {result.totalPages}
            </span>
          </div>

          {result.items.length === 0 ? (
            <div className="grid min-h-56 place-items-center p-8 text-center">
              <div>
                <Workflow className="mx-auto mb-3 text-[var(--text-secondary)]" size={28} />
                <h3 className="m-0 text-base font-semibold">{t('projectConsole.registryEmptyTitle')}</h3>
                <p className="mt-2 mb-0 text-sm text-[var(--text-secondary)]">
                  {t('projectConsole.registryEmptyDescription')}
                </p>
              </div>
            </div>
          ) : (
            <ProjectResults result={result} locale={locale} t={t} />
          )}

          <Pagination result={result} search={search} environment={environment} status={status} sort={sort} />
        </section>
      )}
    </div>
  );
}

function ProjectResults({ result, locale, t }: {
  result: ManagedProjectPage;
  locale: string;
  t: (path: string, variables?: Record<string, string | number>) => string;
}) {
  return (
    <>
      <div className="hidden md:block">
        <div className="grid grid-cols-[minmax(220px,1.5fr)_130px_150px_130px_130px_44px] gap-4 border-b border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase">
          <span>{t('labels.name')}</span>
          <span>{t('labels.environment')}</span>
          <span>{t('labels.owner')}</span>
          <span>{t('sections.servers')}</span>
          <span>{t('labels.requests')}</span>
          <span className="srOnly">{t('actions.viewProject')}</span>
        </div>
        {result.items.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="grid min-h-20 grid-cols-[minmax(220px,1.5fr)_130px_150px_130px_130px_44px] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3 transition last:border-b-0 hover:bg-[var(--surface-secondary)] focus:bg-[var(--surface-secondary)] focus:outline-none"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot status={project.status} />
                <strong className="truncate text-sm">{project.name}</strong>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">{project.code}</span>
              </div>
              <p className="mt-1 mb-0 truncate text-xs text-[var(--text-secondary)]">{project.description}</p>
            </div>
            <span className="text-sm">{t(`status.${project.environment}`)}</span>
            <span className="truncate text-sm">{project.owner}</span>
            <span className="flex items-center gap-1.5 text-sm">
              <Server size={14} className="text-[var(--text-secondary)]" />
              {project.healthyServerCount}/{project.serverCount}
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              <Activity size={14} className="text-[var(--text-secondary)]" />
              {new Intl.NumberFormat(locale).format(project.requestPerMinute)}
            </span>
            <ExternalLink size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="divide-y divide-[var(--border-subtle)] md:hidden">
        {result.items.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="block p-4 transition hover:bg-[var(--surface-secondary)] focus:bg-[var(--surface-secondary)] focus:outline-none"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusDot status={project.status} />
                  <strong className="truncate text-sm">{project.name}</strong>
                </div>
                <p className="mt-1 mb-0 truncate text-xs text-[var(--text-secondary)]">
                  {project.code} / {project.owner} / {project.region}
                </p>
              </div>
              <ExternalLink size={16} className="shrink-0 text-[var(--text-secondary)]" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[var(--text-secondary)]">
              <span>{t(`status.${project.environment}`)}</span>
              <span>{project.serverCount} {t('projectConsole.overview.servers')}</span>
              <span>{project.serviceCount} {t('projectConsole.overview.services')}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Pagination({ result, search, environment, status, sort }: Omit<ProjectsRegistryPageProps, 'mode'> & { result: ManagedProjectPage }) {
  if (result.totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] p-4" aria-label="Pagination">
      <PageLink
        page={result.page - 1}
        disabled={result.page <= 1}
        search={search}
        environment={environment}
        status={status}
        sort={sort}
        label="Previous page"
      >
        <ChevronLeft size={17} />
      </PageLink>
      <span className="text-sm text-[var(--text-secondary)]">{result.page} / {result.totalPages}</span>
      <PageLink
        page={result.page + 1}
        disabled={result.page >= result.totalPages}
        search={search}
        environment={environment}
        status={status}
        sort={sort}
        label="Next page"
      >
        <ChevronRight size={17} />
      </PageLink>
    </nav>
  );
}

function PageLink({ page, disabled, search, environment, status, sort, label, children }: {
  page: number;
  disabled: boolean;
  search: string;
  environment: string;
  status: string;
  sort: string;
  label: string;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams({ page: String(page), search, environment, status, sort });
  const className = 'inline-flex size-10 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)]';

  if (disabled) {
    return <span className={`${className} cursor-not-allowed opacity-40`} aria-disabled="true">{children}</span>;
  }

  return <Link href={`/projects?${params.toString()}`} className={className} aria-label={label} title={label}>{children}</Link>;
}

function StatusDot({ status }: { status: ProjectStatus }) {
  const color = status === 'healthy' ? 'var(--tone-success)' : status === 'warning' ? 'var(--tone-warning)' : 'var(--tone-danger)';
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />;
}
