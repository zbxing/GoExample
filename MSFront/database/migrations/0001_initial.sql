CREATE TABLE "managed_projects" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL CHECK (CHAR_LENGTH("name") BETWEEN 1 AND 160),
  "code" TEXT NOT NULL CHECK (CHAR_LENGTH("code") BETWEEN 1 AND 80),
  "description" TEXT NOT NULL DEFAULT '',
  "owner" TEXT NOT NULL CHECK (CHAR_LENGTH("owner") BETWEEN 1 AND 160),
  "environment" TEXT NOT NULL CHECK ("environment" IN ('production', 'staging', 'development')),
  "status" TEXT NOT NULL CHECK ("status" IN ('healthy', 'warning', 'critical')),
  "region" TEXT NOT NULL CHECK (CHAR_LENGTH("region") BETWEEN 1 AND 120),
  "baseUrl" TEXT NOT NULL,
  "apiBaseUrl" TEXT NOT NULL,
  "probeBaseUrl" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "versionLabel" TEXT NOT NULL,
  "lastDeployedAt" TIMESTAMPTZ NOT NULL,
  "activeUsers" INTEGER NOT NULL DEFAULT 0 CHECK ("activeUsers" >= 0),
  "requestPerMinute" INTEGER NOT NULL DEFAULT 0 CHECK ("requestPerMinute" >= 0),
  "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("errorRate" BETWEEN 0 AND 100),
  "servers" JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (JSONB_TYPEOF("servers") = 'array'),
  "services" JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (JSONB_TYPEOF("services") = 'array'),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "managed_projects_code_lower_key"
  ON "managed_projects" (LOWER("code"));
CREATE INDEX "managed_projects_environment_status_idx"
  ON "managed_projects" ("environment", "status");
CREATE INDEX "managed_projects_updated_at_idx"
  ON "managed_projects" ("updatedAt" DESC);

CREATE TABLE "framework_users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL CHECK (CHAR_LENGTH("username") BETWEEN 1 AND 128),
  "displayName" TEXT NOT NULL CHECK (CHAR_LENGTH("displayName") BETWEEN 1 AND 160),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled')),
  "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT NOT NULL DEFAULT 'system',
  "updatedBy" TEXT NOT NULL DEFAULT 'system',
  "version" BIGINT NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "framework_users_username_lower_key"
  ON "framework_users" (LOWER("username"))
  WHERE "deletedAt" IS NULL;
CREATE INDEX "framework_users_status_idx"
  ON "framework_users" ("status")
  WHERE "deletedAt" IS NULL;

CREATE TABLE "msfront_managed_roles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL CHECK (CHAR_LENGTH("name") BETWEEN 1 AND 160),
  "description" TEXT NOT NULL DEFAULT '',
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "locked" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "auth_sessions" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "framework_users" ("id") ON DELETE CASCADE,
  "tokenHash" TEXT,
  "authProvider" TEXT,
  "tenantId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "lastUsedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "revokeReason" TEXT,
  "updatedBy" TEXT NOT NULL DEFAULT 'system',
  "version" BIGINT NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key"
  ON "auth_sessions" ("tokenHash")
  WHERE "tokenHash" IS NOT NULL;
CREATE INDEX "auth_sessions_user_activity_idx"
  ON "auth_sessions" ("userId", "lastUsedAt" DESC NULLS LAST, "createdAt" DESC);
CREATE INDEX "auth_sessions_active_expiry_idx"
  ON "auth_sessions" ("expiresAt")
  WHERE "revokedAt" IS NULL;

CREATE TABLE "framework_api_keys" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL CHECK (CHAR_LENGTH("name") BETWEEN 1 AND 160),
  "keyPrefix" TEXT NOT NULL CHECK (CHAR_LENGTH("keyPrefix") BETWEEN 1 AND 32),
  "keyHash" TEXT,
  "createdByUserId" TEXT NOT NULL REFERENCES "framework_users" ("id") ON DELETE CASCADE,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ,
  "lastUsedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "revokeReason" TEXT,
  "updatedBy" TEXT NOT NULL DEFAULT 'system',
  "version" BIGINT NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "framework_api_keys_key_hash_key"
  ON "framework_api_keys" ("keyHash")
  WHERE "keyHash" IS NOT NULL;
CREATE INDEX "framework_api_keys_owner_activity_idx"
  ON "framework_api_keys" ("createdByUserId", "lastUsedAt" DESC NULLS LAST, "createdAt" DESC);
CREATE INDEX "framework_api_keys_active_expiry_idx"
  ON "framework_api_keys" ("expiresAt")
  WHERE "revokedAt" IS NULL;

CREATE TABLE "audit_events" (
  "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "category" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "actorType" TEXT,
  "actorId" TEXT,
  "actorUserId" TEXT,
  "actorUsername" TEXT,
  "actorDisplayName" TEXT,
  "targetType" TEXT,
  "targetId" TEXT,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "resourceId" TEXT,
  "scope" TEXT,
  "clientIp" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF("metadata") = 'object'),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "audit_events_created_at_idx" ON "audit_events" ("createdAt" DESC);
CREATE INDEX "audit_events_category_created_at_idx"
  ON "audit_events" ("category", "createdAt" DESC);
CREATE INDEX "audit_events_actor_id_created_at_idx"
  ON "audit_events" ("actorId", "createdAt" DESC)
  WHERE "actorId" IS NOT NULL;
