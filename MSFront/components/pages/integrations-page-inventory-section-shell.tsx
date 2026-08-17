'use client';

import { IntegrationsPageInventoryContent } from '@/components/pages/integrations-page-inventory-content';
import { useLocale } from '@/providers/locale-provider';
import type {
  ApiInventoryArea,
  IntegrationsGovernanceView,
} from '@/lib/types/management';
import type { InventorySecurityFilter } from '@/lib/utils/governance-filters';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

interface IntegrationsPageInventorySectionShellProps {
  inventory: IntegrationsGovernanceView['inventory'];
  inventoryAreaFilter: 'all' | ApiInventoryArea;
  inventorySearchQuery: string;
  inventorySecurityFilter: InventorySecurityFilter;
  inventorySummaryCards: ReturnType<typeof useIntegrationsPageSurfaceController>['inventorySummaryCards'];
  operationPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['operationPresentationCards'];
  securitySchemePresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['securitySchemePresentationCards'];
  setInventoryAreaFilter: (value: 'all' | ApiInventoryArea) => void;
  setInventorySearchQuery: (value: string) => void;
  setInventorySecurityFilter: (value: InventorySecurityFilter) => void;
}

export function IntegrationsPageInventorySectionShell({
  inventory,
  inventoryAreaFilter,
  inventorySearchQuery,
  inventorySecurityFilter,
  inventorySummaryCards,
  operationPresentationCards,
  securitySchemePresentationCards,
  setInventoryAreaFilter,
  setInventorySearchQuery,
  setInventorySecurityFilter,
}: IntegrationsPageInventorySectionShellProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('dashboard.integrations.inventoryTitle')}</h2>
          <p>{t('dashboard.integrations.inventoryDescription')}</p>
        </div>
      </div>

      <IntegrationsPageInventoryContent
        inventory={inventory}
        inventoryAreaFilter={inventoryAreaFilter}
        inventorySearchQuery={inventorySearchQuery}
        inventorySecurityFilter={inventorySecurityFilter}
        inventorySummaryCards={inventorySummaryCards}
        operationPresentationCards={operationPresentationCards}
        securitySchemePresentationCards={securitySchemePresentationCards}
        setInventoryAreaFilter={setInventoryAreaFilter}
        setInventorySearchQuery={setInventorySearchQuery}
        setInventorySecurityFilter={setInventorySecurityFilter}
      />
    </section>
  );
}
