'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SecurityFiltersWorkbench } from '@/components/common/security-filters-workbench-content';
import type {
  LocaleCode,
  SecurityRoleCoverage,
  SecurityUserEntry,
} from '@/lib/types/management';
import {
  buildContextualRolesHref,
  buildContextualUsersHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import {
  formatNumber,
  humanizeIdentifier,
} from '@/lib/utils/format';
import {
  matchesSecuritySearch,
  type SecurityFocusFilter,
  type SecurityStatusFilter,
} from '@/lib/utils/security-filters';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityFiltersContextWorkbenchProps {
  locale: LocaleCode;
  t: TranslationFn;
  focus: SecurityFocusFilter;
  statusFilter: SecurityStatusFilter;
  roleFilter: string;
  search: string;
  roleEntries: readonly SecurityRoleCoverage[];
  roleOptions: readonly string[];
  userEntries: readonly SecurityUserEntry[];
  filteredUsers: readonly SecurityUserEntry[];
  filteredSessionsCount: number;
  filteredApiKeysCount: number;
  auditCount: number;
  accessNavigationContext: AccessNavigationContext;
  onSearchChange: (value: string) => void;
  onFocusChange: (value: SecurityFocusFilter) => void;
  onStatusChange: (value: SecurityStatusFilter) => void;
  onRoleChange: (value: string) => void;
  onCopy: () => void;
  onReset: () => void;
  feedback?: ReactNode;
  className?: string;
}

export function SecurityFiltersContextWorkbench({
  locale,
  t,
  focus,
  statusFilter,
  roleFilter,
  search,
  roleEntries,
  roleOptions,
  userEntries,
  filteredUsers,
  filteredSessionsCount,
  filteredApiKeysCount,
  auditCount,
  accessNavigationContext,
  onSearchChange,
  onFocusChange,
  onStatusChange,
  onRoleChange,
  onCopy,
  onReset,
  feedback,
  className,
}: SecurityFiltersContextWorkbenchProps) {
  const securityPrimaryUser =
    filteredUsers[0] ??
    userEntries.find((user) => (roleFilter !== 'all' ? user.roles.includes(roleFilter) : false)) ??
    null;
  const matchedRoleFromSearch =
    roleEntries.find((role) => matchesSecuritySearch(search, role.role))?.role ?? '';
  const securityPrimaryRoleId =
    roleFilter !== 'all'
      ? roleFilter
      : securityPrimaryUser?.roles[0] || matchedRoleFromSearch || roleEntries[0]?.role || '';
  const securityContextTags = [
    `${t('security.filters.focusLabel')}: ${focusLabelFromFilter(focus, t)}`,
    `${t('security.filters.statusLabel')}: ${
      statusFilter === 'all'
        ? t('security.filters.allStatuses')
        : t(`security.status.${statusFilter}`)
    }`,
    `${t('security.filters.roleLabel')}: ${
      roleFilter === 'all' ? t('security.filters.allRoles') : humanizeIdentifier(roleFilter)
    }`,
    search ? `${t('security.filters.searchLabel')}: ${search}` : null,
  ].filter((value): value is string => Boolean(value));
  const securityContextUsersHref = buildContextualUsersHref(accessNavigationContext, {
    userId: securityPrimaryUser?.id,
    roleId: securityPrimaryRoleId || undefined,
    status:
      statusFilter === 'active' || statusFilter === 'disabled' ? statusFilter : undefined,
    search: search || undefined,
  });
  const securityContextRolesHref = buildContextualRolesHref(accessNavigationContext, {
    roleId: securityPrimaryRoleId || undefined,
    userId: securityPrimaryUser?.id,
  });

  return (
    <SecurityFiltersWorkbench
      title={t('security.filters.title')}
      description={t('security.filters.description')}
      contextLabel={t('nav.security')}
      contextTags={securityContextTags}
      contextActions={
        <>
          <Link href={securityContextUsersHref} className="secondaryButton">
            {t('labels.users')}
            <ArrowRight size={14} />
          </Link>
          <Link href={securityContextRolesHref} className="secondaryButton">
            {t('labels.roles')}
            <ArrowRight size={14} />
          </Link>
        </>
      }
      searchLabel={t('security.filters.searchLabel')}
      searchPlaceholder={t('security.filters.searchPlaceholder')}
      searchValue={search}
      onSearchChange={onSearchChange}
      focusLabel={t('security.filters.focusLabel')}
      focusValue={focus}
      focusOptions={[
        { value: 'all', label: t('security.filters.focusAll') },
        { value: 'users', label: t('security.filters.focusUsers') },
        { value: 'sessions', label: t('security.filters.focusSessions') },
        { value: 'apiKeys', label: t('security.filters.focusApiKeys') },
        { value: 'audit', label: t('security.filters.focusAudit') },
      ]}
      onFocusChange={(value) => onFocusChange(value as SecurityFocusFilter)}
      statusLabel={t('security.filters.statusLabel')}
      statusValue={statusFilter}
      statusOptions={[
        { value: 'all', label: t('security.filters.allStatuses') },
        { value: 'active', label: t('security.status.active') },
        { value: 'disabled', label: t('security.status.disabled') },
        { value: 'expired', label: t('security.status.expired') },
        { value: 'revoked', label: t('security.status.revoked') },
      ]}
      onStatusChange={(value) => onStatusChange(value as SecurityStatusFilter)}
      roleLabel={t('security.filters.roleLabel')}
      roleValue={roleFilter}
      roleOptions={[
        { value: 'all', label: t('security.filters.allRoles') },
        ...roleOptions.map((role) => ({
          value: role,
          label: humanizeIdentifier(role),
        })),
      ]}
      onRoleChange={onRoleChange}
      summaryTags={[
        t('security.filters.resultsUsers', {
          count: formatNumber(filteredUsers.length, locale),
        }),
        t('security.filters.resultsSessions', {
          count: formatNumber(filteredSessionsCount, locale),
        }),
        t('security.filters.resultsApiKeys', {
          count: formatNumber(filteredApiKeysCount, locale),
        }),
        t('security.filters.resultsAudit', {
          count: formatNumber(auditCount, locale),
        }),
      ]}
      copyLabel={t('security.filters.copyLink')}
      onCopy={onCopy}
      resetLabel={t('security.filters.reset')}
      onReset={onReset}
      feedback={feedback}
      className={className}
    />
  );
}

function focusLabelFromFilter(
  focus: SecurityFocusFilter,
  t: TranslationFn,
) {
  if (focus === 'users') {
    return t('security.filters.focusUsers');
  }

  if (focus === 'sessions') {
    return t('security.filters.focusSessions');
  }

  if (focus === 'apiKeys') {
    return t('security.filters.focusApiKeys');
  }

  if (focus === 'audit') {
    return t('security.filters.focusAudit');
  }

  return t('security.filters.focusAll');
}
