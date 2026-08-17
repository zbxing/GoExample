import 'server-only';
import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { resolveDatabasePoolOptions } from '@/lib/server/database-config';
import { workspaceRootPath } from '@/lib/server/runtime-paths';

let databasePool: Pool | null = null;
let workspaceEnvLoaded = false;

export function isDatabaseConfigured() {
  return Boolean(resolveDatabaseUrl());
}

export function resolveDatabaseUrl() {
  loadWorkspaceEnvironment();

  const msFrontDatabaseUrl = `${process.env.MSFRONT_DATABASE_URL ?? ''}`.trim();

  if (msFrontDatabaseUrl) {
    return msFrontDatabaseUrl;
  }

  const sharedDatabaseUrl = `${process.env.DATABASE_URL ?? ''}`.trim();
  return sharedDatabaseUrl || null;
}

export function getDatabasePool() {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required before using the MSFront database repository.');
  }

  if (!databasePool) {
    databasePool = new Pool({
      connectionString: databaseUrl,
      application_name: 'msfront',
      ...resolveDatabasePoolOptions(),
    });
    databasePool.on('error', (error) => {
      console.error('[msfront:database] unexpected idle client error', error.message);
    });
  }

  return databasePool;
}

function loadWorkspaceEnvironment() {
  if (workspaceEnvLoaded) {
    return;
  }

  workspaceEnvLoaded = true;

  for (const relativePath of ['config/.env.local', 'config/.env', '.env.local', '.env']) {
    loadDotEnv({
      path: path.join(/* turbopackIgnore: true */ workspaceRootPath, relativePath),
      override: false,
      quiet: true,
    });
  }
}
