'use client';

import type { ManagedProjectService } from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';
import { StatusBadge } from '@/components/common/status-badge';

interface ServiceGridProps {
  services: ManagedProjectService[];
}

export function ServiceGrid({ services }: ServiceGridProps) {
  const { t } = useLocale();

  return (
    <div className="serviceGrid">
      {services.map((service) => (
        <article key={service.id} className="serviceCard">
          <div className="serviceCardHeader">
            <div>
              <span className="serviceCategory">{service.category}</span>
              <h3>{service.name}</h3>
            </div>
            <StatusBadge
              label={t(`status.${service.status}`)}
              type="status"
              value={service.status}
            />
          </div>
          <p>
            {t('labels.uptime')}: <strong>{service.uptime}</strong>
          </p>
        </article>
      ))}
    </div>
  );
}
