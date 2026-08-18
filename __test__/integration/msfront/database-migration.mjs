import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..', '..');
const migrationScript = path.join(repositoryRoot, 'MSFront', 'scripts', 'migrate.mjs');
const requireFromMSFront = createRequire(path.join(repositoryRoot, 'MSFront', 'package.json'));
const pg = requireFromMSFront('pg');
const databaseUrl = `${process.env.MSFRONT_DATABASE_URL ?? process.env.DATABASE_URL ?? ''}`.trim();

if (!databaseUrl) {
  console.log('[database-integration] skipped: MSFRONT_DATABASE_URL/DATABASE_URL is not set');
  process.exit(0);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
  application_name: 'msfront-database-integration',
});

try {
  await waitForDatabase(pool);
  const concurrentRuns = await Promise.all([runMigration(), runMigration()]);
  assert.match(
    concurrentRuns.map((result) => result.stdout).join('\n'),
    /0001_initial applied/,
  );
  const repeatedRun = await runMigration();
  assert.match(repeatedRun.stdout, /0001_initial already applied/);
  const statusRun = await runMigration(['--status']);
  assert.match(statusRun.stdout, /0001_initial applied/);

  const tables = await pool.query(`
    SELECT "table_name"
    FROM information_schema.tables
    WHERE "table_schema" = 'public'
      AND "table_name" = ANY($1::text[])
    ORDER BY "table_name"
  `, [[
    'msfront_schema_migrations',
    'managed_projects',
    'framework_users',
    'msfront_managed_roles',
    'auth_sessions',
    'framework_api_keys',
    'audit_events',
  ]]);
  assert.deepEqual(tables.rows.map((row) => row.table_name), [
    'audit_events',
    'auth_sessions',
    'framework_api_keys',
    'framework_users',
    'managed_projects',
    'msfront_managed_roles',
    'msfront_schema_migrations',
  ]);

  const migrationHistory = await pool.query(
    'SELECT COUNT(*)::int AS count FROM "msfront_schema_migrations"',
  );
  assert.equal(migrationHistory.rows[0].count, 1);

  const indexes = await pool.query(
    `SELECT "indexname" FROM pg_indexes WHERE "tablename" = 'managed_projects'`,
  );
  assert.ok(indexes.rows.some((row) => row.indexname === 'managed_projects_code_lower_key'));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO "managed_projects" (
        "id", "name", "code", "owner", "environment", "status", "region",
        "baseUrl", "apiBaseUrl", "versionLabel", "lastDeployedAt", "createdBy", "updatedBy"
      ) VALUES ('migration-integration-1', 'Integration', 'INTEGRATION', 'CI', 'development', 'healthy', 'ci',
        'http://localhost:3001', 'http://localhost:3001/api', 'test', NOW(), 'ci', 'ci')
    `);
    await assert.rejects(
      client.query(`
        INSERT INTO "managed_projects" (
          "id", "name", "code", "owner", "environment", "status", "region",
          "baseUrl", "apiBaseUrl", "versionLabel", "lastDeployedAt", "createdBy", "updatedBy"
        ) VALUES ('migration-integration-2', 'Integration duplicate', 'integration', 'CI', 'development', 'healthy', 'ci',
          'http://localhost:3001', 'http://localhost:3001/api', 'test', NOW(), 'ci', 'ci')
      `),
      (error) => error?.code === '23505',
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

async function runMigration(args = []) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [migrationScript, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

async function waitForDatabase(databasePool) {
  let lastError;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await databasePool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError ?? new Error('PostgreSQL did not become ready.');
}
