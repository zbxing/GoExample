import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildNatsClusterChecksums,
  buildNatsClusterEvidenceReport,
  natsClusterEvidenceSchemaVersion,
  natsClusterGoTest,
  verifyNatsClusterContractArtifacts,
  verifyNatsClusterEvidence,
} from '../../scripts/lib/nats-cluster-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'nats-cluster-evidence-tests');
const image = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const commit = 'c'.repeat(40);

function environment(binarySHA256) {
  return [
    'contract=nats-jetstream-cluster-failover',
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
    'ended_at=2026-08-28T00:01:20.000Z',
    '',
  ].join('\n');
}

function goOutput(passed = true) {
  return [
    `=== RUN   ${natsClusterGoTest}`,
    passed
      ? `--- PASS: ${natsClusterGoTest} (1.00s)`
      : `--- FAIL: ${natsClusterGoTest} (1.00s)`,
    passed ? 'PASS' : 'FAIL',
    passed
      ? 'ok  github.com/zbxing/goexample/Framework/queueclient/natsjetstream  2.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/queueclient/natsjetstream  2.000s',
    '',
  ].join('\n');
}

function innerReport() {
  return {
    schemaVersion: 6,
    status: 'passed',
    storage: 'file',
    clusterSize: 3,
    streamReplicas: 3,
    consumerReplicas: 3,
    abruptLeaderStops: 3,
    oldLeader: 'goexample-js-node-2',
    newLeader: 'goexample-js-node-3',
    leaderChanged: true,
    persistedBeforeFailover: 3,
    persistedAfterFailover: 4,
    recoveredStreamSequence: 1,
    deliveryCountBefore: 1,
    deliveryCountAfter: 2,
    redeliveryObserved: true,
    publishedAfterFailover: 1,
    workerAcknowledged: 2,
    deadLettered: 1,
    sourceAckPending: 0,
    sourceMessagesPending: 0,
    survivingServers: 2,
    shortLeaseRejected: true,
    leasePreflightPassed: true,
    requiredLeaseNanos: 8_515_000_000,
    workerAckWaitNanos: 9_000_000_000,
    sameConnectionSession: true,
    disconnectedObserved: true,
    reconnectedObserved: true,
    connectionServerBefore: 'goexample-js-node-2',
    connectionServerAfter: 'goexample-js-node-1',
    adapterSessionRecovered: true,
    restartedServers: 3,
    replicaRecoveryPassed: true,
    secondOldLeader: 'goexample-js-node-3',
    secondNewLeader: 'goexample-js-node-2',
    secondLeaderChanged: true,
    distinctLeadersStopped: true,
    persistedAfterSecondFailover: 6,
    secondRecoveredStreamSequence: 5,
    secondDeliveryCountBefore: 1,
    secondDeliveryCountAfter: 2,
    secondRedeliveryObserved: true,
    publishedAfterSecondFailover: 1,
    acknowledgedAfterSecondFailover: 2,
    secondLeasePreflightPassed: true,
    connectionServerBeforeSecondFailover: 'goexample-js-node-1',
    connectionServerAfterSecondFailover: 'goexample-js-node-1',
    sameConnectionSessionAfterSecondFailover: true,
    adapterSessionRecoveredAfterSecondFailover: true,
    overlappingOfflineServers: 2,
    quorumUnavailableObserved: true,
    quorumFailureBudgetNanos: 3_000_000_000,
    quorumFailureElapsedNanos: 500_000_000,
    quorumOldLeader: 'goexample-js-node-2',
    quorumRecoveredLeader: 'goexample-js-node-1',
    persistedAfterQuorumRecovery: 8,
    quorumRecoveredStreamSequence: 7,
    quorumDeliveryCountBefore: 1,
    quorumDeliveryCountAfter: 2,
    quorumRedeliveryObserved: true,
    publishedAfterQuorumRecovery: 1,
    acknowledgedAfterQuorumRecovery: 2,
    quorumLeasePreflightPassed: true,
    connectionServerBeforeQuorumLoss: 'goexample-js-node-1',
    connectionServerDuringQuorumLoss: 'goexample-js-node-1',
    connectionServerAfterQuorumRecovery: 'goexample-js-node-1',
    sameConnectionSessionAfterQuorumRecovery: true,
    adapterSessionRecoveredAfterQuorumRecovery: true,
    finalReplicaRecoveryPassed: true,
    concurrentFaultInjected: true,
    concurrentStoppedServers: 2,
    concurrentOldLeader: 'goexample-js-node-1',
    concurrentStoppedPeer: 'goexample-js-node-2',
    concurrentSurvivor: 'goexample-js-node-3',
    concurrentRecoveredLeader: 'goexample-js-node-1',
    concurrentStopSkewBudgetNanos: 250_000_000,
    concurrentStopSkewNanos: 0,
    concurrentQuorumUnavailableObserved: true,
    concurrentFailureBudgetNanos: 3_000_000_000,
    concurrentFailureElapsedNanos: 500_000_000,
    persistedAfterConcurrentRecovery: 10,
    concurrentRecoveredStreamSequence: 9,
    concurrentDeliveryCountBefore: 1,
    concurrentDeliveryCountAfter: 2,
    concurrentRedeliveryObserved: true,
    publishedAfterConcurrentRecovery: 1,
    acknowledgedAfterConcurrentRecovery: 2,
    concurrentLeasePreflightPassed: true,
    connectionServerBeforeConcurrentFailure: 'goexample-js-node-1',
    connectionServerDuringConcurrentFailure: 'goexample-js-node-3',
    connectionServerAfterConcurrentRecovery: 'goexample-js-node-3',
    sameConnectionSessionAfterConcurrentRecovery: true,
    adapterSessionRecoveredAfterConcurrentRecovery: true,
    concurrentReplicaRecoveryPassed: true,
    networkPartitionInjected: true,
    networkPartitionedServers: 3,
    networkPartitionLeader: 'goexample-js-node-1',
    networkPartitionConnectionServer: 'goexample-js-node-3',
    routeProxyConnectionsBefore: 12,
    routeProxyConnectionsClosed: 12,
    partitionQuorumUnavailableObserved: true,
    partitionFailureBudgetNanos: 3_000_000_000,
    partitionFailureElapsedNanos: 500_000_000,
    partitionRecoveredLeader: 'goexample-js-node-1',
    persistedAfterPartitionRecovery: 12,
    partitionRecoveredStreamSequence: 11,
    partitionDeliveryCountBefore: 1,
    partitionDeliveryCountAfter: 2,
    partitionRedeliveryObserved: true,
    publishedAfterPartitionRecovery: 1,
    acknowledgedAfterPartitionRecovery: 2,
    partitionLeasePreflightPassed: true,
    connectionServerAfterPartitionRecovery: 'goexample-js-node-3',
    sameConnectionSessionAfterPartitionRecovery: true,
    adapterSessionRecoveredAfterPartitionRecovery: true,
    partitionReplicaRecoveryPassed: true,
  };
}

function serverLog(node, starts) {
  const leaderMarker = "JetStream cluster new stream leader for '$G > GOEXAMPLE_FAILOVER_SOURCE'";
  return [
    ...Array.from({ length: starts }, () => 'Starting nats-server'),
    `Name:     ${node}`,
    'Version:  2.14.5',
    leaderMarker,
    'Server is ready',
    '',
  ].join('\n');
}

async function writeOuterEvidence(evidenceRoot) {
  const report = buildNatsClusterEvidenceReport({ repositoryRoot, evidenceRoot });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNatsClusterChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binary = Buffer.alloc(128 * 1024, 0x43);
  const binarySHA256 = createHash('sha256').update(binary).digest('hex');
  const inner = innerReport();
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(binarySHA256), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeFile(path.join(evidenceRoot, 'nats-server-binary.sha256'), `${binarySHA256}  nats-server\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'goexample-js-node-1.log'), serverLog('goexample-js-node-1', 2), 'utf8');
  await writeFile(path.join(evidenceRoot, 'goexample-js-node-2.log'), serverLog('goexample-js-node-2', 3), 'utf8');
  await writeFile(path.join(evidenceRoot, 'goexample-js-node-3.log'), serverLog('goexample-js-node-3', 3), 'utf8');
  await writeFile(path.join(evidenceRoot, 'cluster-failover-report.json'), `${JSON.stringify(inner, null, 2)}\n`, 'utf8');
  const outer = await writeOuterEvidence(evidenceRoot);
  return { binary, evidenceRoot, inner, outer: outer.report, reportPath: outer.reportPath };
}

test('NATS cluster evidence binds failover, quorum loss, route partition, and the local-only boundary', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const contract = verifyNatsClusterContractArtifacts({ evidenceRoot });
  const verified = verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(contract.report.partitionRecoveredStreamSequence, 11);
  assert.equal(verified.report.schemaVersion, natsClusterEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.goTests.passed, [natsClusterGoTest]);
  assert.equal(verified.artifactPaths.length, 11);
  assert.match(verified.report.limitations.join('\n'), /natsBroker remains not_recorded/);
});

test('failed NATS cluster evidence preserves bounded incomplete artifacts without claiming failover', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), goOutput(false), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  for (const name of [
    'goexample-js-node-1.log',
    'goexample-js-node-2.log',
    'goexample-js-node-3.log',
    'cluster-failover-report.json',
  ]) {
    await rm(path.join(evidenceRoot, name), { force: true });
  }
  const { report } = await writeOuterEvidence(evidenceRoot);
  const verified = verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(report.status, 'failed');
  assert.equal(verified.report.outputs.clusterReport, null);
  assert.equal(verified.artifactPaths.length, 7);
});

test('NATS cluster evidence rejects scope, status, schema, semantic, log, binary, and checksum tampering', async (t) => {
  const { binary, evidenceRoot, inner, outer, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(outer);
  scopeTamper.scope.clusterTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(() => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }), /scope no longer matches/);

  const statusTamper = structuredClone(outer);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(() => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }), /status must match/);

  const schemaTamper = structuredClone(outer);
  schemaTamper.schemaVersion = 2;
  await writeFile(reportPath, `${JSON.stringify(schemaTamper, null, 2)}\n`, 'utf8');
  assert.throws(() => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }), /schemaVersion 1/);

  const semanticTamper = structuredClone(inner);
  semanticTamper.persistedAfterPartitionRecovery = 11;
  await writeFile(
    path.join(evidenceRoot, 'cluster-failover-report.json'),
    `${JSON.stringify(semanticTamper, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  assert.throws(
    () => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }),
    /cluster report does not satisfy/,
  );

  await writeFile(
    path.join(evidenceRoot, 'cluster-failover-report.json'),
    `${JSON.stringify(inner, null, 2)}\n`,
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'goexample-js-node-3.log'), 'tampered log\n', 'utf8');
  assert.throws(
    () => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|server-start and stream-leader/,
  );

  await writeFile(
    path.join(evidenceRoot, 'goexample-js-node-3.log'),
    serverLog('goexample-js-node-3', 3),
    'utf8',
  );
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'nats-server'), Buffer.from('tampered binary'));
  assert.throws(
    () => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }),
    /size mismatch|hash mismatch|copied NATS server binary/,
  );

  await writeFile(path.join(evidenceRoot, 'nats-server'), binary);
  await writeOuterEvidence(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  environment.txt\n`, 'utf8');
  assert.throws(
    () => verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
