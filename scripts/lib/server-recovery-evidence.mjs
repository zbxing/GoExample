import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedGitCommit } from './bounded-command.mjs';

export const serverRecoveryEvidenceSchemaVersion = 1;
export const serverRecoverySummarySchemaVersion = 1;
export const serverRecoveryCommand = Object.freeze(['yarn', 'drill:server']);
export const serverRecoveryScenarios = Object.freeze([
  Object.freeze({
    id: 'redis_outage_and_lock_safety',
    package: './Framework/sharedstate',
    tests: Object.freeze([
      'TestRedisLockOwnerCannotDeleteReplacementLease',
      'TestRedisLockWaitIsBounded',
      'TestRedisOperationsFailWhenBackendStops',
      'TestRedisFailureDoesNotMasqueradeAsClientDeadline',
    ]),
  }),
  Object.freeze({
    id: 'otel_outage_and_recovery',
    package: './Framework/observability',
    tests: Object.freeze([
      'TestBatchSpanProcessorDropsBurstWithoutBlockingWhenExporterIsStalled',
      'TestOTLPHTTPExporterMetricsRecordCollectorFailureAndRecovery',
      'TestOTLPHTTPExporterRecordsEachAttemptAndRecoversWithinOneBatch',
      'TestTraceExporterHTTPClientAndRetryBudgetsAreFinite',
    ]),
  }),
  Object.freeze({
    id: 'http_deadline_drain_and_shutdown',
    package: './Framework/httpapi',
    tests: Object.freeze([
      'TestWriteTimeoutStopsSlowReaderOverTCP',
      'TestShutdownClosesIdleKeepAliveConnectionsOverTCP',
      'TestDrainingRejectsNewAPIRequestsButKeepsExistingWorkAndProbeContract',
      'TestRequestDeadlineCancelsHandlerOverTCP',
      'TestServerShutdownCancelsHandlerOverTCP',
      'TestSharedStorageFailureIsFailClosed',
    ]),
  }),
  Object.freeze({
    id: 'outbound_timeout_and_cancellation',
    package: './Framework/httpclient',
    tests: Object.freeze([
      'TestClientRecordsTimeoutWithoutLeakingTransportError',
      'TestClientRecordsCallerCancellation',
    ]),
  }),
]);

export const serverRecoveryLimitations = Object.freeze([
  'uses local test dependencies and loopback sockets, not target infrastructure',
  'does not establish production RPO, RTO, failover, alert delivery, or operator response',
  'requires a signed remote artifact before it can contribute provenance evidence',
]);

const sha256Pattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumRawOutputBytes = 4 * 1024 * 1024;
const maximumSummaryBytes = 1024 * 1024;
const scenarioTimeoutMs = 45_000;
const parentTimeoutMs = 60_000;

function reject(message) {
  throw new Error(`Server recovery evidence: ${message}`);
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

function requireStringArray(value, expected, name) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    reject(`${name} must match the fixed contract`);
  }
}

function requireRegularFile(filePath, name, maximumBytes) {
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

function describeFile(filePath, root, maximumBytes = maximumRawOutputBytes) {
  const stats = requireRegularFile(filePath, repositoryRelativePath(root, filePath), maximumBytes);
  return {
    path: repositoryRelativePath(root, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function describeArtifact(filePath, evidenceRoot, maximumBytes = maximumRawOutputBytes) {
  const stats = requireRegularFile(filePath, path.basename(filePath), maximumBytes);
  return {
    path: repositoryRelativePath(evidenceRoot, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function verifyArtifactRecord(record, evidenceRoot, name, expectedName, maximumBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  if (value.path !== expectedName) {
    reject(`${name}.path must equal ${expectedName}`);
  }
  const filePath = path.join(evidenceRoot, expectedName);
  const stats = requireRegularFile(filePath, name, maximumBytes);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes !== stats.size) {
    reject(`${name}.bytes does not match ${expectedName}`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    reject(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== value.sha256) {
    reject(`${name}.sha256 does not match ${expectedName}`);
  }
  return filePath;
}

function verifySummaryFileRecord(record, repositoryRoot, evidenceRoot, name, artifactName) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  const filePath = path.join(evidenceRoot, artifactName);
  const expectedPath = repositoryRelativePath(repositoryRoot, filePath);
  if (value.path !== expectedPath) {
    reject(`${name}.path must equal ${expectedPath}`);
  }
  const stats = requireRegularFile(filePath, name, maximumRawOutputBytes);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes !== stats.size) {
    reject(`${name}.bytes does not match ${artifactName}`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    reject(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== value.sha256) {
    reject(`${name}.sha256 does not match ${artifactName}`);
  }
  return filePath;
}

function requiredGoVersion(repositoryRoot) {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  return workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m)?.[1]
    ?? reject('go.work must declare an exact Go patch toolchain');
}

function goPlatform(nodePlatform) {
  return nodePlatform === 'win32' ? 'windows' : nodePlatform;
}

function goArchitecture(nodeArchitecture) {
  return ({ x64: 'amd64', ia32: '386' })[nodeArchitecture] ?? nodeArchitecture;
}

function currentGitCommit(repositoryRoot) {
  const value = readBoundedGitCommit({ cwd: repositoryRoot });
  if (value === null) {
    reject('cannot resolve the current Git commit');
  }
  return value;
}

function collectSource(repositoryRoot) {
  const files = {
    workspace: 'go.work',
    frameworkGoMod: 'Framework/go.mod',
    frameworkGoSum: 'Framework/go.sum',
    sharedStateTests: 'Framework/sharedstate/redis_test.go',
    observabilityTests: 'Framework/observability/tracing_test.go',
    httpLifecycleTests: 'Framework/httpapi/lifecycle_contract_test.go',
    httpSharedStateTests: 'Framework/httpapi/shared_state_test.go',
    httpClientTests: 'Framework/httpclient/client_test.go',
    drillRunner: 'scripts/server-recovery-drill.mjs',
    evidenceRunner: 'scripts/server-recovery-evidence.mjs',
    commandRunner: 'scripts/lib/server-recovery-command.mjs',
    evidenceVerifier: 'scripts/lib/server-recovery-evidence.mjs',
    boundedCommand: 'scripts/lib/bounded-command.mjs',
    evidenceTests: '__test__/node/server-recovery-evidence.test.mjs',
    runbook: 'docs/recovery/server-failure-matrix.md',
    workflow: '.github/workflows/go-quality.yml',
  };
  return Object.fromEntries(
    Object.entries(files).map(([name, relative]) => [
      name,
      describeFile(path.join(repositoryRoot, ...relative.split('/')), repositoryRoot),
    ]),
  );
}

export function serverRecoveryGoArguments(scenario) {
  const testPattern = `^(${scenario.tests.join('|')})$`;
  return ['test', '-v', '-count=1', '-timeout=45s', `-run=${testPattern}`, scenario.package];
}

function expectedContract() {
  return {
    scenarioTimeoutMs,
    parentTimeoutMs,
    scenarios: serverRecoveryScenarios.map((scenario) => ({
      id: scenario.id,
      package: scenario.package,
      tests: [...scenario.tests],
      goArguments: serverRecoveryGoArguments(scenario),
    })),
  };
}

function parseJSONFile(filePath, name, maximumBytes) {
  requireRegularFile(filePath, name, maximumBytes);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    reject(`${name} must contain valid JSON`);
  }
}

function verifyScenarioOutput(content, scenario, status, name) {
  if (status !== 'passed') {
    return;
  }
  if (content.includes('--- FAIL:') || !/(?:^|\n)PASS\r?\n/.test(content)) {
    reject(`${name} must contain a successful Go test result`);
  }
  for (const testName of scenario.tests) {
    const marker = new RegExp(`^--- PASS: ${testName} \\(`, 'm');
    if (!marker.test(content)) {
      reject(`${name} is missing the passed marker for ${testName}`);
    }
  }
}

function verifySummary(repositoryRoot, evidenceRoot) {
  const summaryPath = path.join(evidenceRoot, 'summary.json');
  const summary = requireExactKeys(
    parseJSONFile(summaryPath, 'summary.json', maximumSummaryBytes),
    ['generatedAt', 'limitations', 'repository', 'scenarios', 'schemaVersion', 'scope', 'status', 'toolchain'],
    'summary',
  );
  if (summary.schemaVersion !== serverRecoverySummarySchemaVersion) {
    reject(`summary.schemaVersion must equal ${serverRecoverySummarySchemaVersion}`);
  }
  if (summary.scope !== 'local_contract_only') {
    reject('summary.scope must equal local_contract_only');
  }
  const generatedAt = requireTimestamp(summary.generatedAt, 'summary.generatedAt');
  requireExactKeys(summary.repository, ['gitCommit'], 'summary.repository');
  if (!gitCommitPattern.test(summary.repository.gitCommit)) {
    reject('summary.repository.gitCommit must be a full lowercase Git commit');
  }
  if (summary.repository.gitCommit !== currentGitCommit(repositoryRoot)) {
    reject('summary.repository.gitCommit does not match the current repository');
  }
  requireExactKeys(summary.toolchain, ['go'], 'summary.toolchain');
  const goVersion = requiredGoVersion(repositoryRoot);
  const goVersionPattern = new RegExp(`^go version go${goVersion.replaceAll('.', '\\.')} [a-z0-9]+/[a-z0-9]+$`);
  if (typeof summary.toolchain.go !== 'string' || !goVersionPattern.test(summary.toolchain.go)) {
    reject(`summary.toolchain.go must identify Go ${goVersion}`);
  }
  requireStringArray(summary.limitations, serverRecoveryLimitations, 'summary.limitations');
  if (!Array.isArray(summary.scenarios) || summary.scenarios.length !== serverRecoveryScenarios.length) {
    reject(`summary.scenarios must contain exactly ${serverRecoveryScenarios.length} entries`);
  }

  const rawOutputs = [];
  for (let index = 0; index < serverRecoveryScenarios.length; index += 1) {
    const expected = serverRecoveryScenarios[index];
    const actual = requireExactKeys(
      summary.scenarios[index],
      [
        'durationMs', 'exitCode', 'id', 'package', 'scope', 'signal', 'spawnErrorCode', 'startedAt',
        'status', 'stderr', 'stdout', 'tests',
      ],
      `summary.scenarios[${index}]`,
    );
    if (actual.id !== expected.id || actual.package !== expected.package || actual.scope !== 'local_contract') {
      reject(`summary.scenarios[${index}] identity does not match the fixed matrix`);
    }
    requireStringArray(actual.tests, expected.tests, `summary.scenarios[${index}].tests`);
    const startedAt = requireTimestamp(actual.startedAt, `summary.scenarios[${index}].startedAt`);
    if (startedAt > generatedAt) {
      reject(`summary.scenarios[${index}].startedAt must not follow summary.generatedAt`);
    }
    if (!Number.isSafeInteger(actual.durationMs) || actual.durationMs < 0 || actual.durationMs > parentTimeoutMs) {
      reject(`summary.scenarios[${index}].durationMs must be between 0 and ${parentTimeoutMs}`);
    }
    const exitCodeValid = actual.exitCode === null
      || (Number.isSafeInteger(actual.exitCode) && actual.exitCode >= 0 && actual.exitCode <= 255);
    const signalValid = actual.signal === null || (typeof actual.signal === 'string' && /^[A-Z][A-Z0-9]+$/.test(actual.signal));
    const errorValid = actual.spawnErrorCode === null
      || (typeof actual.spawnErrorCode === 'string' && /^[A-Z][A-Z0-9_]+$/.test(actual.spawnErrorCode));
    if (!exitCodeValid || !signalValid || !errorValid) {
      reject(`summary.scenarios[${index}] has an invalid process result`);
    }
    const processPassed = actual.exitCode === 0 && actual.signal === null && actual.spawnErrorCode === null;
    if (actual.status !== (processPassed ? 'passed' : 'failed')) {
      reject(`summary.scenarios[${index}].status does not match its process result`);
    }
    if (!processPassed && actual.exitCode === null && actual.signal === null && actual.spawnErrorCode === null) {
      reject(`summary.scenarios[${index}] failed without a process failure reason`);
    }
    const stdoutName = `${expected.id}.stdout.txt`;
    const stderrName = `${expected.id}.stderr.txt`;
    const stdoutPath = verifySummaryFileRecord(
      actual.stdout,
      repositoryRoot,
      evidenceRoot,
      `summary.scenarios[${index}].stdout`,
      stdoutName,
    );
    verifySummaryFileRecord(
      actual.stderr,
      repositoryRoot,
      evidenceRoot,
      `summary.scenarios[${index}].stderr`,
      stderrName,
    );
    verifyScenarioOutput(readFileSync(stdoutPath, 'utf8'), expected, actual.status, stdoutName);
    rawOutputs.push({
      scenarioId: expected.id,
      stdout: describeArtifact(stdoutPath, evidenceRoot),
      stderr: describeArtifact(path.join(evidenceRoot, stderrName), evidenceRoot),
    });
  }

  const expectedStatus = summary.scenarios.every((scenario) => scenario.status === 'passed') ? 'passed' : 'failed';
  if (summary.status !== expectedStatus) {
    reject('summary.status does not match the scenario results');
  }
  return { summary, summaryPath, rawOutputs };
}

function validateExecution(execution, summary, name = 'execution') {
  const value = requireExactKeys(
    execution,
    ['completedAt', 'exitCode', 'signal', 'spawnErrorCode', 'startedAt'],
    name,
  );
  const startedAt = requireTimestamp(value.startedAt, `${name}.startedAt`);
  const completedAt = requireTimestamp(value.completedAt, `${name}.completedAt`);
  if (startedAt > completedAt) {
    reject(`${name}.startedAt must not follow ${name}.completedAt`);
  }
  for (let index = 0; index < summary.scenarios.length; index += 1) {
    const scenarioStartedAt = Date.parse(summary.scenarios[index].startedAt);
    if (scenarioStartedAt < startedAt || scenarioStartedAt > completedAt) {
      reject(`summary.scenarios[${index}].startedAt must stay inside the outer execution window`);
    }
  }
  if (Date.parse(summary.generatedAt) > completedAt) {
    reject('summary.generatedAt must not follow execution.completedAt');
  }
  const exitCodeValid = value.exitCode === null
    || (Number.isSafeInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255);
  const signalValid = value.signal === null || (typeof value.signal === 'string' && /^[A-Z][A-Z0-9]+$/.test(value.signal));
  const errorValid = value.spawnErrorCode === null
    || (typeof value.spawnErrorCode === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value.spawnErrorCode));
  if (!exitCodeValid || !signalValid || !errorValid) {
    reject(`${name} has an invalid process result`);
  }
  const passed = value.exitCode === 0 && value.signal === null && value.spawnErrorCode === null;
  if (summary.status !== (passed ? 'passed' : 'failed')) {
    reject(`${name} process result does not match summary.status`);
  }
  return value;
}

export function buildServerRecoveryEvidenceReport({ repositoryRoot, evidenceRoot, execution }) {
  const { summary, summaryPath, rawOutputs } = verifySummary(repositoryRoot, evidenceRoot);
  const checkedExecution = validateExecution(execution, summary);
  return {
    schemaVersion: serverRecoveryEvidenceSchemaVersion,
    generatedAt: checkedExecution.completedAt,
    scope: 'local_server_recovery_evidence',
    status: summary.status,
    command: [...serverRecoveryCommand],
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      go: summary.toolchain.go,
    },
    repository: { gitCommit: summary.repository.gitCommit },
    execution: { ...checkedExecution },
    contract: expectedContract(),
    source: collectSource(repositoryRoot),
    summary: describeArtifact(summaryPath, evidenceRoot, maximumSummaryBytes),
    rawOutputs,
    limitations: [...serverRecoveryLimitations],
  };
}

function checksumArtifactNames() {
  return [
    ...serverRecoveryScenarios.flatMap((scenario) => [
      `${scenario.id}.stdout.txt`,
      `${scenario.id}.stderr.txt`,
    ]),
    'summary.json',
    'report.json',
  ];
}

export function writeServerRecoveryEvidenceChecksums(evidenceRoot) {
  const content = checksumArtifactNames()
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), content, 'utf8');
  return content;
}

function verifyChecksums(evidenceRoot) {
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, 'SHA256SUMS', 16 * 1024);
  const expected = checksumArtifactNames()
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  if (readFileSync(checksumPath, 'utf8') !== expected) {
    reject('SHA256SUMS must contain the exact ordered artifact set');
  }
}

export function verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = requireExactKeys(
    parseJSONFile(reportPath, 'report.json', maximumSummaryBytes),
    [
      'command', 'contract', 'execution', 'generatedAt', 'limitations', 'rawOutputs', 'repository',
      'runtime', 'schemaVersion', 'scope', 'source', 'status', 'summary',
    ],
    'report',
  );
  if (report.schemaVersion !== serverRecoveryEvidenceSchemaVersion) {
    reject(`report.schemaVersion must equal ${serverRecoveryEvidenceSchemaVersion}`);
  }
  if (report.scope !== 'local_server_recovery_evidence') {
    reject('report.scope must equal local_server_recovery_evidence');
  }
  requireStringArray(report.command, serverRecoveryCommand, 'report.command');
  requireStringArray(report.limitations, serverRecoveryLimitations, 'report.limitations');
  if (JSON.stringify(report.contract) !== JSON.stringify(expectedContract())) {
    reject('report.contract must match the fixed four-scenario matrix and Go commands');
  }

  const { summary, rawOutputs } = verifySummary(repositoryRoot, evidenceRoot);
  const execution = validateExecution(report.execution, summary, 'report.execution');
  const generatedAt = requireTimestamp(report.generatedAt, 'report.generatedAt');
  if (generatedAt !== Date.parse(execution.completedAt)) {
    reject('report.generatedAt must equal report.execution.completedAt');
  }
  if (report.status !== summary.status) {
    reject('report.status must equal summary.status');
  }
  const repository = requireExactKeys(report.repository, ['gitCommit'], 'report.repository');
  if (repository.gitCommit !== summary.repository.gitCommit) {
    reject('report.repository.gitCommit must equal summary.repository.gitCommit');
  }
  const runtime = requireExactKeys(report.runtime, ['architecture', 'go', 'node', 'platform'], 'report.runtime');
  if (
    typeof runtime.platform !== 'string' || !/^[a-z0-9]+$/.test(runtime.platform) ||
    typeof runtime.architecture !== 'string' || !/^[a-z0-9]+$/.test(runtime.architecture) ||
    typeof runtime.node !== 'string' || !/^v\d+\.\d+\.\d+$/.test(runtime.node) ||
    runtime.go !== summary.toolchain.go
  ) {
    reject('report.runtime is invalid or does not match summary.toolchain');
  }
  const goSuffix = `${goPlatform(runtime.platform)}/${goArchitecture(runtime.architecture)}`;
  if (!runtime.go.endsWith(` ${goSuffix}`)) {
    reject('report.runtime platform and architecture do not match the Go toolchain');
  }
  if (JSON.stringify(report.source) !== JSON.stringify(collectSource(repositoryRoot))) {
    reject('report.source does not match the current recovery contract source scope');
  }
  verifyArtifactRecord(report.summary, evidenceRoot, 'report.summary', 'summary.json', maximumSummaryBytes);
  if (JSON.stringify(report.rawOutputs) !== JSON.stringify(rawOutputs)) {
    reject('report.rawOutputs does not match the scenario raw streams');
  }
  verifyChecksums(evidenceRoot);

  const artifactNames = [...checksumArtifactNames(), 'SHA256SUMS'];
  return {
    report,
    summary,
    artifactPaths: artifactNames.map((name) => repositoryRelativePath(repositoryRoot, path.join(evidenceRoot, name))),
  };
}
