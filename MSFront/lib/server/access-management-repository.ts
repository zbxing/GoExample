import 'server-only';
import { type QueryResultRow } from 'pg';
import {
  MSFRONT_DEFAULT_ROLE_DEFINITIONS,
  MSFRONT_SUPPORTED_PERMISSIONS,
  filterValidPermissionIdentifiers,
  isValidRoleIdentifier,
  isValidPermissionIdentifier,
  normalizePermissionList,
} from '@/lib/server/access-control-config';
import { getDatabasePool, isDatabaseConfigured } from '@/lib/server/database';
import type {
  AccessManagedRoleDefinition,
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementSummary,
  AccessManagementView,
  FrameworkUserStatus,
} from '@/lib/types/management';

const auditActorId = 'msfront:security-console';
const auditActorDisplayName = 'MSFront Security Console';

interface FrameworkUserInventoryRow extends QueryResultRow {
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

interface ManagedRoleRow extends QueryResultRow {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  locked: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface SessionRevokeRow extends QueryResultRow {
  id: string;
  userId: string;
  revokedAt: Date | string | null;
}

interface ApiKeyRevokeRow extends QueryResultRow {
  id: string;
  createdByUserId: string;
  revokedAt: Date | string | null;
}

interface ManagedRoleInput {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

interface ManagedUserUpdateInput {
  displayName: string;
  status: FrameworkUserStatus;
  roles: string[];
  extraPermissions: string[];
}

interface DatabaseQueryCarrier {
  query: <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    rows: Row[];
  }>;
}

export async function readAccessManagementView(): Promise<AccessManagementView> {
  if (!isDatabaseConfigured()) {
    const now = new Date().toISOString();
    const roles = MSFRONT_DEFAULT_ROLE_DEFINITIONS.map<AccessManagedRoleEntry>((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: normalizePermissionList(role.permissions),
      locked: role.locked,
      imported: false,
      createdAt: now,
      updatedAt: now,
      memberCount: 0,
      activeMemberCount: 0,
      disabledMemberCount: 0,
      permissionCount: role.permissions.length,
    }));

    return {
      source: 'unavailable',
      message:
        'RBAC management is waiting for DATABASE_URL or MSFRONT_DATABASE_URL before it can manage live framework users and credentials.',
      supportedPermissions: [...MSFRONT_SUPPORTED_PERMISSIONS],
      roles,
      users: [],
      summary: buildAccessManagementSummary(roles, []),
    };
  }

  const pool = getDatabasePool();
  await ensureManagedRolesSeeded(pool);

  const [roleRows, userRows] = await Promise.all([
    readManagedRoleRows(pool),
    readFrameworkUserInventoryRows(pool),
  ]);
  const roleCatalog = buildRoleCatalog(roleRows, userRows);
  const users = userRows
    .map((row) => mapAccessManagedUser(row, roleCatalog))
    .sort((left, right) => {
      const statusRank = left.status === 'active' ? 0 : 1;
      const otherStatusRank = right.status === 'active' ? 0 : 1;

      if (statusRank !== otherStatusRank) {
        return statusRank - otherStatusRank;
      }

      return left.displayName.localeCompare(right.displayName) || left.username.localeCompare(right.username);
    });
  const roles = roleCatalog
    .map((role) => summarizeManagedRole(role, users))
    .sort((left, right) => {
      if (left.locked !== right.locked) {
        return left.locked ? -1 : 1;
      }

      return right.memberCount - left.memberCount || left.name.localeCompare(right.name);
    });

  return {
    source: 'database',
    message:
      'MSFront is managing live framework users, role bundles, sessions, and API keys from the shared access datastore.',
    supportedPermissions: collectSuggestedPermissions(roles, users),
    roles,
    users,
    summary: buildAccessManagementSummary(roles, users),
  };
}

export async function updateManagedUser(
  userId: string,
  input: ManagedUserUpdateInput,
): Promise<AccessManagedUserEntry> {
  assertDatabaseIsConfigured();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureManagedRolesSeeded(client);

    const previousRoles = buildRoleCatalog(
      await readManagedRoleRows(client),
      await readFrameworkUserInventoryRows(client),
    );
    const row = await readFrameworkUserRowById(client, userId);

    if (!row) {
      throw new Error(`Managed user not found: ${userId}`);
    }

    const nextRoles = normalizeRequestedRoleList(input.roles, 'roles');
    const unknownRole = nextRoles.find(
      (roleId) => !previousRoles.some((role) => role.id === roleId),
    );

    if (unknownRole) {
      throw new Error(`Unknown managed role: ${unknownRole}`);
    }

    const availableRoleCatalog = ensureCatalogForRoleIds(previousRoles, nextRoles);
    const nextInheritedPermissions = collectPermissionsForRoles(nextRoles, availableRoleCatalog);
    const nextExtraPermissions = normalizeManagedPermissionInput(
      input.extraPermissions,
      'extraPermissions',
    );
    const nextEffectivePermissions = normalizePermissionList([
      ...nextInheritedPermissions,
      ...nextExtraPermissions,
    ]);
    const displayName = normalizeRequiredString(input.displayName, 'displayName');
    const status = normalizeUserStatus(input.status);

    await client.query(
      `
        UPDATE "framework_users"
        SET
          "displayName" = $2,
          "status" = $3,
          "roles" = $4::text[],
          "permissions" = $5::text[],
          "updatedBy" = $6,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = $1
          AND "deletedAt" IS NULL
      `,
      [userId, displayName, status, nextRoles, nextEffectivePermissions, auditActorId],
    );

    await recordAuditEvent(client, {
      category: 'rbac_management',
      action: 'update_user',
      result: 'success',
      targetType: 'framework_user',
      targetId: userId,
      metadata: {
        status,
        roles: nextRoles,
        inheritedPermissions: nextInheritedPermissions,
        extraPermissions: nextExtraPermissions,
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const refreshedView = await readAccessManagementView();
  const refreshedUser = refreshedView.users.find((user) => user.id === userId);

  if (!refreshedUser) {
    throw new Error(`Managed user not found after update: ${userId}`);
  }

  return refreshedUser;
}

export async function updateManagedUsersStatus(
  userIds: string[],
  status: FrameworkUserStatus,
): Promise<{
  updatedCount: number;
  userIds: string[];
  status: FrameworkUserStatus;
}> {
  assertDatabaseIsConfigured();
  const normalizedUserIds = normalizeBatchUserIds(userIds);
  const normalizedStatus = normalizeUserStatus(status);
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureManagedRolesSeeded(client);

    const existingUserRows = await readFrameworkUserInventoryRows(client);
    const existingUserIds = new Set(existingUserRows.map((row) => row.id));
    const missingUserId = normalizedUserIds.find((userId) => !existingUserIds.has(userId));

    if (missingUserId) {
      throw new Error(`Managed user not found: ${missingUserId}`);
    }

    await client.query(
      `
        UPDATE "framework_users"
        SET
          "status" = $2,
          "updatedBy" = $3,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ANY($1::text[])
          AND "deletedAt" IS NULL
      `,
      [normalizedUserIds, normalizedStatus, auditActorId],
    );

    await recordAuditEvent(client, {
      category: 'rbac_management',
      action: 'batch_update_user_status',
      result: 'success',
      targetType: 'framework_user_batch',
      targetId: normalizedStatus,
      metadata: {
        count: normalizedUserIds.length,
        status: normalizedStatus,
        userIds: normalizedUserIds,
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    updatedCount: normalizedUserIds.length,
    userIds: normalizedUserIds,
    status: normalizedStatus,
  };
}

export async function updateManagedUsersRoles(
  userIds: string[],
  roleId: string,
  operation: 'assign' | 'remove',
): Promise<{
  updatedCount: number;
  userIds: string[];
  roleId: string;
  operation: 'assign' | 'remove';
}> {
  assertDatabaseIsConfigured();
  const normalizedUserIds = normalizeBatchUserIds(userIds);
  const normalizedRoleId = normalizeRoleIdentifier(roleId);
  const normalizedOperation = normalizeRoleAssignmentOperation(operation);
  const pool = getDatabasePool();
  const client = await pool.connect();
  let updatedCount = 0;

  try {
    await client.query('BEGIN');
    await ensureManagedRolesSeeded(client);

    const previousRoleRows = await readManagedRoleRows(client);
    const previousUserRows = await readFrameworkUserInventoryRows(client);
    const previousCatalog = buildRoleCatalog(previousRoleRows, previousUserRows);
    const existingRole = previousCatalog.find((role) => role.id === normalizedRoleId);
    const existingUserIds = new Set(previousUserRows.map((row) => row.id));
    const missingUserId = normalizedUserIds.find((userId) => !existingUserIds.has(userId));

    if (!existingRole) {
      throw new Error(`Managed role not found: ${normalizedRoleId}`);
    }

    if (missingUserId) {
      throw new Error(`Managed user not found: ${missingUserId}`);
    }

    for (const row of previousUserRows.filter((user) => normalizedUserIds.includes(user.id))) {
      const currentRoles = normalizeRoleList(Array.isArray(row.roles) ? row.roles : []);
      const nextRoles =
        normalizedOperation === 'assign'
          ? normalizeRequestedRoleList([...currentRoles, normalizedRoleId], 'roles')
          : currentRoles.filter((currentRoleId) => currentRoleId !== normalizedRoleId);

      if (arraysEqual(currentRoles, nextRoles)) {
        continue;
      }

      const previousInheritedPermissions = collectPermissionsForRoles(
        currentRoles,
        previousCatalog,
      );
      const previousEffectivePermissions = normalizePermissionList(
        Array.isArray(row.permissions) ? row.permissions : [],
      );
      const extraPermissions = previousEffectivePermissions.filter(
        (permission) => !previousInheritedPermissions.includes(permission),
      );
      const nextInheritedPermissions = collectPermissionsForRoles(nextRoles, previousCatalog);
      const nextEffectivePermissions = normalizePermissionList([
        ...nextInheritedPermissions,
        ...extraPermissions,
      ]);

      await client.query(
        `
          UPDATE "framework_users"
          SET
            "roles" = $2::text[],
            "permissions" = $3::text[],
            "updatedBy" = $4,
            "version" = "version" + 1,
            "updatedAt" = NOW()
          WHERE "id" = $1
            AND "deletedAt" IS NULL
        `,
        [row.id, nextRoles, nextEffectivePermissions, auditActorId],
      );

      updatedCount += 1;
    }

    await recordAuditEvent(client, {
      category: 'rbac_management',
      action:
        normalizedOperation === 'assign' ? 'batch_assign_user_role' : 'batch_remove_user_role',
      result: 'success',
      targetType: 'managed_role',
      targetId: normalizedRoleId,
      metadata: {
        count: updatedCount,
        requestedUserCount: normalizedUserIds.length,
        roleId: normalizedRoleId,
        userIds: normalizedUserIds,
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    updatedCount,
    userIds: normalizedUserIds,
    roleId: normalizedRoleId,
    operation: normalizedOperation,
  };
}

export async function createManagedRole(input: ManagedRoleInput): Promise<AccessManagedRoleEntry> {
  return saveManagedRole(input.id, input, false);
}

export async function saveManagedRole(
  roleId: string,
  input: ManagedRoleInput,
  allowUpsert = true,
): Promise<AccessManagedRoleEntry> {
  assertDatabaseIsConfigured();
  const normalizedRoleId = normalizeRoleIdentifier(input.id || roleId);
  const name = normalizeRequiredString(input.name, 'name');
  const description = normalizeRequiredString(input.description, 'description');
  const permissions = normalizeManagedPermissionInput(input.permissions, 'permissions');
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureManagedRolesSeeded(client);

    const previousRoleRows = await readManagedRoleRows(client);
    const previousUserRows = await readFrameworkUserInventoryRows(client);
    const previousCatalog = buildRoleCatalog(previousRoleRows, previousUserRows);
    const existingRole = previousCatalog.find((role) => role.id === normalizedRoleId) ?? null;

    if (existingRole && !allowUpsert && !existingRole.imported) {
      throw new Error(`Managed role already exists: ${normalizedRoleId}`);
    }

    if (existingRole?.locked) {
      throw new Error(`Managed role is locked and cannot be modified: ${normalizedRoleId}`);
    }

    if (!existingRole || existingRole.imported) {
      await client.query(
        `
          INSERT INTO "msfront_managed_roles" (
            "id",
            "name",
            "description",
            "permissions",
            "locked",
            "createdBy",
            "updatedBy",
            "version",
            "createdAt",
            "updatedAt"
          ) VALUES (
            $1,
            $2,
            $3,
            $4::text[],
            $5,
            $6,
            $6,
            1,
            NOW(),
            NOW()
          )
          ON CONFLICT ("id") DO UPDATE
          SET
            "name" = EXCLUDED."name",
            "description" = EXCLUDED."description",
            "permissions" = EXCLUDED."permissions",
            "updatedBy" = EXCLUDED."updatedBy",
            "version" = "msfront_managed_roles"."version" + 1,
            "updatedAt" = NOW()
        `,
        [normalizedRoleId, name, description, permissions, existingRole?.locked ?? false, auditActorId],
      );
    } else {
      await client.query(
        `
          UPDATE "msfront_managed_roles"
          SET
            "name" = $2,
            "description" = $3,
            "permissions" = $4::text[],
            "updatedBy" = $5,
            "version" = "version" + 1,
            "updatedAt" = NOW()
          WHERE "id" = $1
        `,
        [normalizedRoleId, name, description, permissions, auditActorId],
      );
    }

    const nextRoleRows = await readManagedRoleRows(client);
    const nextCatalog = buildRoleCatalog(nextRoleRows, previousUserRows);
    await synchronizeUsersForRoleCatalog(client, previousCatalog, nextCatalog, [normalizedRoleId]);
    await recordAuditEvent(client, {
      category: 'rbac_management',
      action: existingRole ? 'update_role' : 'create_role',
      result: 'success',
      targetType: 'managed_role',
      targetId: normalizedRoleId,
      metadata: {
        name,
        permissions,
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const refreshedView = await readAccessManagementView();
  const refreshedRole = refreshedView.roles.find((role) => role.id === normalizedRoleId);

  if (!refreshedRole) {
    throw new Error(`Managed role not found after save: ${normalizedRoleId}`);
  }

  return refreshedRole;
}

export async function deleteManagedRole(roleId: string) {
  assertDatabaseIsConfigured();
  const normalizedRoleId = normalizeRoleIdentifier(roleId);
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureManagedRolesSeeded(client);

    const previousRoleRows = await readManagedRoleRows(client);
    const previousUserRows = await readFrameworkUserInventoryRows(client);
    const previousCatalog = buildRoleCatalog(previousRoleRows, previousUserRows);
    const existingRole = previousCatalog.find((role) => role.id === normalizedRoleId);

    if (!existingRole || existingRole.imported) {
      throw new Error(`Managed role not found: ${normalizedRoleId}`);
    }

    if (existingRole.locked) {
      throw new Error(`Managed role is locked and cannot be deleted: ${normalizedRoleId}`);
    }

    await client.query(
      `
        DELETE FROM "msfront_managed_roles"
        WHERE "id" = $1
      `,
      [normalizedRoleId],
    );

    const nextRoleRows = await readManagedRoleRows(client);
    const nextCatalog = buildRoleCatalog(nextRoleRows, previousUserRows);
    await synchronizeUsersForDeletedRole(client, previousCatalog, nextCatalog, normalizedRoleId);
    await recordAuditEvent(client, {
      category: 'rbac_management',
      action: 'delete_role',
      result: 'success',
      targetType: 'managed_role',
      targetId: normalizedRoleId,
      metadata: {
        name: existingRole.name,
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeManagedSession(sessionId: string) {
  assertDatabaseIsConfigured();
  const pool = getDatabasePool();
  const client = await pool.connect();
  let revokedSession: SessionRevokeRow | null = null;

  try {
    await client.query('BEGIN');
    const result = await client.query<SessionRevokeRow>(
      `
        UPDATE "auth_sessions"
        SET
          "revokedAt" = COALESCE("revokedAt", NOW()),
          "revokeReason" = COALESCE("revokeReason", 'msfront_admin_revoked'),
          "updatedBy" = $2,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = $1
        RETURNING "id", "userId", "revokedAt"
      `,
      [normalizeRequiredString(sessionId, 'sessionId'), auditActorId],
    );
    revokedSession = result.rows[0] ?? null;

    if (!revokedSession) {
      throw new Error(`Managed session not found: ${sessionId}`);
    }

    await recordAuditEvent(client, {
      category: 'security_management',
      action: 'revoke_session',
      result: 'success',
      targetType: 'auth_session',
      targetId: revokedSession.id,
      metadata: {
        userId: revokedSession.userId,
      },
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    revoked: true,
    sessionId: revokedSession.id,
    revokedAt: normalizeOptionalDateTime(revokedSession.revokedAt),
  };
}

export async function revokeManagedApiKey(apiKeyId: string) {
  assertDatabaseIsConfigured();
  const pool = getDatabasePool();
  const client = await pool.connect();
  let revokedApiKey: ApiKeyRevokeRow | null = null;

  try {
    await client.query('BEGIN');
    const result = await client.query<ApiKeyRevokeRow>(
      `
        UPDATE "framework_api_keys"
        SET
          "revokedAt" = COALESCE("revokedAt", NOW()),
          "revokeReason" = COALESCE("revokeReason", 'msfront_admin_revoked'),
          "updatedBy" = $2,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = $1
        RETURNING "id", "createdByUserId", "revokedAt"
      `,
      [normalizeRequiredString(apiKeyId, 'apiKeyId'), auditActorId],
    );
    revokedApiKey = result.rows[0] ?? null;

    if (!revokedApiKey) {
      throw new Error(`Managed API key not found: ${apiKeyId}`);
    }

    await recordAuditEvent(client, {
      category: 'security_management',
      action: 'revoke_api_key',
      result: 'success',
      targetType: 'api_key',
      targetId: revokedApiKey.id,
      metadata: {
        userId: revokedApiKey.createdByUserId,
      },
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    revoked: true,
    apiKeyId: revokedApiKey.id,
    revokedAt: normalizeOptionalDateTime(revokedApiKey.revokedAt),
  };
}

async function ensureManagedRolesSeeded(carrier: DatabaseQueryCarrier) {
  for (const role of MSFRONT_DEFAULT_ROLE_DEFINITIONS) {
    await carrier.query(
      `
        INSERT INTO "msfront_managed_roles" (
          "id",
          "name",
          "description",
          "permissions",
          "locked",
          "createdBy",
          "updatedBy",
          "version",
          "createdAt",
          "updatedAt"
        ) VALUES (
          $1,
          $2,
          $3,
          $4::text[],
          $5,
          $6,
          $6,
          1,
          NOW(),
          NOW()
        )
        ON CONFLICT ("id") DO NOTHING
      `,
      [role.id, role.name, role.description, normalizePermissionList(role.permissions), role.locked, auditActorId],
    );
  }
}

async function readManagedRoleRows(carrier: DatabaseQueryCarrier) {
  const result = await carrier.query<ManagedRoleRow>(
    `
      SELECT
        "id",
        "name",
        "description",
        "permissions",
        "locked",
        "createdAt",
        "updatedAt"
      FROM "msfront_managed_roles"
      ORDER BY "updatedAt" DESC, "createdAt" DESC
    `,
  );

  return result.rows;
}

async function readFrameworkUserInventoryRows(carrier: DatabaseQueryCarrier) {
  const result = await carrier.query<FrameworkUserInventoryRow>(
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
        COALESCE("session_stats"."lastSeenAt", "framework_users"."updatedAt") DESC,
        "framework_users"."displayName" ASC
    `,
  );

  return result.rows;
}

async function readFrameworkUserRowById(carrier: DatabaseQueryCarrier, userId: string) {
  const rows = await readFrameworkUserInventoryRows(carrier);
  return rows.find((row) => row.id === userId) ?? null;
}

function buildRoleCatalog(
  roleRows: ManagedRoleRow[],
  userRows: readonly FrameworkUserInventoryRow[],
): AccessManagedRoleDefinition[] {
  const managedRoles = roleRows.map<AccessManagedRoleDefinition>((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: normalizePermissionList(Array.isArray(row.permissions) ? row.permissions : []),
    locked: Boolean(row.locked),
    imported: false,
    createdAt: normalizeRequiredDateTime(row.createdAt),
    updatedAt: normalizeRequiredDateTime(row.updatedAt),
  }));
  const missingRoleIds = Array.from(
    new Set(
      userRows.flatMap((row) => (Array.isArray(row.roles) ? row.roles : []).filter(Boolean)),
    ),
  ).filter((roleId) => !managedRoles.some((role) => role.id === roleId));

  return [
    ...managedRoles,
    ...missingRoleIds.map<AccessManagedRoleDefinition>((roleId) => ({
      id: roleId,
      name: humanizeIdentifier(roleId),
      description:
        'Imported from an existing framework user assignment. Save the role in MSFront to manage its permission bundle.',
      permissions: [],
      locked: false,
      imported: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  ];
}

function ensureCatalogForRoleIds(
  roleCatalog: readonly AccessManagedRoleDefinition[],
  roleIds: readonly string[],
) {
  const roles = [...roleCatalog];

  for (const roleId of roleIds) {
    if (roles.some((role) => role.id === roleId)) {
      continue;
    }

    roles.push({
      id: roleId,
      name: humanizeIdentifier(roleId),
      description:
        'Imported from an existing framework user assignment. Save the role in MSFront to manage its permission bundle.',
      permissions: [],
      locked: false,
      imported: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return roles;
}

function mapAccessManagedUser(
  row: FrameworkUserInventoryRow,
  roleCatalog: readonly AccessManagedRoleDefinition[],
): AccessManagedUserEntry {
  const roles = normalizeRoleList(Array.isArray(row.roles) ? row.roles : []);
  const inheritedPermissions = collectPermissionsForRoles(roles, roleCatalog);
  const effectivePermissions = normalizePermissionList(
    Array.isArray(row.permissions) ? row.permissions : [],
  );
  const extraPermissions = effectivePermissions.filter(
    (permission) => !inheritedPermissions.includes(permission),
  );

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    status: normalizeUserStatus(row.status),
    roles,
    inheritedPermissions,
    extraPermissions,
    effectivePermissions: normalizePermissionList([
      ...inheritedPermissions,
      ...extraPermissions,
    ]),
    sessionCount: toNumber(row.sessionCount),
    apiKeyCount: toNumber(row.apiKeyCount),
    lastSeenAt: normalizeOptionalDateTime(row.lastSeenAt),
    updatedAt: normalizeRequiredDateTime(row.updatedAt),
  };
}

function summarizeManagedRole(
  role: AccessManagedRoleDefinition,
  users: readonly AccessManagedUserEntry[],
): AccessManagedRoleEntry {
  const members = users.filter((user) => user.roles.includes(role.id));

  return {
    ...role,
    memberCount: members.length,
    activeMemberCount: members.filter((user) => user.status === 'active').length,
    disabledMemberCount: members.filter((user) => user.status === 'disabled').length,
    permissionCount: role.permissions.length,
  };
}

function buildAccessManagementSummary(
  roles: readonly AccessManagedRoleEntry[],
  users: readonly AccessManagedUserEntry[],
): AccessManagementSummary {
  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status === 'active').length,
    disabledUsers: users.filter((user) => user.status === 'disabled').length,
    totalRoles: roles.length,
    customRoles: roles.filter((role) => !role.locked).length,
    usersWithCustomPermissions: users.filter((user) => user.extraPermissions.length > 0).length,
    totalRoleAssignments: users.reduce((total, user) => total + user.roles.length, 0),
    totalEffectivePermissions: users.reduce(
      (total, user) => total + user.effectivePermissions.length,
      0,
    ),
  };
}

function collectPermissionsForRoles(
  roleIds: readonly string[],
  roleCatalog: readonly AccessManagedRoleDefinition[],
) {
  const permissions = roleIds.flatMap(
    (roleId) => roleCatalog.find((role) => role.id === roleId)?.permissions ?? [],
  );

  return normalizePermissionList(permissions);
}

function collectSuggestedPermissions(
  roles: readonly AccessManagedRoleEntry[],
  users: readonly AccessManagedUserEntry[],
) {
  return normalizePermissionList([
    ...MSFRONT_SUPPORTED_PERMISSIONS,
    ...roles.flatMap((role) => role.permissions),
    ...users.flatMap((user) => user.effectivePermissions),
  ]);
}

async function synchronizeUsersForRoleCatalog(
  carrier: DatabaseQueryCarrier,
  previousCatalog: readonly AccessManagedRoleDefinition[],
  nextCatalog: readonly AccessManagedRoleDefinition[],
  targetRoleIds: readonly string[],
) {
  const targetRoleSet = new Set(targetRoleIds);
  const userRows = await readFrameworkUserInventoryRows(carrier);

  for (const row of userRows) {
    const currentRoles = normalizeRoleList(Array.isArray(row.roles) ? row.roles : []);

    if (!currentRoles.some((role) => targetRoleSet.has(role))) {
      continue;
    }

    const previousInheritedPermissions = collectPermissionsForRoles(currentRoles, previousCatalog);
    const previousEffectivePermissions = normalizePermissionList(
      Array.isArray(row.permissions) ? row.permissions : [],
    );
    const extraPermissions = previousEffectivePermissions.filter(
      (permission) => !previousInheritedPermissions.includes(permission),
    );
    const nextInheritedPermissions = collectPermissionsForRoles(currentRoles, nextCatalog);
    const nextEffectivePermissions = normalizePermissionList([
      ...nextInheritedPermissions,
      ...extraPermissions,
    ]);

    if (arraysEqual(previousEffectivePermissions, nextEffectivePermissions)) {
      continue;
    }

    await carrier.query(
      `
        UPDATE "framework_users"
        SET
          "permissions" = $2::text[],
          "updatedBy" = $3,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      [row.id, nextEffectivePermissions, auditActorId],
    );
  }
}

async function synchronizeUsersForDeletedRole(
  carrier: DatabaseQueryCarrier,
  previousCatalog: readonly AccessManagedRoleDefinition[],
  nextCatalog: readonly AccessManagedRoleDefinition[],
  deletedRoleId: string,
) {
  const userRows = await readFrameworkUserInventoryRows(carrier);

  for (const row of userRows) {
    const currentRoles = normalizeRoleList(Array.isArray(row.roles) ? row.roles : []);

    if (!currentRoles.includes(deletedRoleId)) {
      continue;
    }

    const nextRoles = currentRoles.filter((role) => role !== deletedRoleId);
    const previousInheritedPermissions = collectPermissionsForRoles(currentRoles, previousCatalog);
    const previousEffectivePermissions = normalizePermissionList(
      Array.isArray(row.permissions) ? row.permissions : [],
    );
    const extraPermissions = previousEffectivePermissions.filter(
      (permission) => !previousInheritedPermissions.includes(permission),
    );
    const nextInheritedPermissions = collectPermissionsForRoles(nextRoles, nextCatalog);
    const nextEffectivePermissions = normalizePermissionList([
      ...nextInheritedPermissions,
      ...extraPermissions,
    ]);

    await carrier.query(
      `
        UPDATE "framework_users"
        SET
          "roles" = $2::text[],
          "permissions" = $3::text[],
          "updatedBy" = $4,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      [row.id, nextRoles, nextEffectivePermissions, auditActorId],
    );
  }
}

async function recordAuditEvent(
  carrier: DatabaseQueryCarrier,
  input: {
    category: string;
    action: string;
    result: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await carrier.query(
    `
      INSERT INTO "audit_events" (
        "category",
        "action",
        "result",
        "actorType",
        "actorId",
        "actorDisplayName",
        "targetType",
        "targetId",
        "scope",
        "metadata",
        "createdAt"
      ) VALUES (
        $1,
        $2,
        $3,
        'system',
        $4,
        $5,
        $6,
        $7,
        'msfront',
        $8::jsonb,
        NOW()
      )
    `,
    [
      input.category,
      input.action,
      input.result,
      auditActorId,
      auditActorDisplayName,
      input.targetType,
      input.targetId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

function assertDatabaseIsConfigured() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'DATABASE_URL or MSFRONT_DATABASE_URL is required before using MSFront access management.',
    );
  }
}

function normalizeRoleList(input: readonly string[]) {
  return Array.from(
    new Set(
      input
        .map((item) => `${item}`.trim())
        .filter((item) => item.length > 0 && isValidRoleIdentifier(item)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeBatchUserIds(userIds: readonly string[]) {
  const normalizedUserIds = Array.from(
    new Set(
      userIds
        .map((userId) => normalizeRequiredString(userId, 'userIds'))
        .filter(Boolean),
    ),
  );

  if (normalizedUserIds.length === 0) {
    throw new Error('No managed users were selected for the batch update.');
  }

  return normalizedUserIds;
}

function normalizeRequestedRoleList(input: readonly string[], fieldName: string) {
  const rawRoles = Array.from(
    new Set(
      input
        .map((item) => `${item}`.trim())
        .filter(Boolean),
    ),
  );
  const invalidRole = rawRoles.find((item) => !isValidRoleIdentifier(item));

  if (invalidRole) {
    throw new Error(`Invalid role identifier in ${fieldName}: ${invalidRole}`);
  }

  return rawRoles.sort((left, right) => left.localeCompare(right));
}

function normalizeManagedPermissionInput(input: readonly string[], fieldName: string) {
  const rawPermissions = Array.from(
    new Set(
      input
        .map((item) => `${item}`.trim())
        .filter(Boolean),
    ),
  );
  const invalidPermission = rawPermissions.find(
    (permission) => !isValidPermissionIdentifier(permission),
  );

  if (invalidPermission) {
    throw new Error(`Invalid permission identifier in ${fieldName}: ${invalidPermission}`);
  }

  return normalizePermissionList(filterValidPermissionIdentifiers(rawPermissions));
}

function normalizeRoleIdentifier(value: string) {
  const normalized = `${value ?? ''}`.trim();

  if (!isValidRoleIdentifier(normalized)) {
    throw new Error(`Invalid role identifier: ${value}`);
  }

  return normalized;
}

function normalizeRequiredString(value: string, fieldName: string) {
  const normalized = `${value ?? ''}`.trim();

  if (!normalized) {
    throw new Error(`Missing required field: ${fieldName}`);
  }

  return normalized;
}

function normalizeUserStatus(value: string) {
  if (value === 'active' || value === 'disabled') {
    return value;
  }

  throw new Error(`Invalid user status: ${value}`);
}

function normalizeRoleAssignmentOperation(value: string) {
  if (value === 'assign' || value === 'remove') {
    return value;
  }

  throw new Error(`Invalid batch role operation: ${value}`);
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

function toNumber(value: unknown) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function humanizeIdentifier(value: string) {
  return `${value}`
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
