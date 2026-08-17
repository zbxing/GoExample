'use client';

import type { ReactNode } from 'react';
import {
  SecurityPermissionResultsSection,
  SecurityRoleResultsSection,
} from '@/components/common/security-governance-results-sections-content';
import type {
  LocaleCode,
  SecurityPermissionCoverage,
  SecurityRoleCoverage,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import {
  useSecurityGovernanceWorkbenchPresentationController,
} from '@/lib/utils/use-security-governance-surface-presentation-controller';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityGovernanceWorkbenchSectionProps {
  children: ReactNode;
}

interface SecurityGovernanceWorkbenchProps {
  roleEntries: readonly SecurityRoleCoverage[];
  permissionEntries: readonly SecurityPermissionCoverage[];
  locale: LocaleCode;
  t: Translate;
  accessNavigationContext: AccessNavigationContext;
}

export function SecurityGovernanceWorkbenchSection({
  children,
}: SecurityGovernanceWorkbenchSectionProps) {
  return <div className="twoColumn">{children}</div>;
}

export function SecurityGovernanceWorkbench({
  roleEntries,
  permissionEntries,
  locale,
  t,
  accessNavigationContext,
}: SecurityGovernanceWorkbenchProps) {
  const { permissionCards, roleCards } = useSecurityGovernanceWorkbenchPresentationController({
    roleEntries,
    permissionEntries,
    locale,
    t,
    accessNavigationContext,
  });

  return (
    <SecurityGovernanceWorkbenchSection>
      <SecurityRoleResultsSection entries={roleCards} t={t} />
      <SecurityPermissionResultsSection entries={permissionCards} t={t} />
    </SecurityGovernanceWorkbenchSection>
  );
}
