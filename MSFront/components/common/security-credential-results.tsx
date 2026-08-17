'use client';

import { useTransition } from 'react';
import { SecurityCredentialWorkbench } from '@/components/common/security-credential-workbench-content';
import type {
  SecurityApiKeyEntry,
  LocaleCode,
  SecurityGovernanceView,
  SecuritySessionEntry,
} from '@/lib/types/management';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface SecurityCredentialRefreshWorkbenchProps {
  sessions: readonly SecuritySessionEntry[];
  apiKeys: readonly SecurityApiKeyEntry[];
  locale: LocaleCode;
  t: TranslationFn;
  accessNavigationContext: AccessNavigationContext;
  onGovernanceChange: (nextGovernance: SecurityGovernanceView) => void;
  onClearFeedback: () => void;
  onShowError: (message: string) => void;
  onShowSuccess: (message: string) => void;
}

export function SecurityCredentialRefreshWorkbench({
  sessions,
  apiKeys,
  locale,
  t,
  accessNavigationContext,
  onGovernanceChange,
  onClearFeedback,
  onShowError,
  onShowSuccess,
}: SecurityCredentialRefreshWorkbenchProps) {
  const [isPending, startTransition] = useTransition();

  async function refreshGovernanceData() {
    const response = await fetch('/api/management/security', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(t('security.messages.reloadError'));
    }

    return (await response.json()) as SecurityGovernanceView;
  }

  function handleRevokeSession(sessionId: string) {
    onClearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/management/security/sessions/${sessionId}/revoke`, {
          method: 'POST',
        });
        const payload = (await response.json()) as
          | { revoked: true; sessionId: string }
          | { message?: string };

        if (!response.ok) {
          onShowError(
            'message' in payload
              ? payload.message ?? t('security.messages.revokeSessionError')
              : t('security.messages.revokeSessionError'),
          );
          return;
        }

        const nextGovernance = await refreshGovernanceData();
        onGovernanceChange(nextGovernance);
        onShowSuccess(t('security.messages.revokeSessionSuccess'));
      })().catch((requestError) => {
        onShowError(
          requestError instanceof Error
            ? requestError.message
            : t('security.messages.revokeSessionError'),
        );
      });
    });
  }

  function handleRevokeApiKey(apiKeyId: string) {
    onClearFeedback();

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/management/security/api-keys/${apiKeyId}/revoke`, {
          method: 'POST',
        });
        const payload = (await response.json()) as
          | { revoked: true; apiKeyId: string }
          | { message?: string };

        if (!response.ok) {
          onShowError(
            'message' in payload
              ? payload.message ?? t('security.messages.revokeApiKeyError')
              : t('security.messages.revokeApiKeyError'),
          );
          return;
        }

        const nextGovernance = await refreshGovernanceData();
        onGovernanceChange(nextGovernance);
        onShowSuccess(t('security.messages.revokeApiKeySuccess'));
      })().catch((requestError) => {
        onShowError(
          requestError instanceof Error
            ? requestError.message
            : t('security.messages.revokeApiKeyError'),
        );
      });
    });
  }

  return (
    <SecurityCredentialWorkbench
      sessions={sessions}
      apiKeys={apiKeys}
      locale={locale}
      t={t}
      busy={isPending}
      accessNavigationContext={accessNavigationContext}
      onRevokeSession={handleRevokeSession}
      onRevokeApiKey={handleRevokeApiKey}
    />
  );
}
