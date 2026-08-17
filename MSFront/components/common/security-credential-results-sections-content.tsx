'use client';

import type { ReactNode } from 'react';
import {
  SecurityApiKeyCard,
  SecurityCredentialGroupSection,
  SecuritySessionCard,
  toneFromCredentialStatus,
} from '@/components/common/security-credential-surface';
import { SecurityEmptyState } from '@/components/common/security-empty-state';
import { SecurityPanelSection } from '@/components/common/security-panel-section';
import type {
  LocaleCode,
  SecurityApiKeyEntry,
  SecurityCredentialStatus,
  SecuritySessionEntry,
} from '@/lib/types/management';
import {
  type AccessNavigationContext,
  buildContextualUsersHref,
} from '@/lib/utils/access-navigation';
import { formatNumber } from '@/lib/utils/format';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityCredentialStatusGroup<TEntry> {
  status: SecurityCredentialStatus;
  entries: readonly TEntry[];
}

interface SecurityCredentialResultsProps<TEntry> {
  emptyTitle: string;
  emptyDescription: string;
  entries: readonly TEntry[];
  locale: LocaleCode;
  t: TranslationFn;
  renderEntry: (entry: TEntry) => ReactNode;
}

interface SecuritySessionResultsSectionProps {
  entries: readonly SecuritySessionEntry[];
  locale: LocaleCode;
  t: TranslationFn;
  busy: boolean;
  accessNavigationContext: AccessNavigationContext;
  onRevoke: (sessionId: string) => void;
}

interface SecurityApiKeyResultsSectionProps {
  entries: readonly SecurityApiKeyEntry[];
  locale: LocaleCode;
  t: TranslationFn;
  busy: boolean;
  accessNavigationContext: AccessNavigationContext;
  onRevoke: (apiKeyId: string) => void;
}

function SecurityCredentialResults<TEntry extends { status: SecurityCredentialStatus }>({
  emptyTitle,
  emptyDescription,
  entries,
  locale,
  t,
  renderEntry,
}: SecurityCredentialResultsProps<TEntry>) {
  if (entries.length === 0) {
    return <SecurityEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const groups = groupEntriesByStatus(entries);

  return (
    <div className="credentialGroupStack">
      {groups.map((group) => (
        <SecurityCredentialGroupSection
          key={group.status}
          eyebrow={t(`security.status.${group.status}`)}
          title={t(`security.status.${group.status}`)}
          badgeLabel={formatNumber(group.entries.length, locale)}
          badgeTone={toneFromCredentialStatus(group.status)}
        >
          {group.entries.map((entry) => renderEntry(entry))}
        </SecurityCredentialGroupSection>
      ))}
    </div>
  );
}

export function SecuritySessionResultsSection({
  entries,
  locale,
  t,
  busy,
  accessNavigationContext,
  onRevoke,
}: SecuritySessionResultsSectionProps) {
  return (
    <SecurityPanelSection
      title={t('security.sessionsTitle')}
      description={t('security.sessionsDescription')}
    >
      <SecurityCredentialResults
        emptyTitle={t('security.sessionsEmptyTitle')}
        emptyDescription={t('security.sessionsEmptyDescription')}
        entries={entries}
        locale={locale}
        t={t}
        renderEntry={(session) => (
          <SecuritySessionCard
            key={session.id}
            locale={locale}
            t={t}
            session={session}
            openUserHref={buildContextualUsersHref(accessNavigationContext, {
              userId: session.userId,
            })}
            busy={busy}
            onRevoke={onRevoke}
          />
        )}
      />
    </SecurityPanelSection>
  );
}

export function SecurityApiKeyResultsSection({
  entries,
  locale,
  t,
  busy,
  accessNavigationContext,
  onRevoke,
}: SecurityApiKeyResultsSectionProps) {
  return (
    <SecurityPanelSection
      title={t('security.apiKeysTitle')}
      description={t('security.apiKeysDescription')}
    >
      <SecurityCredentialResults
        emptyTitle={t('security.apiKeysEmptyTitle')}
        emptyDescription={t('security.apiKeysEmptyDescription')}
        entries={entries}
        locale={locale}
        t={t}
        renderEntry={(apiKey) => (
          <SecurityApiKeyCard
            key={apiKey.id}
            locale={locale}
            t={t}
            apiKey={apiKey}
            openOwnerHref={buildContextualUsersHref(accessNavigationContext, {
              userId: apiKey.ownerUserId,
            })}
            busy={busy}
            onRevoke={onRevoke}
          />
        )}
      />
    </SecurityPanelSection>
  );
}

function groupEntriesByStatus<TEntry extends { status: SecurityCredentialStatus }>(
  entries: readonly TEntry[],
): SecurityCredentialStatusGroup<TEntry>[] {
  const statusOrder: SecurityCredentialStatus[] = ['active', 'expired', 'revoked'];

  return statusOrder
    .map((status) => ({
      status,
      entries: entries.filter((entry) => entry.status === status),
    }))
    .filter((group) => group.entries.length > 0);
}
