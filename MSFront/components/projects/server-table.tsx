'use client';

import type { ManagedProjectServer } from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';
import { StatusBadge } from '@/components/common/status-badge';

interface ServerTableProps {
  servers: ManagedProjectServer[];
}

export function ServerTable({ servers }: ServerTableProps) {
  const { locale, t } = useLocale();

  return (
    <div className="tableCard">
      <table className="responsiveTable" aria-label={t('sections.servers')}>
        <thead>
          <tr>
            <th scope="col">{t('labels.serverHost')}</th>
            <th scope="col">{t('labels.region')}</th>
            <th scope="col">{t('labels.environment')}</th>
            <th scope="col">{t('labels.cpuUsage')}</th>
            <th scope="col">{t('labels.memoryUsage')}</th>
            <th scope="col">{t('labels.responseTime')}</th>
            <th scope="col">{t('labels.status')}</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr key={server.id}>
              <td>
                <span className="tableCellLabel">{t('labels.serverHost')}</span>
                <div className="tableCellValue">
                  <strong>{server.name}</strong>
                  <span>{server.host}</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.region')}</span>
                <div className="tableCellValue">
                  <span>{server.region}</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.environment')}</span>
                <div className="tableCellValue">
                  <span>{t(`status.${server.environment}`)}</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.cpuUsage')}</span>
                <div className="tableCellValue">
                  <span>{server.cpuUsage}%</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.memoryUsage')}</span>
                <div className="tableCellValue">
                  <span>{server.memoryUsage}%</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.responseTime')}</span>
                <div className="tableCellValue">
                  <span>{new Intl.NumberFormat(locale).format(server.responseTimeMs)} ms</span>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.status')}</span>
                <div className="tableCellValue">
                  <StatusBadge
                    label={t(`status.${server.status}`)}
                    type="status"
                    value={server.status}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
