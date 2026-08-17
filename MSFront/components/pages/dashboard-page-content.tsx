'use client';

import Link from 'next/link';
import { Boxes, Cable, ShieldCheck, UsersRound } from 'lucide-react';
import { RuntimeSurfacePanel } from '@/components/common/runtime-surface-panel';
import { PortfolioGrid } from '@/components/dashboard/portfolio-grid';
import { TimelinePanel } from '@/components/dashboard/timeline-panel';
import type {
  ManagedProject,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type { ProjectSortMode } from '@/lib/utils/governance-filters';
import type { useDashboardPageController } from '@/lib/utils/use-dashboard-page-controller';
import { useLocale } from '@/providers/locale-provider';

interface DashboardPageContentProps {
  activityItems: ReturnType<typeof useDashboardPageController>['activityItems'];
  alertItems: ReturnType<typeof useDashboardPageController>['alertItems'];
  backendRuntime: ReturnType<typeof useDashboardPageController>['backendRuntime'];
  initialPortfolioEnvironment: 'all' | ProjectEnvironment;
  initialPortfolioSearch: string;
  initialPortfolioSort: ProjectSortMode;
  initialPortfolioStatus: 'all' | ProjectStatus;
  projects: ManagedProject[];
}

export function DashboardPageContent({
  activityItems,
  alertItems,
  backendRuntime,
  initialPortfolioEnvironment,
  initialPortfolioSearch,
  initialPortfolioSort,
  initialPortfolioStatus,
  projects,
}: DashboardPageContentProps) {
  const { t } = useLocale();
  const quickActions = [
    {
      href: '/projects',
      icon: Boxes,
      label: t('nav.projects'),
    },
    {
      href: '/integrations',
      icon: Cable,
      label: t('nav.integrations'),
    },
    {
      href: '/security',
      icon: ShieldCheck,
      label: t('nav.security'),
    },
    {
      href: '/users',
      icon: UsersRound,
      label: t('labels.users'),
    },
  ] as const;

  return (
    <div className="dashboardReferenceWorkspace">
      <div className="dashboardReferenceMain">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>{t('sections.portfolio')}</h2>
              <p>{t('app.subtitle')}</p>
            </div>
          </div>
          <PortfolioGrid
            projects={projects}
            initialSearch={initialPortfolioSearch}
            initialEnvironment={initialPortfolioEnvironment}
            initialStatus={initialPortfolioStatus}
            initialSort={initialPortfolioSort}
            enableUrlSync
            urlSyncScope="dashboard"
          />
        </section>

        <div className="twoColumn">
          <TimelinePanel
            title={t('sections.alerts')}
            items={alertItems}
            emptyMessage={t('dashboard.alerts.empty')}
          />
          <TimelinePanel
            title={t('sections.activity')}
            items={activityItems}
            emptyMessage={t('dashboard.activity.empty')}
          />
        </div>
      </div>

      <aside className="dashboardReferenceRail">
        <section className="panel dashboardQuickActions">
          <div className="panelHeader">
            <div>
              <h2>{t('dashboard.quickActions.title')}</h2>
              <p>{t('dashboard.quickActions.description')}</p>
            </div>
          </div>
          <div className="dashboardQuickActionGrid">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <Link key={action.href} href={action.href} className="dashboardQuickAction">
                  <Icon size={17} />
                  <span>{action.label}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <RuntimeSurfacePanel
          title={t('dashboard.backend.title')}
          description={t('dashboard.backend.description')}
          summary={backendRuntime}
        />
      </aside>
    </div>
  );
}
