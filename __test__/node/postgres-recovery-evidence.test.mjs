import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildPostgresRecoveryChecksums,
  buildPostgresRecoveryEvidenceReport,
  postgresRecoveryEvidenceSchemaVersion,
  postgresRecoveryGoTests,
  verifyPostgresRecoveryEvidence,
} from '../../scripts/lib/postgres-recovery-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'postgres-recovery-evidence-tests');
const image = 'postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5';
const snapshotDigest = '1'.repeat(64);
const liveDigest = '2'.repeat(64);
const hostPort = 35432;

function repositoryPath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function environment() {
  return [
    'contract=postgres-logical-backup-restore',
    'platform=linux',
    'architecture=x64',
    `node=${process.version}`,
    'go=go version go1.25.13 linux/amd64',
    'docker=28.3.2',
    'postgres=16.10 (Debian 16.10-1.pgdg13+1)',
    `git_commit=${'a'.repeat(40)}`,
    `image=${image}`,
    `host_port=${hostPort}`,
    'topology=single-node-disposable-container',
    'backup=logical-custom-format',
    'target_postgres_recovery=not_recorded',
    'pitr=not_tested',
    'rpo_rto=not_approved',
    '',
  ].join('\n');
}

function contractOutput(error = null) {
  return [
    'image pull: Digest: sha256:' + 'f'.repeat(64),
    `container started: ${'b'.repeat(64)}`,
    'database ready after 2 attempt(s)',
    ...(error ? [`failure: ${error}`] : []),
    '',
  ].join('\n');
}

function goTestOutput(passedTests = postgresRecoveryGoTests, status = 'passed') {
  return [
    ...passedTests.flatMap((name) => [
      `=== RUN   ${name}`,
      `--- PASS: ${name} (0.10s)`,
    ]),
    status === 'passed' ? 'PASS' : 'FAIL',
    status === 'passed'
      ? 'ok  github.com/zbxing/goexample/Framework/sqlclient  1.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/sqlclient  1.000s',
    '',
  ].join('\n');
}

function rawRecovery(backup) {
  return {
    schemaVersion: 1,
    scope: 'linux_docker_logical_backup_restore',
    image,
    databaseVersion: '16.10 (Debian 16.10-1.pgdg13+1)',
    startedAt: '2026-08-27T00:00:05.000Z',
    completedAt: '2026-08-27T00:00:15.000Z',
    durationMs: 10_000,
    recoveryPointLSN: '0/16B6C50',
    sourceAtBackup: { rows: 1_000, digest: snapshotDigest },
    sourceAfterBackup: { rows: 1_001, digest: liveDigest },
    restored: { rows: 1_000, digest: snapshotDigest },
    backup: {
      bytes: backup.length,
      sha256: createHash('sha256').update(backup).digest('hex'),
    },
  };
}

function recoveryReport(evidenceRoot, raw) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-27T00:00:16.000Z',
    scope: raw.scope,
    status: 'passed',
    source: {
      input: repositoryPath(path.join(evidenceRoot, 'recovery-raw.json')),
      backup: repositoryPath(path.join(evidenceRoot, 'backup.dump')),
    },
    image: raw.image,
    databaseVersion: raw.databaseVersion,
    durationMs: raw.durationMs,
    recoveryPointLSN: raw.recoveryPointLSN,
    sourceAtBackup: raw.sourceAtBackup,
    sourceAfterBackup: raw.sourceAfterBackup,
    restored: raw.restored,
    backup: raw.backup,
    assertions: { restoredMatchesCheckpoint: true, postCheckpointWriteExcluded: true },
    limitations: [
      'the contract uses a disposable single-node PostgreSQL container and a logical custom-format archive',
      'the contract does not establish physical backup, WAL archiving, PITR, replication, failover, or target data-volume behavior',
      'target RPO, RTO, alert delivery, operator response, and signed provenance remain unrecorded',
    ],
  };
}

async function writeOuterReport(
  evidenceRoot,
  { testExitCode = 0, recoveryExitCode = 0, error = null } = {},
) {
  const report = buildPostgresRecoveryEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    nodeVersion: process.version,
    platform: 'linux',
    architecture: 'x64',
    goVersion: 'go version go1.25.13 linux/amd64',
    dockerVersion: '28.3.2',
    postgresVersion: '16.10 (Debian 16.10-1.pgdg13+1)',
    gitCommit: 'a'.repeat(40),
    hostPort,
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:20.000Z',
    testExitCode,
    recoveryExitCode,
    error,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildPostgresRecoveryChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const backup = Buffer.alloc(4096, 0x5a);
  const raw = rawRecovery(backup);
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'contract-output.txt'), contractOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goTestOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(
    path.join(evidenceRoot, 'recovery-output.txt'),
    'PostgreSQL recovery report written to .temp/workflow-artifacts/postgres-recovery-contract/recovery-report.json\n',
    'utf8',
  );
  await writeFile(path.join(evidenceRoot, 'recovery-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'container.log'), 'bounded PostgreSQL log\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'recovery-raw.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(evidenceRoot, 'recovery-report.json'),
    `${JSON.stringify(recoveryReport(evidenceRoot, raw), null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(evidenceRoot, 'backup.dump'), backup);
  const { report, reportPath } = await writeOuterReport(evidenceRoot);
  return { evidenceRoot, raw, report, reportPath };
}

test('PostgreSQL recovery evidence binds Go contracts, exact restore semantics, and local-only limitations', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const verified = verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.schemaVersion, postgresRecoveryEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.goTests.passed, postgresRecoveryGoTests);
  assert.equal(verified.artifactPaths.length, 12);
  assert.match(verified.report.limitations.join('\n'), /postgresRecovery remains not_recorded/);
});

test('failed PostgreSQL recovery evidence accepts only ordered successful Go-test subsets and bounded errors', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const error = 'bounded PostgreSQL Go contract failure';
  const passed = postgresRecoveryGoTests.slice(0, 2);
  await writeFile(path.join(evidenceRoot, 'contract-output.txt'), contractOutput(error), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goTestOutput(passed, 'failed'), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  await writeOuterReport(evidenceRoot, { testExitCode: 1, error });
  const verified = verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.deepEqual(verified.report.goTests.passed, passed);

  await writeFile(
    path.join(evidenceRoot, 'test-output.txt'),
    goTestOutput([postgresRecoveryGoTests[1], postgresRecoveryGoTests[0]], 'failed'),
    'utf8',
  );
  await writeOuterReport(evidenceRoot, { testExitCode: 1, error });
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /goTests\.passed must preserve the fixed PostgreSQL contract order/,
  );

  const recoveryError = 'logical backup/restore failed before the raw report was complete';
  await writeFile(path.join(evidenceRoot, 'contract-output.txt'), contractOutput(recoveryError), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goTestOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'recovery-output.txt'), `${recoveryError}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'recovery-status.txt'), 'exit_code=1\n', 'utf8');
  for (const name of ['recovery-raw.json', 'recovery-report.json', 'backup.dump']) {
    await rm(path.join(evidenceRoot, name), { force: true });
  }
  await writeOuterReport(evidenceRoot, { recoveryExitCode: 1, error: recoveryError });
  const incomplete = verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(incomplete.report.status, 'failed');
  assert.equal(incomplete.report.outputs.recoveryRaw, null);
  assert.equal(incomplete.artifactPaths.length, 9);
});

test('PostgreSQL recovery evidence rejects scope, status, raw/report semantics, and checksum tampering', async (t) => {
  const { evidenceRoot, raw, report, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(report);
  scopeTamper.scope.integrationTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(report);
  statusTamper.execution.testExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /status and execution\.error|status must match/,
  );

  const rawTamper = structuredClone(raw);
  rawTamper.sourceAfterBackup.digest = '3'.repeat(64);
  await writeFile(path.join(evidenceRoot, 'recovery-raw.json'), `${JSON.stringify(rawTamper, null, 2)}\n`, 'utf8');
  await writeOuterReport(evidenceRoot);
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /recovery report no longer matches/,
  );

  await writeFile(path.join(evidenceRoot, 'recovery-raw.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  const semanticReport = recoveryReport(evidenceRoot, raw);
  semanticReport.assertions.postCheckpointWriteExcluded = false;
  await writeFile(path.join(evidenceRoot, 'recovery-report.json'), `${JSON.stringify(semanticReport, null, 2)}\n`, 'utf8');
  await writeOuterReport(evidenceRoot);
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /recovery report no longer matches/,
  );

  await writeFile(
    path.join(evidenceRoot, 'recovery-report.json'),
    `${JSON.stringify(recoveryReport(evidenceRoot, raw), null, 2)}\n`,
    'utf8',
  );
  await writeOuterReport(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
