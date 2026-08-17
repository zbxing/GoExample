'use client';

import { SectionHeader } from '@/components/common/section-header';
import { EnvironmentsPageLowerContent } from '@/components/pages/environments-page-lower-content';
import {
  EnvironmentsPageOverviewContent,
} from '@/components/pages/environments-page-overview-content';
import { useLocale } from '@/providers/locale-provider';
import type {
  EnvironmentGovernanceItem,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import { type EnvironmentSortMode } from '@/lib/utils/governance-filters';
import { useEnvironmentsPageBridgeController } from '@/lib/utils/use-environments-page-bridge-controller';

interface EnvironmentsPageProps {
  environments: EnvironmentGovernanceItem[];
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: EnvironmentSortMode;
}

export function EnvironmentsPage({
  environments,
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
}: EnvironmentsPageProps) {
  const { locale, t } = useLocale();
  const {
    environmentsPageLowerContentProps,
    environmentsPageOverviewContentProps,
  } = useEnvironmentsPageBridgeController({
    environments,
    locale,
    t,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialSort,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.environments')}
        title={t('pages.environmentsTitle')}
        description={t('pages.environmentsDescription')}
      />
      <EnvironmentsPageOverviewContent {...environmentsPageOverviewContentProps} />
      <EnvironmentsPageLowerContent {...environmentsPageLowerContentProps} />
    </div>
  );
}
