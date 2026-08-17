'use client';

import { SectionHeader } from '@/components/common/section-header';
import { ServicesPageLowerContent } from '@/components/pages/services-page-lower-content';
import { ServicesPageOverviewContent } from '@/components/pages/services-page-overview-content';
import { useLocale } from '@/providers/locale-provider';
import type {
  ManagedServiceCategory,
  ProjectEnvironment,
  ProjectStatus,
  ServiceCategorySummary,
  ServiceHealthEntry,
} from '@/lib/types/management';
import type { ServiceSortMode } from '@/lib/utils/governance-filters';
import { useServicesPageBridgeController } from '@/lib/utils/use-services-page-bridge-controller';

interface ServicesPageProps {
  services: ServiceHealthEntry[];
  categorySummary: ServiceCategorySummary[];
  initialProjectId?: string;
  initialSearch?: string;
  initialCategory?: 'all' | ManagedServiceCategory;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialSort?: ServiceSortMode;
}

export function ServicesPage({
  services,
  categorySummary,
  initialProjectId = '',
  initialSearch = '',
  initialCategory = 'all',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialSort = 'risk',
}: ServicesPageProps) {
  const { locale, t } = useLocale();
  const {
    servicesPageLowerContentProps,
    servicesPageOverviewContentProps,
  } = useServicesPageBridgeController({
    services,
    categorySummary,
    locale,
    t,
    initialProjectId,
    initialSearch,
    initialCategory,
    initialEnvironment,
    initialStatus,
    initialSort,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.services')}
        title={t('pages.servicesTitle')}
        description={t('pages.servicesDescription')}
      />
      <ServicesPageOverviewContent {...servicesPageOverviewContentProps} />
      <ServicesPageLowerContent {...servicesPageLowerContentProps} />
    </div>
  );
}
