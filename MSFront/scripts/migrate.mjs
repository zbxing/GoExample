import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { discoverMigrations } from './migration-lib.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontRoot = path.resolve(scriptDirectory, '..');
const workspaceRoot = path.resolve(frontRoot, '..');
const migrationsDirectory = path.join(frontRoot, 'database', 'migrations');
const advisoryLockId = '583849286194671203';

const argumentsSet = new Set(process.argv.slice(2));
const allowedArguments = new Set(['--dry-run', '--status']);

for (const argument of argumentsSet) {
  if (!allowedArguments.has(argument)) {
    throw new Error(`Unknown migration argument: ${argument}`);
  }
}

if (argumentsSet.has('--dry-run') && argumentsSet.has('--status')) {
  throw new Error('--dry-run and --status cannot be used together.');
}

loadWorkspaceEnvironment();
const migrations = await discoverMigrations(migrationsDirectory);

if (argumentsSet.has('--dry-run')) {
  for (const migration of migrations) {
    console.log(`${migration.version} ${migration.checksum}`);
  }
  process.exit(0);
}

const databaseUrl = `${process.env.MSFRONT_DATABASE_URL ?? process.env.DATABASE_URL ?? ''}`.trim();

if (!databaseUrl) {
  throw new Error('MSFRONT_DATABASE_URL or DATABASE_URL is required to run migrations.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: 'msfront-migrator',
});
const client = await pool.connect();

try {
  await client.query('SELECT pg_advisory_lock($1::bigint)', [advisoryLockId]);
  await ensureMigrationTable(client);
  const appliedResult = await client.query(
    'SELECT "version", "checksum", "appliedAt" FROM "msfront_schema_migrations" ORDER BY "version"',
  );
  const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));

  if (argumentsSet.has('--status')) {
    for (const migration of migrations) {
      const record = applied.get(migration.version);
      const status = !record
        ? 'pending'
        : record.checksum === migration.checksum
          ? 'applied'
          : 'checksum-mismatch';
      console.log(`${migration.version} ${status}`);
    }
    process.exitCode = [...applied.keys()].some(
      (version) => !migrations.some((migration) => migration.version === version),
    )
      ? 1
      : 0;
  } else {
    for (const migration of migrations) {
      const record = applied.get(migration.version);

      if (record) {
        if (record.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.version} checksum differs from the applied database record.`,
          );
        }
        console.log(`${migration.version} already applied`);
        continue;
      }

      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `
            INSERT INTO "msfront_schema_migrations" (
              "version", "checksum", "executionMs", "appliedAt"
            ) VALUES ($1, $2, $3, NOW())
          `,
          [migration.version, migration.checksum, Date.now() - startedAt],
        );
        await client.query('COMMIT');
        console.log(`${migration.version} applied`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  }
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [advisoryLockId]);
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "msfront_schema_migrations" (
      "version" TEXT PRIMARY KEY,
      "checksum" CHAR(64) NOT NULL,
      "executionMs" INTEGER NOT NULL CHECK ("executionMs" >= 0),
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadWorkspaceEnvironment() {
  for (const relativePath of ['config/.env.local', 'config/.env', '.env.local', '.env']) {
    loadDotEnv({
      path: path.join(workspaceRoot, relativePath),
      override: false,
      quiet: true,
    });
  }

  for (const relativePath of ['.env.local', '.env']) {
    loadDotEnv({
      path: path.join(frontRoot, relativePath),
      override: false,
      quiet: true,
    });
  }
}
