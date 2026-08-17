'use client';

import { FeedbackBanner } from '@/components/common/feedback-banner';
import { SecurityFiltersContextWorkbench } from '@/components/common/security-workbench-controls';
import type {
  LocaleCode,
  SecurityGovernanceView,
  SecuritySessionEntry,
  SecurityApiKeyEntry,
  SecurityUserEntry,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import type {
  SecurityFocusFilter,
  SecurityStatusFilter,
} from '@/lib/utils/security-filters';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityPageWorkbenchContentProps {
  locale: LocaleCode;
  t: Translate;
  governance: SecurityGovernanceView;
  filteredUsers: readonly SecurityUserEntry[];
  filteredSessions: readonly SecuritySessionEntry[];
  filteredApiKeys: readonly SecurityApiKeyEntry[];
  auditCount: number;
  accessNavigationContext: AccessNavigationContext;
  focus: SecurityFocusFilter;
  statusFilter: SecurityStatusFilter;
  roleFilter: string;
  search: string;
  roleOptions: readonly string[];
  feedback: Parameters<typeof FeedbackBanner>[0]['feedback'];
  onSearchChange: (value: string) => void;
  onFocusChange: (value: SecurityFocusFilter) => void;
  onStatusChange: (value: SecurityStatusFilter) => void;
  onRoleChange: (value: string) => void;
  onCopy: () => void;
  onReset: () => void;
}

export function SecurityPageWorkbenchContent({
  locale,
  t,
  governance,
  filteredUsers,
  filteredSessions,
  filteredApiKeys,
  auditCount,
  accessNavigationContext,
  focus,
  statusFilter,
  roleFilter,
  search,
  roleOptions,
  feedback,
  onSearchChange,
  onFocusChange,
  onStatusChange,
  onRoleChange,
  onCopy,
  onReset,
}: SecurityPageWorkbenchContentProps) {
  return (
    <SecurityFiltersContextWorkbench
      locale={locale}
      t={t}
      focus={focus}
      statusFilter={statusFilter}
      roleFilter={roleFilter}
      search={search}
      roleEntries={governance.roles}
      roleOptions={roleOptions}
      userEntries={governance.users}
      filteredUsers={filteredUsers}
      filteredSessionsCount={filteredSessions.length}
      filteredApiKeysCount={filteredApiKeys.length}
      auditCount={auditCount}
      accessNavigationContext={accessNavigationContext}
      onSearchChange={onSearchChange}
      onFocusChange={onFocusChange}
      onStatusChange={onStatusChange}
      onRoleChange={onRoleChange}
      onCopy={onCopy}
      onReset={onReset}
      feedback={<FeedbackBanner feedback={feedback} />}
    />
  );
}
