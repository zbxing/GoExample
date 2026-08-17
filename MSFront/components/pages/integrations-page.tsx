'use client';

import { SectionHeader } from '@/components/common/section-header';
import { IntegrationsPageLowerContent } from '@/components/pages/integrations-page-lower-content';
import {
  IntegrationsPageOverviewContent,
} from '@/components/pages/integrations-page-overview-content';
import { useLocale } from '@/providers/locale-provider';
import type {
  ApiInventoryArea,
  IntegrationsGovernanceView,
  ProjectEnvironment,
  ProjectStatus,
} from '@/lib/types/management';
import type {
  EndpointSortMode,
  InventorySecurityFilter,
  ProbeCoverageFilter,
} from '@/lib/utils/governance-filters';
import { useIntegrationsPageBridgeController } from '@/lib/utils/use-integrations-page-bridge-controller';

interface IntegrationsPageProps extends IntegrationsGovernanceView {
  initialProjectId?: string;
  initialSearch?: string;
  initialEnvironment?: 'all' | ProjectEnvironment;
  initialStatus?: 'all' | ProjectStatus;
  initialCoverage?: ProbeCoverageFilter;
  initialSort?: EndpointSortMode;
  initialInventorySearch?: string;
  initialInventoryArea?: 'all' | ApiInventoryArea;
  initialInventorySecurity?: InventorySecurityFilter;
}

export function IntegrationsPage({
  endpoints,
  summary,
  inventory,
  initialProjectId = '',
  initialSearch = '',
  initialEnvironment = 'all',
  initialStatus = 'all',
  initialCoverage = 'all',
  initialSort = 'risk',
  initialInventorySearch = '',
  initialInventoryArea = 'all',
  initialInventorySecurity = 'all',
}: IntegrationsPageProps) {
  const { locale, t } = useLocale();
  const {
    integrationsPageLowerContentProps,
    integrationsPageOverviewContentProps,
  } = useIntegrationsPageBridgeController({
    endpoints,
    summary,
    inventory,
    locale,
    t,
    initialProjectId,
    initialSearch,
    initialEnvironment,
    initialStatus,
    initialCoverage,
    initialSort,
    initialInventorySearch,
    initialInventoryArea,
    initialInventorySecurity,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('nav.integrations')}
        title={t('pages.integrationsTitle')}
        description={t('pages.integrationsDescription')}
      />
      <IntegrationsPageOverviewContent {...integrationsPageOverviewContentProps} />
      <IntegrationsPageLowerContent {...integrationsPageLowerContentProps} />
    </div>
  );
}
