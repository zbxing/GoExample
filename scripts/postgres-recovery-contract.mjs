import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPostgresRecoveryChecksums,
  buildPostgresRecoveryEvidenceReport,
} from './lib/postgres-recovery-evidence.mjs';
import {
  contractCommandMaximumOutputBytes,
  createContractCommandRunner,
} from './lib/contract-command.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const image = 'postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5';
const artifactDirectory = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'postgres-recovery-contract');
const runID = randomUUID();
const containerName = `goexample-postgres-recovery-${runID}`;
const databaseUser = 'postgres';
const databasePassword = `recovery-${randomUUID()}`;
const integrationDatabase = 'goexample_ci';
const sourceDatabase = 'goexample_recovery_source';
const restoredDatabase = 'goexample_recovery_restored';
const backupContainerPath = `/tmp/goexample-recovery-${runID}.dump`;
const backupHostPath = path.join(artifactDirectory, 'backup.dump');
const rawRecoveryPath = path.join(artifactDirectory, 'recovery-raw.json');
const recoveryReportPath = path.join(artifactDirectory, 'recovery-report.json');
const contract = {
  schemaVersion: 1,
  scope: 'linux_docker_logical_backup_restore',
  image,
  snapshotRows: 1_000,
  postCheckpointWrites: 1,
  maximumDurationMs: 120_000,
  backupFormat: 'pg_dump custom',
  restoreMode: 'pg_restore single transaction',
};
const startedAt = new Date().toISOString();

function fail(message) {
  console.error(`PostgreSQL recovery contract: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
  console.log(JSON.stringify(contract, null, 2));
  process.exit(0);
}
if (args.length > 0) {
  fail(`unknown argument: ${args[0]}`);
}

const runContractCommand = createContractCommandRunner({ cwd: repositoryRoot });

function run(command, commandArgs, options = {}) {
  return runContractCommand(command, commandArgs, {
    ...options,
    maxOutputBytes: options.maxOutputBytes ?? contractCommandMaximumOutputBytes,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function dockerExec(commandArgs, options = {}) {
  return run('docker', [
    'exec', '--env', `PGPASSWORD=${databasePassword}`, containerName,
    ...commandArgs,
  ], options);
}

async function psql(database, statement) {
  const result = await dockerExec([
    'psql', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=terse',
    '--username', databaseUser, '--dbname', database, '--tuples-only', '--no-align',
    '--command', statement,
  ]);
  return result.stdout.trim();
}

async function checkpoint(database) {
  const rows = await psql(database, [
    "SELECT id::text || E'\\t' || payload || E'\\t' ||",
    "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')",
    'FROM recovery_items ORDER BY id;',
  ].join(' '));
  const canonical = rows ? `${rows}\n` : '';
  return {
    rows: rows ? rows.split(/\r?\n/).length : 0,
    digest: createHash('sha256').update(canonical).digest('hex'),
  };
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function archive(environment, contractOutput, testOutput, testStatus, recoveryOutput, recoveryStatus, failures) {
  await mkdir(artifactDirectory, { recursive: true });
  let containerLog = '';
  if (containerStarted) {
    const logs = await run('docker', ['logs', containerName], { allowFailure: true, timeoutMs: 30_000 });
    containerLog = `${logs.stdout}${logs.stderr}`;
  }
  await writeFile(path.join(artifactDirectory, 'environment.txt'), environment, 'utf8');
  await writeFile(path.join(artifactDirectory, 'contract-output.txt'), `${contractOutput.join('\n')}\n`, 'utf8');
  await writeFile(path.join(artifactDirectory, 'test-output.txt'), testOutput, 'utf8');
  await writeFile(path.join(artifactDirectory, 'test-status.txt'), `exit_code=${testStatus}\n`, 'utf8');
  await writeFile(path.join(artifactDirectory, 'recovery-output.txt'), recoveryOutput, 'utf8');
  await writeFile(path.join(artifactDirectory, 'recovery-status.txt'), `exit_code=${recoveryStatus}\n`, 'utf8');
  await writeFile(path.join(artifactDirectory, 'container.log'), containerLog, 'utf8');

  const report = buildPostgresRecoveryEvidenceReport({
    repositoryRoot,
    evidenceRoot: artifactDirectory,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    goVersion,
    dockerVersion,
    postgresVersion: databaseVersion,
    gitCommit,
    hostPort,
    startedAt,
    endedAt: new Date().toISOString(),
    testExitCode: testStatus,
    recoveryExitCode: recoveryStatus,
    error: failures.length === 0 ? null : failures.join('\n'),
  });
  await writeFile(path.join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(artifactDirectory, 'SHA256SUMS'),
    buildPostgresRecoveryChecksums(artifactDirectory),
    'utf8',
  );
}

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(artifactDirectory, { recursive: true });
let containerStarted = false;
let hostPort = null;
let gitCommit = 'unavailable';
let goVersion = 'unavailable';
let dockerVersion = 'unavailable';
let databaseVersion = 'unavailable';
let testOutput = '';
let testStatus = 1;
let recoveryOutput = '';
let recoveryStatus = 1;
const contractOutput = [];
const failures = [];

try {
  if (process.platform !== 'linux') {
    throw new Error('the PostgreSQL recovery contract requires a Linux Docker host');
  }
  const [git, go, docker] = await Promise.all([
    run('git', ['rev-parse', 'HEAD']),
    run('go', ['version']),
    run('docker', ['version', '--format', '{{.Server.Version}}']),
  ]);
  gitCommit = git.stdout.trim();
  goVersion = go.stdout.trim();
  dockerVersion = docker.stdout.trim();
  const pull = await run('docker', ['pull', image], { timeoutMs: 120_000 });
  contractOutput.push(`image pull: ${pull.stdout.trim().split(/\r?\n/).at(-1)}`);

  hostPort = await reservePort();
  const started = await run('docker', [
    'run', '--detach', '--name', containerName,
    '--publish', `127.0.0.1:${hostPort}:5432`,
    '--shm-size', '128m', '--memory', '1g', '--cpus', '2',
    '--env', `POSTGRES_USER=${databaseUser}`,
    '--env', `POSTGRES_PASSWORD=${databasePassword}`,
    '--env', `POSTGRES_DB=${integrationDatabase}`,
    image,
  ]);
  containerStarted = true;
  contractOutput.push(`container started: ${started.stdout.trim()}`);
  let ready = false;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const probe = await dockerExec([
      'pg_isready', '--username', databaseUser, '--dbname', integrationDatabase,
    ], { allowFailure: true, timeoutMs: 5_000 });
    if (probe.status === 0) {
      contractOutput.push(`database ready after ${attempt} attempt(s)`);
      ready = true;
      break;
    }
    await delay(250);
  }
  if (!ready) {
    throw new Error('PostgreSQL did not become ready within 15 seconds');
  }
  databaseVersion = await psql(integrationDatabase, 'SHOW server_version;');

  const integration = await run('go', [
    '-C', 'Framework', 'test', '-v', '-count=1', '-timeout=2m',
    '-run', '^TestRealPostgres', './sqlclient',
  ], {
    allowFailure: true,
    timeoutMs: 150_000,
    env: {
      ...process.env,
      POSTGRES_TEST_URL:
        `postgres://${databaseUser}:${encodeURIComponent(databasePassword)}@127.0.0.1:${hostPort}/${integrationDatabase}?sslmode=disable`,
    },
  });
  testOutput = `${integration.stdout}${integration.stderr}`;
  testStatus = integration.status;
  if (testStatus !== 0) {
    failures.push(`real PostgreSQL Go contracts exited with code ${testStatus}`);
  }

  const recoveryStartedAt = new Date();
  const recoveryStarted = performance.now();
  try {
    await psql(integrationDatabase, `CREATE DATABASE ${sourceDatabase};`);
    await psql(integrationDatabase, `CREATE DATABASE ${restoredDatabase};`);
    await psql(sourceDatabase, [
      'CREATE TABLE recovery_items (',
      'id bigint PRIMARY KEY,',
      'payload text NOT NULL,',
      'created_at timestamptz NOT NULL',
      ');',
      'INSERT INTO recovery_items (id, payload, created_at)',
      "SELECT value, md5(value::text), TIMESTAMPTZ '2026-01-01 00:00:00+00' + value * INTERVAL '1 second'",
      'FROM generate_series(1, 1000) AS value;',
    ].join(' '));
    const sourceAtBackup = await checkpoint(sourceDatabase);
    const recoveryPointLSN = await psql(sourceDatabase, 'SELECT pg_current_wal_lsn();');

    await dockerExec([
      'pg_dump', '--format=custom', '--compress=9', '--no-owner', '--no-privileges',
      '--username', databaseUser, '--dbname', sourceDatabase, '--file', backupContainerPath,
    ], { timeoutMs: 60_000 });
    await run('docker', ['cp', `${containerName}:${backupContainerPath}`, backupHostPath], {
      timeoutMs: 30_000,
    });
    await psql(sourceDatabase, [
      'INSERT INTO recovery_items (id, payload, created_at)',
      "VALUES (1001, md5('1001'), TIMESTAMPTZ '2026-01-01 00:16:41+00');",
    ].join(' '));
    const sourceAfterBackup = await checkpoint(sourceDatabase);

    await dockerExec([
      'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
      '--username', databaseUser, '--dbname', restoredDatabase, backupContainerPath,
    ], { timeoutMs: 60_000 });
    const restored = await checkpoint(restoredDatabase);
    const completedAt = new Date();
    const backupStats = await stat(backupHostPath);
    const raw = {
      schemaVersion: 1,
      scope: contract.scope,
      image,
      databaseVersion,
      startedAt: recoveryStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(1, Math.round(performance.now() - recoveryStarted)),
      recoveryPointLSN,
      sourceAtBackup,
      sourceAfterBackup,
      restored,
      backup: {
        bytes: backupStats.size,
        sha256: await sha256File(backupHostPath),
      },
    };
    await writeFile(rawRecoveryPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    const report = await run(process.execPath, [
      path.join('scripts', 'postgres-recovery-report.mjs'),
      '--input', path.relative(repositoryRoot, rawRecoveryPath),
      '--backup', path.relative(repositoryRoot, backupHostPath),
      '--output', path.relative(repositoryRoot, recoveryReportPath),
    ], { allowFailure: true, timeoutMs: 30_000 });
    recoveryOutput = `${report.stdout}${report.stderr}`;
    recoveryStatus = report.status;
    if (recoveryStatus !== 0) {
      failures.push(`PostgreSQL recovery report exited with code ${recoveryStatus}`);
    }
  } catch (error) {
    recoveryOutput += `${error.message}\n${error.result?.stdout ?? ''}${error.result?.stderr ?? ''}`;
    failures.push(`logical backup/restore failed: ${error.message}`);
  }
} catch (error) {
  failures.push(error.message);
  contractOutput.push(`setup failure: ${error.message}`);
} finally {
  const environment = [
    'contract=postgres-logical-backup-restore',
    `platform=${process.platform}`,
    `architecture=${process.arch}`,
    `node=${process.version}`,
    `go=${goVersion}`,
    `docker=${dockerVersion}`,
    `postgres=${databaseVersion}`,
    `git_commit=${gitCommit}`,
    `image=${image}`,
    `host_port=${hostPort ?? 'unavailable'}`,
    'topology=single-node-disposable-container',
    'backup=logical-custom-format',
    'target_postgres_recovery=not_recorded',
    'pitr=not_tested',
    'rpo_rto=not_approved',
    '',
  ].join('\n');
  if (failures.length > 0) {
    contractOutput.push(...failures.map((failure) => `failure: ${failure}`));
  }
  try {
    await archive(
      environment,
      contractOutput,
      testOutput,
      testStatus,
      recoveryOutput,
      recoveryStatus,
      failures,
    );
  } finally {
    if (containerStarted) {
      await run('docker', ['rm', '--force', containerName], { allowFailure: true, timeoutMs: 30_000 });
    }
  }
}

if (failures.length > 0 || testStatus !== 0 || recoveryStatus !== 0) {
  console.error(failures.join('\n') || 'PostgreSQL recovery contract failed');
  process.exit(1);
}
console.log(`PostgreSQL recovery contract passed; evidence: ${path.relative(repositoryRoot, artifactDirectory)}`);
