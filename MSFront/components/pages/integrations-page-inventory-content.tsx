'use client';

import { IntegrationsPageInventoryOperationsContent } from '@/components/pages/integrations-page-inventory-operations-content';
import { IntegrationsPageInventorySecuritySchemesContent } from '@/components/pages/integrations-page-inventory-security-schemes-content';
import { useLocale } from '@/providers/locale-provider';
import type {
  ApiInventoryArea,
  IntegrationsGovernanceView,
} from '@/lib/types/management';
import type { InventorySecurityFilter } from '@/lib/utils/governance-filters';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

interface IntegrationsPageInventoryContentProps {
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

export function IntegrationsPageInventoryContent({
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
}: IntegrationsPageInventoryContentProps) {
  const { t } = useLocale();

  if (!inventory) {
    return (
      <div className="emptyStatePanel">
        <strong>{t('dashboard.integrations.inventoryUnavailableTitle')}</strong>
        <p>{t('dashboard.integrations.inventoryUnavailableDescription')}</p>
      </div>
    );
  }

  return (
    <div className="integrationInventoryLayout">
      <IntegrationsPageInventoryOperationsContent
        inventoryAreaFilter={inventoryAreaFilter}
        inventorySearchQuery={inventorySearchQuery}
        inventorySecurityFilter={inventorySecurityFilter}
        inventorySummaryCards={inventorySummaryCards}
        operationPresentationCards={operationPresentationCards}
        setInventoryAreaFilter={setInventoryAreaFilter}
        setInventorySearchQuery={setInventorySearchQuery}
        setInventorySecurityFilter={setInventorySecurityFilter}
      />
      <IntegrationsPageInventorySecuritySchemesContent
        inventoryTitle={inventory.title}
        securitySchemePresentationCards={securitySchemePresentationCards}
      />
    </div>
  );
}
