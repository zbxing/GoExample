import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const natsClusterEvidenceSchemaVersion = 1;
export const natsClusterGoTest = 'TestRealNATSJetStreamClusterLeaderFailover';

const expectedImage = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const expectedCommand = Object.freeze([
  'go', '-C', 'Framework', 'test', '-v', '-count=1', '-timeout=2m',
  '-run', '^TestRealNATS', './queueclient/...',
]);
const expectedContract = Object.freeze({
  scope: 'three_node_three_replica_same_session_failover',
  storage: 'file',
  clusterSize: 3,
  streamReplicas: 3,
  consumerReplicas: 3,
  abruptLeaderStops: 3,
  concurrentStoppedServers: 2,
  networkPartitionedServers: 3,
  workerAckWaitNanos: 9_000_000_000,
});
const baseArtifactNames = Object.freeze([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
]);
const clusterArtifactNames = Object.freeze([
  'goexample-js-node-1.log',
  'goexample-js-node-2.log',
  'goexample-js-node-3.log',
  'cluster-failover-report.json',
]);
const limitations = Object.freeze([
  'the three NATS processes, file stores, route proxies, streams, durable consumers, subjects, credentials and ports are disposable non-production fixtures on one runner',
  'the local process and route failures do not prove target broker identity, authorization, cross-host or cross-zone infrastructure failure, network-device policy, disk-corruption recovery, target capacity, atomic settlement, exactly-once, backup, PITR, RPO or RTO',
  'natsBroker remains not_recorded until signed target-environment broker recovery evidence is archived and independently verified',
]);
const clusterReportKeys = Object.freeze([
  'schemaVersion', 'status', 'storage', 'clusterSize', 'streamReplicas', 'consumerReplicas',
  'abruptLeaderStops', 'oldLeader', 'newLeader', 'leaderChanged', 'persistedBeforeFailover',
  'persistedAfterFailover', 'recoveredStreamSequence', 'deliveryCountBefore',
  'deliveryCountAfter', 'redeliveryObserved', 'publishedAfterFailover', 'workerAcknowledged',
  'deadLettered', 'sourceAckPending', 'sourceMessagesPending', 'survivingServers',
  'shortLeaseRejected', 'leasePreflightPassed', 'requiredLeaseNanos', 'workerAckWaitNanos',
  'sameConnectionSession', 'disconnectedObserved', 'reconnectedObserved',
  'connectionServerBefore', 'connectionServerAfter', 'adapterSessionRecovered', 'restartedServers',
  'replicaRecoveryPassed', 'secondOldLeader', 'secondNewLeader', 'secondLeaderChanged',
  'distinctLeadersStopped', 'persistedAfterSecondFailover', 'secondRecoveredStreamSequence',
  'secondDeliveryCountBefore', 'secondDeliveryCountAfter', 'secondRedeliveryObserved',
  'publishedAfterSecondFailover', 'acknowledgedAfterSecondFailover',
  'secondLeasePreflightPassed', 'connectionServerBeforeSecondFailover',
  'connectionServerAfterSecondFailover', 'sameConnectionSessionAfterSecondFailover',
  'adapterSessionRecoveredAfterSecondFailover', 'overlappingOfflineServers',
  'quorumUnavailableObserved', 'quorumFailureBudgetNanos', 'quorumFailureElapsedNanos',
  'quorumOldLeader', 'quorumRecoveredLeader', 'persistedAfterQuorumRecovery',
  'quorumRecoveredStreamSequence', 'quorumDeliveryCountBefore', 'quorumDeliveryCountAfter',
  'quorumRedeliveryObserved', 'publishedAfterQuorumRecovery', 'acknowledgedAfterQuorumRecovery',
  'quorumLeasePreflightPassed', 'connectionServerBeforeQuorumLoss',
  'connectionServerDuringQuorumLoss', 'connectionServerAfterQuorumRecovery',
  'sameConnectionSessionAfterQuorumRecovery', 'adapterSessionRecoveredAfterQuorumRecovery',
  'finalReplicaRecoveryPassed', 'concurrentFaultInjected', 'concurrentStoppedServers',
  'concurrentOldLeader', 'concurrentStoppedPeer', 'concurrentSurvivor',
  'concurrentRecoveredLeader', 'concurrentStopSkewBudgetNanos', 'concurrentStopSkewNanos',
  'concurrentQuorumUnavailableObserved', 'concurrentFailureBudgetNanos',
  'concurrentFailureElapsedNanos', 'persistedAfterConcurrentRecovery',
  'concurrentRecoveredStreamSequence', 'concurrentDeliveryCountBefore',
  'concurrentDeliveryCountAfter', 'concurrentRedeliveryObserved',
  'publishedAfterConcurrentRecovery', 'acknowledgedAfterConcurrentRecovery',
  'concurrentLeasePreflightPassed', 'connectionServerBeforeConcurrentFailure',
  'connectionServerDuringConcurrentFailure', 'connectionServerAfterConcurrentRecovery',
  'sameConnectionSessionAfterConcurrentRecovery', 'adapterSessionRecoveredAfterConcurrentRecovery',
  'concurrentReplicaRecoveryPassed', 'networkPartitionInjected', 'networkPartitionedServers',
  'networkPartitionLeader', 'networkPartitionConnectionServer', 'routeProxyConnectionsBefore',
  'routeProxyConnectionsClosed', 'partitionQuorumUnavailableObserved',
  'partitionFailureBudgetNanos', 'partitionFailureElapsedNanos', 'partitionRecoveredLeader',
  'persistedAfterPartitionRecovery', 'partitionRecoveredStreamSequence',
  'partitionDeliveryCountBefore', 'partitionDeliveryCountAfter', 'partitionRedeliveryObserved',
  'publishedAfterPartitionRecovery', 'acknowledgedAfterPartitionRecovery',
  'partitionLeasePreflightPassed', 'connectionServerAfterPartitionRecovery',
  'sameConnectionSessionAfterPartitionRecovery', 'adapterSessionRecoveredAfterPartitionRecovery',
  'partitionReplicaRecoveryPassed',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const nodeNamePattern = /^goexample-js-node-[123]$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`NATS cluster evidence: ${message}`);
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function requireExactKeys(value, expectedKeys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    reject(`${name} keys must be exactly ${expected.join(', ')}`);
  }
  return value;
}

function requireRegularFile(filePath, root, maximumBytes) {
  if (!existsSync(filePath)) {
    reject(`${relativePath(root, filePath)} is missing`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maximumBytes) {
    reject(`${relativePath(root, filePath)} must be a non-empty regular file no larger than ${maximumBytes} bytes`);
  }
  return filePath;
}

function describeFile(filePath, root) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1) {
    reject(`${relativePath(root, filePath)} must be a non-empty regular file and not a symbolic link`);
  }
  return {
    path: relativePath(root, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function optionalDescription(evidenceRoot, name) {
  const filePath = path.join(evidenceRoot, name);
  return existsSync(filePath) ? describeFile(filePath, evidenceRoot) : null;
}

function resolveEvidenceFile(evidenceRoot, value, name) {
  if (
    typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
    path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    reject(`${name} contains an unsafe path`);
  }
  const resolved = path.resolve(evidenceRoot, ...value.split('/'));
  const relative = path.relative(evidenceRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    reject(`${name} must stay inside the NATS cluster evidence directory`);
  }
  return resolved;
}

function verifyFileRecord(record, evidenceRoot, name, expectedName, maximumBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  if (value.path !== expectedName) {
    reject(`${name}.path must equal ${expectedName}`);
  }
  const filePath = resolveEvidenceFile(evidenceRoot, value.path, `${name}.path`);
  requireRegularFile(filePath, evidenceRoot, maximumBytes);
  const stats = lstatSync(filePath);
  if (!Number.isSafeInteger(value.bytes) || value.bytes !== stats.size) {
    reject(`${name} size mismatch`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256) || hashFile(filePath) !== value.sha256) {
    reject(`${name} hash mismatch`);
  }
  return filePath;
}

function requireTimestamp(value, name) {
  if (
    typeof value !== 'string' || !canonicalTimestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value
  ) {
    reject(`${name} must be a canonical UTC timestamp`);
  }
}

function requiredGoVersion(repositoryRoot) {
  const goMod = readFileSync(path.join(repositoryRoot, 'Framework', 'go.mod'), 'utf8');
  return goMod.match(/^toolchain go([0-9]+\.[0-9]+\.[0-9]+)$/m)?.[1]
    ?? goMod.match(/^go ([0-9]+\.[0-9]+(?:\.[0-9]+)?)$/m)?.[1]
    ?? reject('Framework/go.mod must declare a Go version');
}

function goPlatform(nodePlatform) {
  return nodePlatform === 'win32' ? 'windows' : nodePlatform;
}

function goArchitecture(nodeArchitecture) {
  return ({ x64: 'amd64', ia32: '386' })[nodeArchitecture] ?? nodeArchitecture;
}

function collectScope(repositoryRoot) {
  return {
    client: describeFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client.go'), repositoryRoot),
    worker: describeFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker.go'), repositoryRoot),
    adapter: describeFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter.go'), repositoryRoot),
    integrationTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'integration_test.go'),
      repositoryRoot,
    ),
    clusterTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'cluster_integration_test.go'),
      repositoryRoot,
    ),
    frameworkGoMod: describeFile(path.join(repositoryRoot, 'Framework', 'go.mod'), repositoryRoot),
    frameworkGoSum: describeFile(path.join(repositoryRoot, 'Framework', 'go.sum'), repositoryRoot),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'nats-cluster-evidence.mjs'), repositoryRoot),
    verifier: describeFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-cluster-evidence.mjs'), repositoryRoot),
    behaviorTest: describeFile(
      path.join(repositoryRoot, '__test__', 'node', 'nats-cluster-evidence.test.mjs'),
      repositoryRoot,
    ),
    runbook: describeFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), repositoryRoot),
    workflow: describeFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), repositoryRoot),
  };
}

function parseEnvironment(content) {
  const lines = content.split('\n');
  if (lines.at(-1) !== '') {
    reject('environment.txt must end with a newline');
  }
  lines.pop();
  const expectedNames = [
    'contract', 'runner_os', 'runner_arch', 'platform', 'architecture', 'node', 'go', 'docker',
    'git_commit', 'nats_image', 'nats_server_sha256', 'jetstream_enabled', 'storage',
    'target_nats_broker', 'rpo_rto', 'started_at', 'ended_at',
  ];
  if (lines.length !== expectedNames.length) {
    reject(`environment.txt must contain exactly ${expectedNames.length} fields`);
  }
  const values = {};
  for (let index = 0; index < expectedNames.length; index += 1) {
    const separator = lines[index].indexOf('=');
    const name = separator >= 0 ? lines[index].slice(0, separator) : '';
    const value = separator >= 0 ? lines[index].slice(separator + 1) : '';
    if (name !== expectedNames[index] || value.length === 0 || /[\r\n]/.test(value)) {
      reject(`environment.txt field ${index + 1} must be ${expectedNames[index]}`);
    }
    values[name] = value;
  }
  return values;
}

function readExitStatus(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^exit_code=(\d+)\n$/);
  if (!match) {
    reject('test-status.txt must contain exactly one numeric exit_code');
  }
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    reject('test-status.txt exit_code must be between 0 and 255');
  }
  return value;
}

function readBinaryChecksum(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^([a-f0-9]{64})  nats-server\n$/);
  if (!match) {
    reject('nats-server-binary.sha256 must contain exactly the copied binary checksum');
  }
  return match[1];
}

function extractPassedClusterTest(content) {
  const run = new RegExp(`^=== RUN   ${natsClusterGoTest}$`, 'm').test(content);
  const pass = new RegExp(`^--- PASS: ${natsClusterGoTest} `, 'm').test(content);
  const skip = new RegExp(`^--- SKIP: ${natsClusterGoTest} `, 'm').test(content);
  return run && pass && !skip ? [natsClusterGoTest] : [];
}

function checksumArtifactNames(evidenceRoot) {
  return [
    ...baseArtifactNames,
    ...clusterArtifactNames.filter((name) => existsSync(path.join(evidenceRoot, name))),
    'report.json',
  ];
}

export function buildNatsClusterChecksums(evidenceRoot) {
  return `${checksumArtifactNames(evidenceRoot)
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}`)
    .join('\n')}\n`;
}

export function verifyNatsClusterContractArtifacts({ evidenceRoot }) {
  const logPaths = [1, 2, 3].map((node) => requireRegularFile(
    path.join(evidenceRoot, `goexample-js-node-${node}.log`),
    evidenceRoot,
    16 * 1024 * 1024,
  ));
  const reportPath = requireRegularFile(
    path.join(evidenceRoot, 'cluster-failover-report.json'),
    evidenceRoot,
    256 * 1024,
  );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('cluster-failover-report.json must contain valid JSON');
  }
  const report = requireExactKeys(parsed, clusterReportKeys, 'cluster report');
  const nodeFields = [
    'oldLeader', 'newLeader', 'connectionServerBefore', 'connectionServerAfter',
    'secondOldLeader', 'secondNewLeader', 'connectionServerBeforeSecondFailover',
    'connectionServerAfterSecondFailover', 'quorumOldLeader', 'quorumRecoveredLeader',
    'connectionServerBeforeQuorumLoss', 'connectionServerDuringQuorumLoss',
    'connectionServerAfterQuorumRecovery', 'concurrentOldLeader', 'concurrentStoppedPeer',
    'concurrentSurvivor', 'concurrentRecoveredLeader', 'connectionServerBeforeConcurrentFailure',
    'connectionServerDuringConcurrentFailure', 'connectionServerAfterConcurrentRecovery',
    'networkPartitionLeader', 'networkPartitionConnectionServer', 'partitionRecoveredLeader',
    'connectionServerAfterPartitionRecovery',
  ];
  if (nodeFields.some((name) => !nodeNamePattern.test(report[name] ?? ''))) {
    reject('cluster report contains an invalid node identity');
  }
  if (
    report.oldLeader === report.newLeader || report.secondOldLeader !== report.newLeader ||
    report.secondOldLeader === report.oldLeader || report.secondNewLeader === report.secondOldLeader ||
    report.quorumOldLeader !== report.secondNewLeader || report.quorumOldLeader === report.secondOldLeader ||
    report.quorumRecoveredLeader === report.secondOldLeader ||
    report.concurrentOldLeader === report.concurrentStoppedPeer ||
    report.concurrentOldLeader === report.concurrentSurvivor ||
    report.concurrentStoppedPeer === report.concurrentSurvivor ||
    report.concurrentRecoveredLeader === report.concurrentStoppedPeer
  ) {
    reject('cluster report leader relationships are invalid');
  }
  if (
    report.schemaVersion !== 6 || report.status !== 'passed' ||
    report.storage !== expectedContract.storage || report.clusterSize !== expectedContract.clusterSize ||
    report.streamReplicas !== expectedContract.streamReplicas ||
    report.consumerReplicas !== expectedContract.consumerReplicas ||
    report.abruptLeaderStops !== expectedContract.abruptLeaderStops ||
    report.leaderChanged !== true || report.persistedBeforeFailover !== 3 ||
    report.persistedAfterFailover !== 4 || report.recoveredStreamSequence !== 1 ||
    report.deliveryCountBefore !== 1 || !Number.isSafeInteger(report.deliveryCountAfter) ||
    report.deliveryCountAfter < 2 || report.redeliveryObserved !== true ||
    report.publishedAfterFailover !== 1 || report.workerAcknowledged !== 2 ||
    report.deadLettered !== 1 || report.sourceAckPending !== 0 || report.sourceMessagesPending !== 0 ||
    report.survivingServers !== 2 || report.shortLeaseRejected !== true ||
    report.leasePreflightPassed !== true || report.requiredLeaseNanos !== 8_510_000_000 ||
    report.workerAckWaitNanos !== expectedContract.workerAckWaitNanos ||
    report.sameConnectionSession !== true || report.disconnectedObserved !== true ||
    report.reconnectedObserved !== true || report.connectionServerBefore !== report.oldLeader ||
    report.connectionServerAfter === report.connectionServerBefore || report.adapterSessionRecovered !== true ||
    report.restartedServers !== 3 || report.replicaRecoveryPassed !== true ||
    report.secondLeaderChanged !== true || report.distinctLeadersStopped !== true ||
    report.persistedAfterSecondFailover !== 6 || report.secondRecoveredStreamSequence !== 5 ||
    report.secondDeliveryCountBefore !== 1 || !Number.isSafeInteger(report.secondDeliveryCountAfter) ||
    report.secondDeliveryCountAfter < 2 || report.secondRedeliveryObserved !== true ||
    report.publishedAfterSecondFailover !== 1 || report.acknowledgedAfterSecondFailover !== 2 ||
    report.secondLeasePreflightPassed !== true ||
    report.connectionServerAfterSecondFailover === report.secondOldLeader ||
    report.sameConnectionSessionAfterSecondFailover !== true ||
    report.adapterSessionRecoveredAfterSecondFailover !== true || report.overlappingOfflineServers !== 2 ||
    report.quorumUnavailableObserved !== true || report.quorumFailureBudgetNanos !== 3_000_000_000 ||
    !Number.isSafeInteger(report.quorumFailureElapsedNanos) || report.quorumFailureElapsedNanos <= 0 ||
    report.quorumFailureElapsedNanos > report.quorumFailureBudgetNanos ||
    report.persistedAfterQuorumRecovery !== 8 || report.quorumRecoveredStreamSequence !== 7 ||
    report.quorumDeliveryCountBefore !== 1 || !Number.isSafeInteger(report.quorumDeliveryCountAfter) ||
    report.quorumDeliveryCountAfter < 2 || report.quorumRedeliveryObserved !== true ||
    report.publishedAfterQuorumRecovery !== 1 || report.acknowledgedAfterQuorumRecovery !== 2 ||
    report.quorumLeasePreflightPassed !== true ||
    report.connectionServerBeforeQuorumLoss === report.secondOldLeader ||
    report.connectionServerDuringQuorumLoss === report.secondOldLeader ||
    report.connectionServerDuringQuorumLoss === report.quorumOldLeader ||
    report.connectionServerAfterQuorumRecovery === report.secondOldLeader ||
    report.sameConnectionSessionAfterQuorumRecovery !== true ||
    report.adapterSessionRecoveredAfterQuorumRecovery !== true ||
    report.finalReplicaRecoveryPassed !== true || report.concurrentFaultInjected !== true ||
    report.concurrentStoppedServers !== expectedContract.concurrentStoppedServers ||
    report.concurrentStopSkewBudgetNanos !== 250_000_000 ||
    !Number.isSafeInteger(report.concurrentStopSkewNanos) || report.concurrentStopSkewNanos < 0 ||
    report.concurrentStopSkewNanos > report.concurrentStopSkewBudgetNanos ||
    report.concurrentQuorumUnavailableObserved !== true ||
    report.concurrentFailureBudgetNanos !== 3_000_000_000 ||
    !Number.isSafeInteger(report.concurrentFailureElapsedNanos) ||
    report.concurrentFailureElapsedNanos <= 0 ||
    report.concurrentFailureElapsedNanos > report.concurrentFailureBudgetNanos ||
    report.persistedAfterConcurrentRecovery !== 10 || report.concurrentRecoveredStreamSequence !== 9 ||
    report.concurrentDeliveryCountBefore !== 1 || !Number.isSafeInteger(report.concurrentDeliveryCountAfter) ||
    report.concurrentDeliveryCountAfter < 2 || report.concurrentRedeliveryObserved !== true ||
    report.publishedAfterConcurrentRecovery !== 1 || report.acknowledgedAfterConcurrentRecovery !== 2 ||
    report.concurrentLeasePreflightPassed !== true ||
    report.connectionServerBeforeConcurrentFailure === report.concurrentStoppedPeer ||
    report.connectionServerDuringConcurrentFailure !== report.concurrentSurvivor ||
    report.connectionServerAfterConcurrentRecovery === report.concurrentStoppedPeer ||
    report.sameConnectionSessionAfterConcurrentRecovery !== true ||
    report.adapterSessionRecoveredAfterConcurrentRecovery !== true ||
    report.concurrentReplicaRecoveryPassed !== true || report.networkPartitionInjected !== true ||
    report.networkPartitionedServers !== expectedContract.networkPartitionedServers ||
    report.networkPartitionLeader === report.networkPartitionConnectionServer ||
    !Number.isSafeInteger(report.routeProxyConnectionsBefore) || report.routeProxyConnectionsBefore < 3 ||
    !Number.isSafeInteger(report.routeProxyConnectionsClosed) || report.routeProxyConnectionsClosed < 3 ||
    report.partitionQuorumUnavailableObserved !== true ||
    report.partitionFailureBudgetNanos !== 3_000_000_000 ||
    !Number.isSafeInteger(report.partitionFailureElapsedNanos) || report.partitionFailureElapsedNanos <= 0 ||
    report.partitionFailureElapsedNanos > report.partitionFailureBudgetNanos ||
    report.persistedAfterPartitionRecovery !== 12 || report.partitionRecoveredStreamSequence !== 11 ||
    report.partitionDeliveryCountBefore !== 1 || !Number.isSafeInteger(report.partitionDeliveryCountAfter) ||
    report.partitionDeliveryCountAfter < 2 || report.partitionRedeliveryObserved !== true ||
    report.publishedAfterPartitionRecovery !== 1 || report.acknowledgedAfterPartitionRecovery !== 2 ||
    report.partitionLeasePreflightPassed !== true ||
    report.connectionServerAfterPartitionRecovery !== report.networkPartitionConnectionServer ||
    report.sameConnectionSessionAfterPartitionRecovery !== true ||
    report.adapterSessionRecoveredAfterPartitionRecovery !== true ||
    report.partitionReplicaRecoveryPassed !== true
  ) {
    reject('cluster report does not satisfy the fixed three-node failover and route-partition contract');
  }

  const logs = Object.fromEntries(logPaths.map((logPath, index) => [
    `goexample-js-node-${index + 1}`,
    readFileSync(logPath, 'utf8'),
  ]));
  const readLog = (node) => logs[node] ?? reject(`node log is missing for ${node}`);
  const totalServerStarts = Object.values(logs).reduce(
    (count, log) => count + (log.match(/Starting nats-server/g) ?? []).length,
    0,
  );
  const streamLeaderMarker = "JetStream cluster new stream leader for '$G > GOEXAMPLE_FAILOVER_SOURCE'";
  for (const node of Object.keys(logs)) {
    if (!logs[node].includes(`Name:     ${node}`) || !logs[node].includes('Version:  2.14.5')) {
      reject(`${node}.log does not bind the expected server identity and version`);
    }
  }
  if (
    totalServerStarts !== 8 ||
    (readLog(report.oldLeader).match(/Starting nats-server/g) ?? []).length < 2 ||
    !readLog(report.oldLeader).includes(streamLeaderMarker) ||
    !readLog(report.newLeader).includes(streamLeaderMarker) ||
    !readLog(report.secondNewLeader).includes(streamLeaderMarker) ||
    (readLog(report.secondOldLeader).match(/Starting nats-server/g) ?? []).length < 2 ||
    (readLog(report.quorumOldLeader).match(/Starting nats-server/g) ?? []).length < 2 ||
    !readLog(report.quorumRecoveredLeader).includes(streamLeaderMarker) ||
    (readLog(report.concurrentOldLeader).match(/Starting nats-server/g) ?? []).length < 2 ||
    (readLog(report.concurrentStoppedPeer).match(/Starting nats-server/g) ?? []).length < 2 ||
    !readLog(report.concurrentRecoveredLeader).includes(streamLeaderMarker) ||
    !readLog(report.networkPartitionLeader).includes(streamLeaderMarker) ||
    !readLog(report.partitionRecoveredLeader).includes(streamLeaderMarker)
  ) {
    reject('cluster logs do not satisfy the fixed server-start and stream-leader evidence contract');
  }
  return { report, artifactPaths: [...logPaths, reportPath] };
}

export function buildNatsClusterEvidenceReport({ repositoryRoot, evidenceRoot }) {
  for (const name of baseArtifactNames) {
    requireRegularFile(
      path.join(evidenceRoot, name),
      evidenceRoot,
      name === 'nats-server' ? 64 * 1024 * 1024 : 8 * 1024 * 1024,
    );
  }
  const environment = parseEnvironment(readFileSync(path.join(evidenceRoot, 'environment.txt'), 'utf8'));
  const exitCode = readExitStatus(path.join(evidenceRoot, 'test-status.txt'));
  const testOutput = readFileSync(path.join(evidenceRoot, 'test-output.txt'), 'utf8');
  const clusterComplete = clusterArtifactNames.every((name) => existsSync(path.join(evidenceRoot, name)));
  const error = exitCode === 0 && clusterComplete
    ? null
    : clusterComplete
      ? `Go contract exited with code ${exitCode}`
      : 'cluster contract artifacts are incomplete';
  return {
    schemaVersion: natsClusterEvidenceSchemaVersion,
    status: exitCode === 0 && clusterComplete ? 'passed' : 'failed',
    command: [...expectedCommand],
    contract: { ...expectedContract },
    runtime: {
      runnerOS: environment.runner_os,
      runnerArch: environment.runner_arch,
      platform: environment.platform,
      architecture: environment.architecture,
      nodeVersion: environment.node,
      goVersion: environment.go,
      dockerVersion: environment.docker,
    },
    source: {
      gitCommit: environment.git_commit,
      image: environment.nats_image,
      natsServerSHA256: environment.nats_server_sha256,
    },
    scope: collectScope(repositoryRoot),
    execution: {
      startedAt: environment.started_at,
      endedAt: environment.ended_at,
      exitCode,
      error,
    },
    goTests: {
      expected: [natsClusterGoTest],
      passed: extractPassedClusterTest(testOutput),
    },
    outputs: {
      environment: describeFile(path.join(evidenceRoot, 'environment.txt'), evidenceRoot),
      testOutput: describeFile(path.join(evidenceRoot, 'test-output.txt'), evidenceRoot),
      testStatus: describeFile(path.join(evidenceRoot, 'test-status.txt'), evidenceRoot),
      natsServer: describeFile(path.join(evidenceRoot, 'nats-server'), evidenceRoot),
      natsServerChecksum: describeFile(path.join(evidenceRoot, 'nats-server-binary.sha256'), evidenceRoot),
      node1Log: optionalDescription(evidenceRoot, 'goexample-js-node-1.log'),
      node2Log: optionalDescription(evidenceRoot, 'goexample-js-node-2.log'),
      node3Log: optionalDescription(evidenceRoot, 'goexample-js-node-3.log'),
      clusterReport: optionalDescription(evidenceRoot, 'cluster-failover-report.json'),
    },
    limitations: [...limitations],
  };
}

export function verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = requireRegularFile(path.join(evidenceRoot, 'report.json'), evidenceRoot, 256 * 1024);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('report.json must contain valid JSON');
  }
  const report = requireExactKeys(
    parsed,
    [
      'command', 'contract', 'execution', 'goTests', 'limitations', 'outputs', 'runtime',
      'schemaVersion', 'scope', 'source', 'status',
    ],
    'report',
  );
  if (report.schemaVersion !== natsClusterEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${natsClusterEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed real NATS contract invocation');
  }
  if (JSON.stringify(report.contract) !== JSON.stringify(expectedContract)) {
    reject('contract must preserve the fixed three-node failover and route-partition semantics');
  }
  const runtime = requireExactKeys(
    report.runtime,
    ['architecture', 'dockerVersion', 'goVersion', 'nodeVersion', 'platform', 'runnerArch', 'runnerOS'],
    'runtime',
  );
  const nodeMatch = `${runtime.nodeVersion ?? ''}`.match(/^v(\d+)\.\d+\.\d+$/);
  if (!nodeMatch || Number(nodeMatch[1]) < 20) {
    reject('runtime.nodeVersion must identify a supported Node.js release');
  }
  for (const name of ['platform', 'architecture']) {
    if (typeof runtime[name] !== 'string' || !/^[a-z0-9_]{2,32}$/.test(runtime[name])) {
      reject(`runtime.${name} must be a bounded platform identifier`);
    }
  }
  for (const name of ['runnerOS', 'runnerArch', 'dockerVersion']) {
    if (typeof runtime[name] !== 'string' || runtime[name].length < 1 || runtime[name].length > 128 || /[\r\n]/.test(runtime[name])) {
      reject(`runtime.${name} must be a bounded runtime identifier`);
    }
  }
  const expectedGo = `go version go${requiredGoVersion(repositoryRoot)} ${goPlatform(runtime.platform)}/${goArchitecture(runtime.architecture)}`;
  if (runtime.goVersion !== expectedGo) {
    reject('runtime.goVersion must match the pinned Go toolchain and Node runtime');
  }
  const source = requireExactKeys(report.source, ['gitCommit', 'image', 'natsServerSHA256'], 'source');
  if (
    !/^[a-f0-9]{40}$/.test(source.gitCommit ?? '') || source.image !== expectedImage ||
    typeof source.natsServerSHA256 !== 'string' || !sha256Pattern.test(source.natsServerSHA256)
  ) {
    reject('source must bind the commit, exact NATS image, and copied server binary');
  }
  if (JSON.stringify(report.scope) !== JSON.stringify(collectScope(repositoryRoot))) {
    reject('scope no longer matches the queue client, adapter, tests, toolchain, runner, verifier, runbook, and workflow');
  }
  const execution = requireExactKeys(report.execution, ['endedAt', 'error', 'exitCode', 'startedAt'], 'execution');
  requireTimestamp(execution.startedAt, 'execution.startedAt');
  requireTimestamp(execution.endedAt, 'execution.endedAt');
  const duration = Date.parse(execution.endedAt) - Date.parse(execution.startedAt);
  if (duration < 0 || duration > 10 * 60 * 1000) {
    reject('execution timestamps must describe a non-negative run no longer than ten minutes');
  }
  if (!Number.isSafeInteger(execution.exitCode) || execution.exitCode < 0 || execution.exitCode > 255) {
    reject('execution.exitCode must be an integer between 0 and 255');
  }
  const goTests = requireExactKeys(report.goTests, ['expected', 'passed'], 'goTests');
  if (JSON.stringify(goTests.expected) !== JSON.stringify([natsClusterGoTest])) {
    reject('goTests.expected must contain the fixed cluster failover contract');
  }
  if (
    !Array.isArray(goTests.passed) || goTests.passed.length > 1 ||
    (goTests.passed.length === 1 && goTests.passed[0] !== natsClusterGoTest)
  ) {
    reject('goTests.passed must be an ordered subset of the fixed cluster failover contract');
  }
  const outputs = requireExactKeys(
    report.outputs,
    [
      'clusterReport', 'environment', 'natsServer', 'natsServerChecksum', 'node1Log',
      'node2Log', 'node3Log', 'testOutput', 'testStatus',
    ],
    'outputs',
  );
  const environmentPath = verifyFileRecord(outputs.environment, evidenceRoot, 'outputs.environment', 'environment.txt', 64 * 1024);
  const testOutputPath = verifyFileRecord(outputs.testOutput, evidenceRoot, 'outputs.testOutput', 'test-output.txt', 8 * 1024 * 1024);
  const testStatusPath = verifyFileRecord(outputs.testStatus, evidenceRoot, 'outputs.testStatus', 'test-status.txt', 1024);
  const natsServerPath = verifyFileRecord(outputs.natsServer, evidenceRoot, 'outputs.natsServer', 'nats-server', 64 * 1024 * 1024);
  const natsServerChecksumPath = verifyFileRecord(
    outputs.natsServerChecksum,
    evidenceRoot,
    'outputs.natsServerChecksum',
    'nats-server-binary.sha256',
    1024,
  );
  const optionalPaths = {};
  for (const [key, name, maximumBytes] of [
    ['node1Log', 'goexample-js-node-1.log', 16 * 1024 * 1024],
    ['node2Log', 'goexample-js-node-2.log', 16 * 1024 * 1024],
    ['node3Log', 'goexample-js-node-3.log', 16 * 1024 * 1024],
    ['clusterReport', 'cluster-failover-report.json', 256 * 1024],
  ]) {
    const fileExists = existsSync(path.join(evidenceRoot, name));
    if (outputs[key] === null) {
      if (fileExists) {
        reject(`outputs.${key} must describe the existing ${name}`);
      }
      optionalPaths[key] = null;
    } else {
      optionalPaths[key] = verifyFileRecord(outputs[key], evidenceRoot, `outputs.${key}`, name, maximumBytes);
    }
  }
  const clusterComplete = Object.values(optionalPaths).every((value) => value !== null);
  const expectedStatus = execution.exitCode === 0 && clusterComplete && execution.error === null ? 'passed' : 'failed';
  if (report.status !== expectedStatus) {
    reject('status must match the Go exit, cluster artifact completeness, and execution error');
  }
  if (report.status === 'passed' && JSON.stringify(goTests.passed) !== JSON.stringify([natsClusterGoTest])) {
    reject('passed evidence must contain the non-skipped cluster failover Go contract');
  }
  if (
    report.status === 'failed' &&
    (typeof execution.error !== 'string' || execution.error.length === 0 || execution.error.length > 4096 || /\r/.test(execution.error))
  ) {
    reject('failed execution.error must contain a bounded error');
  }
  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    contract: 'nats-jetstream-cluster-failover',
    runner_os: runtime.runnerOS,
    runner_arch: runtime.runnerArch,
    platform: runtime.platform,
    architecture: runtime.architecture,
    node: runtime.nodeVersion,
    go: runtime.goVersion,
    docker: runtime.dockerVersion,
    git_commit: source.gitCommit,
    nats_image: source.image,
    nats_server_sha256: source.natsServerSHA256,
    jetstream_enabled: 'true',
    storage: 'file-stream',
    target_nats_broker: 'not_recorded',
    rpo_rto: 'not_approved',
    started_at: execution.startedAt,
    ended_at: execution.endedAt,
  };
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    reject('environment.txt no longer matches the archived runtime, source, execution, and local-only boundary');
  }
  if (
    hashFile(natsServerPath) !== source.natsServerSHA256 ||
    readBinaryChecksum(natsServerChecksumPath) !== source.natsServerSHA256
  ) {
    reject('copied NATS server binary no longer matches its archived SHA-256');
  }
  if (readExitStatus(testStatusPath) !== execution.exitCode) {
    reject('test-status.txt no longer matches execution.exitCode');
  }
  const testOutput = readFileSync(testOutputPath, 'utf8');
  if (JSON.stringify(extractPassedClusterTest(testOutput)) !== JSON.stringify(goTests.passed)) {
    reject('test-output.txt no longer matches the reported cluster Go contract result');
  }
  if (
    report.status === 'passed' &&
    (
      !new RegExp(`^=== RUN   ${natsClusterGoTest}$`, 'm').test(testOutput) ||
      !new RegExp(`^--- PASS: ${natsClusterGoTest} `, 'm').test(testOutput) ||
      new RegExp(`^--- SKIP: ${natsClusterGoTest} `, 'm').test(testOutput) ||
      !/^PASS$/m.test(testOutput)
    )
  ) {
    reject('passed test-output.txt must contain the non-skipped cluster Go contract and final PASS');
  }
  if (clusterComplete) {
    verifyNatsClusterContractArtifacts({ evidenceRoot });
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only NATS cluster boundary');
  }
  const checksumPath = requireRegularFile(path.join(evidenceRoot, 'SHA256SUMS'), evidenceRoot, 32 * 1024);
  if (readFileSync(checksumPath, 'utf8') !== buildNatsClusterChecksums(evidenceRoot)) {
    reject('SHA256SUMS must contain the exact ordered NATS cluster evidence artifact set');
  }
  return {
    report,
    artifactPaths: [...checksumArtifactNames(evidenceRoot), 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, name)))
      .sort(),
  };
}
