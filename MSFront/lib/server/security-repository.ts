import 'server-only';
import { type QueryResultRow } from 'pg';
import { getDatabasePool, isDatabaseConfigured } from '@/lib/server/database';

export interface SecurityRepositorySummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
  roleCount: number;
  permissionCount: number;
  totalSessions: number;
  activeSessions: number;
  revokedSessions: number;
  expiredSessions: number;
  totalApiKeys: number;
  activeApiKeys: number;
  revokedApiKeys: number;
  expiredApiKeys: number;
  recentAuditEvents: number;
  failedAuditEvents: number;
  uniqueAuditActors: number;
}

export interface SecurityRepositoryRoleCoverage {
  role: string;
  memberCount: number;
  activeMemberCount: number;
  disabledMemberCount: number;
}

export interface SecurityRepositoryPermissionCoverage {
  permission: string;
  userAssignments: number;
  apiKeyAssignments: number;
}

export interface SecurityRepositoryUserEntry {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: string[];
  sessionCount: number;
  apiKeyCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface SecurityRepositorySessionEntry {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  authProvider: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface SecurityRepositoryApiKeyEntry {
  id: string;
  name: string;
  keyPrefix: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  permissions: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface SecurityRepositoryAuditEventEntry {
  id: string;
  category: string;
  action: string;
  result: string;
  actor: string;
  target: string;
  scope: string | null;
  clientIp: string | null;
  createdAt: string;
}

export interface SecurityRepositoryPayload {
  source: 'database' | 'unavailable';
  message: string;
  summary: SecurityRepositorySummary;
  roles: SecurityRepositoryRoleCoverage[];
  permissions: SecurityRepositoryPermissionCoverage[];
  users: SecurityRepositoryUserEntry[];
  sessions: SecurityRepositorySessionEntry[];
  apiKeys: SecurityRepositoryApiKeyEntry[];
  auditEvents: SecurityRepositoryAuditEventEntry[];
}

interface AccessSummaryRow extends QueryResultRow {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
  roleCount: number;
  permissionCount: number;
}

interface SessionSummaryRow extends QueryResultRow {
  totalSessions: number;
  activeSessions: number;
  revokedSessions: number;
  expiredSessions: number;
}

interface ApiKeySummaryRow extends QueryResultRow {
  totalApiKeys: number;
  activeApiKeys: number;
  revokedApiKeys: number;
  expiredApiKeys: number;
}

interface AuditSummaryRow extends QueryResultRow {
  recentAuditEvents: number;
  failedAuditEvents: number;
  uniqueAuditActors: number;
}

interface RoleCoverageRow extends QueryResultRow {
  role: string;
  memberCount: number;
  activeMemberCount: number;
  disabledMemberCount: number;
}

interface PermissionCoverageRow extends QueryResultRow {
  permission: string;
  userAssignments: number;
  apiKeyAssignments: number;
}

interface UserInventoryRow extends QueryResultRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: string[];
  sessionCount: number;
  apiKeyCount: number;
  lastSeenAt: Date | string | null;
  updatedAt: Date | string;
}

interface SessionInventoryRow extends QueryResultRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  authProvider: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  revokeReason: string | null;
}

interface ApiKeyInventoryRow extends QueryResultRow {
  id: string;
  name: string;
  keyPrefix: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  permissions: string[];
  createdAt: Date | string;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  revokeReason: string | null;
}

interface AuditInventoryRow extends QueryResultRow {
  id: string;
  category: string;
  action: string;
  result: string;
  actor: string;
  target: string;
  scope: string | null;
  clientIp: string | null;
  createdAt: Date | string;
}

const emptySummary: SecurityRepositorySummary = {
  totalUsers: 0,
  activeUsers: 0,
  disabledUsers: 0,
  adminUsers: 0,
  roleCount: 0,
  permissionCount: 0,
  totalSessions: 0,
  activeSessions: 0,
  revokedSessions: 0,
  expiredSessions: 0,
  totalApiKeys: 0,
  activeApiKeys: 0,
  revokedApiKeys: 0,
  expiredApiKeys: 0,
  recentAuditEvents: 0,
  failedAuditEvents: 0,
  uniqueAuditActors: 0,
};

export async function readSecurityRepositoryPayload(): Promise<SecurityRepositoryPayload> {
  if (!isDatabaseConfigured()) {
    return createUnavailablePayload(
      'Security governance is waiting for a PostgreSQL connection. Configure DATABASE_URL or MSFRONT_DATABASE_URL to enable live access data.',
    );
  }

  const pool = getDatabasePool();

  try {
    const [
      accessSummaryResult,
      sessionSummaryResult,
      apiKeySummaryResult,
      auditSummaryResult,
      roleCoverageResult,
      permissionCoverageResult,
      userInventoryResult,
      sessionInventoryResult,
      apiKeyInventoryResult,
      auditInventoryResult,
    ] = await Promise.all([
      pool.query<AccessSummaryRow>(
        `
          WITH "effective_permissions" AS (
            SELECT "permission"
            FROM "framework_users" AS "user_entry"
            CROSS JOIN LATERAL UNNEST("user_entry"."permissions") AS "permission"
            WHERE "user_entry"."deletedAt" IS NULL
              AND "user_entry"."status" = 'active'
            UNION
            SELECT "permission"
            FROM "framework_api_keys" AS "api_key_entry"
            CROSS JOIN LATERAL UNNEST("api_key_entry"."permissions") AS "permission"
            WHERE "api_key_entry"."revokedAt" IS NULL
              AND ("api_key_entry"."expiresAt" IS NULL OR "api_key_entry"."expiresAt" >= NOW())
          )
          SELECT
            COUNT(*)::int AS "totalUsers",
            COUNT(*) FILTER (WHERE "status" = 'active')::int AS "activeUsers",
            COUNT(*) FILTER (WHERE "status" <> 'active')::int AS "disabledUsers",
            COUNT(*) FILTER (
              WHERE "status" = 'active' AND 'admin' = ANY("roles")
            )::int AS "adminUsers",
            COALESCE((
              SELECT COUNT(DISTINCT "role")::int
              FROM "framework_users" AS "role_entry"
              CROSS JOIN LATERAL UNNEST("role_entry"."roles") AS "role"
              WHERE "role_entry"."deletedAt" IS NULL
            ), 0) AS "roleCount",
            COALESCE((
              SELECT COUNT(DISTINCT "permission")::int
              FROM "effective_permissions"
            ), 0) AS "permissionCount"
          FROM "framework_users"
          WHERE "deletedAt" IS NULL
        `,
      ),
      pool.query<SessionSummaryRow>(
        `
          SELECT
            COUNT(*)::int AS "totalSessions",
            COUNT(*) FILTER (
              WHERE "revokedAt" IS NULL AND "expiresAt" >= NOW()
            )::int AS "activeSessions",
            COUNT(*) FILTER (WHERE "revokedAt" IS NOT NULL)::int AS "revokedSessions",
            COUNT(*) FILTER (
              WHERE "revokedAt" IS NULL AND "expiresAt" < NOW()
            )::int AS "expiredSessions"
          FROM "auth_sessions"
        `,
      ),
      pool.query<ApiKeySummaryRow>(
        `
          SELECT
            COUNT(*)::int AS "totalApiKeys",
            COUNT(*) FILTER (
              WHERE "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" >= NOW())
            )::int AS "activeApiKeys",
            COUNT(*) FILTER (WHERE "revokedAt" IS NOT NULL)::int AS "revokedApiKeys",
            COUNT(*) FILTER (
              WHERE "revokedAt" IS NULL AND "expiresAt" IS NOT NULL AND "expiresAt" < NOW()
            )::int AS "expiredApiKeys"
          FROM "framework_api_keys"
        `,
      ),
      pool.query<AuditSummaryRow>(
        `
          SELECT
            COUNT(*)::int AS "recentAuditEvents",
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE("result", '')) NOT IN ('success', 'succeeded', 'ok', 'allowed')
            )::int AS "failedAuditEvents",
            COUNT(DISTINCT COALESCE(
              NULLIF("actorDisplayName", ''),
              NULLIF("actorUsername", ''),
              NULLIF("actorId", ''),
              NULLIF("actorUserId", ''),
              'system'
            ))::int AS "uniqueAuditActors"
          FROM "audit_events"
          WHERE "createdAt" >= NOW() - INTERVAL '7 days'
        `,
      ),
      pool.query<RoleCoverageRow>(
        `
          SELECT
            "role",
            COUNT(*)::int AS "memberCount",
            COUNT(*) FILTER (WHERE "status" = 'active')::int AS "activeMemberCount",
            COUNT(*) FILTER (WHERE "status" <> 'active')::int AS "disabledMemberCount"
          FROM "framework_users"
          CROSS JOIN LATERAL UNNEST("roles") AS "role"
          WHERE "deletedAt" IS NULL
          GROUP BY "role"
          ORDER BY "memberCount" DESC, "role" ASC
        `,
      ),
      pool.query<PermissionCoverageRow>(
        `
          WITH "user_permissions" AS (
            SELECT
              "permission",
              COUNT(*)::int AS "userAssignments"
            FROM "framework_users"
            CROSS JOIN LATERAL UNNEST("permissions") AS "permission"
            WHERE "deletedAt" IS NULL
              AND "status" = 'active'
            GROUP BY "permission"
          ),
          "api_key_permissions" AS (
            SELECT
              "permission",
              COUNT(*)::int AS "apiKeyAssignments"
            FROM "framework_api_keys"
            CROSS JOIN LATERAL UNNEST("permissions") AS "permission"
            WHERE "revokedAt" IS NULL
              AND ("expiresAt" IS NULL OR "expiresAt" >= NOW())
            GROUP BY "permission"
          )
          SELECT
            COALESCE("user_permissions"."permission", "api_key_permissions"."permission") AS "permission",
            COALESCE("user_permissions"."userAssignments", 0)::int AS "userAssignments",
            COALESCE("api_key_permissions"."apiKeyAssignments", 0)::int AS "apiKeyAssignments"
          FROM "user_permissions"
          FULL OUTER JOIN "api_key_permissions"
            ON "user_permissions"."permission" = "api_key_permissions"."permission"
          ORDER BY ("userAssignments" + "apiKeyAssignments") DESC, "permission" ASC
          LIMIT 10
        `,
      ),
      pool.query<UserInventoryRow>(
        `
          SELECT
            "framework_users"."id",
            "framework_users"."username",
            "framework_users"."displayName",
            "framework_users"."status",
            "framework_users"."roles",
            "framework_users"."permissions",
            COALESCE("session_stats"."sessionCount", 0)::int AS "sessionCount",
            COALESCE("api_key_stats"."apiKeyCount", 0)::int AS "apiKeyCount",
            "session_stats"."lastSeenAt",
            "framework_users"."updatedAt"
          FROM "framework_users"
          LEFT JOIN (
            SELECT
              "userId",
              COUNT(*)::int AS "sessionCount",
              MAX(COALESCE("lastUsedAt", "createdAt")) AS "lastSeenAt"
            FROM "auth_sessions"
            GROUP BY "userId"
          ) AS "session_stats"
            ON "session_stats"."userId" = "framework_users"."id"
          LEFT JOIN (
            SELECT
              "createdByUserId",
              COUNT(*)::int AS "apiKeyCount"
            FROM "framework_api_keys"
            GROUP BY "createdByUserId"
          ) AS "api_key_stats"
            ON "api_key_stats"."createdByUserId" = "framework_users"."id"
          WHERE "framework_users"."deletedAt" IS NULL
          ORDER BY
            CASE WHEN "framework_users"."status" = 'active' THEN 0 ELSE 1 END,
            COALESCE("session_stats"."lastSeenAt", "framework_users"."updatedAt") DESC
          LIMIT 100
        `,
      ),
      pool.query<SessionInventoryRow>(
        `
          SELECT
            "auth_sessions"."id",
            "auth_sessions"."userId",
            "framework_users"."username",
            "framework_users"."displayName",
            "auth_sessions"."authProvider",
            "auth_sessions"."tenantId",
            "auth_sessions"."ipAddress",
            "auth_sessions"."userAgent",
            "auth_sessions"."createdAt",
            "auth_sessions"."expiresAt",
            "auth_sessions"."lastUsedAt",
            "auth_sessions"."revokedAt",
            "auth_sessions"."revokeReason"
          FROM "auth_sessions"
          INNER JOIN "framework_users"
            ON "framework_users"."id" = "auth_sessions"."userId"
          WHERE "framework_users"."deletedAt" IS NULL
          ORDER BY COALESCE("auth_sessions"."lastUsedAt", "auth_sessions"."createdAt") DESC
          LIMIT 100
        `,
      ),
      pool.query<ApiKeyInventoryRow>(
        `
          SELECT
            "framework_api_keys"."id",
            "framework_api_keys"."name",
            "framework_api_keys"."keyPrefix",
            "framework_api_keys"."createdByUserId" AS "ownerUserId",
            "framework_users"."username" AS "ownerUsername",
            "framework_users"."displayName" AS "ownerDisplayName",
            "framework_api_keys"."permissions",
            "framework_api_keys"."createdAt",
            "framework_api_keys"."expiresAt",
            "framework_api_keys"."lastUsedAt",
            "framework_api_keys"."revokedAt",
            "framework_api_keys"."revokeReason"
          FROM "framework_api_keys"
          INNER JOIN "framework_users"
            ON "framework_users"."id" = "framework_api_keys"."createdByUserId"
          WHERE "framework_users"."deletedAt" IS NULL
          ORDER BY COALESCE("framework_api_keys"."lastUsedAt", "framework_api_keys"."createdAt") DESC
          LIMIT 100
        `,
      ),
      pool.query<AuditInventoryRow>(
        `
          SELECT
            "id",
            "category",
            "action",
            "result",
            COALESCE(
              NULLIF("actorDisplayName", ''),
              NULLIF("actorUsername", ''),
              NULLIF("actorId", ''),
              NULLIF("actorUserId", ''),
              'system'
            ) AS "actor",
            COALESCE(
              NULLIF(CONCAT_WS(' / ', NULLIF("targetType", ''), NULLIF("targetId", '')), ''),
              NULLIF(CONCAT_WS(' / ', NULLIF("subjectType", ''), NULLIF("subjectId", '')), ''),
              NULLIF("resourceId", ''),
              'platform'
            ) AS "target",
            "scope",
            "clientIp",
            "createdAt"
          FROM "audit_events"
          ORDER BY "createdAt" DESC
          LIMIT 100
        `,
      ),
    ]);

    const summary: SecurityRepositorySummary = {
      ...emptySummary,
      ...mapAccessSummary(accessSummaryResult.rows[0]),
      ...mapSessionSummary(sessionSummaryResult.rows[0]),
      ...mapApiKeySummary(apiKeySummaryResult.rows[0]),
      ...mapAuditSummary(auditSummaryResult.rows[0]),
    };

    return {
      source: 'database',
      message:
        'Security governance is reading live access data from framework users, sessions, API keys, and recent audit activity.',
      summary,
      roles: roleCoverageResult.rows.map((row) => ({
        role: row.role,
        memberCount: toNumber(row.memberCount),
        activeMemberCount: toNumber(row.activeMemberCount),
        disabledMemberCount: toNumber(row.disabledMemberCount),
      })),
      permissions: permissionCoverageResult.rows.map((row) => ({
        permission: row.permission,
        userAssignments: toNumber(row.userAssignments),
        apiKeyAssignments: toNumber(row.apiKeyAssignments),
      })),
      users: userInventoryResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        status: row.status,
        roles: Array.isArray(row.roles) ? row.roles : [],
        permissions: Array.isArray(row.permissions) ? row.permissions : [],
        sessionCount: toNumber(row.sessionCount),
        apiKeyCount: toNumber(row.apiKeyCount),
        lastSeenAt: normalizeOptionalDateTime(row.lastSeenAt),
        updatedAt: normalizeRequiredDateTime(row.updatedAt),
      })),
      sessions: sessionInventoryResult.rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        authProvider: row.authProvider,
        tenantId: row.tenantId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: normalizeRequiredDateTime(row.createdAt),
        expiresAt: normalizeRequiredDateTime(row.expiresAt),
        lastUsedAt: normalizeOptionalDateTime(row.lastUsedAt),
        revokedAt: normalizeOptionalDateTime(row.revokedAt),
        revokeReason: row.revokeReason,
      })),
      apiKeys: apiKeyInventoryResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        ownerUserId: row.ownerUserId,
        ownerUsername: row.ownerUsername,
        ownerDisplayName: row.ownerDisplayName,
        permissions: Array.isArray(row.permissions) ? row.permissions : [],
        createdAt: normalizeRequiredDateTime(row.createdAt),
        expiresAt: normalizeOptionalDateTime(row.expiresAt),
        lastUsedAt: normalizeOptionalDateTime(row.lastUsedAt),
        revokedAt: normalizeOptionalDateTime(row.revokedAt),
        revokeReason: row.revokeReason,
      })),
      auditEvents: auditInventoryResult.rows.map((row) => ({
        id: row.id,
        category: row.category,
        action: row.action,
        result: row.result,
        actor: row.actor,
        target: row.target,
        scope: row.scope,
        clientIp: row.clientIp,
        createdAt: normalizeRequiredDateTime(row.createdAt),
      })),
    };
  } catch (error) {
    return createUnavailablePayload(
      `Security governance could not read framework access tables. ${
        error instanceof Error ? error.message : 'Unknown database error.'
      }`,
    );
  }
}

function createUnavailablePayload(message: string): SecurityRepositoryPayload {
  return {
    source: 'unavailable',
    message,
    summary: emptySummary,
    roles: [],
    permissions: [],
    users: [],
    sessions: [],
    apiKeys: [],
    auditEvents: [],
  };
}

function mapAccessSummary(row?: AccessSummaryRow) {
  return {
    totalUsers: toNumber(row?.totalUsers),
    activeUsers: toNumber(row?.activeUsers),
    disabledUsers: toNumber(row?.disabledUsers),
    adminUsers: toNumber(row?.adminUsers),
    roleCount: toNumber(row?.roleCount),
    permissionCount: toNumber(row?.permissionCount),
  };
}

function mapSessionSummary(row?: SessionSummaryRow) {
  return {
    totalSessions: toNumber(row?.totalSessions),
    activeSessions: toNumber(row?.activeSessions),
    revokedSessions: toNumber(row?.revokedSessions),
    expiredSessions: toNumber(row?.expiredSessions),
  };
}

function mapApiKeySummary(row?: ApiKeySummaryRow) {
  return {
    totalApiKeys: toNumber(row?.totalApiKeys),
    activeApiKeys: toNumber(row?.activeApiKeys),
    revokedApiKeys: toNumber(row?.revokedApiKeys),
    expiredApiKeys: toNumber(row?.expiredApiKeys),
  };
}

function mapAuditSummary(row?: AuditSummaryRow) {
  return {
    recentAuditEvents: toNumber(row?.recentAuditEvents),
    failedAuditEvents: toNumber(row?.failedAuditEvents),
    uniqueAuditActors: toNumber(row?.uniqueAuditActors),
  };
}

function toNumber(value: unknown) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeRequiredDateTime(value: Date | string) {
  return new Date(value).toISOString();
}

function normalizeOptionalDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}
