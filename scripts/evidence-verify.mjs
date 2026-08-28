import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
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
    try {
      verifyNatsRestartContractArtifacts({ evidenceRoot: path.join(repositoryRoot, root) });
    } catch (error) {
      fail(`recorded localNatsRestart report does not satisfy the single-node restart contract: ${error.message}`);
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
    }
    try {
      verifyNatsClusterContractArtifacts({
        evidenceRoot: path.join(repositoryRoot, root),
      });
    } catch (error) {
      fail(`recorded localNatsClusterFailover evidence is invalid: ${error.message}`);
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
      'report.json',
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
      'source-manifest.json',
      'reproducibility-report.json',
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
    let sourceManifest;
    let reproducibilityReport;
    let bundle;
    try {
      releaseManifest = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'release-manifest.json'), 'utf8'));
      sourceManifest = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'source-manifest.json'), 'utf8'));
      reproducibilityReport = JSON.parse(
        readFileSync(path.join(repositoryRoot, root, 'reproducibility-report.json'), 'utf8'),
      );
      bundle = JSON.parse(readFileSync(path.join(repositoryRoot, root, 'provenance.bundle.json'), 'utf8'));
    } catch {
      fail('recorded signedRelease requires valid release, source, reproducibility, and provenance bundle JSON');
    }
    const subjectName = releaseManifest?.subject?.name;
    const subjectDigest = releaseManifest?.subject?.sha256;
    if (
      releaseManifest?.schemaVersion !== 2 ||
      releaseManifest?.scope !== 'goexample_server_release' ||
      typeof subjectName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(subjectName) ||
      typeof subjectDigest !== 'string' ||
      !sha256Pattern.test(subjectDigest) ||
      releaseManifest?.source?.repository !== 'github.com/zbxing/goexample' ||
      !/^[a-f0-9]{40}$/.test(releaseManifest?.build?.commit ?? '')
    ) {
      fail('recorded signedRelease release manifest subject is invalid');
    }
    const sourceReference = releaseManifest?.source?.manifest;
    const sourceManifestPath = path.join(repositoryRoot, root, 'source-manifest.json');
    if (
      sourceReference?.name !== 'source-manifest.json' ||
      !Number.isSafeInteger(sourceReference?.bytes) ||
      sourceReference.bytes <= 0 ||
      sourceReference.bytes > 1024 * 1024 ||
      typeof sourceReference?.sha256 !== 'string' ||
      !sha256Pattern.test(sourceReference.sha256) ||
      lstatSync(sourceManifestPath).size !== sourceReference.bytes ||
      hashFile(sourceManifestPath) !== sourceReference.sha256 ||
      sourceManifest?.schemaVersion !== 1 ||
      sourceManifest?.scope !== 'goexample_server_release_sources' ||
      sourceManifest?.entrypoint !== './Solutions/Example/cmd/server' ||
      !Array.isArray(sourceManifest?.files) ||
      sourceManifest.files.length === 0 ||
      sourceManifest.files.length > 4096
    ) {
      fail('recorded signedRelease source manifest is invalid');
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
    if (
      reproducibilityReport?.schemaVersion !== 3 ||
      reproducibilityReport?.scope !== 'goexample_server_release_reproducibility' ||
      reproducibilityReport?.subject?.name !== subjectName ||
      reproducibilityReport?.subject?.bytes !== releaseManifest.subject.bytes ||
      reproducibilityReport?.subject?.sha256 !== subjectDigest ||
      reproducibilityReport?.sourceManifest?.name !== sourceReference.name ||
      reproducibilityReport?.sourceManifest?.bytes !== sourceReference.bytes ||
      reproducibilityReport?.sourceManifest?.sha256 !== sourceReference.sha256 ||
      reproducibilityReport?.sourceCommit !== releaseManifest?.build?.commit ||
      !Array.isArray(reproducibilityReport?.runs) ||
      reproducibilityReport.runs.length !== 2
    ) {
      fail('recorded signedRelease reproducibility report is invalid');
    }
    const checksums = readFileSync(path.join(repositoryRoot, root, 'SHA256SUMS'), 'utf8');
    const expectedProvenanceSubjects = [
      { name: subjectName, sha256: subjectDigest },
      {
        name: 'release-manifest.json',
        sha256: hashFile(path.join(repositoryRoot, root, 'release-manifest.json')),
      },
      { name: 'source-manifest.json', sha256: hashFile(sourceManifestPath) },
      {
        name: 'reproducibility-report.json',
        sha256: hashFile(path.join(repositoryRoot, root, 'reproducibility-report.json')),
      },
    ];
    const expectedChecksums = expectedProvenanceSubjects
      .map(({ sha256, name }) => `${sha256}  ${name}\n`)
      .join('');
    if (checksums !== expectedChecksums) {
      fail('recorded signedRelease SHA256SUMS does not contain exactly its four attested subjects');
    }
    try {
      verifyReleaseProvenanceBundleSubjects(bundle, expectedProvenanceSubjects, {
        repository: releaseManifest.source.repository,
        sourceCommit: releaseManifest.build.commit,
        workflowPath: '.github/workflows/go-quality.yml',
      });
    } catch (error) {
      fail(`recorded signedRelease provenance payload is invalid: ${error.message}`);
    }
    const attestationURL = readFileSync(path.join(repositoryRoot, root, 'attestation-url.txt'), 'utf8').trim();
    try {
      verifyReleaseAttestationURL(attestationURL, releaseManifest.source.repository);
    } catch (error) {
      fail(`recorded signedRelease attestation URL is invalid: ${error.message}`);
    }
    const verification = readFileSync(
      path.join(repositoryRoot, root, 'attestation-verification.txt'),
      'utf8',
    );
    try {
      verifyReleaseAttestationVerification(verification, expectedProvenanceSubjects);
    } catch (error) {
      fail(`recorded signedRelease attestation verification output is invalid: ${error.message}`);
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
const auditChainArtifactPrefix = '.temp/workflow-artifacts/audit-chain/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(auditChainArtifactPrefix))) {
  let auditChainEvidence;
  try {
    auditChainEvidence = verifyAuditChainEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'audit-chain'),
    });
  } catch (error) {
    fail(`audit chain evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of auditChainEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`audit chain evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const authorizationArtifactPrefix = '.temp/workflow-artifacts/authorization-policy/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(authorizationArtifactPrefix))) {
  let authorizationEvidence;
  try {
    authorizationEvidence = verifyAuthorizationEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'authorization-policy'),
    });
  } catch (error) {
    fail(`authorization evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of authorizationEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`authorization evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const oidcBrowserArtifactPrefix = '.temp/workflow-artifacts/oidc-browser/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(oidcBrowserArtifactPrefix))) {
  let oidcBrowserEvidence;
  try {
    oidcBrowserEvidence = verifyOIDCBrowserEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'oidc-browser'),
    });
  } catch (error) {
    fail(`OIDC browser evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of oidcBrowserEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`OIDC browser evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const serverRecoveryArtifactPrefix = '.temp/recovery/server-local/';
const serverRecoveryOuterArtifactNames = new Set(['summary.json', 'report.json', 'SHA256SUMS']);
const serverRecoveryEvidencePresent = [...evidencePaths].some((artifactPath) => {
  if (!artifactPath.startsWith(serverRecoveryArtifactPrefix)) {
    return false;
  }
  return serverRecoveryOuterArtifactNames.has(artifactPath.slice(serverRecoveryArtifactPrefix.length));
});
if (serverRecoveryEvidencePresent) {
  let serverRecoveryEvidence;
  try {
    serverRecoveryEvidence = verifyServerRecoveryEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'recovery', 'server-local'),
    });
  } catch (error) {
    fail(`server recovery evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of serverRecoveryEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`server recovery evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const workflowLintArtifactPrefix = '.temp/workflow-artifacts/workflow-lint/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(workflowLintArtifactPrefix))) {
  let workflowLintEvidence;
  try {
    workflowLintEvidence = verifyWorkflowLintEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'workflow-lint'),
    });
  } catch (error) {
    fail(`workflow lint evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of workflowLintEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`workflow lint evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const prometheusRuleArtifactPrefix = '.temp/workflow-artifacts/prometheus-rules/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(prometheusRuleArtifactPrefix))) {
  let prometheusRuleEvidence;
  try {
    prometheusRuleEvidence = verifyPrometheusRuleEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'prometheus-rules'),
    });
  } catch (error) {
    fail(`Prometheus rule evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of prometheusRuleEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`Prometheus rule evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const kubernetesArtifactPrefix = '.temp/workflow-artifacts/kubernetes-manifest/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(kubernetesArtifactPrefix))) {
  let kubernetesEvidence;
  try {
    kubernetesEvidence = verifyKubernetesEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'kubernetes-manifest'),
    });
  } catch (error) {
    fail(`Kubernetes evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of kubernetesEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`Kubernetes evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const nginxEdgeArtifactPrefix = '.temp/workflow-artifacts/nginx-edge-contract/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(nginxEdgeArtifactPrefix))) {
  let nginxEdgeEvidence;
  try {
    nginxEdgeEvidence = verifyNginxEdgeEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'nginx-edge-contract'),
    });
  } catch (error) {
    fail(`Nginx edge evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of nginxEdgeEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`Nginx edge evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const redisSentinelArtifactPrefix = '.temp/workflow-artifacts/redis-sentinel-contract/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(redisSentinelArtifactPrefix))) {
  let redisSentinelEvidence;
  try {
    redisSentinelEvidence = verifyRedisSentinelEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'redis-sentinel-contract'),
    });
  } catch (error) {
    fail(`Redis Sentinel evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of redisSentinelEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`Redis Sentinel evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const postgresRecoveryArtifactPrefix = '.temp/workflow-artifacts/postgres-recovery-contract/';
if ([...evidencePaths].some((artifactPath) => artifactPath.startsWith(postgresRecoveryArtifactPrefix))) {
  let postgresRecoveryEvidence;
  try {
    postgresRecoveryEvidence = verifyPostgresRecoveryEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'postgres-recovery-contract'),
    });
  } catch (error) {
    fail(`PostgreSQL recovery evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of postgresRecoveryEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`PostgreSQL recovery evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const natsDeliveryArtifactPrefix = '.temp/workflow-artifacts/nats-contract/delivery/';
const natsDeliveryOuterArtifactNames = new Set([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
]);
const natsDeliveryOuterEvidencePresent = [...evidencePaths].some((artifactPath) => {
  if (!artifactPath.startsWith(natsDeliveryArtifactPrefix)) {
    return false;
  }
  return natsDeliveryOuterArtifactNames.has(artifactPath.slice(natsDeliveryArtifactPrefix.length));
});
if (natsDeliveryOuterEvidencePresent) {
  let natsDeliveryEvidence;
  try {
    natsDeliveryEvidence = verifyNatsDeliveryEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'nats-contract', 'delivery'),
    });
  } catch (error) {
    fail(`NATS delivery evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of natsDeliveryEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`NATS delivery evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const natsRestartArtifactPrefix = '.temp/workflow-artifacts/nats-contract/restart/';
const natsRestartOuterArtifactNames = new Set([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
]);
const natsRestartOuterEvidencePresent = [...evidencePaths].some((artifactPath) => {
  if (!artifactPath.startsWith(natsRestartArtifactPrefix)) {
    return false;
  }
  return natsRestartOuterArtifactNames.has(artifactPath.slice(natsRestartArtifactPrefix.length));
});
if (natsRestartOuterEvidencePresent) {
  let natsRestartEvidence;
  try {
    natsRestartEvidence = verifyNatsRestartEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'nats-contract', 'restart'),
    });
  } catch (error) {
    fail(`NATS restart evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of natsRestartEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`NATS restart evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const natsSnapshotArtifactPrefix = '.temp/workflow-artifacts/nats-contract/snapshot/';
const natsSnapshotOuterArtifactNames = new Set([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
]);
const natsSnapshotOuterEvidencePresent = [...evidencePaths].some((artifactPath) => {
  if (!artifactPath.startsWith(natsSnapshotArtifactPrefix)) {
    return false;
  }
  return natsSnapshotOuterArtifactNames.has(artifactPath.slice(natsSnapshotArtifactPrefix.length));
});
if (natsSnapshotOuterEvidencePresent) {
  let natsSnapshotEvidence;
  try {
    natsSnapshotEvidence = verifyNatsSnapshotEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'nats-contract', 'snapshot'),
    });
  } catch (error) {
    fail(`NATS snapshot evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of natsSnapshotEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`NATS snapshot evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
const natsClusterArtifactPrefix = '.temp/workflow-artifacts/nats-contract/cluster/';
const natsClusterOuterArtifactNames = new Set([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
  'report.json',
  'SHA256SUMS',
]);
const natsClusterOuterEvidencePresent = [...evidencePaths].some((artifactPath) => {
  if (!artifactPath.startsWith(natsClusterArtifactPrefix)) {
    return false;
  }
  return natsClusterOuterArtifactNames.has(artifactPath.slice(natsClusterArtifactPrefix.length));
});
if (natsClusterOuterEvidencePresent) {
  let natsClusterEvidence;
  try {
    natsClusterEvidence = verifyNatsClusterEvidence({
      repositoryRoot,
      evidenceRoot: path.join(tempRoot, 'workflow-artifacts', 'nats-contract', 'cluster'),
    });
  } catch (error) {
    fail(`NATS cluster evidence is invalid: ${error.message}`);
  }
  for (const artifactPath of natsClusterEvidence.artifactPaths) {
    if (!evidencePaths.has(artifactPath)) {
      fail(`NATS cluster evidence artifact is missing from the manifest: ${artifactPath}`);
    }
  }
}
verifyBoundaries(document.boundaries, evidencePaths);

console.log(
  `Evidence manifest verified: ${relativePath(manifestPath)} (${inputCount} inputs, ${artifactCount} artifacts, sha256 ${hashFile(manifestPath)})`,
);
