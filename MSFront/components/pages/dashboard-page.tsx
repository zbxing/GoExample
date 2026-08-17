'use client';

import { ReferenceDashboard } from '@/components/pages/reference-dashboard';
import type {
  ManagedProject,
  ManagementBackendProbe,
  ManagementOverview,
  ProjectEnvironment,
  ProjectStatus,
  SecurityGovernanceView,
} from '@/lib/types/management';
import { type ProjectSortMode } from '@/lib/utils/governance-filters';

interface DashboardPageProps {
  overview: ManagementOverview & {
    backend: ManagementBackendProbe;
  };
  projects: ManagedProject[];
  security: SecurityGovernanceView;
  initialPortfolioSearch?: string;
  initialPortfolioEnvironment?: 'all' | ProjectEnvironment;
  initialPortfolioStatus?: 'all' | ProjectStatus;
  initialPortfolioSort?: ProjectSortMode;
}

export function DashboardPage(props: DashboardPageProps) {
  void props;

  return <ReferenceDashboard />;
}
