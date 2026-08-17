'use client';

import { Search } from 'lucide-react';
import { SummaryCard } from '@/components/common/management-primitives';
import { useLocale } from '@/providers/locale-provider';
import type { ApiInventoryArea } from '@/lib/types/management';
import type { InventorySecurityFilter } from '@/lib/utils/governance-filters';
import type { useIntegrationsPagePresentationController } from '@/lib/utils/use-integrations-page-presentation-controller';
import type { useIntegrationsPageSurfaceController } from '@/lib/utils/use-integrations-page-surface-controller';

interface IntegrationsPageInventoryWorkbenchContentProps {
  inventoryAreaFilter: 'all' | ApiInventoryArea;
  inventorySearchQuery: string;
  inventorySecurityFilter: InventorySecurityFilter;
  inventorySummaryCards: ReturnType<typeof useIntegrationsPageSurfaceController>['inventorySummaryCards'];
  operationPresentationCards: ReturnType<
    typeof useIntegrationsPagePresentationController
  >['operationPresentationCards'];
  setInventoryAreaFilter: (value: 'all' | ApiInventoryArea) => void;
  setInventorySearchQuery: (value: string) => void;
  setInventorySecurityFilter: (value: InventorySecurityFilter) => void;
}

export function IntegrationsPageInventoryOperationsContent({
  inventoryAreaFilter,
  inventorySearchQuery,
  inventorySecurityFilter,
  inventorySummaryCards,
  operationPresentationCards,
  setInventoryAreaFilter,
  setInventorySearchQuery,
  setInventorySecurityFilter,
}: IntegrationsPageInventoryWorkbenchContentProps) {
  const { t } = useLocale();

  return (
    <div className="editorStack">
      <div className="portfolioSummaryGrid">
        {inventorySummaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </div>

      <div className="accessFilterGrid">
        <label className="filterField filterFieldWide">
          <span>{t('dashboard.integrations.inventoryFilters.searchLabel')}</span>
          <div className="filterFieldInline">
            <Search size={16} />
            <input
              value={inventorySearchQuery}
              onChange={(event) => setInventorySearchQuery(event.target.value)}
              placeholder={t('dashboard.integrations.inventoryFilters.searchPlaceholder')}
            />
          </div>
        </label>
        <label className="filterField">
          <span>{t('dashboard.integrations.inventoryFilters.areaLabel')}</span>
          <select
            value={inventoryAreaFilter}
            onChange={(event) =>
              setInventoryAreaFilter(event.target.value as 'all' | ApiInventoryArea)
            }
          >
            <option value="all">{t('dashboard.integrations.inventoryFilters.areaAll')}</option>
            <option value="auth">{t('dashboard.integrations.inventoryAreas.auth')}</option>
            <option value="example">{t('dashboard.integrations.inventoryAreas.example')}</option>
            <option value="platform">{t('dashboard.integrations.inventoryAreas.platform')}</option>
            <option value="other">{t('dashboard.integrations.inventoryAreas.other')}</option>
          </select>
        </label>
        <label className="filterField">
          <span>{t('dashboard.integrations.inventoryFilters.securedLabel')}</span>
          <select
            value={inventorySecurityFilter}
            onChange={(event) =>
              setInventorySecurityFilter(event.target.value as InventorySecurityFilter)
            }
          >
            <option value="all">{t('dashboard.integrations.inventoryFilters.securedAll')}</option>
            <option value="secured">
              {t('dashboard.integrations.inventoryFilters.securedOnly')}
            </option>
            <option value="unsecured">
              {t('dashboard.integrations.inventoryFilters.unsecuredOnly')}
            </option>
          </select>
        </label>
      </div>

      {operationPresentationCards.length === 0 ? (
        <div className="emptyStatePanel">
          <strong>{t('dashboard.integrations.inventoryEmptyTitle')}</strong>
          <p>{t('dashboard.integrations.inventoryEmptyDescription')}</p>
        </div>
      ) : (
        <div className="integrationMethodList">
          {operationPresentationCards.map((operation) => (
            <OperationCard key={operation.id} operation={operation} />
          ))}
        </div>
      )}
    </div>
  );
}

function OperationCard({
  operation,
}: {
  operation: ReturnType<typeof useIntegrationsPagePresentationController>['operationPresentationCards'][number];
}) {
  return (
    <article className="integrationMethodCard">
      <div className="serviceCardHeader">
        <div>
          <div className="integrationOperationHeader">
            <span className="methodPill">{operation.method}</span>
            <span className="serviceCategory">{operation.areaLabel}</span>
          </div>
          <h3>{operation.path}</h3>
          <p>{operation.securitySchemesLabel}</p>
        </div>
        <div className="tagList">
          {operation.badges.map((badge) => (
            <span key={badge.id} className={badge.className}>
              {badge.label}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
