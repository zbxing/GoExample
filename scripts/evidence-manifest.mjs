import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
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
import { verifySDKReleaseEvidence } from './lib/sdk-release-evidence.mjs';
import { verifySDKConsumerEvidence } from './lib/sdk-consumer-evidence.mjs';
import { verifySDKConsumerMatrixEvidence } from './lib/sdk-consumer-matrix-evidence.mjs';
import { verifyServerRecoveryEvidence } from './lib/server-recovery-evidence.mjs';
import { verifyWorkflowLintEvidence } from './lib/workflow-lint.mjs';
import {
  evidenceInputPaths,
  optionalEvidenceInputPaths,
} from './lib/evidence-manifest-contract.mjs';

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

function run(command, args, { raw = false } = {}) {
  const candidates = process.platform === 'win32' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0) {
      const output = `${result.stdout ?? ''}`;
      return raw ? output : output.trim() || null;
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
      const output = `${result.stdout ?? ''}`;
      return raw ? output : output.trim() || null;
    }
  }
  return null;
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, 'r');
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireUnlinkedDirectoryChain(root, directory, name, { create = false } = {}) {
  if (!isWithin(root, directory)) {
    fail(`${name} escapes its allowed directory`);
  }
  const relative = path.relative(root, directory);
  const directories = [root];
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    directories.push(current);
  }
  for (const currentDirectory of directories) {
    if (!existsSync(currentDirectory)) {
      if (!create) {
        fail(`${name} is missing: ${relativePath(currentDirectory)}`);
      }
      mkdirSync(currentDirectory);
    }
    const stats = lstatSync(currentDirectory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail(`${name} must not contain symbolic links or non-directories: ${relativePath(currentDirectory)}`);
    }
  }
}

function requireSingleLinkFile(filePath, name) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    fail(`${name} must be a regular file with exactly one hard link: ${relativePath(filePath)}`);
  }
  return stats;
}

function walkFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const directoryStats = lstatSync(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    fail(`evidence inventory root must be a directory without symbolic links: ${relativePath(directory)}`);
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`evidence inventory must not contain symbolic links: ${relativePath(entryPath)}`);
    }
    if (entry.isDirectory()) {
      if (entry.name === '.test-fixtures') {
        continue;
      }
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      if (lstatSync(entryPath).nlink !== 1) {
        fail(`evidence inventory must not contain hard-linked files: ${relativePath(entryPath)}`);
      }
      files.push(entryPath);
    } else {
      fail(`evidence inventory must contain only regular files and directories: ${relativePath(entryPath)}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function describeFile(filePath) {
  const stats = requireSingleLinkFile(filePath, 'evidence artifact');
  return {
    path: relativePath(filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function describeInput(inputPath) {
  const filePath = path.join(repositoryRoot, inputPath);
  if (!existsSync(filePath)) {
    if (!optionalEvidenceInputPaths.includes(inputPath)) {
      fail(`required evidence input is missing: ${inputPath}`);
    }
    return { path: inputPath, present: false };
  }
  const stats = requireSingleLinkFile(filePath, 'evidence input');
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
requireUnlinkedDirectoryChain(tempRoot, path.dirname(outputPath), 'manifest output parent directory', { create: true });
if (existsSync(outputPath)) {
  requireSingleLinkFile(outputPath, 'manifest output');
}

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

const sdkReleaseEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'sdk-release-readiness');
const sdkReleaseEvidencePresent = [
  'verification-output.txt',
  'verification-error.txt',
  'verification-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(sdkReleaseEvidenceRoot, name)));
if (sdkReleaseEvidencePresent) {
  try {
    verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: sdkReleaseEvidenceRoot });
  } catch (error) {
    fail(`SDK release evidence is invalid: ${error.message}`);
  }
}

const sdkConsumerEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'sdk-consumer-migration');
const sdkConsumerEvidencePresent = [
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(sdkConsumerEvidenceRoot, name)));
if (sdkConsumerEvidencePresent) {
  try {
    verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: sdkConsumerEvidenceRoot });
  } catch (error) {
    fail(`SDK consumer evidence is invalid: ${error.message}`);
  }
}

const sdkConsumerMatrixEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'sdk-consumer-matrix');
const sdkConsumerMatrixEvidencePresent = [
  'verification-output.txt',
  'verification-error.txt',
  'verification-status.txt',
  'report.json',
  'SHA256SUMS',
].some((name) => existsSync(path.join(sdkConsumerMatrixEvidenceRoot, name)));
if (sdkConsumerMatrixEvidencePresent) {
  try {
    verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: sdkConsumerMatrixEvidenceRoot });
  } catch (error) {
    fail(`SDK consumer matrix evidence is invalid: ${error.message}`);
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

const gitStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { raw: true });
const gitCommit = run('git', ['rev-parse', 'HEAD']);
if (typeof gitCommit !== 'string' || !/^[a-f0-9]{40}$/.test(gitCommit)) {
  fail('current repository Git commit is unavailable');
}
if (gitStatus === null) {
  fail('current repository Git status is unavailable');
}
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
    gitCommit,
    dirty: gitStatus.length > 0,
    changedFileCount: gitStatus ? gitStatus.split('\n').filter(Boolean).length : 0,
    statusSha256: createHash('sha256').update(gitStatus).digest('hex'),
  },
  toolchain: {
    node: process.version,
    yarn: run('yarn', ['--version']) ?? 'unavailable',
    go: (goVersion ? run(goVersion, ['version']) : run('go', ['version'])) ?? 'unavailable',
    goToolchain: toolchainVersion ?? 'undeclared',
  },
  inputs: evidenceInputPaths.map(describeInput),
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
