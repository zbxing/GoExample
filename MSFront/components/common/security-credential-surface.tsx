'use client';

import type { ReactNode } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { ShieldBan } from 'lucide-react';
import { SecurityApiKeyCardContent } from '@/components/common/security-api-key-card-content';
import { SecuritySessionCardContent } from '@/components/common/security-session-card-content';
import { TonePill } from '@/components/common/management-primitives';
import type { ManagementTone } from '@/components/common/management-primitives';
import type {
  LocaleCode,
  SecurityApiKeyEntry,
  SecurityCredentialStatus,
  SecuritySessionEntry,
} from '@/lib/types/management';

interface SecurityCredentialGroupSectionProps {
  eyebrow: string;
  title: string;
  badgeLabel: string;
  badgeTone: ManagementTone;
  children: ReactNode;
}

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

interface SecurityCredentialCardRendererProps {
  locale: LocaleCode;
  t: (path: string, variables?: Record<string, string | number>) => string;
  busy: boolean;
}

interface SecuritySessionCardProps extends SecurityCredentialCardRendererProps {
  session: SecuritySessionEntry;
  openUserHref: Route;
  onRevoke: (sessionId: string) => void;
}

interface SecurityApiKeyCardProps extends SecurityCredentialCardRendererProps {
  apiKey: SecurityApiKeyEntry;
  openOwnerHref: Route;
  onRevoke: (apiKeyId: string) => void;
}

export function SecurityCredentialGroupSection({
  eyebrow,
  title,
  badgeLabel,
  badgeTone,
  children,
}: SecurityCredentialGroupSectionProps) {
  return (
    <section className="credentialGroupSection">
      <div className="credentialGroupHeader">
        <div>
          <span className="serviceCategory">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <TonePill label={badgeLabel} tone={badgeTone} />
      </div>
      <div className="securityEntityStack">{children}</div>
    </section>
  );
}

export function SecurityCredentialCard({
  eyebrow,
  title,
  badge,
  metaFields,
  summary,
  footer,
}: SecurityCredentialCardProps) {
  return (
    <article className="securityEntityCard">
      <div className="securityHeaderRow">
        <div>
          <span className="serviceCategory">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <div className="tagList">{badge}</div>
      </div>
      <div className="securityMetaGrid">
        {metaFields.map((field) => (
          <SecurityMetaField
            key={`${field.label}:${field.value}`}
            label={field.label}
            value={field.value}
          />
        ))}
      </div>
      {summary}
      {footer}
    </article>
  );
}

export function SecurityCredentialCardBadgeActions({
  statusLabel,
  status,
  canRevoke,
  busy,
  revokeLabel,
  revokingLabel,
  onRevoke,
}: SecurityCredentialCardBadgeActionsProps) {
  return (
    <>
      <TonePill label={statusLabel} tone={toneFromCredentialStatus(status)} />
      {canRevoke ? (
        <button type="button" className="dangerButton" disabled={busy} onClick={onRevoke}>
          <ShieldBan size={14} />
          {busy ? revokingLabel : revokeLabel}
        </button>
      ) : null}
    </>
  );
}

export function toneFromCredentialStatus(status: SecurityCredentialStatus): ManagementTone {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'expired') {
    return 'warning';
  }

  return 'danger';
}

export function SecurityCredentialCardFooterLink({
  href,
  label,
}: SecurityCredentialCardFooterLinkProps) {
  return (
    <Link href={href} className="secondaryButton">
      {label}
    </Link>
  );
}

export function SecurityMetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="securityMetaField">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SecuritySessionCard({
  session,
  locale,
  t,
  openUserHref,
  busy,
  onRevoke,
}: SecuritySessionCardProps) {
  return (
    <SecuritySessionCardContent
      session={session}
      locale={locale}
      t={t}
      openUserHref={openUserHref}
      busy={busy}
      onRevoke={onRevoke}
      CardComponent={SecurityCredentialCard}
      BadgeActionsComponent={SecurityCredentialCardBadgeActions}
      FooterLinkComponent={SecurityCredentialCardFooterLink}
    />
  );
}

export function SecurityApiKeyCard({
  apiKey,
  locale,
  t,
  openOwnerHref,
  busy,
  onRevoke,
}: SecurityApiKeyCardProps) {
  return (
    <SecurityApiKeyCardContent
      apiKey={apiKey}
      locale={locale}
      t={t}
      openOwnerHref={openOwnerHref}
      busy={busy}
      onRevoke={onRevoke}
      CardComponent={SecurityCredentialCard}
      BadgeActionsComponent={SecurityCredentialCardBadgeActions}
      FooterLinkComponent={SecurityCredentialCardFooterLink}
    />
  );
}
