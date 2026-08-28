import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildNatsDeliveryChecksums,
  buildNatsDeliveryEvidenceReport,
  natsDeliveryEvidenceSchemaVersion,
  natsDeliveryGoTest,
  verifyNatsDeliveryContractArtifacts,
  verifyNatsDeliveryEvidence,
} from '../../scripts/lib/nats-delivery-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'nats-delivery-evidence-tests');
const image = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const commit = 'd'.repeat(40);

function environment(binarySHA256) {
  return [
    'contract=nats-jetstream-delivery-lease',
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
    `=== RUN   ${natsDeliveryGoTest}`,
    passed
      ? `--- PASS: ${natsDeliveryGoTest} (2.10s)`
      : `--- FAIL: ${natsDeliveryGoTest} (2.10s)`,
    passed ? 'PASS' : 'FAIL',
    passed
      ? 'ok  github.com/zbxing/goexample/Framework/queueclient/natsjetstream  3.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/queueclient/natsjetstream  3.000s',
    '',
  ].join('\n');
}

function innerReport() {
  return {
    schemaVersion: 1,
    status: 'passed',
    storage: 'file',
    replicas: 1,
    sourceMessagesPublished: 4,
    redeliveryObserved: true,
    redeliveryCount: 2,
    acknowledged: 1,
    deadLettered: 1,
    dlqAcknowledged: 1,
    shortLeaseRejected: true,
    staticLeasePreflightPassed: true,
    requiredLeaseNanos: 8_510_000_000,
    workerAckWaitNanos: 9_000_000_000,
    dynamicLeasePreflightPassed: true,
    dynamicRequiredLeaseNanos: 700_000_000,
    dynamicAckWaitNanos: 800_000_000,
    dynamicHandlingNanos: 1_500_000_000,
    leaseExtensionIntervalNanos: 100_000_000,
    leaseExtensions: 14,
    leaseExtensionFailures: 0,
    dynamicRedeliveryAfterAck: false,
    sourceAckPending: 0,
    sourceMessagesPending: 0,
  };
}

function serverLog() {
  return [
    'Starting nats-server',
    'Version:  2.14.5',
    'Starting JetStream',
    'Server is ready',
    '',
  ].join('\n');
}

async function writeOuterEvidence(evidenceRoot) {
  const report = buildNatsDeliveryEvidenceReport({ repositoryRoot, evidenceRoot });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNatsDeliveryChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binary = Buffer.alloc(128 * 1024, 0x44);
  const binarySHA256 = createHash('sha256').update(binary).digest('hex');
  const inner = innerReport();
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(binarySHA256), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeFile(path.join(evidenceRoot, 'nats-server-binary.sha256'), `${binarySHA256}  nats-server\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-server.log'), serverLog(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'delivery-report.json'), `${JSON.stringify(inner, null, 2)}\n`, 'utf8');
  const outer = await writeOuterEvidence(evidenceRoot);
  return { binary, binarySHA256, evidenceRoot, inner, outer: outer.report, reportPath: outer.reportPath };
}

test('NATS delivery evidence binds redelivery, settlement, static preflight, and dynamic lease extension', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const contract = verifyNatsDeliveryContractArtifacts({ evidenceRoot });
  const verified = verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(contract.report.dynamicRequiredLeaseNanos, 700_000_000);
  assert.equal(verified.report.schemaVersion, natsDeliveryEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.goTests.passed, [natsDeliveryGoTest]);
  assert.equal(verified.artifactPaths.length, 9);
  assert.match(verified.report.limitations.join('\n'), /natsBroker remains not_recorded/);
});

test('failed NATS delivery evidence remains verifiable without claiming delivery semantics', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(false), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  await rm(path.join(evidenceRoot, 'nats-server.log'), { force: true });
  await rm(path.join(evidenceRoot, 'delivery-report.json'), { force: true });
  const { report } = await writeOuterEvidence(evidenceRoot);
  const verified = verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(report.status, 'failed');
  assert.equal(verified.report.outputs.deliveryReport, null);
  assert.equal(verified.artifactPaths.length, 7);
});

test('NATS delivery evidence rejects scope, status, semantic, log, binary, and checksum tampering', async (t) => {
  const { binary, evidenceRoot, inner, outer, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(outer);
  scopeTamper.scope.integrationTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(outer);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /status must match/,
  );

  const semanticTamper = structuredClone(inner);
  semanticTamper.leaseExtensions = 4;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(semanticTamper, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report does not satisfy/,
  );

  await writeFile(path.join(evidenceRoot, 'delivery-report.json'), `${JSON.stringify(inner, null, 2)}\n`, 'utf8');
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-server.log'), 'tampered log\n', 'utf8');
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|missing Starting nats-server/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-server.log'), serverLog(), 'utf8');
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-server'), Buffer.from('tampered binary'));
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|copied NATS server binary/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  environment.txt\n`, 'utf8');
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});

test('NATS delivery evidence rejects path traversal and production-boundary drift', async (t) => {
  const { binarySHA256, evidenceRoot, outer, reportPath } = await createEvidence(t);

  const pathTamper = structuredClone(outer);
  pathTamper.outputs.serverLog.path = '../nats-server.log';
  await writeFile(reportPath, `${JSON.stringify(pathTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /path must equal nats-server\.log|unsafe path/,
  );

  await writeFile(
    path.join(evidenceRoot, 'environment.txt'),
    environment(binarySHA256).replace('target_nats_broker=not_recorded', 'target_nats_broker=recorded'),
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /local-only boundary/,
  );
});
