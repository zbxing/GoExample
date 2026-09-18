import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedGitCommit, readBoundedGoVersion } from './bounded-command.mjs';
import { selectRepositoryToolCommand } from './go-toolchain-environment.mjs';

export const auditChainEvidenceSchemaVersion = 1;
export const auditChainTests = Object.freeze([
  'TestSecurityAuditSinkReceivesBoundedLowSensitivityRecord',
  'TestSecurityAuditSinkFailuresAreIsolatedAndCredentialSafe',
  'TestSecurityAuditSinkHonorsConfiguredTimeoutWithoutChangingResponse',
  'TestHashChainAuditSinkWritesAndVerifiesLinkedRecords',
  'TestHashChainAuditSinkRejectsTamperingAndInvalidRecords',
  'TestHashChainAuditSinkHonorsCancellationAndWriterBounds',
  'TestHashChainAuditSinkSerializesConcurrentWriters',
  'TestEncryptedAuditWriterEncryptsAndSupportsKeyRotation',
  'TestEncryptedAuditWriterRejectsTamperingUnknownKeysAndInvalidConfig',
]);
export const auditChainGoArguments = Object.freeze([
  'test',
  '-p=1',
  '-v',
  '-count=1',
  '-timeout=90s',
  `-run=^(${auditChainTests.join('|')})$`,
  './httpapi',
]);
export const auditChainLimitations = Object.freeze([
  'proves repository-local hash chaining, encryption, rotation, bounds, cancellation, concurrency, and tamper rejection only',
  'does not establish durable or immutable production storage, KMS or Vault custody, access control, retention, deletion, or trusted time',
  'does not establish target SIEM ingestion, paging delivery, named operator response, remote provenance, or production incident closure',
]);
export const auditChainArtifactNames = Object.freeze([
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
]);

const checksumArtifactNames = auditChainArtifactNames.filter((name) => name !== 'SHA256SUMS');
const sha256Pattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumArtifactBytes = 4 * 1024 * 1024;
const maximumReportBytes = 1024 * 1024;
const executionTimeoutMs = 120_000;

function reject(message) {
  throw new Error(`Audit chain evidence: ${message}`);
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
    !canonicalTimestampPattern.test(value) ||
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

function describeFile(filePath, root, maximumBytes = maximumArtifactBytes) {
  const stats = requireRegularFile(filePath, repositoryRelativePath(root, filePath), maximumBytes);
  return {
    path: repositoryRelativePath(root, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function describeArtifact(evidenceRoot, name, maximumBytes = maximumArtifactBytes) {
  const filePath = path.join(evidenceRoot, name);
  const stats = requireRegularFile(filePath, name, maximumBytes);
  return { path: name, bytes: stats.size, sha256: hashFile(filePath) };
}

function verifyFileRecord(record, filePath, expectedPath, name, maximumBytes = maximumArtifactBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  if (value.path !== expectedPath) {
    reject(`${name}.path must equal ${expectedPath}`);
  }
  const stats = requireRegularFile(filePath, name, maximumBytes);
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

function requiredGoVersion(repositoryRoot) {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  return workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m)?.[1]
    ?? reject('go.work must declare an exact Go patch toolchain');
}

export function resolveAuditChainGoCommand(repositoryRoot) {
  const executableName = process.platform === 'win32' ? 'go.exe' : 'go';
  const version = requiredGoVersion(repositoryRoot);
  return selectRepositoryToolCommand({
    configuredCommand: process.env.GO_BINARY,
    repositoryCandidates: [
      path.join(repositoryRoot, '.temp', 'toolchain', `go${version}`, 'go', 'bin', executableName),
      path.join(repositoryRoot, '.temp', 'toolchain', 'go', 'bin', executableName),
    ],
    fallbackCommand: executableName,
  }).command;
}

function currentGoVersion(repositoryRoot) {
  const value = readBoundedGoVersion(resolveAuditChainGoCommand(repositoryRoot), {
    cwd: path.join(repositoryRoot, 'Framework'),
  });
  if (value === null) {
    reject('cannot resolve the Go toolchain identity');
  }
  return value;
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
    workspace: 'go.work',
    frameworkGoMod: 'Framework/go.mod',
    frameworkGoSum: 'Framework/go.sum',
    auditSink: 'Framework/httpapi/security_audit_sink.go',
    auditSinkTests: 'Framework/httpapi/security_audit_sink_test.go',
    auditChain: 'Framework/httpapi/security_audit_chain.go',
    auditChainTests: 'Framework/httpapi/security_audit_chain_test.go',
    auditRunbook: 'docs/security/server-audit-events.md',
    evidenceRunner: 'scripts/audit-chain-evidence.mjs',
    evidenceVerifier: 'scripts/lib/audit-chain-evidence.mjs',
    boundedCommand: 'scripts/lib/bounded-command.mjs',
    evidenceTests: '__test__/node/audit-chain-evidence.test.mjs',
    evidenceManifest: 'scripts/evidence-manifest.mjs',
    independentVerifier: 'scripts/evidence-verify.mjs',
    evidenceInputContract: 'scripts/lib/evidence-manifest-contract.mjs',
    workflow: '.github/workflows/go-quality.yml',
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
    const filePath = path.join(repositoryRoot, ...relative.split('/'));
    verifyFileRecord(source[name], filePath, relative, `source.${name}`);
  }
}

function parseJSON(filePath, name, maximumBytes) {
  requireRegularFile(filePath, name, maximumBytes);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    reject(`${name} must contain valid JSON`);
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
  if (startedAt > completedAt || completedAt - startedAt > executionTimeoutMs) {
    reject(`${name} must stay inside the ${executionTimeoutMs}ms budget`);
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

function verifySuccessfulGoOutput(content) {
  if (content.includes('--- FAIL:') || !/(?:^|\n)PASS\r?\n/.test(content)) {
    reject('go-output.txt must contain a successful Go test result');
  }
  for (const testName of auditChainTests) {
    if (!new RegExp(`^--- PASS: ${testName} \\(`, 'm').test(content)) {
      reject(`go-output.txt is missing the passed marker for ${testName}`);
    }
  }
}

function verifyChecksums(evidenceRoot) {
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, 'SHA256SUMS', maximumReportBytes);
  const expected = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  if (readFileSync(checksumPath, 'utf8') !== expected) {
    reject('SHA256SUMS must contain the exact ordered audit evidence artifact set');
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
  const expected = [...auditChainArtifactNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    reject(`evidence directory files must be exactly ${expected.join(', ')}`);
  }
}

export function buildAuditChainEvidenceReport({ repositoryRoot, evidenceRoot, execution }) {
  const checkedExecution = validateExecution(execution);
  const status = processPassed(checkedExecution) ? 'passed' : 'failed';
  const output = readFileSync(path.join(evidenceRoot, 'go-output.txt'), 'utf8');
  if (status === 'passed') {
    verifySuccessfulGoOutput(output);
  }
  const statusText = readFileSync(path.join(evidenceRoot, 'go-status.txt'), 'utf8');
  if (statusText !== expectedStatusText(checkedExecution)) {
    reject('go-status.txt does not match the process result');
  }
  return {
    schemaVersion: auditChainEvidenceSchemaVersion,
    generatedAt: checkedExecution.completedAt,
    scope: 'local_audit_chain_contract',
    status,
    command: ['go', ...auditChainGoArguments],
    workingDirectory: 'Framework',
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      go: currentGoVersion(repositoryRoot),
    },
    repository: { gitCommit: currentGitCommit(repositoryRoot) },
    execution: { ...checkedExecution },
    contract: {
      timeoutMs: executionTimeoutMs,
      tests: [...auditChainTests],
      assertions: {
        httpSinkCorrelation: true,
        httpSinkFailureIsolation: true,
        httpSinkTimeoutBounded: true,
        linkedRecords: true,
        strictRecordValidation: true,
        cancellationAndBounds: true,
        concurrentSerialization: true,
        aes256GCMEncryption: true,
        keyRotation: true,
        ciphertextTamperRejected: true,
        unknownKeyRejected: true,
        duplicateNonceRejected: true,
      },
    },
    source: collectSource(repositoryRoot),
    artifacts: {
      stdout: describeArtifact(evidenceRoot, 'go-output.txt'),
      stderr: describeArtifact(evidenceRoot, 'go-error.txt'),
      status: describeArtifact(evidenceRoot, 'go-status.txt'),
    },
    limitations: [...auditChainLimitations],
  };
}

export function writeAuditChainEvidenceChecksums(evidenceRoot) {
  const content = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), content, 'utf8');
}

export function verifyAuditChainEvidence({ repositoryRoot, evidenceRoot }) {
  verifyDirectory(evidenceRoot);
  const report = requireExactKeys(
    parseJSON(path.join(evidenceRoot, 'report.json'), 'report.json', maximumReportBytes),
    [
      'artifacts', 'command', 'contract', 'execution', 'generatedAt', 'limitations', 'repository',
      'runtime', 'schemaVersion', 'scope', 'source', 'status', 'workingDirectory',
    ],
    'report',
  );
  if (report.schemaVersion !== auditChainEvidenceSchemaVersion) {
    reject(`report.schemaVersion must equal ${auditChainEvidenceSchemaVersion}`);
  }
  if (report.scope !== 'local_audit_chain_contract' || report.workingDirectory !== 'Framework') {
    reject('report must identify the fixed local audit chain contract');
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
  if (JSON.stringify(report.command) !== JSON.stringify(['go', ...auditChainGoArguments])) {
    reject('report.command must match the fixed Go audit contract');
  }
  requireExactKeys(report.runtime, ['architecture', 'go', 'node', 'platform'], 'report.runtime');
  if (
    report.runtime.platform !== process.platform ||
    report.runtime.architecture !== process.arch ||
    report.runtime.node !== process.version ||
    report.runtime.go !== currentGoVersion(repositoryRoot)
  ) {
    reject('report.runtime does not match the current verifier runtime');
  }
  const requiredVersion = requiredGoVersion(repositoryRoot).replaceAll('.', '\\.');
  if (!new RegExp(`^go version go${requiredVersion} [a-z0-9]+/[a-z0-9]+$`).test(report.runtime.go)) {
    reject('report.runtime.go does not match the pinned workspace toolchain');
  }
  requireExactKeys(report.repository, ['gitCommit'], 'report.repository');
  if (
    !gitCommitPattern.test(report.repository.gitCommit) ||
    report.repository.gitCommit !== currentGitCommit(repositoryRoot)
  ) {
    reject('report.repository.gitCommit does not match the current repository');
  }
  const contract = requireExactKeys(report.contract, ['assertions', 'tests', 'timeoutMs'], 'report.contract');
  if (
    contract.timeoutMs !== executionTimeoutMs ||
    JSON.stringify(contract.tests) !== JSON.stringify(auditChainTests)
  ) {
    reject('report.contract does not match the fixed audit test matrix');
  }
  const assertions = requireExactKeys(
    contract.assertions,
    [
      'aes256GCMEncryption', 'cancellationAndBounds', 'ciphertextTamperRejected',
      'concurrentSerialization', 'duplicateNonceRejected', 'keyRotation', 'linkedRecords',
      'httpSinkCorrelation', 'httpSinkFailureIsolation', 'httpSinkTimeoutBounded',
      'strictRecordValidation', 'unknownKeyRejected',
    ],
    'report.contract.assertions',
  );
  if (Object.values(assertions).some((value) => value !== true)) {
    reject('report.contract.assertions must all be true');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(auditChainLimitations)) {
    reject('report.limitations must match the fixed local-only boundary');
  }
  verifySource(report.source, repositoryRoot);
  const artifacts = requireExactKeys(report.artifacts, ['status', 'stderr', 'stdout'], 'report.artifacts');
  const outputPath = verifyFileRecord(
    artifacts.stdout,
    path.join(evidenceRoot, 'go-output.txt'),
    'go-output.txt',
    'report.artifacts.stdout',
  );
  verifyFileRecord(
    artifacts.stderr,
    path.join(evidenceRoot, 'go-error.txt'),
    'go-error.txt',
    'report.artifacts.stderr',
  );
  const statusPath = verifyFileRecord(
    artifacts.status,
    path.join(evidenceRoot, 'go-status.txt'),
    'go-status.txt',
    'report.artifacts.status',
  );
  if (readFileSync(statusPath, 'utf8') !== expectedStatusText(execution)) {
    reject('go-status.txt does not match report.execution');
  }
  if (report.status === 'passed') {
    verifySuccessfulGoOutput(readFileSync(outputPath, 'utf8'));
  }
  verifyChecksums(evidenceRoot);
  return {
    report,
    artifactPaths: auditChainArtifactNames.map((name) =>
      repositoryRelativePath(repositoryRoot, path.join(evidenceRoot, name))),
  };
}
