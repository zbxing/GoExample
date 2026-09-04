import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedGitCommit } from './bounded-command.mjs';
import { readSDKConsumerMatrix, verifySDKConsumerMatrix } from './sdk-consumer-matrix.mjs';

export const sdkConsumerMatrixEvidenceSchemaVersion = 1;
export const sdkConsumerMatrixEvidenceArguments = Object.freeze([
  'scripts/sdk-consumer-matrix.mjs',
  'check',
]);
export const sdkConsumerMatrixEvidenceArtifactNames = Object.freeze([
  'verification-output.txt',
  'verification-error.txt',
  'verification-status.txt',
  'report.json',
  'SHA256SUMS',
]);
export const sdkConsumerMatrixProcessTimeoutMs = 30_000;
const executionBudgetMs = 60_000;
const checksumArtifactNames = sdkConsumerMatrixEvidenceArtifactNames.filter((name) => name !== 'SHA256SUMS');
const sha256Pattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumArtifactBytes = 4 * 1024 * 1024;
const maximumReportBytes = 1024 * 1024;

export const sdkConsumerMatrixEvidenceLimitations = Object.freeze([
  'proves repository-local SDK consumer matrix validation, version/path alignment, and the documented deprecation window only',
  'does not establish a formal SDK tag, package publication, external consumer execution, or target deployment migration',
  'does not establish deprecation-window execution, production ownership, remote provenance, or target environment behavior',
]);

function reject(message) {
  throw new Error(`SDK consumer matrix evidence: ${message}`);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function repositoryRelativePath(repositoryRoot, filePath) {
  return toPosix(path.relative(repositoryRoot, filePath));
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

function requireTimestamp(value, name) {
  if (
    typeof value !== 'string' ||
    !timestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    reject(`${name} must be a canonical UTC timestamp`);
  }
  return Date.parse(value);
}

function requireRegularFile(filePath, name, maximumBytes = maximumArtifactBytes) {
  if (!existsSync(filePath)) {
    reject(`${name} is missing`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    reject(`${name} must be a regular file and not a symbolic link`);
  }
  if (stats.size > maximumBytes) {
    reject(`${name} exceeds ${maximumBytes} bytes`);
  }
  return stats;
}

function describeFile(filePath, repositoryRoot) {
  const relative = repositoryRelativePath(repositoryRoot, filePath);
  const stats = requireRegularFile(filePath, relative);
  return { path: relative, bytes: stats.size, sha256: hashFile(filePath) };
}

function describeArtifact(evidenceRoot, name) {
  const filePath = path.join(evidenceRoot, name);
  const stats = requireRegularFile(filePath, name);
  return { path: name, bytes: stats.size, sha256: hashFile(filePath) };
}

function verifyFileRecord(record, filePath, expectedPath, name) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  if (value.path !== expectedPath) {
    reject(`${name}.path must equal ${expectedPath}`);
  }
  const stats = requireRegularFile(filePath, name);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes !== stats.size) {
    reject(`${name}.bytes does not match ${expectedPath}`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    reject(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== value.sha256) {
    reject(`${name}.sha256 does not match ${expectedPath}`);
  }
  return filePath;
}

function currentGitCommit(repositoryRoot) {
  const value = readBoundedGitCommit({ cwd: repositoryRoot });
  if (value === null) {
    reject('cannot resolve the current Git commit');
  }
  return value;
}

function sourcePaths() {
  return {
    packageDocument: 'package.json',
    matrixContract: 'contracts/sdk-consumer-matrix.json',
    matrixVerifier: 'scripts/lib/sdk-consumer-matrix.mjs',
    matrixRunner: 'scripts/sdk-consumer-matrix.mjs',
    projectManifest: 'contracts/projects.json',
    projectContractVerifier: 'scripts/lib/project-contracts.mjs',
    exampleOpenAPI: 'docs/openapi/openapi.json',
    billingOpenAPI: 'docs/openapi/billing.json',
    consumerMatrixDoc: 'docs/openapi/consumer-matrix.md',
    exampleReleaseManifest: 'SDK/GoExample/release-manifest.json',
    billingReleaseManifest: 'SDK/Billing/release-manifest.json',
    evidenceRunner: 'scripts/sdk-consumer-matrix-evidence.mjs',
    evidenceVerifier: 'scripts/lib/sdk-consumer-matrix-evidence.mjs',
    boundedCommand: 'scripts/lib/bounded-command.mjs',
    evidenceTests: '__test__/node/sdk-consumer-matrix-evidence.test.mjs',
    aggregateGenerator: 'scripts/evidence-manifest.mjs',
    aggregateVerifier: 'scripts/evidence-verify.mjs',
    aggregateInputContract: 'scripts/lib/evidence-manifest-contract.mjs',
    workflow: '.github/workflows/node-tools-quality.yml',
  };
}

function collectSource(repositoryRoot) {
  return Object.fromEntries(
    Object.entries(sourcePaths()).map(([name, relative]) => [
      name,
      describeFile(path.join(repositoryRoot, ...relative.split('/')), repositoryRoot),
    ]),
  );
}

function verifySource(source, repositoryRoot) {
  const paths = sourcePaths();
  requireExactKeys(source, Object.keys(paths), 'source');
  for (const [name, relative] of Object.entries(paths)) {
    verifyFileRecord(
      source[name],
      path.join(repositoryRoot, ...relative.split('/')),
      relative,
      `source.${name}`,
    );
  }
}

function expectedStatusText(execution) {
  return [
    `exit_code=${execution.exitCode ?? ''}`,
    `signal=${execution.signal ?? ''}`,
    `spawn_error=${execution.spawnErrorCode ?? ''}`,
    '',
  ].join('\n');
}

function validateExecution(execution, name = 'execution') {
  const value = requireExactKeys(
    execution,
    ['completedAt', 'exitCode', 'signal', 'spawnErrorCode', 'startedAt'],
    name,
  );
  const startedAt = requireTimestamp(value.startedAt, `${name}.startedAt`);
  const completedAt = requireTimestamp(value.completedAt, `${name}.completedAt`);
  if (startedAt > completedAt || completedAt - startedAt > executionBudgetMs) {
    reject(`${name} must stay inside the ${executionBudgetMs}ms budget`);
  }
  const exitCodeValid = value.exitCode === null
    || (Number.isSafeInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255);
  const signalValid = value.signal === null
    || (typeof value.signal === 'string' && /^[A-Z][A-Z0-9]+$/.test(value.signal));
  const errorValid = value.spawnErrorCode === null
    || (typeof value.spawnErrorCode === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value.spawnErrorCode));
  if (!exitCodeValid || !signalValid || !errorValid) {
    reject(`${name} has an invalid process result`);
  }
  if (value.exitCode === null && value.signal === null && value.spawnErrorCode === null) {
    reject(`${name} must record an exit code, signal, or spawn error`);
  }
  return value;
}

function processPassed(execution) {
  return execution.exitCode === 0 && execution.signal === null && execution.spawnErrorCode === null;
}

export function expectedSDKConsumerMatrixEvidenceOutput() {
  return 'SDK consumer matrix verified: 2 repository-local consumers\n';
}

function verifyChecksums(evidenceRoot) {
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, 'SHA256SUMS', maximumReportBytes);
  const expected = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  if (readFileSync(checksumPath, 'utf8') !== expected) {
    reject('SHA256SUMS must contain the exact ordered SDK consumer matrix evidence artifact set');
  }
}

function verifyDirectory(evidenceRoot) {
  if (!existsSync(evidenceRoot) || !lstatSync(evidenceRoot).isDirectory()) {
    reject('evidence directory is missing');
  }
  const actual = readdirSync(evidenceRoot, { withFileTypes: true });
  if (actual.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('evidence directory may only contain regular files');
  }
  const names = actual.map((entry) => entry.name).sort();
  const expected = [...sdkConsumerMatrixEvidenceArtifactNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    reject(`evidence directory files must be exactly ${expected.join(', ')}`);
  }
}

function contract(repositoryRoot) {
  const matrix = readSDKConsumerMatrix(repositoryRoot);
  return {
    matrix,
    assertions: {
      projectAndSDKPathsBound: true,
      openAPIVersionsBound: true,
      releaseManifestVersionsBound: true,
      canonicalAndDeprecatedPathsBound: true,
      deprecationWindowBound: true,
      publicationAndDeploymentBoundariesExplicit: true,
    },
  };
}

function verifySuccessfulOutput(stdout, stderr) {
  if (stdout !== expectedSDKConsumerMatrixEvidenceOutput()) {
    reject('verification-output.txt must contain the exact SDK consumer matrix marker');
  }
  if (stderr !== '') {
    reject('verification-error.txt must be empty for passed evidence');
  }
}

export function buildSDKConsumerMatrixEvidenceReport({ repositoryRoot, evidenceRoot, execution }) {
  const checkedExecution = validateExecution(execution);
  const status = processPassed(checkedExecution) ? 'passed' : 'failed';
  const stdout = readFileSync(path.join(evidenceRoot, 'verification-output.txt'), 'utf8');
  const stderr = readFileSync(path.join(evidenceRoot, 'verification-error.txt'), 'utf8');
  if (status === 'passed') {
    verifySuccessfulOutput(stdout, stderr);
  }
  const statusText = readFileSync(path.join(evidenceRoot, 'verification-status.txt'), 'utf8');
  if (statusText !== expectedStatusText(checkedExecution)) {
    reject('verification-status.txt does not match the process result');
  }
  verifySDKConsumerMatrix(repositoryRoot);
  return {
    schemaVersion: sdkConsumerMatrixEvidenceSchemaVersion,
    generatedAt: checkedExecution.completedAt,
    scope: 'local_sdk_consumer_matrix_contract',
    status,
    command: ['node', ...sdkConsumerMatrixEvidenceArguments],
    workingDirectory: '.',
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    repository: { gitCommit: currentGitCommit(repositoryRoot) },
    execution: { ...checkedExecution },
    contract: contract(repositoryRoot),
    source: collectSource(repositoryRoot),
    artifacts: {
      stdout: describeArtifact(evidenceRoot, 'verification-output.txt'),
      stderr: describeArtifact(evidenceRoot, 'verification-error.txt'),
      status: describeArtifact(evidenceRoot, 'verification-status.txt'),
    },
    limitations: [...sdkConsumerMatrixEvidenceLimitations],
  };
}

export function writeSDKConsumerMatrixEvidenceChecksums(evidenceRoot) {
  const content = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), content, 'utf8');
}

export function verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot }) {
  verifyDirectory(evidenceRoot);
  const reportPath = path.join(evidenceRoot, 'report.json');
  requireRegularFile(reportPath, 'report.json', maximumReportBytes);
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('report.json must contain valid JSON');
  }
  requireExactKeys(
    report,
    [
      'artifacts', 'command', 'contract', 'execution', 'generatedAt', 'limitations', 'repository',
      'runtime', 'schemaVersion', 'scope', 'source', 'status', 'workingDirectory',
    ],
    'report',
  );
  if (report.schemaVersion !== sdkConsumerMatrixEvidenceSchemaVersion) {
    reject(`report.schemaVersion must equal ${sdkConsumerMatrixEvidenceSchemaVersion}`);
  }
  if (report.scope !== 'local_sdk_consumer_matrix_contract' || report.workingDirectory !== '.') {
    reject('report must identify the fixed local SDK consumer matrix contract');
  }
  const generatedAt = requireTimestamp(report.generatedAt, 'report.generatedAt');
  const execution = validateExecution(report.execution, 'report.execution');
  if (generatedAt !== Date.parse(execution.completedAt)) {
    reject('report.generatedAt must equal report.execution.completedAt');
  }
  const expectedStatus = processPassed(execution) ? 'passed' : 'failed';
  if (report.status !== expectedStatus) {
    reject('report.status does not match the process result');
  }
  if (JSON.stringify(report.command) !== JSON.stringify(['node', ...sdkConsumerMatrixEvidenceArguments])) {
    reject('report.command must match the fixed SDK consumer matrix command');
  }
  requireExactKeys(report.runtime, ['architecture', 'node', 'platform'], 'report.runtime');
  if (
    report.runtime.platform !== process.platform ||
    report.runtime.architecture !== process.arch ||
    report.runtime.node !== process.version
  ) {
    reject('report.runtime does not match the current verifier runtime');
  }
  requireExactKeys(report.repository, ['gitCommit'], 'report.repository');
  if (
    !gitCommitPattern.test(report.repository.gitCommit) ||
    report.repository.gitCommit !== currentGitCommit(repositoryRoot)
  ) {
    reject('report.repository.gitCommit does not match the current repository');
  }
  const expectedContract = contract(repositoryRoot);
  const actualContract = requireExactKeys(report.contract, ['assertions', 'matrix'], 'report.contract');
  if (JSON.stringify(actualContract) !== JSON.stringify(expectedContract)) {
    reject('report.contract does not match the fixed SDK consumer matrix contract');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(sdkConsumerMatrixEvidenceLimitations)) {
    reject('report.limitations must match the fixed repository-only boundary');
  }
  verifySource(report.source, repositoryRoot);
  const artifacts = requireExactKeys(report.artifacts, ['status', 'stderr', 'stdout'], 'report.artifacts');
  const stdoutPath = verifyFileRecord(
    artifacts.stdout,
    path.join(evidenceRoot, 'verification-output.txt'),
    'verification-output.txt',
    'report.artifacts.stdout',
  );
  const stderrPath = verifyFileRecord(
    artifacts.stderr,
    path.join(evidenceRoot, 'verification-error.txt'),
    'verification-error.txt',
    'report.artifacts.stderr',
  );
  const statusPath = verifyFileRecord(
    artifacts.status,
    path.join(evidenceRoot, 'verification-status.txt'),
    'verification-status.txt',
    'report.artifacts.status',
  );
  if (readFileSync(statusPath, 'utf8') !== expectedStatusText(execution)) {
    reject('verification-status.txt does not match report.execution');
  }
  if (report.status === 'passed') {
    verifySuccessfulOutput(readFileSync(stdoutPath, 'utf8'), readFileSync(stderrPath, 'utf8'));
  }
  verifyChecksums(evidenceRoot);
  return {
    report,
    artifactPaths: sdkConsumerMatrixEvidenceArtifactNames.map((name) =>
      repositoryRelativePath(repositoryRoot, path.join(evidenceRoot, name))),
  };
}
