'use client';

import Link from 'next/link';
import { TonePill } from '@/components/common/management-primitives';
import { SecurityEmptyState } from '@/components/common/security-empty-state';
import { SecurityPanelSection } from '@/components/common/security-panel-section';
import { SecuritySummaryCard } from '@/components/common/security-summary-card';
import type {
  SecurityPermissionResultCardModel,
  SecurityRoleResultCardModel,
} from '@/lib/utils/use-security-governance-surface-presentation-controller';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityRoleResultsSectionProps {
  entries: readonly SecurityRoleResultCardModel[];
  t: Translate;
}

interface SecurityPermissionResultsSectionProps {
  entries: readonly SecurityPermissionResultCardModel[];
  t: Translate;
}

export function SecurityRoleResultsSection({
  entries,
  t,
}: SecurityRoleResultsSectionProps) {
  return (
    <SecurityPanelSection
      title={t('security.rolesTitle')}
      description={t('security.rolesDescription')}
    >
      {entries.length === 0 ? (
        <SecurityEmptyState
          title={t('security.rolesEmptyTitle')}
          description={t('security.rolesEmptyDescription')}
        />
      ) : (
        <div className="securityRoleGrid">
          {entries.map((role) => (
            <SecuritySummaryCard
              key={role.id}
              eyebrow={role.eyebrow}
              title={role.title}
              badge={<TonePill label={role.badgeLabel} tone="info" />}
              tags={
                <Link href={role.filterHref} className="securityTag securityTagLink">
                  {role.filterLabel}
                </Link>
              }
              metrics={role.metrics}
              footer={
                <Link href={role.openRoleHref} className="secondaryButton">
                  {role.openRoleLabel}
                </Link>
              }
            />
          ))}
        </div>
      )}
    </SecurityPanelSection>
  );
}

export function SecurityPermissionResultsSection({
  entries,
  t,
}: SecurityPermissionResultsSectionProps) {
  return (
    <SecurityPanelSection
      title={t('security.permissionsTitle')}
      description={t('security.permissionsDescription')}
    >
      {entries.length === 0 ? (
        <SecurityEmptyState
          title={t('security.permissionsEmptyTitle')}
          description={t('security.permissionsEmptyDescription')}
        />
      ) : (
        <div className="securityPermissionList">
          {entries.map((permission) => (
            <SecuritySummaryCard
              key={permission.id}
              eyebrow={permission.eyebrow}
              title={permission.title}
              badge={<TonePill label={permission.badgeLabel} tone="info" />}
              metrics={permission.metrics}
              className="securityPermissionItem"
            />
          ))}
        </div>
      )}
    </SecurityPanelSection>
  );
}
