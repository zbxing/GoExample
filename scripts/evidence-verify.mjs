import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultManifest = path.join(tempRoot, 'evidence', 'manifest.json');
const evidenceCategories = [
  'coverage',
  'benchmark',
  'profiles',
  'sbom',
  'scans',
  'workflowArtifacts',
  'deployment',
  'recovery',
  'natsRestart',
  'natsSnapshot',
  'natsCluster',
  'release',
];
const boundaryNames = [
  'linuxRemoteBenchmark',
  'productionSharedStore',
  'otelCollector',
  'postgresRecovery',
  'natsBroker',
  'localNatsRestart',
  'localNatsSnapshotRestore',
  'localNatsClusterFailover',
  'oidcProvider',
  'signedRelease',
  'targetEdge',
  'kubernetesDrill',
];
const boundaryStatuses = new Set(['recorded', 'failed', 'not_recorded']);
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Evidence verification: ${message}`);
  process.exit(1);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseManifestArgument() {
  const args = process.argv.slice(2);
  let manifest = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--manifest') {
      if (manifest !== null) {
        fail('manifest may only be specified once');
      }
      manifest = args[index + 1];
      index += 1;
      if (!manifest || manifest.startsWith('--')) {
        fail('--manifest requires a path');
      }
      continue;
    }
    if (argument.startsWith('--manifest=')) {
      if (manifest !== null) {
        fail('manifest may only be specified once');
      }
      manifest = argument.slice('--manifest='.length);
      if (!manifest) {
        fail('--manifest requires a path');
      }
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  return manifest;
}

function resolveManifestPath() {
  const requested = parseManifestArgument();
  const manifestPath = path.resolve(repositoryRoot, requested ?? path.relative(repositoryRoot, defaultManifest));
  const relativeToTemp = path.relative(tempRoot, manifestPath);
  if (
    !relativeToTemp ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp) ||
    !relativeToTemp.toLowerCase().endsWith('.json')
  ) {
    fail('manifest must be a .json file inside the repository .temp directory');
  }
  if (!existsSync(manifestPath)) {
    fail(`manifest does not exist: ${relativePath(manifestPath)}`);
  }
  const stats = lstatSync(manifestPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail('manifest must be a regular file and not a symbolic link');
  }
  return manifestPath;
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a non-negative safe integer`);
  }
}

function resolveRecordedPath(value, parent, name) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${name} contains an unsafe path`);
  }
  const resolved = path.resolve(repositoryRoot, ...value.split('/'));
  if (!isWithin(parent, resolved)) {
    fail(`${name} escapes its allowed directory`);
  }
  return resolved;
}

function verifyFile(record, parent, name) {
  const item = requireObject(record, name);
  const filePath = resolveRecordedPath(item.path, parent, `${name}.path`);
  if (!existsSync(filePath)) {
    fail(`${name} is missing: ${item.path}`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`${name} must resolve to a regular file: ${item.path}`);
  }
  requireNonNegativeInteger(item.bytes, `${name}.bytes`);
  if (stats.size !== item.bytes) {
    fail(`${name} size mismatch: ${item.path}`);
  }
  if (typeof item.sha256 !== 'string' || !sha256Pattern.test(item.sha256)) {
    fail(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== item.sha256) {
    fail(`${name} hash mismatch: ${item.path}`);
  }
  return item.path;
}

function verifyInputs(inputs) {
  if (!Array.isArray(inputs)) {
    fail('inputs must be an array');
  }
  const paths = new Set();
  for (const [index, rawInput] of inputs.entries()) {
    const name = `inputs[${index}]`;
    const input = requireObject(rawInput, name);
    const filePath = resolveRecordedPath(input.path, repositoryRoot, `${name}.path`);
    if (paths.has(input.path)) {
      fail(`inputs contains duplicate path: ${input.path}`);
    }
    paths.add(input.path);
    if (typeof input.present !== 'boolean') {
      fail(`${name}.present must be a boolean`);
    }
    if (!input.present) {
      if (existsSync(filePath)) {
        fail(`${name} was recorded absent but now exists: ${input.path}`);
      }
      continue;
    }
    verifyFile(input, repositoryRoot, name);
  }
  return paths.size;
}

function verifyEvidence(evidence) {
  const document = requireObject(evidence, 'evidence');
  const paths = new Set();
  let count = 0;
  for (const category of evidenceCategories) {
    const artifacts = document[category];
    if (!Array.isArray(artifacts)) {
      fail(`evidence.${category} must be an array`);
    }
    for (const [index, artifact] of artifacts.entries()) {
      const name = `evidence.${category}[${index}]`;
      const artifactPath = verifyFile(artifact, tempRoot, name);
      if (paths.has(artifactPath)) {
        fail(`evidence contains duplicate artifact path: ${artifactPath}`);
      }
      paths.add(artifactPath);
      count += 1;
    }
  }
  for (const category of Object.keys(document)) {
    if (!evidenceCategories.includes(category)) {
      fail(`evidence contains unknown category: ${category}`);
    }
  }
  return { count, paths };
}

function verifyBoundaries(boundaries, evidencePaths) {
  const document = requireObject(boundaries, 'boundaries');
  for (const name of boundaryNames) {
    const boundary = requireObject(document[name], `boundaries.${name}`);
    if (!boundaryStatuses.has(boundary.status)) {
      fail(`boundaries.${name}.status must be recorded, failed, or not_recorded`);
    }
    if (typeof boundary.reason !== 'string' || boundary.reason.trim().length === 0) {
      fail(`boundaries.${name}.reason must be non-empty`);
    }
  }
  for (const name of Object.keys(document)) {
    if (!boundaryNames.includes(name)) {
      fail(`boundaries contains unknown entry: ${name}`);
    }
  }
  if (document.localNatsRestart.status === 'recorded') {
    const root = '.temp/nats-restart-evidence';
    const requiredNames = ['nats-before-restart.log', 'nats-after-restart.log', 'restart-report.json'];
    for (const relativeName of requiredNames) {
      const artifactPath = `${root}/${relativeName}`;
      if (!evidencePaths.has(artifactPath)) {
        fail(`recorded localNatsRestart is missing required artifact: ${artifactPath}`);
      }
      if (lstatSync(path.join(repositoryRoot, artifactPath)).size === 0) {
        fail(`recorded localNatsRestart artifact is empty: ${artifactPath}`);
      }
    }
    let report;
    try {
      report = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'restart-report.json'), 'utf8'));
    } catch {
      fail('recorded localNatsRestart requires a valid restart-report.json');
    }
    if (
      report?.schemaVersion !== 1 ||
      report?.status !== 'passed' ||
      report?.storage !== 'file' ||
      report?.replicas !== 1 ||
      report?.abruptRestarts !== 1 ||
      report?.persistedMessages !== 3 ||
      !Number.isSafeInteger(report?.recoveredStreamSequence) ||
      report.recoveredStreamSequence <= 0 ||
      report?.deliveryCountBeforeRestart !== 1 ||
      report?.deliveryCountAfterRestart !== 1 ||
      report?.redeliveryObserved !== true ||
      report?.acknowledged !== 1 ||
      report?.deadLettered !== 1 ||
      report?.sourceAckPending !== 0 ||
      report?.sourceMessagesPending !== 0 ||
      report?.shortLeaseRejected !== true ||
      report?.leasePreflightPassed !== true ||
      !Number.isSafeInteger(report?.requiredLeaseNanos) ||
      report.requiredLeaseNanos <= 0 ||
      !Number.isSafeInteger(report?.workerAckWaitNanos) ||
      report.workerAckWaitNanos < report.requiredLeaseNanos
    ) {
      fail('recorded localNatsRestart report does not satisfy the single-node restart contract');
    }
  }
  if (document.localNatsSnapshotRestore.status === 'recorded') {
    const root = '.temp/nats-snapshot-evidence';
    const requiredNames = [
      'nats-snapshot-restore.log',
      'source-stream.snapshot',
      'snapshot-restore-report.json',
    ];
    for (const relativeName of requiredNames) {
      const artifactPath = `${root}/${relativeName}`;
      if (!evidencePaths.has(artifactPath)) {
        fail(`recorded localNatsSnapshotRestore is missing required artifact: ${artifactPath}`);
      }
      if (lstatSync(path.join(repositoryRoot, artifactPath)).size === 0) {
        fail(`recorded localNatsSnapshotRestore artifact is empty: ${artifactPath}`);
      }
    }
    let report;
    try {
      report = JSON.parse(
        readFileSync(path.join(repositoryRoot, root, 'snapshot-restore-report.json'), 'utf8'),
      );
    } catch {
      fail('recorded localNatsSnapshotRestore requires a valid snapshot-restore-report.json');
    }
    const snapshotPath = path.join(repositoryRoot, root, 'source-stream.snapshot');
    const serverLog = readFileSync(path.join(repositoryRoot, root, 'nats-snapshot-restore.log'), 'utf8');
    if (
      report?.schemaVersion !== 1 ||
      report?.status !== 'passed' ||
      report?.storage !== 'file' ||
      report?.replicas !== 1 ||
      report?.snapshotIncludesConsumers !== true ||
      report?.snapshotCheckedMessages !== true ||
      !Number.isSafeInteger(report?.snapshotBytes) ||
      report.snapshotBytes <= 0 ||
      typeof report?.snapshotSHA256 !== 'string' ||
      !sha256Pattern.test(report.snapshotSHA256) ||
      !Number.isSafeInteger(report?.snapshotChunks) ||
      report.snapshotChunks < 2 ||
      report?.checkpointMessages !== 3 ||
      report?.checkpointFirstSequence !== 1 ||
      report?.checkpointLastSequence !== 3 ||
      report?.postCheckpointMessages !== 1 ||
      report?.messagesBeforeDelete !== 4 ||
      report?.restoredMessages !== 3 ||
      report?.postCheckpointExcluded !== true ||
      report?.tamperedSnapshotRejected !== true ||
      report?.consumerRestored !== true ||
      report?.ackPendingBeforeSnapshot !== 1 ||
      report?.messagesPendingBeforeSnapshot !== 1 ||
      report?.ackPendingAfterRestore !== 1 ||
      report?.messagesPendingAfterRestore !== 1 ||
      report?.unacknowledgedSequence !== 2 ||
      report?.recoveredSequence !== report.unacknowledgedSequence ||
      report?.sameSequenceRedelivered !== true ||
      report?.acknowledgedAfterRestore !== 1 ||
      report?.deadLetteredAfterRestore !== 1 ||
      report?.sourceAckPending !== 0 ||
      report?.sourceMessagesPending !== 0 ||
      !Number.isSafeInteger(report?.restoreElapsedNanos) ||
      report.restoreElapsedNanos <= 0 ||
      report?.restoreBudgetNanos !== 15_000_000_000 ||
      report.restoreElapsedNanos > report.restoreBudgetNanos ||
      lstatSync(snapshotPath).size !== report.snapshotBytes ||
      hashFile(snapshotPath) !== report.snapshotSHA256 ||
      !serverLog.includes('Starting nats-server') ||
      !serverLog.includes('Starting health check and snapshot') ||
      !serverLog.includes('Completed snapshot') ||
      !serverLog.includes('Starting restore') ||
      !serverLog.includes('Completed restore')
    ) {
      fail('recorded localNatsSnapshotRestore does not satisfy the bounded file-stream restore contract');
    }
  }
  if (document.localNatsClusterFailover.status === 'recorded') {
    const root = '.temp/nats-cluster-evidence';
    const requiredNames = [
      'goexample-js-node-1.log',
      'goexample-js-node-2.log',
      'goexample-js-node-3.log',
      'cluster-failover-report.json',
    ];
    for (const relativeName of requiredNames) {
      const artifactPath = `${root}/${relativeName}`;
      if (!evidencePaths.has(artifactPath)) {
        fail(`recorded localNatsClusterFailover is missing required artifact: ${artifactPath}`);
      }
      if (lstatSync(path.join(repositoryRoot, artifactPath)).size === 0) {
        fail(`recorded localNatsClusterFailover artifact is empty: ${artifactPath}`);
      }
    }
    let report;
    try {
      report = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'cluster-failover-report.json'), 'utf8'));
    } catch {
      fail('recorded localNatsClusterFailover requires a valid cluster-failover-report.json');
    }
    const clusterNodeNamePattern = /^goexample-js-node-[123]$/;
    if (
      !clusterNodeNamePattern.test(report?.oldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.newLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.secondOldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.secondNewLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.quorumOldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.quorumRecoveredLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentOldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentStoppedPeer ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentSurvivor ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentRecoveredLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.networkPartitionLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.networkPartitionConnectionServer ?? '') ||
      !clusterNodeNamePattern.test(report?.partitionRecoveredLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.connectionServerAfterPartitionRecovery ?? '') ||
      report.oldLeader === report.newLeader ||
      report.secondOldLeader !== report.newLeader ||
      report.secondOldLeader === report.oldLeader ||
      report.secondNewLeader === report.secondOldLeader ||
      report.quorumOldLeader !== report.secondNewLeader ||
      report.quorumOldLeader === report.secondOldLeader ||
      report.quorumRecoveredLeader === report.secondOldLeader ||
      report.concurrentOldLeader === report.concurrentStoppedPeer ||
      report.concurrentOldLeader === report.concurrentSurvivor ||
      report.concurrentStoppedPeer === report.concurrentSurvivor ||
      report.concurrentRecoveredLeader === report.concurrentStoppedPeer ||
      report.networkPartitionLeader === report.networkPartitionConnectionServer ||
      report.connectionServerAfterPartitionRecovery !== report.networkPartitionConnectionServer
    ) {
      fail('recorded localNatsClusterFailover report contains an invalid leader identity');
    }
    let oldLeaderLog = '';
    let newLeaderLog = '';
    let secondNewLeaderLog = '';
    let secondOldLeaderLog = '';
    let quorumOldLeaderLog = '';
    let quorumRecoveredLeaderLog = '';
    let connectionServerAfterLog = '';
    let connectionServerAfterSecondLog = '';
    let connectionServerDuringQuorumLog = '';
    let connectionServerAfterQuorumLog = '';
    let concurrentOldLeaderLog = '';
    let concurrentStoppedPeerLog = '';
    let concurrentRecoveredLeaderLog = '';
    let connectionServerDuringConcurrentLog = '';
    let connectionServerAfterConcurrentLog = '';
    let networkPartitionLeaderLog = '';
    let partitionRecoveredLeaderLog = '';
    let connectionServerAfterPartitionLog = '';
    let totalServerStarts = 0;
    try {
      oldLeaderLog = readFileSync(path.join(repositoryRoot, root, `${report?.oldLeader ?? 'invalid'}.log`), 'utf8');
      newLeaderLog = readFileSync(path.join(repositoryRoot, root, `${report?.newLeader ?? 'invalid'}.log`), 'utf8');
      secondNewLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.secondNewLeader ?? 'invalid'}.log`),
        'utf8',
      );
      secondOldLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.secondOldLeader ?? 'invalid'}.log`),
        'utf8',
      );
      quorumOldLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.quorumOldLeader ?? 'invalid'}.log`),
        'utf8',
      );
      quorumRecoveredLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.quorumRecoveredLeader ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerAfterLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerAfter ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerAfterSecondLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerAfterSecondFailover ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerDuringQuorumLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerDuringQuorumLoss ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerAfterQuorumLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerAfterQuorumRecovery ?? 'invalid'}.log`),
        'utf8',
      );
      concurrentOldLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.concurrentOldLeader ?? 'invalid'}.log`),
        'utf8',
      );
      concurrentStoppedPeerLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.concurrentStoppedPeer ?? 'invalid'}.log`),
        'utf8',
      );
      concurrentRecoveredLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.concurrentRecoveredLeader ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerDuringConcurrentLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerDuringConcurrentFailure ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerAfterConcurrentLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerAfterConcurrentRecovery ?? 'invalid'}.log`),
        'utf8',
      );
      networkPartitionLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.networkPartitionLeader ?? 'invalid'}.log`),
        'utf8',
      );
      partitionRecoveredLeaderLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.partitionRecoveredLeader ?? 'invalid'}.log`),
        'utf8',
      );
      connectionServerAfterPartitionLog = readFileSync(
        path.join(repositoryRoot, root, `${report?.connectionServerAfterPartitionRecovery ?? 'invalid'}.log`),
        'utf8',
      );
      totalServerStarts = [1, 2, 3].reduce((count, node) => {
        const log = readFileSync(path.join(repositoryRoot, root, `goexample-js-node-${node}.log`), 'utf8');
        return count + (log.match(/Starting nats-server/g) ?? []).length;
      }, 0);
    } catch {
      fail('recorded localNatsClusterFailover report leaders must resolve to archived node logs');
    }
    const streamLeaderMarker = "JetStream cluster new stream leader for '$G > GOEXAMPLE_FAILOVER_SOURCE'";
    if (
      report?.schemaVersion !== 6 ||
      report?.status !== 'passed' ||
      report?.storage !== 'file' ||
      report?.clusterSize !== 3 ||
      report?.streamReplicas !== 3 ||
      report?.consumerReplicas !== 3 ||
      report?.abruptLeaderStops !== 3 ||
      !clusterNodeNamePattern.test(report?.oldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.newLeader ?? '') ||
      report.oldLeader === report.newLeader ||
      report?.leaderChanged !== true ||
      report?.persistedBeforeFailover !== 3 ||
      report?.persistedAfterFailover !== 4 ||
      report?.recoveredStreamSequence !== 1 ||
      report?.deliveryCountBefore !== 1 ||
      !Number.isSafeInteger(report?.deliveryCountAfter) ||
      report.deliveryCountAfter < 2 ||
      report?.redeliveryObserved !== true ||
      report?.publishedAfterFailover !== 1 ||
      report?.workerAcknowledged !== 2 ||
      report?.deadLettered !== 1 ||
      report?.sourceAckPending !== 0 ||
      report?.sourceMessagesPending !== 0 ||
      report?.survivingServers !== 2 ||
      report?.shortLeaseRejected !== true ||
      report?.leasePreflightPassed !== true ||
      !Number.isSafeInteger(report?.requiredLeaseNanos) ||
      report.requiredLeaseNanos <= 0 ||
      !Number.isSafeInteger(report?.workerAckWaitNanos) ||
      report.workerAckWaitNanos < report.requiredLeaseNanos ||
      report?.sameConnectionSession !== true ||
      report?.disconnectedObserved !== true ||
      report?.reconnectedObserved !== true ||
      report?.connectionServerBefore !== report.oldLeader ||
      !clusterNodeNamePattern.test(report?.connectionServerAfter ?? '') ||
      report.connectionServerAfter === report.connectionServerBefore ||
      report?.adapterSessionRecovered !== true ||
      report?.restartedServers !== 3 ||
      report?.replicaRecoveryPassed !== true ||
      report?.secondOldLeader !== report.newLeader ||
      report.secondOldLeader === report.oldLeader ||
      !clusterNodeNamePattern.test(report?.secondNewLeader ?? '') ||
      report.secondNewLeader === report.secondOldLeader ||
      report?.secondLeaderChanged !== true ||
      report?.distinctLeadersStopped !== true ||
      report?.persistedAfterSecondFailover !== 6 ||
      report?.secondRecoveredStreamSequence !== 5 ||
      report?.secondDeliveryCountBefore !== 1 ||
      !Number.isSafeInteger(report?.secondDeliveryCountAfter) ||
      report.secondDeliveryCountAfter < 2 ||
      report?.secondRedeliveryObserved !== true ||
      report?.publishedAfterSecondFailover !== 1 ||
      report?.acknowledgedAfterSecondFailover !== 2 ||
      report?.secondLeasePreflightPassed !== true ||
      !clusterNodeNamePattern.test(report?.connectionServerBeforeSecondFailover ?? '') ||
      !clusterNodeNamePattern.test(report?.connectionServerAfterSecondFailover ?? '') ||
      report.connectionServerAfterSecondFailover === report.secondOldLeader ||
      report?.sameConnectionSessionAfterSecondFailover !== true ||
      report?.adapterSessionRecoveredAfterSecondFailover !== true ||
      report?.overlappingOfflineServers !== 2 ||
      report?.quorumUnavailableObserved !== true ||
      report?.quorumFailureBudgetNanos !== 3_000_000_000 ||
      !Number.isSafeInteger(report?.quorumFailureElapsedNanos) ||
      report.quorumFailureElapsedNanos <= 0 ||
      report.quorumFailureElapsedNanos > report.quorumFailureBudgetNanos ||
      report?.quorumOldLeader !== report.secondNewLeader ||
      report.quorumOldLeader === report.secondOldLeader ||
      !clusterNodeNamePattern.test(report?.quorumRecoveredLeader ?? '') ||
      report.quorumRecoveredLeader === report.secondOldLeader ||
      report?.persistedAfterQuorumRecovery !== 8 ||
      report?.quorumRecoveredStreamSequence !== 7 ||
      report?.quorumDeliveryCountBefore !== 1 ||
      !Number.isSafeInteger(report?.quorumDeliveryCountAfter) ||
      report.quorumDeliveryCountAfter < 2 ||
      report?.quorumRedeliveryObserved !== true ||
      report?.publishedAfterQuorumRecovery !== 1 ||
      report?.acknowledgedAfterQuorumRecovery !== 2 ||
      report?.quorumLeasePreflightPassed !== true ||
      !clusterNodeNamePattern.test(report?.connectionServerBeforeQuorumLoss ?? '') ||
      report.connectionServerBeforeQuorumLoss === report.secondOldLeader ||
      !clusterNodeNamePattern.test(report?.connectionServerDuringQuorumLoss ?? '') ||
      report.connectionServerDuringQuorumLoss === report.secondOldLeader ||
      report.connectionServerDuringQuorumLoss === report.quorumOldLeader ||
      !clusterNodeNamePattern.test(report?.connectionServerAfterQuorumRecovery ?? '') ||
      report.connectionServerAfterQuorumRecovery === report.secondOldLeader ||
      report?.sameConnectionSessionAfterQuorumRecovery !== true ||
      report?.adapterSessionRecoveredAfterQuorumRecovery !== true ||
      report?.finalReplicaRecoveryPassed !== true ||
      report?.concurrentFaultInjected !== true ||
      report?.concurrentStoppedServers !== 2 ||
      !clusterNodeNamePattern.test(report?.concurrentOldLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentStoppedPeer ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentSurvivor ?? '') ||
      !clusterNodeNamePattern.test(report?.concurrentRecoveredLeader ?? '') ||
      report.concurrentOldLeader === report.concurrentStoppedPeer ||
      report.concurrentOldLeader === report.concurrentSurvivor ||
      report.concurrentStoppedPeer === report.concurrentSurvivor ||
      report.concurrentRecoveredLeader === report.concurrentStoppedPeer ||
      report?.concurrentStopSkewBudgetNanos !== 250_000_000 ||
      !Number.isSafeInteger(report?.concurrentStopSkewNanos) ||
      report.concurrentStopSkewNanos < 0 ||
      report.concurrentStopSkewNanos > report.concurrentStopSkewBudgetNanos ||
      report?.concurrentQuorumUnavailableObserved !== true ||
      report?.concurrentFailureBudgetNanos !== 3_000_000_000 ||
      !Number.isSafeInteger(report?.concurrentFailureElapsedNanos) ||
      report.concurrentFailureElapsedNanos <= 0 ||
      report.concurrentFailureElapsedNanos > report.concurrentFailureBudgetNanos ||
      report?.persistedAfterConcurrentRecovery !== 10 ||
      report?.concurrentRecoveredStreamSequence !== 9 ||
      report?.concurrentDeliveryCountBefore !== 1 ||
      !Number.isSafeInteger(report?.concurrentDeliveryCountAfter) ||
      report.concurrentDeliveryCountAfter < 2 ||
      report?.concurrentRedeliveryObserved !== true ||
      report?.publishedAfterConcurrentRecovery !== 1 ||
      report?.acknowledgedAfterConcurrentRecovery !== 2 ||
      report?.concurrentLeasePreflightPassed !== true ||
      !clusterNodeNamePattern.test(report?.connectionServerBeforeConcurrentFailure ?? '') ||
      report.connectionServerBeforeConcurrentFailure === report.concurrentStoppedPeer ||
      report?.connectionServerDuringConcurrentFailure !== report.concurrentSurvivor ||
      !clusterNodeNamePattern.test(report?.connectionServerAfterConcurrentRecovery ?? '') ||
      report.connectionServerAfterConcurrentRecovery === report.concurrentStoppedPeer ||
      report?.sameConnectionSessionAfterConcurrentRecovery !== true ||
      report?.adapterSessionRecoveredAfterConcurrentRecovery !== true ||
      report?.concurrentReplicaRecoveryPassed !== true ||
      report?.networkPartitionInjected !== true ||
      report?.networkPartitionedServers !== 3 ||
      !clusterNodeNamePattern.test(report?.networkPartitionLeader ?? '') ||
      !clusterNodeNamePattern.test(report?.networkPartitionConnectionServer ?? '') ||
      report.networkPartitionLeader === report.networkPartitionConnectionServer ||
      !Number.isSafeInteger(report?.routeProxyConnectionsBefore) ||
      report.routeProxyConnectionsBefore < 3 ||
      !Number.isSafeInteger(report?.routeProxyConnectionsClosed) ||
      report.routeProxyConnectionsClosed < 3 ||
      report?.partitionQuorumUnavailableObserved !== true ||
      report?.partitionFailureBudgetNanos !== 3_000_000_000 ||
      !Number.isSafeInteger(report?.partitionFailureElapsedNanos) ||
      report.partitionFailureElapsedNanos <= 0 ||
      report.partitionFailureElapsedNanos > report.partitionFailureBudgetNanos ||
      !clusterNodeNamePattern.test(report?.partitionRecoveredLeader ?? '') ||
      report?.persistedAfterPartitionRecovery !== 12 ||
      report?.partitionRecoveredStreamSequence !== 11 ||
      report?.partitionDeliveryCountBefore !== 1 ||
      !Number.isSafeInteger(report?.partitionDeliveryCountAfter) ||
      report.partitionDeliveryCountAfter < 2 ||
      report?.partitionRedeliveryObserved !== true ||
      report?.publishedAfterPartitionRecovery !== 1 ||
      report?.acknowledgedAfterPartitionRecovery !== 2 ||
      report?.partitionLeasePreflightPassed !== true ||
      report?.connectionServerAfterPartitionRecovery !== report.networkPartitionConnectionServer ||
      report?.sameConnectionSessionAfterPartitionRecovery !== true ||
      report?.adapterSessionRecoveredAfterPartitionRecovery !== true ||
      report?.partitionReplicaRecoveryPassed !== true ||
      totalServerStarts !== 8 ||
      !oldLeaderLog.includes(`Name:     ${report.oldLeader}`) ||
      (oldLeaderLog.match(/Starting nats-server/g) ?? []).length < 2 ||
      !oldLeaderLog.includes(streamLeaderMarker) ||
      !newLeaderLog.includes(`Name:     ${report.newLeader}`) ||
      !newLeaderLog.includes(streamLeaderMarker) ||
      !secondNewLeaderLog.includes(`Name:     ${report.secondNewLeader}`) ||
      !secondNewLeaderLog.includes(streamLeaderMarker) ||
      !secondOldLeaderLog.includes(`Name:     ${report.secondOldLeader}`) ||
      (secondOldLeaderLog.match(/Starting nats-server/g) ?? []).length < 2 ||
      !quorumOldLeaderLog.includes(`Name:     ${report.quorumOldLeader}`) ||
      (quorumOldLeaderLog.match(/Starting nats-server/g) ?? []).length < 2 ||
      !quorumRecoveredLeaderLog.includes(`Name:     ${report.quorumRecoveredLeader}`) ||
      !quorumRecoveredLeaderLog.includes(streamLeaderMarker) ||
      !connectionServerAfterLog.includes(`Name:     ${report.connectionServerAfter}`) ||
      !connectionServerAfterSecondLog.includes(`Name:     ${report.connectionServerAfterSecondFailover}`) ||
      !connectionServerDuringQuorumLog.includes(`Name:     ${report.connectionServerDuringQuorumLoss}`) ||
      !connectionServerAfterQuorumLog.includes(`Name:     ${report.connectionServerAfterQuorumRecovery}`) ||
      !concurrentOldLeaderLog.includes(`Name:     ${report.concurrentOldLeader}`) ||
      (concurrentOldLeaderLog.match(/Starting nats-server/g) ?? []).length < 2 ||
      !concurrentStoppedPeerLog.includes(`Name:     ${report.concurrentStoppedPeer}`) ||
      (concurrentStoppedPeerLog.match(/Starting nats-server/g) ?? []).length < 2 ||
      !concurrentRecoveredLeaderLog.includes(`Name:     ${report.concurrentRecoveredLeader}`) ||
      !concurrentRecoveredLeaderLog.includes(streamLeaderMarker) ||
      !connectionServerDuringConcurrentLog.includes(`Name:     ${report.connectionServerDuringConcurrentFailure}`) ||
      !connectionServerAfterConcurrentLog.includes(`Name:     ${report.connectionServerAfterConcurrentRecovery}`) ||
      !networkPartitionLeaderLog.includes(`Name:     ${report.networkPartitionLeader}`) ||
      !networkPartitionLeaderLog.includes(streamLeaderMarker) ||
      !partitionRecoveredLeaderLog.includes(`Name:     ${report.partitionRecoveredLeader}`) ||
      !partitionRecoveredLeaderLog.includes(streamLeaderMarker) ||
      !connectionServerAfterPartitionLog.includes(`Name:     ${report.connectionServerAfterPartitionRecovery}`)
    ) {
      fail(
        'recorded localNatsClusterFailover report does not satisfy the concurrent two-node quorum recovery contract and live-process route network partition contract',
      );
    }
  }
  if (document.postgresRecovery.status === 'recorded') {
    const root = '.temp/workflow-artifacts/postgres-recovery-contract';
    const requiredNames = [
      'environment.txt',
      'contract-output.txt',
      'test-output.txt',
      'test-status.txt',
      'recovery-output.txt',
      'recovery-status.txt',
      'container.log',
      'recovery-raw.json',
      'recovery-report.json',
      'backup.dump',
      'SHA256SUMS',
    ];
    for (const relativeName of requiredNames) {
      const artifactPath = `${root}/${relativeName}`;
      if (!evidencePaths.has(artifactPath)) {
        fail(`recorded postgresRecovery is missing required artifact: ${artifactPath}`);
      }
    }
    for (const statusName of ['test-status.txt', 'recovery-status.txt']) {
      const status = readFileSync(path.join(repositoryRoot, root, statusName), 'utf8').trim();
      if (status !== 'exit_code=0') {
        fail(`recorded postgresRecovery requires ${statusName} to contain exit_code=0`);
      }
    }
    let report;
    try {
      report = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'recovery-report.json'), 'utf8'));
    } catch {
      fail('recorded postgresRecovery requires a valid recovery-report.json');
    }
    const backupPath = path.join(repositoryRoot, root, 'backup.dump');
    const backupStats = lstatSync(backupPath);
    if (
      report?.status !== 'passed' ||
      report?.assertions?.restoredMatchesCheckpoint !== true ||
      report?.assertions?.postCheckpointWriteExcluded !== true ||
      report?.backup?.bytes !== backupStats.size ||
      report?.backup?.sha256 !== hashFile(backupPath)
    ) {
      fail('recorded postgresRecovery report does not match the verified backup artifact');
    }
    const checksumNames = requiredNames.filter((relativeName) => relativeName !== 'SHA256SUMS');
    const checksumLines = readFileSync(path.join(repositoryRoot, root, 'SHA256SUMS'), 'utf8')
      .trim()
      .split(/\r?\n/);
    if (checksumLines.length !== checksumNames.length) {
      fail('recorded postgresRecovery SHA256SUMS does not cover every required source artifact');
    }
    const checksums = new Map();
    for (const line of checksumLines) {
      const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/);
      if (!match || checksums.has(match[2])) {
        fail('recorded postgresRecovery SHA256SUMS contains an invalid or duplicate entry');
      }
      checksums.set(match[2], match[1]);
    }
    for (const relativeName of checksumNames) {
      const expected = checksums.get(relativeName);
      if (!expected || expected !== hashFile(path.join(repositoryRoot, root, relativeName))) {
        fail(`recorded postgresRecovery SHA256SUMS mismatch: ${relativeName}`);
      }
    }
  }
  if (document.signedRelease.status === 'recorded') {
    const root = '.temp/server-release';
    const fixedNames = [
      'release-manifest.json',
      'SHA256SUMS',
      'provenance.bundle.json',
      'attestation-url.txt',
      'attestation-verification.txt',
      'attestation-status.txt',
    ];
    for (const relativeName of fixedNames) {
      const artifactPath = `${root}/${relativeName}`;
      if (!evidencePaths.has(artifactPath)) {
        fail(`recorded signedRelease is missing required artifact: ${artifactPath}`);
      }
    }
    const status = readFileSync(path.join(repositoryRoot, root, 'attestation-status.txt'), 'utf8').trim();
    if (status !== 'exit_code=0') {
      fail('recorded signedRelease requires attestation-status.txt to contain exit_code=0');
    }
    let releaseManifest;
    let bundle;
    try {
      releaseManifest = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'release-manifest.json'), 'utf8'));
      bundle = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'provenance.bundle.json'), 'utf8'));
    } catch {
      fail('recorded signedRelease requires valid release manifest and provenance bundle JSON');
    }
    const subjectName = releaseManifest?.subject?.name;
    const subjectDigest = releaseManifest?.subject?.sha256;
    if (
      releaseManifest?.schemaVersion !== 1 ||
      releaseManifest?.scope !== 'goexample_server_release' ||
      typeof subjectName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(subjectName) ||
      typeof subjectDigest !== 'string' ||
      !sha256Pattern.test(subjectDigest)
    ) {
      fail('recorded signedRelease release manifest subject is invalid');
    }
    const subjectPath = `${root}/${subjectName}`;
    if (!evidencePaths.has(subjectPath)) {
      fail(`recorded signedRelease is missing attested subject: ${subjectPath}`);
    }
    const subjectFilePath = path.join(repositoryRoot, subjectPath);
    if (
      lstatSync(subjectFilePath).size !== releaseManifest.subject.bytes ||
      hashFile(subjectFilePath) !== subjectDigest
    ) {
      fail('recorded signedRelease subject does not match its release manifest');
    }
    const checksums = readFileSync(path.join(repositoryRoot, root, 'SHA256SUMS'), 'utf8');
    if (checksums !== `${subjectDigest}  ${subjectName}\n`) {
      fail('recorded signedRelease SHA256SUMS does not contain exactly its subject');
    }
    if (
      typeof bundle?.mediaType !== 'string' ||
      bundle.mediaType.length === 0 ||
      !requireObject(bundle?.verificationMaterial, 'signedRelease.bundle.verificationMaterial') ||
      !requireObject(bundle?.dsseEnvelope, 'signedRelease.bundle.dsseEnvelope')
    ) {
      fail('recorded signedRelease provenance bundle is incomplete');
    }
    const attestationURL = readFileSync(path.join(repositoryRoot, root, 'attestation-url.txt'), 'utf8').trim();
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/attestations\/[A-Za-z0-9_-]+$/.test(attestationURL)) {
      fail('recorded signedRelease attestation URL is invalid');
    }
    const verification = readFileSync(
      path.join(repositoryRoot, root, 'attestation-verification.txt'),
      'utf8',
    ).trim();
    if (verification.length === 0) {
      fail('recorded signedRelease requires non-empty gh verification output');
    }
  }
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return `${result.stdout ?? ''}`.trim();
}

function verifyRepository(repository) {
  const value = requireObject(repository, 'repository');
  if (value.root !== '.') {
    fail('repository.root must be .');
  }
  if (typeof value.gitCommit !== 'string' || !/^[a-f0-9]{40}$|^unknown$/.test(value.gitCommit)) {
    fail('repository.gitCommit must be a full lowercase Git commit or unknown');
  }
  if (typeof value.dirty !== 'boolean') {
    fail('repository.dirty must be a boolean');
  }
  requireNonNegativeInteger(value.changedFileCount, 'repository.changedFileCount');

  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const currentStatus = runGit(['status', '--porcelain=v1']);
  if (value.gitCommit !== 'unknown' && currentCommit !== value.gitCommit) {
    fail('repository Git commit no longer matches the manifest');
  }
  if (currentStatus !== null) {
    const dirty = currentStatus.length > 0;
    const changedFileCount = dirty ? currentStatus.split('\n').filter(Boolean).length : 0;
    if (dirty !== value.dirty || changedFileCount !== value.changedFileCount) {
      fail('repository dirty state no longer matches the manifest');
    }
  }
}

function verifyToolchain(toolchain) {
  const value = requireObject(toolchain, 'toolchain');
  for (const name of ['node', 'yarn', 'go', 'goToolchain']) {
    if (typeof value[name] !== 'string' || value[name].length === 0) {
      fail(`toolchain.${name} must be a non-empty string`);
    }
  }
}

const manifestPath = resolveManifestPath();
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  fail('manifest must contain valid JSON');
}
const document = requireObject(manifest, 'manifest');
if (document.schemaVersion !== 1) {
  fail('schemaVersion must equal 1');
}
if (
  typeof document.generatedAt !== 'string' ||
  Number.isNaN(Date.parse(document.generatedAt)) ||
  new Date(document.generatedAt).toISOString() !== document.generatedAt
) {
  fail('generatedAt must be a canonical ISO-8601 timestamp');
}
verifyRepository(document.repository);
verifyToolchain(document.toolchain);
const inputCount = verifyInputs(document.inputs);
const { count: artifactCount, paths: evidencePaths } = verifyEvidence(document.evidence);
verifyBoundaries(document.boundaries, evidencePaths);

console.log(
  `Evidence manifest verified: ${relativePath(manifestPath)} (${inputCount} inputs, ${artifactCount} artifacts, sha256 ${hashFile(manifestPath)})`,
);
