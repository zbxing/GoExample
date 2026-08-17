'use client';

import type { ReactNode } from 'react';
import {
  SecurityApiKeyResultsSection,
  SecuritySessionResultsSection,
} from '@/components/common/security-credential-results-sections-content';
import type {
  LocaleCode,
  SecurityApiKeyEntry,
  SecuritySessionEntry,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityCredentialWorkbenchProps {
  sessions: readonly SecuritySessionEntry[];
  apiKeys: readonly SecurityApiKeyEntry[];
  locale: LocaleCode;
  t: TranslationFn;
  busy: boolean;
  accessNavigationContext: AccessNavigationContext;
  onRevokeSession: (sessionId: string) => void;
  onRevokeApiKey: (apiKeyId: string) => void;
}

function SecurityCredentialWorkbenchSection({ children }: { children: ReactNode }) {
  return <div className="twoColumn">{children}</div>;
}

export function SecurityCredentialWorkbench({
  sessions,
  apiKeys,
  locale,
  t,
  busy,
  accessNavigationContext,
  onRevokeSession,
  onRevokeApiKey,
}: SecurityCredentialWorkbenchProps) {
  return (
    <SecurityCredentialWorkbenchSection>
      <SecuritySessionResultsSection
        entries={sessions}
        locale={locale}
        t={t}
        busy={busy}
        accessNavigationContext={accessNavigationContext}
        onRevoke={onRevokeSession}
      />

      <SecurityApiKeyResultsSection
        entries={apiKeys}
        locale={locale}
        t={t}
        busy={busy}
        accessNavigationContext={accessNavigationContext}
        onRevoke={onRevokeApiKey}
      />
    </SecurityCredentialWorkbenchSection>
  );
}
