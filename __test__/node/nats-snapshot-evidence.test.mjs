import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildNatsSnapshotChecksums,
  buildNatsSnapshotEvidenceReport,
  natsSnapshotEvidenceSchemaVersion,
  natsSnapshotGoTest,
  verifyNatsSnapshotEvidence,
} from '../../scripts/lib/nats-snapshot-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'nats-snapshot-evidence-tests');
const image = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const commit = 'a'.repeat(40);

function environment(binarySHA256) {
  return [
    'contract=nats-jetstream-snapshot-restore',
    'runner_os=Linux',
    'runner_arch=X64',
    'platform=linux',
    'architecture=x64',
    `node=${process.version}`,
    'go=go version go1.25.13 linux/amd64',
    'docker=28.3.2',
    `git_commit=${commit}`,
    `nats_image=${image}`,
    `nats_server_sha256=${binarySHA256}`,
    'jetstream_enabled=true',
    'storage=file-stream',
    'target_nats_broker=not_recorded',
    'rpo_rto=not_approved',
    'started_at=2026-08-27T00:00:00.000Z',
    'ended_at=2026-08-27T00:00:20.000Z',
    '',
  ].join('\n');
}

function goOutput(passed = true) {
  return [
    `=== RUN   ${natsSnapshotGoTest}`,
    passed
      ? `--- PASS: ${natsSnapshotGoTest} (0.10s)`
      : `--- FAIL: ${natsSnapshotGoTest} (0.10s)`,
    passed ? 'PASS' : 'FAIL',
    passed
      ? 'ok  github.com/zbxing/goexample/Framework/queueclient/natsjetstream  1.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/queueclient/natsjetstream  1.000s',
    '',
  ].join('\n');
}

function innerReport(snapshot) {
  return {
    schemaVersion: 1,
    status: 'passed',
    storage: 'file',
    replicas: 1,
    snapshotIncludesConsumers: true,
    snapshotCheckedMessages: true,
    snapshotBytes: snapshot.length,
    snapshotSHA256: createHash('sha256').update(snapshot).digest('hex'),
    snapshotChunks: 2,
    checkpointMessages: 3,
    checkpointFirstSequence: 1,
    checkpointLastSequence: 3,
    postCheckpointMessages: 1,
    messagesBeforeDelete: 4,
    restoredMessages: 3,
    postCheckpointExcluded: true,
    tamperedSnapshotRejected: true,
    consumerRestored: true,
    ackPendingBeforeSnapshot: 1,
    messagesPendingBeforeSnapshot: 1,
    ackPendingAfterRestore: 1,
    messagesPendingAfterRestore: 1,
    unacknowledgedSequence: 2,
    recoveredSequence: 2,
    sameSequenceRedelivered: true,
    acknowledgedAfterRestore: 1,
    deadLetteredAfterRestore: 1,
    sourceAckPending: 0,
    sourceMessagesPending: 0,
    restoreElapsedNanos: 10_000_000,
    restoreBudgetNanos: 15_000_000_000,
  };
}

async function writeOuterEvidence(evidenceRoot) {
  const report = buildNatsSnapshotEvidenceReport({ repositoryRoot, evidenceRoot });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNatsSnapshotChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binary = Buffer.alloc(128 * 1024, 0x4e);
  const binarySHA256 = createHash('sha256').update(binary).digest('hex');
  const snapshot = Buffer.alloc(50 * 1024, 0x53);
  const report = innerReport(snapshot);
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(binarySHA256), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeFile(path.join(evidenceRoot, 'nats-server-binary.sha256'), `${binarySHA256}  nats-server\n`, 'utf8');
  await writeFile(
    path.join(evidenceRoot, 'nats-snapshot-restore.log'),
    [
      'Starting nats-server',
      'Version:  2.14.5',
      'Starting health check and snapshot',
      'Completed snapshot',
      'Starting restore',
      'Completed restore',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(path.join(evidenceRoot, 'source-stream.snapshot'), snapshot);
  await writeFile(
    path.join(evidenceRoot, 'snapshot-restore-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  const outer = await writeOuterEvidence(evidenceRoot);
  return { evidenceRoot, inner: report, outer: outer.report, reportPath: outer.reportPath };
}

test('NATS snapshot evidence binds the binary, checked restore semantics, and local-only boundary', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const verified = verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.schemaVersion, natsSnapshotEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.goTests.passed, [natsSnapshotGoTest]);
  assert.equal(verified.artifactPaths.length, 10);
  assert.match(verified.report.limitations.join('\n'), /natsBroker remains not_recorded/);
});

test('failed NATS snapshot evidence preserves bounded incomplete artifacts without claiming recovery', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(false), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  for (const name of [
    'nats-snapshot-restore.log',
    'source-stream.snapshot',
    'snapshot-restore-report.json',
  ]) {
    await rm(path.join(evidenceRoot, name), { force: true });
  }
  const { report } = await writeOuterEvidence(evidenceRoot);
  const verified = verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(report.status, 'failed');
  assert.equal(verified.report.outputs.snapshot, null);
  assert.equal(verified.artifactPaths.length, 7);
});

test('NATS snapshot evidence rejects scope, status, semantic, binary, and checksum tampering', async (t) => {
  const { evidenceRoot, inner, outer, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(outer);
  scopeTamper.scope.snapshotTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(outer);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }),
    /status must match/,
  );

  const semanticTamper = structuredClone(inner);
  semanticTamper.postCheckpointExcluded = false;
  await writeFile(
    path.join(evidenceRoot, 'snapshot-restore-report.json'),
    `${JSON.stringify(semanticTamper, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }),
    /snapshot report does not satisfy/,
  );

  await writeFile(
    path.join(evidenceRoot, 'snapshot-restore-report.json'),
    `${JSON.stringify(inner, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-server'), Buffer.from('tampered binary'));
  assert.throws(
    () => verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|copied NATS server binary/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-server'), Buffer.alloc(128 * 1024, 0x4e));
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  environment.txt\n`, 'utf8');
  assert.throws(
    () => verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
