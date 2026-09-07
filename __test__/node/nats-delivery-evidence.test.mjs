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
    schemaVersion: 14,
    status: 'passed',
    storage: 'file',
    replicas: 1,
    pushConsumerRejected: true,
    rebuiltPullConsumerPreflightPassed: true,
    consumerDeliverSubject: '',
    priorityConsumerRejected: true,
    rebuiltDefaultPriorityConsumerPreflightPassed: true,
    consumerPriorityPolicy: 0,
    consumerPriorityGroupCount: 0,
    ackAllConsumerRejected: true,
    rebuiltExplicitAckConsumerPreflightPassed: true,
    consumerAckPolicy: 0,
    receiveCancellationWaitingObserved: true,
    receiveCancellationPropagated: true,
    receiveCancellationError: 'context canceled',
    receiveCancellationLatencyNanos: 25_000_000,
    receiveCancellationFetchMaxWaitNanos: 5_000_000_000,
    receiveCancellationReturnLimitNanos: 1_000_000_000,
    persistentConsumerPreflightPassed: true,
    deliverNewPolicyRejected: true,
    deliverAllPolicyPreflightPassed: true,
    consumerDeliverPolicy: 0,
    replayOriginalPolicyRejected: true,
    replayInstantPolicyPreflightPassed: true,
    consumerReplayPolicy: 0,
    brokerRequestExpiresRejected: true,
    shortRequestExpiresRejected: true,
    compatibleRequestExpiresPreflightPassed: true,
    adapterFetchMaxWaitNanos: 100_000_000,
    consumerMaxRequestExpiresNanos: 5_000_000_000,
    pausedConsumerRejected: true,
    resumedConsumerPreflightPassed: true,
    consumerPaused: false,
    limitedDeliveryRejected: true,
    consumerMaxDeliver: 5,
    headersOnlyRejected: true,
    fullPayloadPreflightPassed: true,
    consumerHeadersOnly: false,
    broadSubjectFilterRejected: true,
    exactSubjectPreflightPassed: true,
    consumerFilterSubject: 'goexample.source.contract.primary',
    foreignSubjectExcluded: true,
    sourceMessagesPublished: 4,
    deduplicatedPublishAttempts: 2,
    deduplicatedStoredMessages: 1,
    duplicateWindowNanos: 60_000_000_000,
    deduplicationVerified: true,
    redeliveryObserved: true,
    redeliveryCount: 2,
    acknowledged: 1,
    deadLettered: 1,
    dlqPublishConfirmed: true,
    dlqAcknowledged: 1,
    shortLeaseRejected: true,
    staticLeasePreflightPassed: true,
    requiredLeaseNanos: 8_515_000_000,
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

test('NATS delivery evidence binds in-flight pull cancellation, push, priority, and AckAll rejection with compatible rebuilds, reliable delivery, deduplication, confirmed DLQ settlement, and lease extension', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const contract = verifyNatsDeliveryContractArtifacts({ evidenceRoot });
  const verified = verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(contract.report.deduplicatedPublishAttempts, 2);
  assert.equal(contract.report.deduplicatedStoredMessages, 1);
  assert.equal(contract.report.duplicateWindowNanos, 60_000_000_000);
  assert.equal(contract.report.deduplicationVerified, true);
  assert.equal(contract.report.dlqPublishConfirmed, true);
  assert.equal(contract.report.pushConsumerRejected, true);
  assert.equal(contract.report.rebuiltPullConsumerPreflightPassed, true);
  assert.equal(contract.report.consumerDeliverSubject, '');
  assert.equal(contract.report.priorityConsumerRejected, true);
  assert.equal(contract.report.rebuiltDefaultPriorityConsumerPreflightPassed, true);
  assert.equal(contract.report.consumerPriorityPolicy, 0);
  assert.equal(contract.report.consumerPriorityGroupCount, 0);
  assert.equal(contract.report.ackAllConsumerRejected, true);
  assert.equal(contract.report.rebuiltExplicitAckConsumerPreflightPassed, true);
  assert.equal(contract.report.consumerAckPolicy, 0);
  assert.equal(contract.report.receiveCancellationWaitingObserved, true);
  assert.equal(contract.report.receiveCancellationPropagated, true);
  assert.equal(contract.report.receiveCancellationError, 'context canceled');
  assert.ok(contract.report.receiveCancellationLatencyNanos < contract.report.receiveCancellationFetchMaxWaitNanos);
  assert.equal(contract.report.persistentConsumerPreflightPassed, true);
  assert.equal(contract.report.deliverNewPolicyRejected, true);
  assert.equal(contract.report.deliverAllPolicyPreflightPassed, true);
  assert.equal(contract.report.consumerDeliverPolicy, 0);
  assert.equal(contract.report.replayOriginalPolicyRejected, true);
  assert.equal(contract.report.replayInstantPolicyPreflightPassed, true);
  assert.equal(contract.report.consumerReplayPolicy, 0);
  assert.equal(contract.report.brokerRequestExpiresRejected, true);
  assert.equal(contract.report.shortRequestExpiresRejected, true);
  assert.equal(contract.report.compatibleRequestExpiresPreflightPassed, true);
  assert.equal(contract.report.adapterFetchMaxWaitNanos, 100_000_000);
  assert.equal(contract.report.consumerMaxRequestExpiresNanos, 5_000_000_000);
  assert.equal(contract.report.pausedConsumerRejected, true);
  assert.equal(contract.report.resumedConsumerPreflightPassed, true);
  assert.equal(contract.report.consumerPaused, false);
  assert.equal(contract.report.limitedDeliveryRejected, true);
  assert.equal(contract.report.consumerMaxDeliver, 5);
  assert.equal(contract.report.headersOnlyRejected, true);
  assert.equal(contract.report.fullPayloadPreflightPassed, true);
  assert.equal(contract.report.consumerHeadersOnly, false);
  assert.equal(contract.report.broadSubjectFilterRejected, true);
  assert.equal(contract.report.exactSubjectPreflightPassed, true);
  assert.equal(contract.report.consumerFilterSubject, 'goexample.source.contract.primary');
  assert.equal(contract.report.foreignSubjectExcluded, true);
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

  const missingDeliveryPolicy = structuredClone(inner);
  delete missingDeliveryPolicy.deliverAllPolicyPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingDeliveryPolicy, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingReplayPolicy = structuredClone(inner);
  delete missingReplayPolicy.replayInstantPolicyPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingReplayPolicy, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingRequestExpiration = structuredClone(inner);
  delete missingRequestExpiration.compatibleRequestExpiresPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingRequestExpiration, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingConsumerPause = structuredClone(inner);
  delete missingConsumerPause.resumedConsumerPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingConsumerPause, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingConsumerMode = structuredClone(inner);
  delete missingConsumerMode.rebuiltPullConsumerPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingConsumerMode, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingPriorityPolicy = structuredClone(inner);
  delete missingPriorityPolicy.rebuiltDefaultPriorityConsumerPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingPriorityPolicy, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingAckPolicy = structuredClone(inner);
  delete missingAckPolicy.rebuiltExplicitAckConsumerPreflightPassed;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingAckPolicy, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  const missingReceiveCancellation = structuredClone(inner);
  delete missingReceiveCancellation.receiveCancellationPropagated;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(missingReceiveCancellation, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report keys must be exactly/,
  );

  for (const [field, value] of [
    ['schemaVersion', 13],
    ['pushConsumerRejected', false],
    ['rebuiltPullConsumerPreflightPassed', false],
    ['consumerDeliverSubject', 'private.delivery.inbox'],
    ['priorityConsumerRejected', false],
    ['rebuiltDefaultPriorityConsumerPreflightPassed', false],
    ['consumerPriorityPolicy', 1],
    ['consumerPriorityGroupCount', 1],
    ['ackAllConsumerRejected', false],
    ['rebuiltExplicitAckConsumerPreflightPassed', false],
    ['consumerAckPolicy', 1],
    ['receiveCancellationWaitingObserved', false],
    ['receiveCancellationPropagated', false],
    ['receiveCancellationError', 'private pull failure'],
    ['receiveCancellationLatencyNanos', 1_000_000_001],
    ['receiveCancellationFetchMaxWaitNanos', 4_000_000_000],
    ['receiveCancellationReturnLimitNanos', 500_000_000],
    ['persistentConsumerPreflightPassed', false],
    ['deliverNewPolicyRejected', false],
    ['deliverAllPolicyPreflightPassed', false],
    ['consumerDeliverPolicy', 2],
    ['replayOriginalPolicyRejected', false],
    ['replayInstantPolicyPreflightPassed', false],
    ['consumerReplayPolicy', 1],
    ['brokerRequestExpiresRejected', false],
    ['shortRequestExpiresRejected', false],
    ['compatibleRequestExpiresPreflightPassed', false],
    ['adapterFetchMaxWaitNanos', 50_000_000],
    ['consumerMaxRequestExpiresNanos', 50_000_000],
    ['pausedConsumerRejected', false],
    ['resumedConsumerPreflightPassed', false],
    ['consumerPaused', true],
    ['limitedDeliveryRejected', false],
    ['consumerMaxDeliver', 1],
    ['headersOnlyRejected', false],
    ['fullPayloadPreflightPassed', false],
    ['consumerHeadersOnly', true],
    ['broadSubjectFilterRejected', false],
    ['exactSubjectPreflightPassed', false],
    ['consumerFilterSubject', 'goexample.source.contract.>'],
    ['foreignSubjectExcluded', false],
  ]) {
    const persistentPreflightTamper = structuredClone(inner);
    persistentPreflightTamper[field] = value;
    await writeFile(
      path.join(evidenceRoot, 'delivery-report.json'),
      `${JSON.stringify(persistentPreflightTamper, null, 2)}\n`,
      'utf8',
    );
    await writeOuterEvidence(evidenceRoot);
    assert.throws(
      () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
      /delivery report does not satisfy/,
    );
  }

  const deduplicationTamper = structuredClone(inner);
  deduplicationTamper.deduplicatedStoredMessages = 2;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(deduplicationTamper, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot }),
    /delivery report does not satisfy/,
  );

  const dlqAcknowledgementTamper = structuredClone(inner);
  dlqAcknowledgementTamper.dlqPublishConfirmed = false;
  await writeFile(
    path.join(evidenceRoot, 'delivery-report.json'),
    `${JSON.stringify(dlqAcknowledgementTamper, null, 2)}\n`,
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
