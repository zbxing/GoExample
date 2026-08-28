import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyReleaseAttestationURL,
  verifyReleaseAttestationVerification,
  verifyReleaseProvenanceBundleSubjects,
} from './lib/release-provenance.mjs';
import { verifyKubernetesEvidence } from './lib/kubernetes-evidence.mjs';
import { verifyAuditChainEvidence } from './lib/audit-chain-evidence.mjs';
import { verifyAuthorizationEvidence } from './lib/authorization-evidence.mjs';
import { verifyOIDCBrowserEvidence } from './lib/oidc-browser-evidence.mjs';
import {
  verifyNatsClusterContractArtifacts,
  verifyNatsClusterEvidence,
} from './lib/nats-cluster-evidence.mjs';
import { verifyNatsDeliveryEvidence } from './lib/nats-delivery-evidence.mjs';
import {
  verifyNatsRestartContractArtifacts,
  verifyNatsRestartEvidence,
} from './lib/nats-restart-evidence.mjs';
import { verifyNatsSnapshotEvidence } from './lib/nats-snapshot-evidence.mjs';
import { verifyNginxEdgeEvidence } from './lib/nginx-edge-evidence.mjs';
import { verifyPostgresRecoveryEvidence } from './lib/postgres-recovery-evidence.mjs';
import { verifyPrometheusRuleEvidence } from './lib/prometheus-rules.mjs';
import { verifyRedisSentinelEvidence } from './lib/redis-sentinel-evidence.mjs';
import { verifyServerRecoveryEvidence } from './lib/server-recovery-evidence.mjs';
import { verifyWorkflowLintEvidence } from './lib/workflow-lint.mjs';

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

const auditChainEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'audit-chain');
const auditChainEvidencePresent = [
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(auditChainEvidenceRoot, name)));
if (auditChainEvidencePresent) {
  try {
    verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: auditChainEvidenceRoot });
  } catch (error) {
    fail(`audit chain evidence is invalid: ${error.message}`);
  }
}

const authorizationEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'authorization-policy');
const authorizationEvidencePresent = [
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(authorizationEvidenceRoot, name)));
if (authorizationEvidencePresent) {
  try {
    verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: authorizationEvidenceRoot });
  } catch (error) {
    fail(`authorization evidence is invalid: ${error.message}`);
  }
}

const oidcBrowserEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'oidc-browser');
const oidcBrowserEvidencePresent = [
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(oidcBrowserEvidenceRoot, name)));
if (oidcBrowserEvidencePresent) {
  try {
    verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: oidcBrowserEvidenceRoot });
  } catch (error) {
    fail(`OIDC browser evidence is invalid: ${error.message}`);
  }
}

const workflowLintEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'workflow-lint');
if (existsSync(workflowLintEvidenceRoot)) {
  try {
    verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot: workflowLintEvidenceRoot });
  } catch (error) {
    fail(`workflow lint evidence is invalid: ${error.message}`);
  }
}

const prometheusRuleEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'prometheus-rules');
if (existsSync(prometheusRuleEvidenceRoot)) {
  try {
    verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot: prometheusRuleEvidenceRoot });
  } catch (error) {
    fail(`Prometheus rule evidence is invalid: ${error.message}`);
  }
}

const kubernetesEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'kubernetes-manifest');
if (existsSync(kubernetesEvidenceRoot)) {
  try {
    verifyKubernetesEvidence({ repositoryRoot, evidenceRoot: kubernetesEvidenceRoot });
  } catch (error) {
    fail(`Kubernetes evidence is invalid: ${error.message}`);
  }
}

const nginxEdgeEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'nginx-edge-contract');
if (existsSync(nginxEdgeEvidenceRoot)) {
  try {
    verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot: nginxEdgeEvidenceRoot });
  } catch (error) {
    fail(`Nginx edge evidence is invalid: ${error.message}`);
  }
}

const redisSentinelEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'redis-sentinel-contract');
if (existsSync(redisSentinelEvidenceRoot)) {
  try {
    verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot: redisSentinelEvidenceRoot });
  } catch (error) {
    fail(`Redis Sentinel evidence is invalid: ${error.message}`);
  }
}

const postgresRecoveryEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'postgres-recovery-contract');
const postgresRecoveryEvidencePresent =
  existsSync(postgresRecoveryEvidenceRoot) &&
  readdirSync(postgresRecoveryEvidenceRoot, { withFileTypes: true }).some((entry) => entry.isFile());
if (postgresRecoveryEvidencePresent) {
  try {
    verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot: postgresRecoveryEvidenceRoot });
  } catch (error) {
    fail(`PostgreSQL recovery evidence is invalid: ${error.message}`);
  }
}

const natsDeliveryOuterEvidenceRoot = path.join(
  tempRoot,
  'workflow-artifacts',
  'nats-contract',
  'delivery',
);
const natsDeliveryOuterEvidencePresent = [
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(natsDeliveryOuterEvidenceRoot, name)));
if (natsDeliveryOuterEvidencePresent) {
  try {
    verifyNatsDeliveryEvidence({ repositoryRoot, evidenceRoot: natsDeliveryOuterEvidenceRoot });
  } catch (error) {
    fail(`NATS delivery evidence is invalid: ${error.message}`);
  }
}

const natsRestartOuterEvidenceRoot = path.join(
  tempRoot,
  'workflow-artifacts',
  'nats-contract',
  'restart',
);
const natsRestartOuterEvidencePresent = [
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(natsRestartOuterEvidenceRoot, name)));
if (natsRestartOuterEvidencePresent) {
  try {
    verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot: natsRestartOuterEvidenceRoot });
  } catch (error) {
    fail(`NATS restart evidence is invalid: ${error.message}`);
  }
}

const natsSnapshotEvidenceRoot = path.join(
  tempRoot,
  'workflow-artifacts',
  'nats-contract',
  'snapshot',
);
const natsSnapshotOuterEvidencePresent = [
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(natsSnapshotEvidenceRoot, name)));
if (natsSnapshotOuterEvidencePresent) {
  try {
    verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot: natsSnapshotEvidenceRoot });
  } catch (error) {
    fail(`NATS snapshot evidence is invalid: ${error.message}`);
  }
}

const natsClusterOuterEvidenceRoot = path.join(
  tempRoot,
  'workflow-artifacts',
  'nats-contract',
  'cluster',
);
const natsClusterOuterEvidencePresent = [
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(natsClusterOuterEvidenceRoot, name)));
if (natsClusterOuterEvidencePresent) {
  try {
    verifyNatsClusterEvidence({ repositoryRoot, evidenceRoot: natsClusterOuterEvidenceRoot });
  } catch (error) {
    fail(`NATS cluster evidence is invalid: ${error.message}`);
  }
}

const serverRecoveryEvidenceRoot = path.join(tempRoot, 'recovery', 'server-local');
const serverRecoveryEvidencePresent = [
  'summary.json',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(serverRecoveryEvidenceRoot, name)));
if (serverRecoveryEvidencePresent) {
  try {
    verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot: serverRecoveryEvidenceRoot });
  } catch (error) {
    fail(`server recovery evidence is invalid: ${error.message}`);
  }
}

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
  `${postgresArtifactRoot}/report.json`,
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
  verifyNatsRestartContractArtifacts({
    evidenceRoot: path.join(repositoryRoot, natsRestartArtifactRoot),
  });
  natsRestartReportPassed = true;
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
  verifyNatsClusterContractArtifacts({
    evidenceRoot: path.join(repositoryRoot, natsClusterArtifactRoot),
  });
  natsClusterReportPassed = true;
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
let releaseChecksumsPassed = false;
let releaseProvenanceSubjects = null;
let releaseProvenanceBuild = null;
try {
  const releaseManifestSource = readReleaseArtifact('release-manifest.json');
  const sourceManifestSource = readReleaseArtifact('source-manifest.json');
  const reproducibilityReportSource = readReleaseArtifact('reproducibility-report.json');
  const releaseManifest = JSON.parse(releaseManifestSource ?? 'null');
  const sourceManifest = JSON.parse(sourceManifestSource ?? 'null');
  const reproducibilityReport = JSON.parse(reproducibilityReportSource ?? 'null');
  releaseSubjectName = releaseManifest?.subject?.name ?? null;
  releaseManifestPassed =
    releaseManifest?.schemaVersion === 2 &&
    releaseManifest?.scope === 'goexample_server_release' &&
    typeof releaseSubjectName === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(releaseSubjectName) &&
    /^[a-f0-9]{64}$/.test(releaseManifest?.subject?.sha256 ?? '') &&
    releaseManifest?.source?.repository === 'github.com/zbxing/goexample' &&
    /^[a-f0-9]{40}$/.test(releaseManifest?.build?.commit ?? '') &&
    releaseManifest?.source?.manifest?.name === 'source-manifest.json' &&
    releaseManifest?.source?.manifest?.bytes === Buffer.byteLength(sourceManifestSource ?? '') &&
    releaseManifest?.source?.manifest?.sha256 ===
      createHash('sha256').update(sourceManifestSource ?? '').digest('hex') &&
    sourceManifest?.schemaVersion === 1 &&
    sourceManifest?.scope === 'goexample_server_release_sources' &&
    sourceManifest?.entrypoint === './Solutions/Example/cmd/server' &&
    Array.isArray(sourceManifest?.files) &&
    sourceManifest.files.length > 0 &&
    reproducibilityReport?.schemaVersion === 3 &&
    reproducibilityReport?.scope === 'goexample_server_release_reproducibility' &&
    reproducibilityReport?.subject?.name === releaseSubjectName &&
    reproducibilityReport?.subject?.sha256 === releaseManifest?.subject?.sha256 &&
    reproducibilityReport?.sourceManifest?.name === 'source-manifest.json' &&
    reproducibilityReport?.sourceManifest?.sha256 === releaseManifest?.source?.manifest?.sha256;
  const expectedChecksums = [
    [releaseManifest?.subject?.sha256, releaseSubjectName],
    [createHash('sha256').update(releaseManifestSource ?? '').digest('hex'), 'release-manifest.json'],
    [createHash('sha256').update(sourceManifestSource ?? '').digest('hex'), 'source-manifest.json'],
    [
      createHash('sha256').update(reproducibilityReportSource ?? '').digest('hex'),
      'reproducibility-report.json',
    ],
  ]
    .map(([sha256, name]) => `${sha256}  ${name}\n`)
    .join('');
  releaseProvenanceSubjects = [
    { name: releaseSubjectName, sha256: releaseManifest?.subject?.sha256 },
    {
      name: 'release-manifest.json',
      sha256: createHash('sha256').update(releaseManifestSource ?? '').digest('hex'),
    },
    {
      name: 'source-manifest.json',
      sha256: createHash('sha256').update(sourceManifestSource ?? '').digest('hex'),
    },
    {
      name: 'reproducibility-report.json',
      sha256: createHash('sha256').update(reproducibilityReportSource ?? '').digest('hex'),
    },
  ];
  releaseProvenanceBuild = {
    repository: releaseManifest?.source?.repository,
    sourceCommit: releaseManifest?.build?.commit,
    workflowPath: '.github/workflows/go-quality.yml',
  };
  releaseChecksumsPassed =
    releaseManifestPassed && readReleaseArtifact('SHA256SUMS') === expectedChecksums;
} catch {
  releaseManifestPassed = false;
  releaseChecksumsPassed = false;
}
let releaseProvenancePassed = false;
if (releaseChecksumsPassed && releaseProvenanceSubjects !== null && releaseProvenanceBuild !== null) {
  try {
    const bundle = JSON.parse(readReleaseArtifact('provenance.bundle.json') ?? 'null');
    verifyReleaseProvenanceBundleSubjects(bundle, releaseProvenanceSubjects, releaseProvenanceBuild);
    verifyReleaseAttestationURL(
      readReleaseArtifact('attestation-url.txt')?.trim() ?? '',
      releaseProvenanceBuild.repository,
    );
    verifyReleaseAttestationVerification(
      readReleaseArtifact('attestation-verification.txt') ?? '',
      releaseProvenanceSubjects,
    );
    releaseProvenancePassed = true;
  } catch {
    releaseProvenancePassed = false;
  }
}
const requiredReleaseArtifacts = [
  `${releaseArtifactRoot}/release-manifest.json`,
  `${releaseArtifactRoot}/SHA256SUMS`,
  `${releaseArtifactRoot}/source-manifest.json`,
  `${releaseArtifactRoot}/reproducibility-report.json`,
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
    ? releaseAttestationStatus === '0' &&
      releaseManifestPassed &&
      releaseChecksumsPassed &&
      releaseProvenancePassed &&
      releaseArtifactsComplete
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
	'Framework/httpapi/app.go',
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
    'Services/Billing/internal/billingapi/sdk_integration_test.go',
    'Services/Billing/internal/billingapp/service.go',
    'Services/Billing/internal/billingapp/service_test.go',
    'SDK/GoExample/go.mod',
    'SDK/GoExample/VERSION',
    'SDK/GoExample/README.md',
    'SDK/GoExample/CHANGELOG.md',
    'SDK/GoExample/client.gen.go',
    'SDK/GoExample/client_test.go',
    'SDK/GoExample/release-manifest.json',
    'SDK/Billing/go.mod',
    'SDK/Billing/VERSION',
    'SDK/Billing/README.md',
    'SDK/Billing/CHANGELOG.md',
    'SDK/Billing/client.gen.go',
    'SDK/Billing/client_test.go',
    'SDK/Billing/release-manifest.json',
    'contracts/projects.json',
    'support/consumer/HealthProbe/go.mod',
    'support/consumer/HealthProbe/go.sum',
    'support/consumer/HealthProbe/cmd/healthprobe/main.go',
    'support/consumer/HealthProbe/cmd/healthprobe/main_test.go',
    'support/deploy/prometheus/.gitignore',
    'support/deploy/prometheus/README.md',
    'support/deploy/prometheus/prometheus.yml',
    'support/deploy/prometheus/rules/goexample-slo.yml',
    'support/deploy/prometheus/tests/goexample-slo.test.yml',
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
    'scripts/sdk-release.mjs',
    'scripts/project-contracts.mjs',
    'scripts/lib/project-contracts.mjs',
    'scripts/lib/audit-chain-evidence.mjs',
    'scripts/lib/authorization-evidence.mjs',
    'scripts/lib/oidc-browser-evidence.mjs',
    'scripts/lib/release-provenance.mjs',
    'scripts/lib/sdk-release.mjs',
    'scripts/lib/kubernetes-evidence.mjs',
    'scripts/lib/nginx-edge-evidence.mjs',
    'scripts/lib/nats-cluster-evidence.mjs',
    'scripts/lib/nats-delivery-evidence.mjs',
    'scripts/lib/nats-restart-evidence.mjs',
    'scripts/lib/nats-snapshot-evidence.mjs',
    'scripts/lib/postgres-recovery-evidence.mjs',
    'scripts/lib/prometheus-rules.mjs',
    'scripts/lib/redis-sentinel-evidence.mjs',
    'scripts/lib/server-recovery-evidence.mjs',
    'scripts/lib/workflow-lint.mjs',
    'scripts/kubernetes-manifest.mjs',
    'scripts/audit-chain-evidence.mjs',
    'scripts/authorization-evidence.mjs',
    'scripts/oidc-browser-evidence.mjs',
    'scripts/kubernetes-evidence.mjs',
    'scripts/nginx-edge.mjs',
    'scripts/nginx-edge-contract.mjs',
    'scripts/nginx-edge-evidence.mjs',
    'scripts/nats-cluster-evidence.mjs',
    'scripts/nats-delivery-evidence.mjs',
    'scripts/nats-restart-evidence.mjs',
    'scripts/nats-snapshot-evidence.mjs',
    'scripts/postgres-recovery-contract.mjs',
    'scripts/postgres-recovery-evidence.mjs',
    'scripts/postgres-recovery-report.mjs',
    'scripts/prometheus-rules.mjs',
    'scripts/redis-sentinel-contract.mjs',
    'scripts/redis-sentinel-evidence.mjs',
    'scripts/server-recovery-drill.mjs',
    'scripts/server-recovery-evidence.mjs',
    'scripts/server-release.mjs',
    'scripts/transport-benchmark-baseline.mjs',
    'scripts/transport-benchmark-report.mjs',
    'scripts/lib/transport-benchmark-environment.mjs',
    'scripts/transport-soak-report.mjs',
    'scripts/v13-evidence.mjs',
    'scripts/workflow-lint.mjs',
    '__test__/node/kubernetes-manifest.test.mjs',
    '__test__/node/audit-chain-evidence.test.mjs',
    '__test__/node/authorization-evidence.test.mjs',
    '__test__/node/oidc-browser-evidence.test.mjs',
    '__test__/node/kubernetes-evidence.test.mjs',
    '__test__/node/sdk-release.test.mjs',
    '__test__/node/nginx-edge.test.mjs',
    '__test__/node/nginx-edge-evidence.test.mjs',
    '__test__/node/nats-cluster-evidence.test.mjs',
    '__test__/node/nats-delivery-evidence.test.mjs',
    '__test__/node/nats-restart-evidence.test.mjs',
    '__test__/node/nats-snapshot-evidence.test.mjs',
    '__test__/node/project-contracts.test.mjs',
    '__test__/node/postgres-recovery-report.test.mjs',
    '__test__/node/postgres-recovery-evidence.test.mjs',
    '__test__/node/prometheus-rules.test.mjs',
    '__test__/node/redis-sentinel-evidence.test.mjs',
    '__test__/node/release-provenance.test.mjs',
    '__test__/node/script-guards.test.mjs',
    '__test__/node/server-release.test.mjs',
    '__test__/node/server-recovery-evidence.test.mjs',
    '__test__/node/transport-benchmark-baseline.test.mjs',
    '__test__/node/transport-benchmark-report.test.mjs',
    '__test__/node/transport-soak-report.test.mjs',
    '__test__/node/v13-evidence.test.mjs',
    '__test__/node/workflow-lint.test.mjs',
    'tools/actionlint/go.mod',
    'tools/actionlint/go.sum',
    'tools/promtool/go.mod',
    'tools/promtool/go.sum',
    '.github/workflows/dependency-review.yml',
    '.github/workflows/go-quality.yml',
    '.github/workflows/go-transport-benchmark.yml',
    '.github/workflows/node-tools-quality.yml',
    '.github/workflows/security-analysis.yml',
    '.github/workflows/supply-chain.yml',
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
          ? 'the default-branch Linux binary, release manifest, source manifest, and reproducibility report were bound to the exact archived in-toto/SLSA DSSE subject set, source commit, repository, workflow, builder invocation, and four successful gh attestation verify results'
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
