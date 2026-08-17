'use client';

import {
  SecurityCredentialRefreshWorkbench,
} from '@/components/common/security-credential-results';
import { SecurityGovernanceWorkbench } from '@/components/common/security-governance-workbench-content';
import {
  SecurityAuditTimeline,
  SecurityUserResults,
} from '@/components/common/security-governance-results-content';
import type {
  LocaleCode,
  SecurityApiKeyEntry,
  SecurityGovernanceView,
  SecuritySessionEntry,
  SecurityUserEntry,
  TimelineItem,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

export interface SecurityPageResultsShellProps {
  locale: LocaleCode;
  t: Translate;
  governance: SecurityGovernanceView;
  filteredUsers: readonly SecurityUserEntry[];
  filteredSessions: readonly SecuritySessionEntry[];
  filteredApiKeys: readonly SecurityApiKeyEntry[];
  auditItems: TimelineItem[];
  accessNavigationContext: AccessNavigationContext;
  onGovernanceChange: (governance: SecurityGovernanceView) => void;
  onClearFeedback: () => void;
  onShowError: (message: string) => void;
  onShowSuccess: (message: string) => void;
}

export function SecurityPageResultsShell({
  locale,
  t,
  governance,
  filteredUsers,
  filteredSessions,
  filteredApiKeys,
  auditItems,
  accessNavigationContext,
  onGovernanceChange,
  onClearFeedback,
  onShowError,
  onShowSuccess,
}: SecurityPageResultsShellProps) {
  return (
    <>
      <SecurityGovernanceWorkbench
        roleEntries={governance.roles}
        permissionEntries={governance.permissions}
        locale={locale}
        t={t}
        accessNavigationContext={accessNavigationContext}
      />

      <SecurityUserResults
        entries={filteredUsers}
        locale={locale}
        t={t}
        accessNavigationContext={accessNavigationContext}
      />

      <SecurityCredentialRefreshWorkbench
        sessions={filteredSessions}
        apiKeys={filteredApiKeys}
        locale={locale}
        t={t}
        accessNavigationContext={accessNavigationContext}
        onGovernanceChange={onGovernanceChange}
        onClearFeedback={onClearFeedback}
        onShowError={onShowError}
        onShowSuccess={onShowSuccess}
      />

      <SecurityAuditTimeline items={auditItems} t={t} />
    </>
  );
}
