import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultOutput = path.join(tempRoot, 'evidence', 'manifest.json');

function fail(message) {
  console.error(`Evidence manifest: ${message}`);
  process.exit(1);
}

function parseOutputArgument() {
  const args = process.argv.slice(2);
  let output = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') {
      if (output !== null) {
        fail('output may only be specified once');
      }
      output = args[index + 1];
      index += 1;
      if (!output || output.startsWith('--')) {
        fail('--output requires a path');
      }
      continue;
    }
    if (argument.startsWith('--output=')) {
      if (output !== null) {
        fail('output may only be specified once');
      }
      output = argument.slice('--output='.length);
      if (!output) {
        fail('--output requires a path');
      }
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  return output;
}

function resolveOutputPath() {
  const requestedOutput = parseOutputArgument();
  const outputPath = path.resolve(repositoryRoot, requestedOutput ?? path.relative(repositoryRoot, defaultOutput));
  const relativeToTemp = path.relative(tempRoot, outputPath);
  if (
    !relativeToTemp ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp) ||
    !relativeToTemp.toLowerCase().endsWith('.json')
  ) {
    fail('output must be a .json file inside the repository .temp directory');
  }
  return outputPath;
}

function run(command, args) {
  const candidates = process.platform === 'win32' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0) {
      return `${result.stdout ?? ''}`.trim() || null;
    }
  }
  if (process.platform === 'win32' && !path.isAbsolute(command)) {
    const commandShell = process.env.ComSpec ?? 'cmd.exe';
    const result = spawnSync(commandShell, ['/d', '/s', '/c', [command, ...args].join(' ')], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0) {
      return `${result.stdout ?? ''}`.trim() || null;
    }
  }
  return null;
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function walkFiles(directory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function describeFile(filePath) {
  const stats = lstatSync(filePath);
  return {
    path: relativePath(filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function describeInput(inputPath) {
  const filePath = path.join(repositoryRoot, inputPath);
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    return { path: inputPath, present: false };
  }
  const stats = lstatSync(filePath);
  return {
    path: inputPath,
    present: true,
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function collectEvidence(outputPath) {
  const roots = [
    ['coverage', path.join(tempRoot, 'coverage')],
    ['benchmark', path.join(tempRoot, 'transport-benchmark')],
    ['profiles', path.join(tempRoot, 'profiles')],
    ['sbom', path.join(tempRoot, 'sbom')],
    ['scans', path.join(tempRoot, 'scans')],
    ['workflowArtifacts', path.join(tempRoot, 'workflow-artifacts')],
    ['deployment', path.join(tempRoot, 'deployment')],
    ['recovery', path.join(tempRoot, 'recovery')],
    ['natsRestart', path.join(tempRoot, 'nats-restart-evidence')],
    ['natsSnapshot', path.join(tempRoot, 'nats-snapshot-evidence')],
    ['natsCluster', path.join(tempRoot, 'nats-cluster-evidence')],
    ['release', path.join(tempRoot, 'server-release')],
  ];
  const filesByRoot = new Map(
    roots.map(([name, root]) => [
      name,
      walkFiles(root).filter((filePath) => {
        const rootRelativePath = path.relative(root, filePath);
        const isTestFixture = rootRelativePath.split(path.sep).includes('.test-fixtures');
        return filePath !== outputPath && isWithin(tempRoot, filePath) && !isTestFixture;
      }),
    ]),
  );
  const benchmarkFiles = filesByRoot.get('benchmark') ?? [];
  const profileFiles = [
    ...(filesByRoot.get('profiles') ?? []),
    ...benchmarkFiles.filter((filePath) => path.extname(filePath).toLowerCase() === '.pprof'),
  ];
  filesByRoot.set(
    'benchmark',
    benchmarkFiles.filter((filePath) => path.extname(filePath).toLowerCase() !== '.pprof'),
  );
  filesByRoot.set('profiles', [...new Set(profileFiles)].sort((left, right) => left.localeCompare(right)));
  return Object.fromEntries(
    roots.map(([name]) => [name, (filesByRoot.get(name) ?? []).map(describeFile)]),
  );
}

const outputPath = resolveOutputPath();
mkdirSync(path.dirname(outputPath), { recursive: true });
mkdirSync(tempRoot, { recursive: true });

const gitStatus = run('git', ['status', '--porcelain=v1']) ?? '';
const gitCommit = run('git', ['rev-parse', 'HEAD']);
const evidence = collectEvidence(outputPath);
const benchmarkFiles = [...(evidence.benchmark ?? []), ...(evidence.profiles ?? [])];
const runningInGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const benchmarkStatusArtifact = (evidence.benchmark ?? []).find((artifact) =>
  artifact.path.endsWith('/benchmark-status.txt'),
);
const benchmarkStatus = benchmarkStatusArtifact
  ? readFileSync(path.join(repositoryRoot, benchmarkStatusArtifact.path), 'utf8').match(/exit_code=(\d+)/)?.[1]
  : null;
const soakStatusArtifact = (evidence.benchmark ?? []).find((artifact) =>
  artifact.path.endsWith('/soak-status.txt'),
);
const soakStatus = soakStatusArtifact
  ? readFileSync(path.join(repositoryRoot, soakStatusArtifact.path), 'utf8').match(/exit_code=(\d+)/)?.[1]
  : null;
const benchmarkArtifactPaths = new Set(benchmarkFiles.map((artifact) => artifact.path));
const requiredBenchmarkArtifacts = [
  '.temp/transport-benchmark/environment.txt',
  '.temp/transport-benchmark/system-before.txt',
  '.temp/transport-benchmark/system-after.txt',
  '.temp/transport-benchmark/transport-benchmark.txt',
  '.temp/transport-benchmark/benchmark-status.txt',
  '.temp/transport-benchmark/benchmark-trend.txt',
  '.temp/transport-benchmark/baseline-source.json',
  '.temp/transport-benchmark/baseline-candidate.json',
  '.temp/transport-benchmark/transport-capacity-report.json',
  '.temp/transport-benchmark/transport-soak.txt',
  '.temp/transport-benchmark/soak-status.txt',
  '.temp/transport-benchmark/transport-soak-report.json',
  '.temp/transport-benchmark/transport.cpu.pprof',
  '.temp/transport-benchmark/transport.heap.pprof',
  '.temp/transport-benchmark/cpu-profile-top.txt',
  '.temp/transport-benchmark/heap-profile-top.txt',
];
const benchmarkArtifactsComplete = requiredBenchmarkArtifacts.every((artifactPath) =>
  benchmarkArtifactPaths.has(artifactPath),
);
const linuxRemoteBenchmarkStatus =
  runningInGitHubActions && process.platform === 'linux' && (benchmarkStatus || soakStatus)
    ? benchmarkStatus === '0' && soakStatus === '0' && benchmarkArtifactsComplete
      ? 'recorded'
      : 'failed'
    : 'not_recorded';
const postgresArtifacts = evidence.workflowArtifacts ?? [];
const postgresArtifactPaths = new Set(postgresArtifacts.map((artifact) => artifact.path));
const postgresArtifactRoot = '.temp/workflow-artifacts/postgres-recovery-contract';
const requiredPostgresRecoveryArtifacts = [
  `${postgresArtifactRoot}/environment.txt`,
  `${postgresArtifactRoot}/contract-output.txt`,
  `${postgresArtifactRoot}/test-output.txt`,
  `${postgresArtifactRoot}/test-status.txt`,
  `${postgresArtifactRoot}/recovery-output.txt`,
  `${postgresArtifactRoot}/recovery-status.txt`,
  `${postgresArtifactRoot}/container.log`,
  `${postgresArtifactRoot}/recovery-raw.json`,
  `${postgresArtifactRoot}/recovery-report.json`,
  `${postgresArtifactRoot}/backup.dump`,
  `${postgresArtifactRoot}/SHA256SUMS`,
];
function readPostgresArtifact(relativeName) {
  const artifactPath = `${postgresArtifactRoot}/${relativeName}`;
  return postgresArtifactPaths.has(artifactPath)
    ? readFileSync(path.join(repositoryRoot, artifactPath), 'utf8')
    : null;
}
const postgresTestStatus = readPostgresArtifact('test-status.txt')?.match(/exit_code=(\d+)/)?.[1] ?? null;
const postgresRecoveryExitStatus =
  readPostgresArtifact('recovery-status.txt')?.match(/exit_code=(\d+)/)?.[1] ?? null;
let postgresReportPassed = false;
try {
  postgresReportPassed = JSON.parse(readPostgresArtifact('recovery-report.json') ?? 'null')?.status === 'passed';
} catch {
  postgresReportPassed = false;
}
const postgresArtifactsComplete = requiredPostgresRecoveryArtifacts.every((artifactPath) =>
  postgresArtifactPaths.has(artifactPath),
);
const postgresRecoveryStatus =
  runningInGitHubActions && process.platform === 'linux' && (postgresTestStatus || postgresRecoveryExitStatus)
    ? postgresTestStatus === '0' &&
        postgresRecoveryExitStatus === '0' &&
        postgresReportPassed &&
        postgresArtifactsComplete
      ? 'recorded'
      : 'failed'
    : 'not_recorded';
const natsRestartArtifacts = evidence.natsRestart ?? [];
const natsRestartArtifactPaths = new Set(natsRestartArtifacts.map((artifact) => artifact.path));
const natsRestartArtifactRoot = '.temp/nats-restart-evidence';
const requiredNatsRestartArtifacts = [
  `${natsRestartArtifactRoot}/nats-before-restart.log`,
  `${natsRestartArtifactRoot}/nats-after-restart.log`,
  `${natsRestartArtifactRoot}/restart-report.json`,
];
let natsRestartReportPassed = false;
try {
  const report = JSON.parse(
    readFileSync(path.join(repositoryRoot, natsRestartArtifactRoot, 'restart-report.json'), 'utf8'),
  );
  natsRestartReportPassed =
    report?.schemaVersion === 1 &&
    report?.status === 'passed' &&
    report?.storage === 'file' &&
    report?.replicas === 1 &&
    report?.abruptRestarts === 1 &&
    report?.persistedMessages === 3 &&
    report?.recoveredStreamSequence > 0 &&
    report?.deliveryCountBeforeRestart === 1 &&
    report?.deliveryCountAfterRestart === 1 &&
    report?.redeliveryObserved === true &&
    report?.acknowledged === 1 &&
    report?.deadLettered === 1 &&
    report?.sourceAckPending === 0 &&
    report?.sourceMessagesPending === 0 &&
    report?.shortLeaseRejected === true &&
    report?.leasePreflightPassed === true &&
    Number.isSafeInteger(report?.requiredLeaseNanos) &&
    report.requiredLeaseNanos > 0 &&
    Number.isSafeInteger(report?.workerAckWaitNanos) &&
    report.workerAckWaitNanos >= report.requiredLeaseNanos;
} catch {
  natsRestartReportPassed = false;
}
const natsRestartArtifactsComplete = requiredNatsRestartArtifacts.every((artifactPath) =>
  natsRestartArtifactPaths.has(artifactPath),
);
const localNatsRestartStatus =
  natsRestartArtifacts.length === 0
    ? 'not_recorded'
    : natsRestartArtifactsComplete && natsRestartReportPassed
      ? 'recorded'
      : 'failed';
const natsSnapshotArtifacts = evidence.natsSnapshot ?? [];
const natsSnapshotArtifactPaths = new Set(natsSnapshotArtifacts.map((artifact) => artifact.path));
const natsSnapshotArtifactRoot = '.temp/nats-snapshot-evidence';
const requiredNatsSnapshotArtifacts = [
  `${natsSnapshotArtifactRoot}/nats-snapshot-restore.log`,
  `${natsSnapshotArtifactRoot}/source-stream.snapshot`,
  `${natsSnapshotArtifactRoot}/snapshot-restore-report.json`,
];
let natsSnapshotReportPassed = false;
try {
  const report = JSON.parse(
    readFileSync(path.join(repositoryRoot, natsSnapshotArtifactRoot, 'snapshot-restore-report.json'), 'utf8'),
  );
  const snapshotPath = path.join(repositoryRoot, natsSnapshotArtifactRoot, 'source-stream.snapshot');
  natsSnapshotReportPassed =
    report?.schemaVersion === 1 &&
    report?.status === 'passed' &&
    report?.storage === 'file' &&
    report?.replicas === 1 &&
    report?.snapshotIncludesConsumers === true &&
    report?.snapshotCheckedMessages === true &&
    Number.isSafeInteger(report?.snapshotBytes) &&
    report.snapshotBytes > 0 &&
    typeof report?.snapshotSHA256 === 'string' &&
    /^[a-f0-9]{64}$/.test(report.snapshotSHA256) &&
    Number.isSafeInteger(report?.snapshotChunks) &&
    report.snapshotChunks >= 2 &&
    report?.checkpointMessages === 3 &&
    report?.checkpointFirstSequence === 1 &&
    report?.checkpointLastSequence === 3 &&
    report?.postCheckpointMessages === 1 &&
    report?.messagesBeforeDelete === 4 &&
    report?.restoredMessages === 3 &&
    report?.postCheckpointExcluded === true &&
    report?.tamperedSnapshotRejected === true &&
    report?.consumerRestored === true &&
    report?.ackPendingBeforeSnapshot === 1 &&
    report?.messagesPendingBeforeSnapshot === 1 &&
    report?.ackPendingAfterRestore === 1 &&
    report?.messagesPendingAfterRestore === 1 &&
    report?.unacknowledgedSequence === 2 &&
    report?.recoveredSequence === report.unacknowledgedSequence &&
    report?.sameSequenceRedelivered === true &&
    report?.acknowledgedAfterRestore === 1 &&
    report?.deadLetteredAfterRestore === 1 &&
    report?.sourceAckPending === 0 &&
    report?.sourceMessagesPending === 0 &&
    Number.isSafeInteger(report?.restoreElapsedNanos) &&
    report.restoreElapsedNanos > 0 &&
    report?.restoreBudgetNanos === 15_000_000_000 &&
    report.restoreElapsedNanos <= report.restoreBudgetNanos &&
    existsSync(snapshotPath) &&
    lstatSync(snapshotPath).isFile() &&
    lstatSync(snapshotPath).size === report.snapshotBytes &&
    hashFile(snapshotPath) === report.snapshotSHA256;
} catch {
  natsSnapshotReportPassed = false;
}
const natsSnapshotArtifactsComplete = requiredNatsSnapshotArtifacts.every((artifactPath) =>
  natsSnapshotArtifactPaths.has(artifactPath),
);
const localNatsSnapshotRestoreStatus =
  natsSnapshotArtifacts.length === 0
    ? 'not_recorded'
    : natsSnapshotArtifactsComplete && natsSnapshotReportPassed
      ? 'recorded'
      : 'failed';
const natsClusterArtifacts = evidence.natsCluster ?? [];
const natsClusterArtifactPaths = new Set(natsClusterArtifacts.map((artifact) => artifact.path));
const natsClusterArtifactRoot = '.temp/nats-cluster-evidence';
const requiredNatsClusterArtifacts = [
  `${natsClusterArtifactRoot}/goexample-js-node-1.log`,
  `${natsClusterArtifactRoot}/goexample-js-node-2.log`,
  `${natsClusterArtifactRoot}/goexample-js-node-3.log`,
  `${natsClusterArtifactRoot}/cluster-failover-report.json`,
];
let natsClusterReportPassed = false;
try {
  const report = JSON.parse(
    readFileSync(path.join(repositoryRoot, natsClusterArtifactRoot, 'cluster-failover-report.json'), 'utf8'),
  );
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
    report.concurrentRecoveredLeader === report.concurrentStoppedPeer
  ) {
    throw new Error('invalid cluster report leader identity');
  }
  const oldLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.oldLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const newLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.newLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const secondNewLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.secondNewLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const secondOldLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.secondOldLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const quorumOldLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.quorumOldLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const quorumRecoveredLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.quorumRecoveredLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const connectionServerAfterLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerAfter ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const connectionServerAfterSecondLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerAfterSecondFailover ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const connectionServerDuringQuorumLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerDuringQuorumLoss ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const connectionServerAfterQuorumLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerAfterQuorumRecovery ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const concurrentOldLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.concurrentOldLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const concurrentStoppedPeerLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.concurrentStoppedPeer ?? 'invalid'}.log`),
    'utf8',
  );
  const concurrentRecoveredLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.concurrentRecoveredLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const connectionServerDuringConcurrentLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerDuringConcurrentFailure ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const connectionServerAfterConcurrentLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerAfterConcurrentRecovery ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const networkPartitionLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.networkPartitionLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const partitionRecoveredLeaderLog = readFileSync(
    path.join(repositoryRoot, natsClusterArtifactRoot, `${report?.partitionRecoveredLeader ?? 'invalid'}.log`),
    'utf8',
  );
  const connectionServerAfterPartitionLog = readFileSync(
    path.join(
      repositoryRoot,
      natsClusterArtifactRoot,
      `${report?.connectionServerAfterPartitionRecovery ?? 'invalid'}.log`,
    ),
    'utf8',
  );
  const clusterNodeLogs = [1, 2, 3].map((node) =>
    readFileSync(path.join(repositoryRoot, natsClusterArtifactRoot, `goexample-js-node-${node}.log`), 'utf8'),
  );
  const totalServerStarts = clusterNodeLogs.reduce(
    (count, log) => count + (log.match(/Starting nats-server/g) ?? []).length,
    0,
  );
  const streamLeaderMarker = "JetStream cluster new stream leader for '$G > GOEXAMPLE_FAILOVER_SOURCE'";
  natsClusterReportPassed =
    report?.schemaVersion === 6 &&
    report?.status === 'passed' &&
    report?.storage === 'file' &&
    report?.clusterSize === 3 &&
    report?.streamReplicas === 3 &&
    report?.consumerReplicas === 3 &&
    report?.abruptLeaderStops === 3 &&
    clusterNodeNamePattern.test(report.oldLeader) &&
    clusterNodeNamePattern.test(report.newLeader) &&
    report.oldLeader !== report.newLeader &&
    report?.leaderChanged === true &&
    report?.persistedBeforeFailover === 3 &&
    report?.persistedAfterFailover === 4 &&
    report?.recoveredStreamSequence === 1 &&
    report?.deliveryCountBefore === 1 &&
    report?.deliveryCountAfter >= 2 &&
    report?.redeliveryObserved === true &&
    report?.publishedAfterFailover === 1 &&
    report?.workerAcknowledged === 2 &&
    report?.deadLettered === 1 &&
    report?.sourceAckPending === 0 &&
    report?.sourceMessagesPending === 0 &&
    report?.survivingServers === 2 &&
    report?.shortLeaseRejected === true &&
    report?.leasePreflightPassed === true &&
    Number.isSafeInteger(report?.requiredLeaseNanos) &&
    report.requiredLeaseNanos > 0 &&
    Number.isSafeInteger(report?.workerAckWaitNanos) &&
    report.workerAckWaitNanos >= report.requiredLeaseNanos &&
    report?.sameConnectionSession === true &&
    report?.disconnectedObserved === true &&
    report?.reconnectedObserved === true &&
    report?.connectionServerBefore === report.oldLeader &&
    clusterNodeNamePattern.test(report?.connectionServerAfter ?? '') &&
    report.connectionServerAfter !== report.connectionServerBefore &&
    report?.adapterSessionRecovered === true &&
    report?.restartedServers === 3 &&
    report?.replicaRecoveryPassed === true &&
    report?.secondOldLeader === report.newLeader &&
    report.secondOldLeader !== report.oldLeader &&
    clusterNodeNamePattern.test(report?.secondNewLeader ?? '') &&
    report.secondNewLeader !== report.secondOldLeader &&
    report?.secondLeaderChanged === true &&
    report?.distinctLeadersStopped === true &&
    report?.persistedAfterSecondFailover === 6 &&
    report?.secondRecoveredStreamSequence === 5 &&
    report?.secondDeliveryCountBefore === 1 &&
    Number.isSafeInteger(report?.secondDeliveryCountAfter) &&
    report.secondDeliveryCountAfter >= 2 &&
    report?.secondRedeliveryObserved === true &&
    report?.publishedAfterSecondFailover === 1 &&
    report?.acknowledgedAfterSecondFailover === 2 &&
    report?.secondLeasePreflightPassed === true &&
    clusterNodeNamePattern.test(report?.connectionServerBeforeSecondFailover ?? '') &&
    clusterNodeNamePattern.test(report?.connectionServerAfterSecondFailover ?? '') &&
    report.connectionServerAfterSecondFailover !== report.secondOldLeader &&
    report?.sameConnectionSessionAfterSecondFailover === true &&
    report?.adapterSessionRecoveredAfterSecondFailover === true &&
    report?.overlappingOfflineServers === 2 &&
    report?.quorumUnavailableObserved === true &&
    report?.quorumFailureBudgetNanos === 3_000_000_000 &&
    Number.isSafeInteger(report?.quorumFailureElapsedNanos) &&
    report.quorumFailureElapsedNanos > 0 &&
    report.quorumFailureElapsedNanos <= report.quorumFailureBudgetNanos &&
    report?.quorumOldLeader === report.secondNewLeader &&
    report.quorumOldLeader !== report.secondOldLeader &&
    clusterNodeNamePattern.test(report?.quorumRecoveredLeader ?? '') &&
    report.quorumRecoveredLeader !== report.secondOldLeader &&
    report?.persistedAfterQuorumRecovery === 8 &&
    report?.quorumRecoveredStreamSequence === 7 &&
    report?.quorumDeliveryCountBefore === 1 &&
    Number.isSafeInteger(report?.quorumDeliveryCountAfter) &&
    report.quorumDeliveryCountAfter >= 2 &&
    report?.quorumRedeliveryObserved === true &&
    report?.publishedAfterQuorumRecovery === 1 &&
    report?.acknowledgedAfterQuorumRecovery === 2 &&
    report?.quorumLeasePreflightPassed === true &&
    clusterNodeNamePattern.test(report?.connectionServerBeforeQuorumLoss ?? '') &&
    report.connectionServerBeforeQuorumLoss !== report.secondOldLeader &&
    clusterNodeNamePattern.test(report?.connectionServerDuringQuorumLoss ?? '') &&
    report.connectionServerDuringQuorumLoss !== report.secondOldLeader &&
    report.connectionServerDuringQuorumLoss !== report.quorumOldLeader &&
    clusterNodeNamePattern.test(report?.connectionServerAfterQuorumRecovery ?? '') &&
    report.connectionServerAfterQuorumRecovery !== report.secondOldLeader &&
    report?.sameConnectionSessionAfterQuorumRecovery === true &&
    report?.adapterSessionRecoveredAfterQuorumRecovery === true &&
    report?.finalReplicaRecoveryPassed === true &&
    report?.concurrentFaultInjected === true &&
    report?.concurrentStoppedServers === 2 &&
    clusterNodeNamePattern.test(report?.concurrentOldLeader ?? '') &&
    clusterNodeNamePattern.test(report?.concurrentStoppedPeer ?? '') &&
    clusterNodeNamePattern.test(report?.concurrentSurvivor ?? '') &&
    clusterNodeNamePattern.test(report?.concurrentRecoveredLeader ?? '') &&
    report.concurrentOldLeader !== report.concurrentStoppedPeer &&
    report.concurrentOldLeader !== report.concurrentSurvivor &&
    report.concurrentStoppedPeer !== report.concurrentSurvivor &&
    report.concurrentRecoveredLeader !== report.concurrentStoppedPeer &&
    report?.concurrentStopSkewBudgetNanos === 250_000_000 &&
    Number.isSafeInteger(report?.concurrentStopSkewNanos) &&
    report.concurrentStopSkewNanos >= 0 &&
    report.concurrentStopSkewNanos <= report.concurrentStopSkewBudgetNanos &&
    report?.concurrentQuorumUnavailableObserved === true &&
    report?.concurrentFailureBudgetNanos === 3_000_000_000 &&
    Number.isSafeInteger(report?.concurrentFailureElapsedNanos) &&
    report.concurrentFailureElapsedNanos > 0 &&
    report.concurrentFailureElapsedNanos <= report.concurrentFailureBudgetNanos &&
    report?.persistedAfterConcurrentRecovery === 10 &&
    report?.concurrentRecoveredStreamSequence === 9 &&
    report?.concurrentDeliveryCountBefore === 1 &&
    Number.isSafeInteger(report?.concurrentDeliveryCountAfter) &&
    report.concurrentDeliveryCountAfter >= 2 &&
    report?.concurrentRedeliveryObserved === true &&
    report?.publishedAfterConcurrentRecovery === 1 &&
    report?.acknowledgedAfterConcurrentRecovery === 2 &&
    report?.concurrentLeasePreflightPassed === true &&
    clusterNodeNamePattern.test(report?.connectionServerBeforeConcurrentFailure ?? '') &&
    report.connectionServerBeforeConcurrentFailure !== report.concurrentStoppedPeer &&
    report?.connectionServerDuringConcurrentFailure === report.concurrentSurvivor &&
    clusterNodeNamePattern.test(report?.connectionServerAfterConcurrentRecovery ?? '') &&
    report.connectionServerAfterConcurrentRecovery !== report.concurrentStoppedPeer &&
    report?.sameConnectionSessionAfterConcurrentRecovery === true &&
    report?.adapterSessionRecoveredAfterConcurrentRecovery === true &&
    report?.concurrentReplicaRecoveryPassed === true &&
    report?.networkPartitionInjected === true &&
    report?.networkPartitionedServers === 3 &&
    clusterNodeNamePattern.test(report?.networkPartitionLeader ?? '') &&
    clusterNodeNamePattern.test(report?.networkPartitionConnectionServer ?? '') &&
    report.networkPartitionLeader !== report.networkPartitionConnectionServer &&
    Number.isSafeInteger(report?.routeProxyConnectionsBefore) &&
    report.routeProxyConnectionsBefore >= 3 &&
    Number.isSafeInteger(report?.routeProxyConnectionsClosed) &&
    report.routeProxyConnectionsClosed >= 3 &&
    report?.partitionQuorumUnavailableObserved === true &&
    report?.partitionFailureBudgetNanos === 3_000_000_000 &&
    Number.isSafeInteger(report?.partitionFailureElapsedNanos) &&
    report.partitionFailureElapsedNanos > 0 &&
    report.partitionFailureElapsedNanos <= report.partitionFailureBudgetNanos &&
    clusterNodeNamePattern.test(report?.partitionRecoveredLeader ?? '') &&
    report?.persistedAfterPartitionRecovery === 12 &&
    report?.partitionRecoveredStreamSequence === 11 &&
    report?.partitionDeliveryCountBefore === 1 &&
    Number.isSafeInteger(report?.partitionDeliveryCountAfter) &&
    report.partitionDeliveryCountAfter >= 2 &&
    report?.partitionRedeliveryObserved === true &&
    report?.publishedAfterPartitionRecovery === 1 &&
    report?.acknowledgedAfterPartitionRecovery === 2 &&
    report?.partitionLeasePreflightPassed === true &&
    report?.connectionServerAfterPartitionRecovery === report.networkPartitionConnectionServer &&
    report?.sameConnectionSessionAfterPartitionRecovery === true &&
    report?.adapterSessionRecoveredAfterPartitionRecovery === true &&
    report?.partitionReplicaRecoveryPassed === true &&
    totalServerStarts === 8 &&
    oldLeaderLog.includes(`Name:     ${report.oldLeader}`) &&
    (oldLeaderLog.match(/Starting nats-server/g) ?? []).length >= 2 &&
    oldLeaderLog.includes(streamLeaderMarker) &&
    newLeaderLog.includes(`Name:     ${report.newLeader}`) &&
    newLeaderLog.includes(streamLeaderMarker) &&
    secondNewLeaderLog.includes(`Name:     ${report.secondNewLeader}`) &&
    secondNewLeaderLog.includes(streamLeaderMarker) &&
    secondOldLeaderLog.includes(`Name:     ${report.secondOldLeader}`) &&
    (secondOldLeaderLog.match(/Starting nats-server/g) ?? []).length >= 2 &&
    quorumOldLeaderLog.includes(`Name:     ${report.quorumOldLeader}`) &&
    (quorumOldLeaderLog.match(/Starting nats-server/g) ?? []).length >= 2 &&
    quorumRecoveredLeaderLog.includes(`Name:     ${report.quorumRecoveredLeader}`) &&
    quorumRecoveredLeaderLog.includes(streamLeaderMarker) &&
    connectionServerAfterLog.includes(`Name:     ${report.connectionServerAfter}`) &&
    connectionServerAfterSecondLog.includes(`Name:     ${report.connectionServerAfterSecondFailover}`) &&
    connectionServerDuringQuorumLog.includes(`Name:     ${report.connectionServerDuringQuorumLoss}`) &&
    connectionServerAfterQuorumLog.includes(`Name:     ${report.connectionServerAfterQuorumRecovery}`) &&
    concurrentOldLeaderLog.includes(`Name:     ${report.concurrentOldLeader}`) &&
    (concurrentOldLeaderLog.match(/Starting nats-server/g) ?? []).length >= 2 &&
    concurrentStoppedPeerLog.includes(`Name:     ${report.concurrentStoppedPeer}`) &&
    (concurrentStoppedPeerLog.match(/Starting nats-server/g) ?? []).length >= 2 &&
    concurrentRecoveredLeaderLog.includes(`Name:     ${report.concurrentRecoveredLeader}`) &&
    concurrentRecoveredLeaderLog.includes(streamLeaderMarker) &&
    connectionServerDuringConcurrentLog.includes(`Name:     ${report.connectionServerDuringConcurrentFailure}`) &&
    connectionServerAfterConcurrentLog.includes(`Name:     ${report.connectionServerAfterConcurrentRecovery}`) &&
    networkPartitionLeaderLog.includes(`Name:     ${report.networkPartitionLeader}`) &&
    networkPartitionLeaderLog.includes(streamLeaderMarker) &&
    partitionRecoveredLeaderLog.includes(`Name:     ${report.partitionRecoveredLeader}`) &&
    partitionRecoveredLeaderLog.includes(streamLeaderMarker) &&
    connectionServerAfterPartitionLog.includes(`Name:     ${report.connectionServerAfterPartitionRecovery}`);
} catch {
  natsClusterReportPassed = false;
}
const natsClusterArtifactsComplete = requiredNatsClusterArtifacts.every((artifactPath) =>
  natsClusterArtifactPaths.has(artifactPath),
);
const localNatsClusterFailoverStatus =
  natsClusterArtifacts.length === 0
    ? 'not_recorded'
    : natsClusterArtifactsComplete && natsClusterReportPassed
      ? 'recorded'
      : 'failed';
const releaseArtifacts = evidence.release ?? [];
const releaseArtifactPaths = new Set(releaseArtifacts.map((artifact) => artifact.path));
const releaseArtifactRoot = '.temp/server-release';
function readReleaseArtifact(relativeName) {
  const artifactPath = `${releaseArtifactRoot}/${relativeName}`;
  return releaseArtifactPaths.has(artifactPath)
    ? readFileSync(path.join(repositoryRoot, artifactPath), 'utf8')
    : null;
}
const releaseAttestationStatus = readReleaseArtifact('attestation-status.txt')?.match(/exit_code=(\d+)/)?.[1] ?? null;
let releaseSubjectName = null;
let releaseManifestPassed = false;
try {
  const releaseManifest = JSON.parse(readReleaseArtifact('release-manifest.json') ?? 'null');
  releaseSubjectName = releaseManifest?.subject?.name ?? null;
  releaseManifestPassed =
    releaseManifest?.schemaVersion === 1 &&
    releaseManifest?.scope === 'goexample_server_release' &&
    typeof releaseSubjectName === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(releaseSubjectName) &&
    /^[a-f0-9]{64}$/.test(releaseManifest?.subject?.sha256 ?? '');
} catch {
  releaseManifestPassed = false;
}
const requiredReleaseArtifacts = [
  `${releaseArtifactRoot}/release-manifest.json`,
  `${releaseArtifactRoot}/SHA256SUMS`,
  `${releaseArtifactRoot}/provenance.bundle.json`,
  `${releaseArtifactRoot}/attestation-url.txt`,
  `${releaseArtifactRoot}/attestation-verification.txt`,
  `${releaseArtifactRoot}/attestation-status.txt`,
  ...(releaseSubjectName ? [`${releaseArtifactRoot}/${releaseSubjectName}`] : []),
];
const releaseArtifactsComplete =
  releaseSubjectName !== null &&
  requiredReleaseArtifacts.every((artifactPath) => releaseArtifactPaths.has(artifactPath));
const signedReleaseStatus =
  runningInGitHubActions && process.platform === 'linux' && releaseAttestationStatus !== null
    ? releaseAttestationStatus === '0' && releaseManifestPassed && releaseArtifactsComplete
      ? 'recorded'
      : 'failed'
    : 'not_recorded';
const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
const toolchainVersion = workspace.match(/^toolchain\s+(\S+)$/m)?.[1] ?? null;
const localGoCandidates = toolchainVersion
  ? [
      path.join(
        tempRoot,
        'toolchain',
        toolchainVersion,
        'go',
        'bin',
        process.platform === 'win32' ? 'go.exe' : 'go',
      ),
      path.join(tempRoot, 'toolchain', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go'),
    ]
  : [];
const goVersion = localGoCandidates.find((candidate) => existsSync(candidate));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: {
    root: '.',
    gitCommit: gitCommit ?? 'unknown',
    dirty: gitStatus.length > 0,
    changedFileCount: gitStatus ? gitStatus.split('\n').filter(Boolean).length : 0,
  },
  toolchain: {
    node: process.version,
    yarn: run('yarn', ['--version']) ?? 'unavailable',
    go: (goVersion ? run(goVersion, ['version']) : run('go', ['version'])) ?? 'unavailable',
    goToolchain: toolchainVersion ?? 'undeclared',
  },
  inputs: [
    'go.work',
    'go.work.sum',
    'Framework/go.mod',
    'Framework/go.sum',
    'Framework/VERSION',
    'Framework/api-snapshot.json',
    'Framework/COMPATIBILITY.md',
	'Framework/CHANGELOG.md',
	'Framework/authorization/authorization.go',
	'Framework/authorization/authorization_test.go',
    'Framework/auth/service.go',
    'Framework/auth/jwks.go',
    'Framework/auth/jwks_test.go',
    'Framework/auth/oidc_flow.go',
    'Framework/auth/oidc_flow_test.go',
    'Framework/auth/oidc_client.go',
    'Framework/auth/oidc_client_test.go',
    'Framework/auth/oidc_callback.go',
    'Framework/auth/oidc_callback_test.go',
	'Framework/sharedstate/authorization_request_store.go',
	'Framework/sharedstate/authorization_request_store_test.go',
    'Framework/auth/session.go',
    'Framework/auth/session_test.go',
	'Framework/auth/browser_session.go',
	'Framework/auth/browser_session_test.go',
    'Framework/config/config.go',
    'Framework/config/config_test.go',
    'Framework/httpclient/client.go',
	'Framework/httpapi/application_authorization.go',
	'Framework/httpapi/application_resource_authorization_test.go',
    'Framework/httpapi/application_query.go',
    'Framework/httpapi/application_command.go',
    'Framework/httpapi/application_precondition.go',
    'Framework/httpapi/auth_middleware.go',
	'Framework/httpapi/oidc_browser.go',
	'Framework/httpapi/oidc_browser_test.go',
    'Framework/httpapi/idempotency_fingerprint.go',
    'Framework/httpapi/middleware.go',
    'Framework/httpapi/response.go',
    'Framework/httpapi/app_test.go',
    'Framework/httpapi/security_audit.go',
    'Framework/httpapi/security_audit_chain.go',
    'Framework/httpapi/security_audit_chain_test.go',
    'Framework/httpapi/security_audit_sink.go',
    'Framework/httpapi/security_audit_sink_test.go',
    'Framework/httpapi/token_verifier_test.go',
    'Framework/sharedstate/redis.go',
    'Framework/sharedstate/session_store.go',
    'Framework/sharedstate/session_store_test.go',
	'Framework/sharedstate/browser_session_store.go',
	'Framework/sharedstate/browser_session_store_test.go',
    'Framework/sharedstate/redis_tracing.go',
    'Framework/sharedstate/redis_test.go',
    'Framework/sharedstate/redis_sentinel_integration_test.go',
    'Framework/httpapi/redis_shared_state_test.go',
    'Framework/observability/metrics.go',
    'Framework/observability/tracing_provider.go',
    'Framework/observability/tracing_test.go',
    'Framework/queueclient/client.go',
    'Framework/queueclient/client_test.go',
    'Framework/queueclient/worker.go',
    'Framework/queueclient/worker_test.go',
    'Framework/queueclient/nats_integration_test.go',
    'Framework/queueclient/natsjetstream/adapter.go',
    'Framework/queueclient/natsjetstream/adapter_test.go',
    'Framework/queueclient/natsjetstream/integration_test.go',
    'Framework/queueclient/natsjetstream/restart_integration_test.go',
    'Framework/queueclient/natsjetstream/snapshot_integration_test.go',
    'Framework/queueclient/natsjetstream/cluster_integration_test.go',
    'Framework/server/http.go',
    'Framework/server/http_test.go',
    'Framework/sqlclient/client.go',
    'Framework/sqlclient/client_test.go',
    'Framework/sqlclient/postgres_integration_test.go',
    'Solutions/Example/go.mod',
    'Solutions/Example/go.sum',
    'Solutions/Example/cmd/server/main.go',
    'Solutions/Example/cmd/server/main_test.go',
    'Solutions/Example/internal/projectapi/routes.go',
    'Solutions/Example/internal/projectapi/routes_test.go',
    'Solutions/Example/internal/projectapi/openapi_contract_test.go',
    'Solutions/Example/internal/projectapi/transport_benchmark_test.go',
	'Solutions/Example/internal/projectapp/service.go',
	'Solutions/Example/internal/projectapp/service_test.go',
    'Solutions/Example/internal/projectapp/authorization.go',
	'Solutions/Example/internal/projectapp/authorization_test.go',
    'Services/Billing/go.mod',
    'Services/Billing/README.md',
    'Services/Billing/cmd/server/main.go',
    'Services/Billing/internal/billingapi/routes.go',
    'Services/Billing/internal/billingapi/routes_test.go',
    'Services/Billing/internal/billingapi/openapi_contract_test.go',
    'Services/Billing/internal/billingapp/service.go',
    'Services/Billing/internal/billingapp/service_test.go',
    'SDK/GoExample/go.mod',
    'SDK/GoExample/VERSION',
    'SDK/GoExample/client.gen.go',
    'SDK/GoExample/client_test.go',
    'SDK/Billing/go.mod',
    'SDK/Billing/VERSION',
    'SDK/Billing/client.gen.go',
    'contracts/projects.json',
    'support/consumer/HealthProbe/go.mod',
    'support/consumer/HealthProbe/go.sum',
    'support/consumer/HealthProbe/cmd/healthprobe/main.go',
    'support/consumer/HealthProbe/cmd/healthprobe/main_test.go',
    'support/deploy/prometheus/rules/goexample-slo.yml',
    'support/deploy/edge/goexample-nginx.contract.json',
    'support/deploy/edge/README.md',
    'support/deploy/kubernetes/goexample-api.template.json',
    'support/deploy/kubernetes/README.md',
    'docs/adr/0001-http-framework-selection.md',
    'docs/adr/0002-http-request-lifecycle-and-protocol-boundary.md',
    'docs/openapi/openapi.json',
    'docs/openapi/billing.json',
    'docs/openapi/consumer-matrix.md',
    'docs/openapi/project-contracts.md',
    'docs/observability/SLO-and-alerts.md',
    'docs/security/server-threat-model.md',
    'docs/security/server-audit-events.md',
    'docs/待优化/待优化V12.md',
    'docs/待优化/待优化V13.md',
    'docs/评估/项目架构与性能评估.md',
    'scripts/evidence-manifest.mjs',
    'scripts/evidence-verify.mjs',
    'scripts/go-project.mjs',
    'scripts/go-sdk.mjs',
    'scripts/project-contracts.mjs',
    'scripts/lib/project-contracts.mjs',
    'scripts/kubernetes-manifest.mjs',
    'scripts/nginx-edge.mjs',
    'scripts/nginx-edge-contract.mjs',
    'scripts/postgres-recovery-contract.mjs',
    'scripts/postgres-recovery-report.mjs',
    'scripts/redis-sentinel-contract.mjs',
    'scripts/server-recovery-drill.mjs',
    'scripts/server-release.mjs',
    'scripts/transport-benchmark-baseline.mjs',
    'scripts/transport-benchmark-report.mjs',
    'scripts/lib/transport-benchmark-environment.mjs',
    'scripts/transport-soak-report.mjs',
    'scripts/v13-evidence.mjs',
    '__test__/node/kubernetes-manifest.test.mjs',
    '__test__/node/nginx-edge.test.mjs',
    '__test__/node/project-contracts.test.mjs',
    '__test__/node/postgres-recovery-report.test.mjs',
    '__test__/node/server-release.test.mjs',
    '__test__/node/transport-benchmark-baseline.test.mjs',
    '__test__/node/transport-benchmark-report.test.mjs',
    '__test__/node/transport-soak-report.test.mjs',
    '__test__/node/v13-evidence.test.mjs',
    '.github/workflows/go-quality.yml',
    '.github/workflows/go-transport-benchmark.yml',
    '.github/workflows/node-tools-quality.yml',
    'docs/recovery/server-failure-matrix.md',
    'package.json',
    'yarn.lock',
  ].map(describeInput),
  evidence,
  boundaries: {
    linuxRemoteBenchmark: {
      status: linuxRemoteBenchmarkStatus,
      reason:
        linuxRemoteBenchmarkStatus === 'recorded'
          ? 'benchmark and bounded soak files were complete and exited successfully on a GitHub Actions Linux runner'
          : linuxRemoteBenchmarkStatus === 'failed'
            ? 'the GitHub Actions Linux benchmark or soak failed, or a required report, trend, system, or profile artifact was incomplete'
            : 'a local manifest cannot prove a successful remote Linux workflow run',
    },
    productionSharedStore: {
      status: 'not_recorded',
      reason: 'the Redis adapter and a local non-TLS Sentinel ACL/failover CI contract are defined, but no successful remote artifact or target TLS Redis HA, recovery, RPO, or RTO run was found',
    },
    otelCollector: {
      status: 'not_recorded',
      reason: 'no real OpenTelemetry collector or trace backend target-environment evidence was found',
    },
    postgresRecovery: {
      status: postgresRecoveryStatus,
      reason:
        postgresRecoveryStatus === 'recorded'
          ? 'the pinned PostgreSQL Linux job completed SQLSTATE, lock, logical backup, isolated restore, checkpoint comparison, and artifact integrity contracts'
          : postgresRecoveryStatus === 'failed'
            ? 'the GitHub Actions PostgreSQL contract failed, its restored checkpoint disagreed, or a required raw, report, backup, status, log, or checksum artifact was incomplete'
            : 'a pinned single-node logical backup and restore contract is defined, but a local manifest cannot prove a successful remote run or target PITR, failover, RPO, or RTO',
    },
    natsBroker: {
      status: 'not_recorded',
      reason: 'real Core NATS propagation plus local single-node restart, file-stream snapshot/restore, three-node sequential leader failover, overlapping and barrier-synchronized concurrent two-node quorum loss and recovery, and server-reported acknowledgement lease preflight contracts are defined, but no successful remote artifact, target broker deployment, target-latency lease tuning, cross-host partition recovery, or production identity and authorization evidence was found',
    },
    localNatsRestart: {
      status: localNatsRestartStatus,
      reason:
        localNatsRestartStatus === 'recorded'
          ? 'local before/after server logs and the structured single-node file-store restart report were complete and hash-archived'
          : localNatsRestartStatus === 'failed'
            ? 'local NATS restart evidence was present but its logs or structured recovery assertions were incomplete'
            : 'no local NATS restart logs and structured recovery report were found',
    },
    localNatsSnapshotRestore: {
      status: localNatsSnapshotRestoreStatus,
      reason:
        localNatsSnapshotRestoreStatus === 'recorded'
          ? 'the local file-stream snapshot, server log, and strict restore report preserve consumer state, exclude post-checkpoint writes, and match the archived SHA-256'
          : localNatsSnapshotRestoreStatus === 'failed'
            ? 'local NATS snapshot evidence was present but its archive integrity, consumer state, restore budget, or settlement assertions were incomplete'
            : 'no local NATS file-stream snapshot and structured restore report were found',
    },
    localNatsClusterFailover: {
      status: localNatsClusterFailoverStatus,
      reason:
        localNatsClusterFailoverStatus === 'recorded'
          ? 'three local server logs and the structured three-replica same-session overlapping, barrier-synchronized concurrent two-node, and live-process route network-partition recovery report were complete and hash-archived'
          : localNatsClusterFailoverStatus === 'failed'
            ? 'local NATS cluster evidence was present but a node log or structured failover assertion was incomplete'
            : 'no local three-node NATS cluster logs and structured leader-failover report were found',
    },
    oidcProvider: {
      status: 'not_recorded',
      reason: 'local JWKS, bounded PKCE/state/nonce discovery/token exchange, hash-keyed cross-client authorization-request storage and atomic consume, Secure HttpOnly SameSite state-cookie callback, hash-only opaque browser session/CSRF/logout, subject-owned tenant/resource authorization, refresh-session tests, and dual-client miniredis stores prove repository behavior only; no target identity provider, MFA, device session inventory, production policy/relationship store, production Redis HA, or production centralized revocation evidence was found',
    },
    signedRelease: {
      status: signedReleaseStatus,
      reason:
        signedReleaseStatus === 'recorded'
          ? 'the default-branch Linux release was checksum-bound to a GitHub Sigstore build provenance bundle and verified with gh attestation verify'
          : signedReleaseStatus === 'failed'
            ? 'the GitHub release build, provenance generation, remote verification, or required bundle/status/checksum artifact failed or was incomplete'
            : 'a deterministic release and default-branch provenance workflow are defined, but a local manifest cannot prove a successful signed remote run',
    },
    targetEdge: {
      status: 'not_recorded',
      reason: 'a pinned Nginx configuration and CI loopback contract are defined, but no target edge, real certificate/DNS, HTTP/3, or target lifecycle artifact was found',
    },
    kubernetesDrill: {
      status: 'not_recorded',
      reason: 'the checked-in template and local renderer prove static contracts only; no target Kubernetes rollout and recovery drill artifact was found',
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Evidence manifest written to ${relativePath(outputPath)}`);
