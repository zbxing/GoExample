'use client';

import Link from 'next/link';
import { TonePill } from '@/components/common/management-primitives';
import { SecurityEmptyState } from '@/components/common/security-empty-state';
import { ResultsWorkspaceShell } from '@/components/common/results-workspace-shell';
import { TimelinePanel } from '@/components/dashboard/timeline-panel';
import type {
  LocaleCode,
  SecurityUserEntry,
  TimelineItem,
} from '@/lib/types/management';
import {
  type AccessNavigationContext,
  buildContextualRolesHref,
  buildContextualUsersHref,
} from '@/lib/utils/access-navigation';
import {
  formatDateTime,
  formatNumber,
  humanizeIdentifier,
} from '@/lib/utils/format';

type Translate = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityUserResultsTableProps {
  entries: readonly SecurityUserEntry[];
  locale: LocaleCode;
  t: Translate;
  accessNavigationContext: AccessNavigationContext;
}

interface SecurityUserResultsProps {
  entries: readonly SecurityUserEntry[];
  locale: LocaleCode;
  t: Translate;
  accessNavigationContext: AccessNavigationContext;
}

interface SecurityAuditTimelineProps {
  items: TimelineItem[];
  t: Translate;
}

export function SecurityUserResultsTable({
  entries,
  locale,
  t,
  accessNavigationContext,
}: SecurityUserResultsTableProps) {
  return (
    <div className="tableCard">
      <table className="responsiveTable" aria-label={t('security.usersTitle')}>
        <thead>
          <tr>
            <th scope="col">{t('labels.users')}</th>
            <th scope="col">{t('labels.roles')}</th>
            <th scope="col">{t('labels.permissions')}</th>
            <th scope="col">{t('labels.sessions')}</th>
            <th scope="col">{t('labels.lastSeen')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((user) => (
            <tr key={user.id}>
              <td>
                <span className="tableCellLabel">{t('labels.users')}</span>
                <div className="tableCellValue">
                  <Link
                    href={buildContextualUsersHref(accessNavigationContext, {
                      userId: user.id,
                    })}
                    className="securityInlineLink securityInlineLinkStrong"
                  >
                    {user.displayName}
                  </Link>
                  <span>
                    @{user.username} /{' '}
                    {t(`security.status.${user.status === 'active' ? 'active' : 'disabled'}`)}
                  </span>
                  <div className="tagList">
                    <TonePill
                      label={t(
                        `security.status.${user.status === 'active' ? 'active' : 'disabled'}`,
                      )}
                      tone={user.status === 'active' ? 'success' : 'danger'}
                    />
                  </div>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.roles')}</span>
                <div className="tableCellValue">
                  <div className="tagList">
                    {user.roles.length > 0 ? (
                      user.roles.map((role) => (
                        <Link
                          key={`${user.id}:${role}`}
                          href={buildContextualRolesHref(accessNavigationContext, {
                            roleId: role,
                            userId: user.id,
                          })}
                          className="securityTag securityTagLink"
                        >
                          {humanizeIdentifier(role)}
                        </Link>
                      ))
                    ) : (
                      <span className="securityTag">{t('security.emptyValue')}</span>
                    )}
                  </div>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.permissions')}</span>
                <div className="tableCellValue">
                  <div className="tagList">
                    {user.permissions.length > 0 ? (
                      user.permissions.slice(0, 4).map((permission) => (
                        <span key={`${user.id}:${permission}`} className="securityTag">
                          {permission}
                        </span>
                      ))
                    ) : (
                      <span className="securityTag">{t('security.emptyValue')}</span>
                    )}
                    {user.permissions.length > 4 ? (
                      <span className="securityTag">
                        +{formatNumber(user.permissions.length - 4, locale)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.sessions')}</span>
                <div className="tableCellValue">
                  <strong>{formatNumber(user.sessionCount, locale)}</strong>
                  <span>
                    {formatNumber(user.apiKeyCount, locale)} {t('labels.apiKeys')}
                  </span>
                  <Link
                    href={buildContextualUsersHref(accessNavigationContext, {
                      userId: user.id,
                    })}
                    className="securityInlineLink"
                  >
                    {t('security.actions.openUser')}
                  </Link>
                </div>
              </td>
              <td>
                <span className="tableCellLabel">{t('labels.lastSeen')}</span>
                <div className="tableCellValue">
                  <strong>
                    {user.lastSeenAt
                      ? formatDateTime(user.lastSeenAt, locale)
                      : t('security.emptyValue')}
                  </strong>
                  <span>{formatDateTime(user.updatedAt, locale)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SecurityUserResults({
  entries,
  locale,
  t,
  accessNavigationContext,
}: SecurityUserResultsProps) {
  return (
    <ResultsWorkspaceShell
      title={t('security.usersTitle')}
      description={t('security.usersDescription')}
      emptyState={
        <SecurityEmptyState
          title={t('security.usersEmptyTitle')}
          description={t('security.usersEmptyDescription')}
        />
      }
      hasContent={entries.length > 0}
    >
      {entries.length > 0 ? (
        <SecurityUserResultsTable
          entries={entries}
          locale={locale}
          t={t}
          accessNavigationContext={accessNavigationContext}
        />
      ) : null}
    </ResultsWorkspaceShell>
  );
}

export function SecurityAuditTimeline({
  items,
  t,
}: SecurityAuditTimelineProps) {
  return (
    <TimelinePanel
      title={t('security.auditTitle')}
      items={items}
      emptyMessage={t('security.auditEmpty')}
    />
  );
}
