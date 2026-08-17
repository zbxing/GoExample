'use client';

import type { ComponentType, ReactNode } from 'react';
import type { Route } from 'next';
import type {
  LocaleCode,
  SecurityCredentialStatus,
  SecuritySessionEntry,
} from '@/lib/types/management';
import { formatDateTime } from '@/lib/utils/format';

interface SecurityCredentialCardProps {
  eyebrow: string;
  title: string;
  badge: ReactNode;
  metaFields: readonly {
    label: string;
    value: string;
  }[];
  summary?: ReactNode;
  footer: ReactNode;
}

interface SecurityCredentialCardBadgeActionsProps {
  statusLabel: string;
  status: SecurityCredentialStatus;
  canRevoke: boolean;
  busy: boolean;
  revokeLabel: string;
  revokingLabel: string;
  onRevoke?: () => void;
}

interface SecurityCredentialCardFooterLinkProps {
  href: Route;
  label: string;
}

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SecuritySessionCardContentProps {
  session: SecuritySessionEntry;
  locale: LocaleCode;
  t: TranslationFn;
  openUserHref: Route;
  busy: boolean;
  onRevoke: (sessionId: string) => void;
  CardComponent: ComponentType<SecurityCredentialCardProps>;
  BadgeActionsComponent: ComponentType<SecurityCredentialCardBadgeActionsProps>;
  FooterLinkComponent: ComponentType<SecurityCredentialCardFooterLinkProps>;
}

export function SecuritySessionCardContent({
  session,
  locale,
  t,
  openUserHref,
  busy,
  onRevoke,
  CardComponent,
  BadgeActionsComponent,
  FooterLinkComponent,
}: SecuritySessionCardContentProps) {
  const metaFields = [
    {
      label: t('labels.provider'),
      value: session.authProvider ?? t('security.emptyValue'),
    },
    {
      label: t('labels.tenant'),
      value: session.tenantId ?? t('security.emptyValue'),
    },
    {
      label: t('labels.lastUsed'),
      value: session.lastUsedAt
        ? formatDateTime(session.lastUsedAt, locale)
        : t('security.emptyValue'),
    },
    {
      label: t('labels.expiresAt'),
      value: formatDateTime(session.expiresAt, locale),
    },
    {
      label: t('labels.clientIp'),
      value: session.ipAddress ?? t('security.emptyValue'),
    },
    {
      label: t('labels.createdAt'),
      value: formatDateTime(session.createdAt, locale),
    },
  ];

  return (
    <CardComponent
      eyebrow={`@${session.username}`}
      title={session.displayName}
      badge={
        <BadgeActionsComponent
          statusLabel={t(`security.status.${session.status}`)}
          status={session.status}
          canRevoke={session.status === 'active'}
          busy={busy}
          revokeLabel={t('security.actions.revokeSession')}
          revokingLabel={t('security.actions.revoking')}
          onRevoke={() => onRevoke(session.id)}
        />
      }
      metaFields={metaFields}
      summary={
        <p className="summaryFootnote">
          {session.revokeReason ?? abbreviateText(session.userAgent ?? t('security.emptyValue'))}
        </p>
      }
      footer={
        <FooterLinkComponent href={openUserHref} label={t('security.actions.openUser')} />
      }
    />
  );
}

function abbreviateText(value: string, limit = 96) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}...`;
}
