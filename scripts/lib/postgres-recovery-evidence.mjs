import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const postgresRecoveryEvidenceSchemaVersion = 1;
export const postgresRecoveryGoTests = Object.freeze([
  'TestRealPostgresRetryTransactionSerializationConflict',
  'TestRealPostgresRetryTransactionDeadlock',
  'TestRealPostgresVersionedUpdateAllowsOneConcurrentWriter',
  'TestRealPostgresVersionedHTTPPrecondition',
  'TestRealPostgresLockWaitHonorsDeadlineAndRecovers',
]);

const expectedImage = 'postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5';
const expectedCommand = Object.freeze(['yarn', 'postgres:recovery:contract']);
const expectedInfrastructureSteps = Object.freeze(['image_pulled', 'container_started', 'database_ready']);
const baseArtifactNames = Object.freeze([
  'environment.txt',
  'contract-output.txt',
  'test-output.txt',
  'test-status.txt',
  'recovery-output.txt',
  'recovery-status.txt',
  'container.log',
]);
const recoveryArtifactNames = Object.freeze([
  'recovery-raw.json',
  'recovery-report.json',
  'backup.dump',
]);
const expectedContract = Object.freeze({
  scope: 'linux_docker_logical_backup_restore',
  snapshotRows: 1_000,
  postCheckpointWrites: 1,
  maximumDurationMs: 120_000,
  backupFormat: 'pg_dump custom',
  restoreMode: 'pg_restore single transaction',
  goTests: postgresRecoveryGoTests,
});
const recoveryLimitations = Object.freeze([
  'the contract uses a disposable single-node PostgreSQL container and a logical custom-format archive',
  'the contract does not establish physical backup, WAL archiving, PITR, replication, failover, or target data-volume behavior',
  'target RPO, RTO, alert delivery, operator response, and signed provenance remain unrecorded',
]);
const limitations = Object.freeze([
  'the PostgreSQL container, databases, credentials, port, logical backup and restore target are ephemeral non-production fixtures',
  'the local contract does not prove physical backup, WAL archiving, PITR, replication, failover, target scale, alert delivery, operator response, RPO or RTO',
  'postgresRecovery remains not_recorded until signed target-environment PostgreSQL recovery evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`PostgreSQL recovery evidence: ${message}`);
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

function describeFile(filePath, root) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    reject(`${relativePath(root, filePath)} must be a regular file and not a symbolic link`);
  }
  return {
    path: relativePath(root, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function resolveEvidenceFile(evidenceRoot, value, name) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    reject(`${name} contains an unsafe path`);
  }
  const resolved = path.resolve(evidenceRoot, ...value.split('/'));
  const relative = path.relative(evidenceRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    reject(`${name} must stay inside the PostgreSQL recovery evidence directory`);
  }
  return resolved;
}

function verifyFileRecord(record, evidenceRoot, name, expectedName, maximumBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  if (value.path !== expectedName) {
    reject(`${name}.path must equal ${expectedName}`);
  }
  const filePath = resolveEvidenceFile(evidenceRoot, value.path, `${name}.path`);
  if (!existsSync(filePath)) {
    reject(`${name} is missing: ${value.path}`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    reject(`${name} must resolve to a regular file and not a symbolic link`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > maximumBytes) {
    reject(`${name}.bytes must be between 0 and ${maximumBytes}`);
  }
  if (stats.size !== value.bytes) {
    reject(`${name} size mismatch`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    reject(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== value.sha256) {
    reject(`${name} hash mismatch`);
  }
  return filePath;
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
    client: describeFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client.go'), repositoryRoot),
    integrationTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'sqlclient', 'postgres_integration_test.go'),
      repositoryRoot,
    ),
    frameworkGoMod: describeFile(path.join(repositoryRoot, 'Framework', 'go.mod'), repositoryRoot),
    frameworkGoSum: describeFile(path.join(repositoryRoot, 'Framework', 'go.sum'), repositoryRoot),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-contract.mjs'), repositoryRoot),
    recoveryReportGenerator: describeFile(
      path.join(repositoryRoot, 'scripts', 'postgres-recovery-report.mjs'),
      repositoryRoot,
    ),
    verifier: describeFile(path.join(repositoryRoot, 'scripts', 'lib', 'postgres-recovery-evidence.mjs'), repositoryRoot),
    runbook: describeFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), repositoryRoot),
    workflow: describeFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), repositoryRoot),
  };
}

function requireOrderedSubset(values, expected, name, status) {
  if (!Array.isArray(values) || values.length > expected.length || new Set(values).size !== values.length) {
    reject(`${name} must contain unique values from the fixed ordered set`);
  }
  let previousIndex = -1;
  for (const value of values) {
    const index = expected.indexOf(value);
    if (index <= previousIndex) {
      reject(`${name} must preserve the fixed PostgreSQL contract order`);
    }
    previousIndex = index;
  }
  if (status === 'passed' && JSON.stringify(values) !== JSON.stringify(expected)) {
    reject(`passed evidence must contain all ${expected.length} ${name}`);
  }
}

function parseEnvironment(content) {
  const lines = content.split('\n');
  if (lines.at(-1) !== '') {
    reject('environment.txt must end with a newline');
  }
  lines.pop();
  const expectedNames = [
    'contract', 'platform', 'architecture', 'node', 'go', 'docker', 'postgres', 'git_commit', 'image',
    'host_port', 'topology', 'backup', 'target_postgres_recovery', 'pitr', 'rpo_rto',
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

function extractInfrastructure(content) {
  const steps = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^image pull: .+/.test(line)) {
      steps.push('image_pulled');
    } else if (/^container started: [a-f0-9]{12,64}$/.test(line)) {
      steps.push('container_started');
    } else if (/^database ready after [1-9][0-9]* attempt\(s\)$/.test(line)) {
      steps.push('database_ready');
    }
  }
  return steps;
}

function extractPassedGoTests(content) {
  return [...content.matchAll(/^--- PASS: (TestRealPostgres[A-Za-z0-9_]+) /gm)].map((match) => match[1]);
}

function readExitStatus(filePath, name) {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^exit_code=([0-9]{1,3})\n$/);
  if (!match || Number(match[1]) > 255) {
    reject(`${name} must contain one exit_code between 0 and 255`);
  }
  return Number(match[1]);
}

function optionalDescription(evidenceRoot, name) {
  const filePath = path.join(evidenceRoot, name);
  return existsSync(filePath) ? describeFile(filePath, evidenceRoot) : null;
}

function checksumArtifactNames(evidenceRoot) {
  return [
    ...baseArtifactNames,
    ...recoveryArtifactNames.filter((name) => existsSync(path.join(evidenceRoot, name))),
    'report.json',
  ];
}

export function buildPostgresRecoveryChecksums(evidenceRoot) {
  return `${checksumArtifactNames(evidenceRoot)
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}`)
    .join('\n')}\n`;
}

export function buildPostgresRecoveryEvidenceReport({
  repositoryRoot,
  evidenceRoot,
  nodeVersion,
  platform,
  architecture,
  goVersion,
  dockerVersion,
  postgresVersion,
  gitCommit,
  hostPort,
  startedAt,
  endedAt,
  testExitCode,
  recoveryExitCode,
  error,
}) {
  const recoveryComplete = recoveryArtifactNames.every((name) => existsSync(path.join(evidenceRoot, name)));
  const status = testExitCode === 0 && recoveryExitCode === 0 && recoveryComplete && error === null
    ? 'passed'
    : 'failed';
  const contractOutput = readFileSync(path.join(evidenceRoot, 'contract-output.txt'), 'utf8');
  const testOutput = readFileSync(path.join(evidenceRoot, 'test-output.txt'), 'utf8');
  return {
    schemaVersion: postgresRecoveryEvidenceSchemaVersion,
    status,
    command: [...expectedCommand],
    runtime: { nodeVersion, platform, architecture, goVersion, dockerVersion, postgresVersion },
    source: { gitCommit, image: expectedImage },
    contract: { ...expectedContract, goTests: [...postgresRecoveryGoTests] },
    scope: collectScope(repositoryRoot),
    execution: { startedAt, endedAt, testExitCode, recoveryExitCode, error },
    infrastructure: { steps: extractInfrastructure(contractOutput), hostPort },
    goTests: { expected: [...postgresRecoveryGoTests], passed: extractPassedGoTests(testOutput) },
    outputs: {
      environment: describeFile(path.join(evidenceRoot, 'environment.txt'), evidenceRoot),
      contractOutput: describeFile(path.join(evidenceRoot, 'contract-output.txt'), evidenceRoot),
      testOutput: describeFile(path.join(evidenceRoot, 'test-output.txt'), evidenceRoot),
      testStatus: describeFile(path.join(evidenceRoot, 'test-status.txt'), evidenceRoot),
      recoveryOutput: describeFile(path.join(evidenceRoot, 'recovery-output.txt'), evidenceRoot),
      recoveryStatus: describeFile(path.join(evidenceRoot, 'recovery-status.txt'), evidenceRoot),
      containerLog: describeFile(path.join(evidenceRoot, 'container.log'), evidenceRoot),
      recoveryRaw: optionalDescription(evidenceRoot, 'recovery-raw.json'),
      recoveryReport: optionalDescription(evidenceRoot, 'recovery-report.json'),
      backup: optionalDescription(evidenceRoot, 'backup.dump'),
    },
    limitations: [...limitations],
  };
}

function requireCheckpoint(value, name) {
  const checkpoint = requireExactKeys(value, ['digest', 'rows'], name);
  if (!Number.isSafeInteger(checkpoint.rows) || checkpoint.rows < 1) {
    reject(`${name}.rows must be a positive integer`);
  }
  if (typeof checkpoint.digest !== 'string' || !sha256Pattern.test(checkpoint.digest)) {
    reject(`${name}.digest must be a lowercase SHA-256 digest`);
  }
  return checkpoint;
}

function verifyRecoverySemantics({ repositoryRoot, rawPath, recoveryReportPath, backupPath, runtime, source, execution }) {
  let raw;
  let recoveryReport;
  try {
    raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    recoveryReport = JSON.parse(readFileSync(recoveryReportPath, 'utf8'));
  } catch {
    reject('recovery raw and report artifacts must contain valid JSON');
  }
  raw = requireExactKeys(
    raw,
    [
      'backup', 'completedAt', 'databaseVersion', 'durationMs', 'image', 'recoveryPointLSN', 'restored',
      'schemaVersion', 'scope', 'sourceAfterBackup', 'sourceAtBackup', 'startedAt',
    ],
    'recovery raw',
  );
  if (raw.schemaVersion !== 1 || raw.scope !== expectedContract.scope || raw.image !== source.image) {
    reject('recovery raw scope and image must match the fixed contract');
  }
  if (raw.databaseVersion !== runtime.postgresVersion) {
    reject('recovery raw databaseVersion must match the archived runtime');
  }
  requireTimestamp(raw.startedAt, 'recovery raw.startedAt');
  requireTimestamp(raw.completedAt, 'recovery raw.completedAt');
  const recoveryDuration = Date.parse(raw.completedAt) - Date.parse(raw.startedAt);
  if (
    !Number.isSafeInteger(raw.durationMs) ||
    raw.durationMs < 1 ||
    raw.durationMs > expectedContract.maximumDurationMs ||
    Math.abs(raw.durationMs - recoveryDuration) > 2_000 ||
    Date.parse(raw.startedAt) < Date.parse(execution.startedAt) ||
    Date.parse(raw.completedAt) > Date.parse(execution.endedAt)
  ) {
    reject('recovery raw duration and timestamps must stay inside the bounded execution');
  }
  if (typeof raw.recoveryPointLSN !== 'string' || !/^[A-F0-9]+\/[A-F0-9]+$/.test(raw.recoveryPointLSN)) {
    reject('recovery raw recoveryPointLSN must be a PostgreSQL LSN');
  }
  const snapshot = requireCheckpoint(raw.sourceAtBackup, 'recovery raw.sourceAtBackup');
  const live = requireCheckpoint(raw.sourceAfterBackup, 'recovery raw.sourceAfterBackup');
  const restored = requireCheckpoint(raw.restored, 'recovery raw.restored');
  if (
    snapshot.rows !== expectedContract.snapshotRows ||
    live.rows !== snapshot.rows + expectedContract.postCheckpointWrites ||
    live.digest === snapshot.digest ||
    restored.rows !== snapshot.rows ||
    restored.digest !== snapshot.digest ||
    restored.rows === live.rows ||
    restored.digest === live.digest
  ) {
    reject('recovery raw checkpoints do not prove exact restore and post-checkpoint exclusion');
  }
  const backupStats = lstatSync(backupPath);
  const backup = requireExactKeys(raw.backup, ['bytes', 'sha256'], 'recovery raw.backup');
  if (
    !backupStats.isFile() ||
    backupStats.isSymbolicLink() ||
    backupStats.size < 1_024 ||
    backup.bytes !== backupStats.size ||
    backup.sha256 !== hashFile(backupPath)
  ) {
    reject('recovery raw backup does not match the archived logical backup');
  }

  recoveryReport = requireExactKeys(
    recoveryReport,
    [
      'assertions', 'backup', 'databaseVersion', 'durationMs', 'generatedAt', 'image', 'limitations',
      'recoveryPointLSN', 'restored', 'schemaVersion', 'scope', 'source', 'sourceAfterBackup',
      'sourceAtBackup', 'status',
    ],
    'recovery report',
  );
  requireTimestamp(recoveryReport.generatedAt, 'recovery report.generatedAt');
  const expectedReport = {
    schemaVersion: 1,
    scope: raw.scope,
    status: 'passed',
    source: {
      input: relativePath(repositoryRoot, rawPath),
      backup: relativePath(repositoryRoot, backupPath),
    },
    image: raw.image,
    databaseVersion: raw.databaseVersion,
    durationMs: raw.durationMs,
    recoveryPointLSN: raw.recoveryPointLSN,
    sourceAtBackup: raw.sourceAtBackup,
    sourceAfterBackup: raw.sourceAfterBackup,
    restored: raw.restored,
    backup: raw.backup,
    assertions: { restoredMatchesCheckpoint: true, postCheckpointWriteExcluded: true },
    limitations: [...recoveryLimitations],
  };
  const actualWithoutGeneratedAt = { ...recoveryReport };
  delete actualWithoutGeneratedAt.generatedAt;
  if (JSON.stringify(actualWithoutGeneratedAt) !== JSON.stringify(expectedReport)) {
    reject('recovery report no longer matches the independently verified raw recovery and backup');
  }
  if (
    Date.parse(recoveryReport.generatedAt) < Date.parse(raw.completedAt) ||
    Date.parse(recoveryReport.generatedAt) > Date.parse(execution.endedAt)
  ) {
    reject('recovery report generation time must stay inside the archived execution');
  }
}

export function verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  if (!existsSync(reportPath)) {
    reject('report.json is missing');
  }
  const reportStats = lstatSync(reportPath);
  if (!reportStats.isFile() || reportStats.isSymbolicLink() || reportStats.size > 256 * 1024) {
    reject('report.json must be a regular file no larger than 256 KiB');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('report.json must contain valid JSON');
  }
  const report = requireExactKeys(
    parsed,
    [
      'command', 'contract', 'execution', 'goTests', 'infrastructure', 'limitations', 'outputs', 'runtime',
      'schemaVersion', 'scope', 'source', 'status',
    ],
    'report',
  );
  if (report.schemaVersion !== postgresRecoveryEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${postgresRecoveryEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed PostgreSQL recovery contract invocation');
  }
  if (JSON.stringify(report.contract) !== JSON.stringify({ ...expectedContract, goTests: [...postgresRecoveryGoTests] })) {
    reject('contract must preserve the fixed logical backup and restore semantics');
  }

  const runtime = requireExactKeys(
    report.runtime,
    ['architecture', 'dockerVersion', 'goVersion', 'nodeVersion', 'platform', 'postgresVersion'],
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
  const expectedGo = `go version go${requiredGoVersion(repositoryRoot)} ${goPlatform(runtime.platform)}/${goArchitecture(runtime.architecture)}`;
  if (
    (report.status === 'passed' && runtime.goVersion !== expectedGo) ||
    (report.status === 'failed' && runtime.goVersion !== 'unavailable' && runtime.goVersion !== expectedGo)
  ) {
    reject('runtime.goVersion must match the pinned Go toolchain and Node runtime or be unavailable on failure');
  }
  for (const name of ['dockerVersion', 'postgresVersion']) {
    if (
      typeof runtime[name] !== 'string' ||
      runtime[name].length < 1 ||
      runtime[name].length > 128 ||
      /[\r\n]/.test(runtime[name]) ||
      (report.status === 'passed' && runtime[name] === 'unavailable')
    ) {
      reject(`runtime.${name} must identify the passed contract runtime`);
    }
  }

  const source = requireExactKeys(report.source, ['gitCommit', 'image'], 'source');
  if (!/^[a-f0-9]{40}$|^unavailable$/.test(source.gitCommit ?? '') || source.image !== expectedImage) {
    reject('source must bind the repository commit and exact pinned PostgreSQL image');
  }
  if (report.status === 'passed' && source.gitCommit === 'unavailable') {
    reject('passed source.gitCommit must identify the tested repository commit');
  }
  const expectedScope = collectScope(repositoryRoot);
  if (JSON.stringify(report.scope) !== JSON.stringify(expectedScope)) {
    reject('scope no longer matches the SQL client, toolchain, test, runner, reports, runbook, verifier, and workflow');
  }

  const execution = requireExactKeys(
    report.execution,
    ['endedAt', 'error', 'recoveryExitCode', 'startedAt', 'testExitCode'],
    'execution',
  );
  requireTimestamp(execution.startedAt, 'execution.startedAt');
  requireTimestamp(execution.endedAt, 'execution.endedAt');
  const duration = Date.parse(execution.endedAt) - Date.parse(execution.startedAt);
  if (duration < 0 || duration > 10 * 60 * 1000) {
    reject('execution timestamps must describe a non-negative run no longer than ten minutes');
  }
  for (const name of ['testExitCode', 'recoveryExitCode']) {
    if (!Number.isSafeInteger(execution[name]) || execution[name] < 0 || execution[name] > 255) {
      reject(`execution.${name} must be an integer between 0 and 255`);
    }
  }
  const exitStatus = execution.testExitCode === 0 && execution.recoveryExitCode === 0 ? 'passed' : 'failed';
  if ((exitStatus === 'passed' && execution.error !== null) || (exitStatus === 'failed' && report.status === 'passed')) {
    reject('status and execution.error must match the two contract exit codes');
  }
  if (
    report.status === 'failed' &&
    (typeof execution.error !== 'string' || execution.error.length === 0 || execution.error.length > 4096 || /\r/.test(execution.error))
  ) {
    reject('failed execution.error must contain a bounded error');
  }

  const infrastructure = requireExactKeys(report.infrastructure, ['hostPort', 'steps'], 'infrastructure');
  requireOrderedSubset(infrastructure.steps, expectedInfrastructureSteps, 'infrastructure.steps', report.status);
  if (
    infrastructure.hostPort !== null &&
    (!Number.isSafeInteger(infrastructure.hostPort) || infrastructure.hostPort < 1 || infrastructure.hostPort > 65535)
  ) {
    reject('infrastructure.hostPort must be null or a TCP port');
  }
  if (report.status === 'passed' && infrastructure.hostPort === null) {
    reject('passed infrastructure.hostPort must identify the loopback database port');
  }
  const goTests = requireExactKeys(report.goTests, ['expected', 'passed'], 'goTests');
  if (JSON.stringify(goTests.expected) !== JSON.stringify(postgresRecoveryGoTests)) {
    reject('goTests.expected must contain the fixed PostgreSQL contract set');
  }
  requireOrderedSubset(goTests.passed, postgresRecoveryGoTests, 'goTests.passed', report.status);

  const outputs = requireExactKeys(
    report.outputs,
    [
      'backup', 'containerLog', 'contractOutput', 'environment', 'recoveryOutput', 'recoveryRaw',
      'recoveryReport', 'recoveryStatus', 'testOutput', 'testStatus',
    ],
    'outputs',
  );
  const environmentPath = verifyFileRecord(outputs.environment, evidenceRoot, 'outputs.environment', 'environment.txt', 64 * 1024);
  const contractOutputPath = verifyFileRecord(outputs.contractOutput, evidenceRoot, 'outputs.contractOutput', 'contract-output.txt', 256 * 1024);
  const testOutputPath = verifyFileRecord(outputs.testOutput, evidenceRoot, 'outputs.testOutput', 'test-output.txt', 8 * 1024 * 1024);
  const testStatusPath = verifyFileRecord(outputs.testStatus, evidenceRoot, 'outputs.testStatus', 'test-status.txt', 1024);
  const recoveryOutputPath = verifyFileRecord(outputs.recoveryOutput, evidenceRoot, 'outputs.recoveryOutput', 'recovery-output.txt', 8 * 1024 * 1024);
  const recoveryStatusPath = verifyFileRecord(outputs.recoveryStatus, evidenceRoot, 'outputs.recoveryStatus', 'recovery-status.txt', 1024);
  verifyFileRecord(outputs.containerLog, evidenceRoot, 'outputs.containerLog', 'container.log', 8 * 1024 * 1024);

  const optionalPaths = {};
  for (const [key, name, maximumBytes] of [
    ['recoveryRaw', 'recovery-raw.json', 256 * 1024],
    ['recoveryReport', 'recovery-report.json', 256 * 1024],
    ['backup', 'backup.dump', 64 * 1024 * 1024],
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
  const recoveryComplete = Object.values(optionalPaths).every((value) => value !== null);
  if (execution.recoveryExitCode === 0 && !recoveryComplete) {
    reject('successful recovery execution requires raw, report, and backup artifacts');
  }
  const expectedStatus =
    execution.testExitCode === 0 &&
    execution.recoveryExitCode === 0 &&
    recoveryComplete &&
    execution.error === null
    ? 'passed'
    : 'failed';
  if (report.status !== expectedStatus) {
    reject('status must match exits and recovery artifact completeness');
  }

  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    contract: 'postgres-logical-backup-restore',
    platform: runtime.platform,
    architecture: runtime.architecture,
    node: runtime.nodeVersion,
    go: runtime.goVersion,
    docker: runtime.dockerVersion,
    postgres: runtime.postgresVersion,
    git_commit: source.gitCommit,
    image: source.image,
    host_port: infrastructure.hostPort === null ? 'unavailable' : `${infrastructure.hostPort}`,
    topology: 'single-node-disposable-container',
    backup: 'logical-custom-format',
    target_postgres_recovery: 'not_recorded',
    pitr: 'not_tested',
    rpo_rto: 'not_approved',
  };
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    reject('environment.txt no longer matches report runtime, source, topology, port, and limitations');
  }

  const contractOutput = readFileSync(contractOutputPath, 'utf8');
  if (JSON.stringify(extractInfrastructure(contractOutput)) !== JSON.stringify(infrastructure.steps)) {
    reject('contract-output.txt no longer matches the reported infrastructure lifecycle');
  }
  const failureLines = contractOutput.split(/\r?\n/).filter((line) => line.startsWith('failure: '));
  const expectedFailureLines = execution.error === null
    ? []
    : execution.error.split('\n').map((message) => `failure: ${message}`);
  if (JSON.stringify(failureLines) !== JSON.stringify(expectedFailureLines)) {
    reject('contract-output.txt no longer matches execution.error');
  }

  const testOutput = readFileSync(testOutputPath, 'utf8');
  if (JSON.stringify(extractPassedGoTests(testOutput)) !== JSON.stringify(goTests.passed)) {
    reject('test-output.txt no longer matches the reported passed Go contracts');
  }
  if (readExitStatus(testStatusPath, 'test-status.txt') !== execution.testExitCode) {
    reject('test-status.txt no longer matches execution.testExitCode');
  }
  if (readExitStatus(recoveryStatusPath, 'recovery-status.txt') !== execution.recoveryExitCode) {
    reject('recovery-status.txt no longer matches execution.recoveryExitCode');
  }
  if (report.status === 'passed') {
    for (const testName of postgresRecoveryGoTests) {
      if (
        !new RegExp(`^=== RUN   ${testName}$`, 'm').test(testOutput) ||
        !new RegExp(`^--- PASS: ${testName} `, 'm').test(testOutput) ||
        new RegExp(`^--- SKIP: ${testName} `, 'm').test(testOutput)
      ) {
        reject(`passed test-output.txt must contain non-skipped ${testName}`);
      }
    }
    if (!/^PASS$/m.test(testOutput)) {
      reject('passed test-output.txt must contain the final Go PASS result');
    }
    if (!/PostgreSQL recovery report written to .*recovery-report\.json/.test(readFileSync(recoveryOutputPath, 'utf8'))) {
      reject('passed recovery-output.txt must record successful report generation');
    }
  }
  if (recoveryComplete) {
    verifyRecoverySemantics({
      repositoryRoot,
      rawPath: optionalPaths.recoveryRaw,
      recoveryReportPath: optionalPaths.recoveryReport,
      backupPath: optionalPaths.backup,
      runtime,
      source,
      execution,
    });
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only PostgreSQL recovery boundary');
  }

  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  if (!existsSync(checksumPath)) {
    reject('SHA256SUMS is missing');
  }
  const checksumStats = lstatSync(checksumPath);
  if (!checksumStats.isFile() || checksumStats.isSymbolicLink() || checksumStats.size > 32 * 1024) {
    reject('SHA256SUMS must be a regular file no larger than 32 KiB');
  }
  if (readFileSync(checksumPath, 'utf8') !== buildPostgresRecoveryChecksums(evidenceRoot)) {
    reject('SHA256SUMS must contain the exact ordered PostgreSQL recovery evidence artifact set');
  }

  return {
    report,
    artifactPaths: [...checksumArtifactNames(evidenceRoot), 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, name)))
      .sort(),
  };
}
