import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'postgres-recovery-contract');
const fixtureRoot = path.join(evidenceRoot, '.test-fixtures');
const scriptPath = path.join(repositoryRoot, 'scripts', 'postgres-recovery-report.mjs');
const snapshotDigest = '1'.repeat(64);
const liveDigest = '2'.repeat(64);

function run(input, backup, output) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--input', path.relative(repositoryRoot, input),
    '--backup', path.relative(repositoryRoot, backup),
    '--output', path.relative(repositoryRoot, output),
  ], { cwd: repositoryRoot, encoding: 'utf8' });
}

function rawRecord(backup, options = {}) {
  const startedAt = new Date('2026-08-22T00:00:00.000Z');
  const completedAt = new Date(startedAt.getTime() + (options.durationMs ?? 12_000));
  return {
    schemaVersion: 1,
    scope: 'linux_docker_logical_backup_restore',
    image: 'postgres:16@sha256:' + 'a'.repeat(64),
    databaseVersion: 'PostgreSQL 16.10',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: options.durationMs ?? 12_000,
    recoveryPointLSN: '0/16B6C50',
    sourceAtBackup: { rows: 1000, digest: snapshotDigest },
    sourceAfterBackup: {
      rows: options.liveRows ?? 1001,
      digest: options.liveDigest ?? liveDigest,
    },
    restored: {
      rows: options.restoredRows ?? 1000,
      digest: options.restoredDigest ?? snapshotDigest,
    },
    backup: {
      bytes: backup.length,
      sha256: createHash('sha256').update(backup).digest('hex'),
    },
  };
}

test('PostgreSQL recovery report verifies the checkpoint and archive digest', async (t) => {
  await mkdir(fixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(fixtureRoot, 'pass-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const backup = Buffer.alloc(4096, 0x5a);
  const input = path.join(testRoot, 'raw.json');
  const backupPath = path.join(testRoot, 'backup.dump');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, `${JSON.stringify(rawRecord(backup))}\n`, 'utf8');
  await writeFile(backupPath, backup);

  const result = run(input, backupPath, output);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.sourceAtBackup.rows, 1000);
  assert.equal(report.sourceAfterBackup.rows, 1001);
  assert.equal(report.restored.digest, snapshotDigest);
  assert.equal(report.assertions.postCheckpointWriteExcluded, true);
  assert.match(report.limitations[1], /PITR/);
  assert.match(report.limitations[2], /RPO, RTO/);
});

test('PostgreSQL recovery report rejects inconsistent recovery evidence', async (t) => {
  await mkdir(fixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(fixtureRoot, 'fail-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const cases = [
    { name: 'post-write-missing', options: { liveRows: 1000 }, message: /post-checkpoint write/ },
    { name: 'restore-count', options: { restoredRows: 999 }, message: /match the backup checkpoint/ },
    { name: 'restore-digest', options: { restoredDigest: '3'.repeat(64) }, message: /match the backup checkpoint/ },
    { name: 'duration', options: { durationMs: 121_000 }, message: /duration exceeds/ },
  ];
  for (const scenario of cases) {
    const backup = Buffer.alloc(4096, scenario.name.length);
    const input = path.join(testRoot, `${scenario.name}.json`);
    const backupPath = path.join(testRoot, `${scenario.name}.dump`);
    const output = path.join(testRoot, `${scenario.name}-report.json`);
    await writeFile(input, `${JSON.stringify(rawRecord(backup, scenario.options))}\n`, 'utf8');
    await writeFile(backupPath, backup);
    const result = run(input, backupPath, output);
    assert.equal(result.status, 1, scenario.name);
    assert.match(result.stderr, scenario.message);
  }

  const backup = Buffer.alloc(4096, 0x33);
  const input = path.join(testRoot, 'tampered.json');
  const backupPath = path.join(testRoot, 'tampered.dump');
  const output = path.join(testRoot, 'tampered-report.json');
  await writeFile(input, `${JSON.stringify(rawRecord(backup))}\n`, 'utf8');
  await writeFile(backupPath, Buffer.concat([backup, Buffer.from('changed')]));
  const tampered = run(input, backupPath, output);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /size or SHA-256/);
});
