'use client';

import type { ComponentType, ReactNode } from 'react';
import type { Route } from 'next';
import type {
  LocaleCode,
  SecurityApiKeyEntry,
  SecurityCredentialStatus,
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

interface SecurityApiKeyCardContentProps {
  apiKey: SecurityApiKeyEntry;
  locale: LocaleCode;
  t: TranslationFn;
  openOwnerHref: Route;
  busy: boolean;
  onRevoke: (apiKeyId: string) => void;
  CardComponent: ComponentType<SecurityCredentialCardProps>;
  BadgeActionsComponent: ComponentType<SecurityCredentialCardBadgeActionsProps>;
  FooterLinkComponent: ComponentType<SecurityCredentialCardFooterLinkProps>;
}

export function SecurityApiKeyCardContent({
  apiKey,
  locale,
  t,
  openOwnerHref,
  busy,
  onRevoke,
  CardComponent,
  BadgeActionsComponent,
  FooterLinkComponent,
}: SecurityApiKeyCardContentProps) {
  const metaFields = [
    {
      label: t('labels.owner'),
      value: apiKey.ownerDisplayName,
    },
    {
      label: t('labels.lastUsed'),
      value: apiKey.lastUsedAt
        ? formatDateTime(apiKey.lastUsedAt, locale)
        : t('security.emptyValue'),
    },
    {
      label: t('labels.expiresAt'),
      value: apiKey.expiresAt
        ? formatDateTime(apiKey.expiresAt, locale)
        : t('security.emptyValue'),
    },
    {
      label: t('labels.createdAt'),
      value: formatDateTime(apiKey.createdAt, locale),
    },
  ];

  return (
    <CardComponent
      eyebrow={apiKey.keyPrefix}
      title={apiKey.name}
      badge={
        <BadgeActionsComponent
          statusLabel={t(`security.status.${apiKey.status}`)}
          status={apiKey.status}
          canRevoke={apiKey.status === 'active'}
          busy={busy}
          revokeLabel={t('security.actions.revokeApiKey')}
          revokingLabel={t('security.actions.revoking')}
          onRevoke={() => onRevoke(apiKey.id)}
        />
      }
      metaFields={metaFields}
      summary={
        <div className="tagList">
          {apiKey.permissions.length > 0 ? (
            apiKey.permissions.map((permission) => (
              <span key={`${apiKey.id}:${permission}`} className="securityTag">
                {permission}
              </span>
            ))
          ) : (
            <span className="securityTag">{t('security.emptyValue')}</span>
          )}
        </div>
      }
      footer={
        <FooterLinkComponent href={openOwnerHref} label={t('security.actions.openOwner')} />
      }
    />
  );
}
