import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildNatsRestartChecksums,
  buildNatsRestartEvidenceReport,
  natsRestartEvidenceSchemaVersion,
  natsRestartGoTest,
  verifyNatsRestartContractArtifacts,
  verifyNatsRestartEvidence,
} from '../../scripts/lib/nats-restart-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'nats-restart-evidence-tests');
const image = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const commit = 'b'.repeat(40);

function environment(binarySHA256) {
  return [
    'contract=nats-jetstream-restart-recovery',
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
    'started_at=2026-08-28T00:00:00.000Z',
    'ended_at=2026-08-28T00:00:20.000Z',
    '',
  ].join('\n');
}

function goOutput(passed = true) {
  return [
    `=== RUN   ${natsRestartGoTest}`,
    passed
      ? `--- PASS: ${natsRestartGoTest} (0.10s)`
      : `--- FAIL: ${natsRestartGoTest} (0.10s)`,
    passed ? 'PASS' : 'FAIL',
    passed
      ? 'ok  github.com/zbxing/goexample/Framework/queueclient/natsjetstream  1.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/queueclient/natsjetstream  1.000s',
    '',
  ].join('\n');
}

function innerReport() {
  return {
    schemaVersion: 1,
    status: 'passed',
    storage: 'file',
    replicas: 1,
    abruptRestarts: 1,
    persistedMessages: 3,
    recoveredStreamSequence: 1,
    deliveryCountBeforeRestart: 1,
    deliveryCountAfterRestart: 1,
    redeliveryObserved: true,
    acknowledged: 1,
    deadLettered: 1,
    sourceAckPending: 0,
    sourceMessagesPending: 0,
    shortLeaseRejected: true,
    leasePreflightPassed: true,
    requiredLeaseNanos: 8_515_000_000,
    workerAckWaitNanos: 9_000_000_000,
  };
}

function serverLog(label) {
  return [
    `Starting nats-server (${label})`,
    'Version:  2.14.5',
    'Starting JetStream',
    'Server is ready',
    '',
  ].join('\n');
}

async function writeOuterEvidence(evidenceRoot) {
  const report = buildNatsRestartEvidenceReport({ repositoryRoot, evidenceRoot });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNatsRestartChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binary = Buffer.alloc(128 * 1024, 0x52);
  const binarySHA256 = createHash('sha256').update(binary).digest('hex');
  const inner = innerReport();
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(binarySHA256), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeFile(path.join(evidenceRoot, 'nats-server-binary.sha256'), `${binarySHA256}  nats-server\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-before-restart.log'), serverLog('before'), 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-after-restart.log'), serverLog('after'), 'utf8');
  await writeFile(path.join(evidenceRoot, 'restart-report.json'), `${JSON.stringify(inner, null, 2)}\n`, 'utf8');
  const outer = await writeOuterEvidence(evidenceRoot);
  return { binary, evidenceRoot, inner, outer: outer.report, reportPath: outer.reportPath };
}

test('NATS restart evidence binds the binary, same-store recovery semantics, and local-only boundary', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const contract = verifyNatsRestartContractArtifacts({ evidenceRoot });
  const verified = verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(contract.report.recoveredStreamSequence, 1);
  assert.equal(verified.report.schemaVersion, natsRestartEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.goTests.passed, [natsRestartGoTest]);
  assert.equal(verified.artifactPaths.length, 10);
  assert.match(verified.report.limitations.join('\n'), /natsBroker remains not_recorded/);
});

test('failed NATS restart evidence preserves bounded incomplete artifacts without claiming recovery', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(false), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  for (const name of ['nats-before-restart.log', 'nats-after-restart.log', 'restart-report.json']) {
    await rm(path.join(evidenceRoot, name), { force: true });
  }
  const { report } = await writeOuterEvidence(evidenceRoot);
  const verified = verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(report.status, 'failed');
  assert.equal(verified.report.outputs.restartReport, null);
  assert.equal(verified.artifactPaths.length, 7);
});

test('NATS restart evidence rejects scope, status, semantic, log, binary, and checksum tampering', async (t) => {
  const { binary, evidenceRoot, inner, outer, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(outer);
  scopeTamper.scope.restartTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(outer);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /status must match/,
  );

  const semanticTamper = structuredClone(inner);
  semanticTamper.recoveredStreamSequence = 2;
  await writeFile(
    path.join(evidenceRoot, 'restart-report.json'),
    `${JSON.stringify(semanticTamper, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /restart report does not satisfy/,
  );

  await writeFile(path.join(evidenceRoot, 'restart-report.json'), `${JSON.stringify(inner, null, 2)}\n`, 'utf8');
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-after-restart.log'), 'tampered log\n', 'utf8');
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|missing Starting nats-server/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-after-restart.log'), serverLog('after'), 'utf8');
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-server'), Buffer.from('tampered binary'));
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|copied NATS server binary/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  environment.txt\n`, 'utf8');
  assert.throws(
    () => verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
