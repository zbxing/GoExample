import type {
  SecurityApiKeyEntry,
  SecurityAuditEventEntry,
  SecurityGovernanceView,
  SecurityPermissionCoverage,
  SecurityRoleCoverage,
  SecuritySessionEntry,
  SecurityUserEntry,
} from '@/lib/types/management';
import type { SecurityRepositoryPayload } from '@/lib/server/security-repository';

export function buildSecurityGovernanceView(
  payload: SecurityRepositoryPayload,
): SecurityGovernanceView {
  return {
    source: payload.source,
    message: payload.message,
    summary: payload.summary,
    roles: [...payload.roles].sort(
      (left, right) => right.memberCount - left.memberCount || left.role.localeCompare(right.role),
    ) as SecurityRoleCoverage[],
    permissions: [...payload.permissions]
      .map((entry) => ({
        ...entry,
        totalAssignments: entry.userAssignments + entry.apiKeyAssignments,
      }))
      .sort(
        (left, right) =>
          right.totalAssignments - left.totalAssignments ||
          left.permission.localeCompare(right.permission),
      ) as SecurityPermissionCoverage[],
    users: [...payload.users].sort((left, right) => {
      const statusRank = rankUserStatus(left.status) - rankUserStatus(right.status);

      if (statusRank !== 0) {
        return statusRank;
      }

      return (
        new Date(right.lastSeenAt ?? right.updatedAt).valueOf() -
        new Date(left.lastSeenAt ?? left.updatedAt).valueOf()
      );
    }) as SecurityUserEntry[],
    sessions: [...payload.sessions].map((entry) => ({
      ...entry,
      status: resolveCredentialStatus(entry.expiresAt, entry.revokedAt),
    })) as SecuritySessionEntry[],
    apiKeys: [...payload.apiKeys]
      .map((entry) => ({
        ...entry,
        status: resolveCredentialStatus(entry.expiresAt, entry.revokedAt),
      }))
      .sort(
        (left, right) =>
          rankCredentialStatus(left.status) - rankCredentialStatus(right.status) ||
          new Date(right.lastUsedAt ?? right.createdAt).valueOf() -
            new Date(left.lastUsedAt ?? left.createdAt).valueOf(),
      ) as SecurityApiKeyEntry[],
    auditEvents: [...payload.auditEvents]
      .map((entry) => ({
        ...entry,
        tone: resolveAuditTone(entry.result, entry.action),
      }))
      .sort(
        (left, right) =>
          new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf(),
      ) as SecurityAuditEventEntry[],
  };
}

function rankUserStatus(status: string) {
  return status === 'active' ? 0 : 1;
}

function resolveCredentialStatus(expiresAt: string | null, revokedAt: string | null) {
  if (revokedAt) {
    return 'revoked' as const;
  }

  if (expiresAt && new Date(expiresAt).valueOf() < Date.now()) {
    return 'expired' as const;
  }

  return 'active' as const;
}

function rankCredentialStatus(status: 'active' | 'expired' | 'revoked') {
  if (status === 'active') {
    return 0;
  }

  if (status === 'expired') {
    return 1;
  }

  return 2;
}

function resolveAuditTone(result: string, action: string) {
  const normalizedResult = `${result}`.toLowerCase();
  const normalizedAction = `${action}`.toLowerCase();

  if (
    normalizedResult.includes('fail') ||
    normalizedResult.includes('error') ||
    normalizedResult.includes('deny') ||
    normalizedResult.includes('reject')
  ) {
    return 'high' as const;
  }

  if (
    normalizedResult.includes('warn') ||
    normalizedResult.includes('revoke') ||
    normalizedAction.includes('revoke')
  ) {
    return 'medium' as const;
  }

  if (
    normalizedResult.includes('success') ||
    normalizedResult.includes('succeed') ||
    normalizedResult.includes('allow') ||
    normalizedResult.includes('ok')
  ) {
    return 'info' as const;
  }

  return 'low' as const;
}
