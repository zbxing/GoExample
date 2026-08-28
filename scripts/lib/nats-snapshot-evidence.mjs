import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const natsSnapshotEvidenceSchemaVersion = 1;
export const natsSnapshotGoTest = 'TestRealNATSJetStreamSnapshotRestoreRecovery';

const expectedImage = 'nats:2.14.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da';
const expectedCommand = Object.freeze([
  'go', '-C', 'Framework', 'test', '-v', '-count=1', '-timeout=2m',
  '-run', '^TestRealNATS', './queueclient/...',
]);
const baseArtifactNames = Object.freeze([
  'environment.txt',
  'test-output.txt',
  'test-status.txt',
  'nats-server',
  'nats-server-binary.sha256',
]);
const snapshotArtifactNames = Object.freeze([
  'nats-snapshot-restore.log',
  'source-stream.snapshot',
  'snapshot-restore-report.json',
]);
const expectedContract = Object.freeze({
  scope: 'single_node_file_stream_snapshot_restore',
  storage: 'file',
  replicas: 1,
  checkpointMessages: 3,
  postCheckpointMessages: 1,
  snapshotIncludesConsumers: true,
  snapshotCheckedMessages: true,
  restoreBudgetNanos: 15_000_000_000,
});
const limitations = Object.freeze([
  'the NATS server, file store, stream, durable consumer, subjects, credentials and ports are disposable non-production fixtures',
  'the local logical snapshot does not prove disk-corruption recovery, cross-host or cross-zone backup, target capacity, production authorization, atomic settlement, exactly-once, PITR, RPO or RTO',
  'natsBroker remains not_recorded until signed target-environment broker recovery evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`NATS snapshot evidence: ${message}`);
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
    reject(`${name} must stay inside the NATS snapshot evidence directory`);
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

function optionalDescription(evidenceRoot, name) {
  const filePath = path.join(evidenceRoot, name);
  return existsSync(filePath) ? describeFile(filePath, evidenceRoot) : null;
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
    client: describeFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client.go'), repositoryRoot),
    worker: describeFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker.go'), repositoryRoot),
    adapter: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter.go'),
      repositoryRoot,
    ),
    integrationTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'integration_test.go'),
      repositoryRoot,
    ),
    snapshotTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'snapshot_integration_test.go'),
      repositoryRoot,
    ),
    frameworkGoMod: describeFile(path.join(repositoryRoot, 'Framework', 'go.mod'), repositoryRoot),
    frameworkGoSum: describeFile(path.join(repositoryRoot, 'Framework', 'go.sum'), repositoryRoot),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'nats-snapshot-evidence.mjs'), repositoryRoot),
    verifier: describeFile(
      path.join(repositoryRoot, 'scripts', 'lib', 'nats-snapshot-evidence.mjs'),
      repositoryRoot,
    ),
    behaviorTest: describeFile(
      path.join(repositoryRoot, '__test__', 'node', 'nats-snapshot-evidence.test.mjs'),
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
  const match = readFileSync(filePath, 'utf8').match(/^exit_code=([0-9]{1,3})\n$/);
  if (!match || Number(match[1]) > 255) {
    reject('test-status.txt must contain one exit_code between 0 and 255');
  }
  return Number(match[1]);
}

function readBinaryChecksum(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^([a-f0-9]{64})  nats-server\n$/);
  if (!match) {
    reject('nats-server-binary.sha256 must contain the exact copied binary checksum');
  }
  return match[1];
}

function extractPassedSnapshotTest(content) {
  return new RegExp(`^--- PASS: ${natsSnapshotGoTest} `, 'm').test(content) ? [natsSnapshotGoTest] : [];
}

function checksumArtifactNames(evidenceRoot) {
  return [
    ...baseArtifactNames,
    ...snapshotArtifactNames.filter((name) => existsSync(path.join(evidenceRoot, name))),
    'report.json',
  ];
}

export function buildNatsSnapshotChecksums(evidenceRoot) {
  return `${checksumArtifactNames(evidenceRoot)
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}`)
    .join('\n')}\n`;
}

export function buildNatsSnapshotEvidenceReport({ repositoryRoot, evidenceRoot }) {
  const environment = parseEnvironment(readFileSync(path.join(evidenceRoot, 'environment.txt'), 'utf8'));
  const testOutput = readFileSync(path.join(evidenceRoot, 'test-output.txt'), 'utf8');
  const exitCode = readExitStatus(path.join(evidenceRoot, 'test-status.txt'));
  const natsServerSHA256 = readBinaryChecksum(path.join(evidenceRoot, 'nats-server-binary.sha256'));
  const snapshotComplete = snapshotArtifactNames.every((name) => existsSync(path.join(evidenceRoot, name)));
  const status = exitCode === 0 && snapshotComplete ? 'passed' : 'failed';
  const error = status === 'passed'
    ? null
    : exitCode === 0
      ? 'NATS snapshot artifacts were incomplete'
      : `NATS Go contract exited with code ${exitCode}`;
  return {
    schemaVersion: natsSnapshotEvidenceSchemaVersion,
    status,
    command: [...expectedCommand],
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
      natsServerSHA256,
    },
    contract: { ...expectedContract },
    scope: collectScope(repositoryRoot),
    execution: {
      startedAt: environment.started_at,
      endedAt: environment.ended_at,
      exitCode,
      error,
    },
    goTests: {
      expected: [natsSnapshotGoTest],
      passed: extractPassedSnapshotTest(testOutput),
    },
    outputs: {
      environment: describeFile(path.join(evidenceRoot, 'environment.txt'), evidenceRoot),
      testOutput: describeFile(path.join(evidenceRoot, 'test-output.txt'), evidenceRoot),
      testStatus: describeFile(path.join(evidenceRoot, 'test-status.txt'), evidenceRoot),
      natsServer: describeFile(path.join(evidenceRoot, 'nats-server'), evidenceRoot),
      natsServerChecksum: describeFile(
        path.join(evidenceRoot, 'nats-server-binary.sha256'),
        evidenceRoot,
      ),
      serverLog: optionalDescription(evidenceRoot, 'nats-snapshot-restore.log'),
      snapshot: optionalDescription(evidenceRoot, 'source-stream.snapshot'),
      snapshotReport: optionalDescription(evidenceRoot, 'snapshot-restore-report.json'),
    },
    limitations: [...limitations],
  };
}

function verifySnapshotSemantics({ reportPath, snapshotPath, serverLogPath }) {
  let inner;
  try {
    inner = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('snapshot-restore-report.json must contain valid JSON');
  }
  inner = requireExactKeys(
    inner,
    [
      'ackPendingAfterRestore', 'ackPendingBeforeSnapshot', 'acknowledgedAfterRestore',
      'checkpointFirstSequence', 'checkpointLastSequence', 'checkpointMessages', 'consumerRestored',
      'deadLetteredAfterRestore', 'messagesBeforeDelete', 'messagesPendingAfterRestore',
      'messagesPendingBeforeSnapshot', 'postCheckpointExcluded', 'postCheckpointMessages',
      'recoveredSequence', 'replicas', 'restoreBudgetNanos', 'restoreElapsedNanos', 'restoredMessages',
      'sameSequenceRedelivered', 'schemaVersion', 'snapshotBytes', 'snapshotCheckedMessages',
      'snapshotChunks', 'snapshotIncludesConsumers', 'snapshotSHA256', 'sourceAckPending',
      'sourceMessagesPending', 'status', 'storage', 'tamperedSnapshotRejected',
      'unacknowledgedSequence',
    ],
    'snapshot report',
  );
  const snapshotStats = lstatSync(snapshotPath);
  if (
    inner.schemaVersion !== 1 ||
    inner.status !== 'passed' ||
    inner.storage !== expectedContract.storage ||
    inner.replicas !== expectedContract.replicas ||
    inner.snapshotIncludesConsumers !== expectedContract.snapshotIncludesConsumers ||
    inner.snapshotCheckedMessages !== expectedContract.snapshotCheckedMessages ||
    !Number.isSafeInteger(inner.snapshotBytes) ||
    inner.snapshotBytes < 16 * 1024 ||
    inner.snapshotBytes > 64 * 1024 * 1024 ||
    inner.snapshotBytes !== snapshotStats.size ||
    typeof inner.snapshotSHA256 !== 'string' ||
    !sha256Pattern.test(inner.snapshotSHA256) ||
    inner.snapshotSHA256 !== hashFile(snapshotPath) ||
    !Number.isSafeInteger(inner.snapshotChunks) ||
    inner.snapshotChunks < 2 ||
    inner.checkpointMessages !== expectedContract.checkpointMessages ||
    inner.checkpointFirstSequence !== 1 ||
    inner.checkpointLastSequence !== 3 ||
    inner.postCheckpointMessages !== expectedContract.postCheckpointMessages ||
    inner.messagesBeforeDelete !== 4 ||
    inner.restoredMessages !== 3 ||
    inner.postCheckpointExcluded !== true ||
    inner.tamperedSnapshotRejected !== true ||
    inner.consumerRestored !== true ||
    inner.ackPendingBeforeSnapshot !== 1 ||
    inner.messagesPendingBeforeSnapshot !== 1 ||
    inner.ackPendingAfterRestore !== 1 ||
    inner.messagesPendingAfterRestore !== 1 ||
    inner.unacknowledgedSequence !== 2 ||
    inner.recoveredSequence !== inner.unacknowledgedSequence ||
    inner.sameSequenceRedelivered !== true ||
    inner.acknowledgedAfterRestore !== 1 ||
    inner.deadLetteredAfterRestore !== 1 ||
    inner.sourceAckPending !== 0 ||
    inner.sourceMessagesPending !== 0 ||
    !Number.isSafeInteger(inner.restoreElapsedNanos) ||
    inner.restoreElapsedNanos <= 0 ||
    inner.restoreBudgetNanos !== expectedContract.restoreBudgetNanos ||
    inner.restoreElapsedNanos > inner.restoreBudgetNanos
  ) {
    reject('snapshot report does not satisfy the fixed checked restore contract');
  }
  const serverLog = readFileSync(serverLogPath, 'utf8');
  for (const marker of [
    'Starting nats-server',
    'Version:  2.14.5',
    'Starting health check and snapshot',
    'Completed snapshot',
    'Starting restore',
    'Completed restore',
  ]) {
    if (!serverLog.includes(marker)) {
      reject(`snapshot server log is missing ${marker}`);
    }
  }
}

export function verifyNatsSnapshotEvidence({ repositoryRoot, evidenceRoot }) {
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
      'command', 'contract', 'execution', 'goTests', 'limitations', 'outputs', 'runtime',
      'schemaVersion', 'scope', 'source', 'status',
    ],
    'report',
  );
  if (report.schemaVersion !== natsSnapshotEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${natsSnapshotEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed real NATS contract invocation');
  }
  if (JSON.stringify(report.contract) !== JSON.stringify(expectedContract)) {
    reject('contract must preserve the fixed file-stream snapshot and restore semantics');
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
    if (
      typeof runtime[name] !== 'string' ||
      runtime[name].length < 1 ||
      runtime[name].length > 128 ||
      /[\r\n]/.test(runtime[name])
    ) {
      reject(`runtime.${name} must be a bounded runtime identifier`);
    }
  }
  const expectedGo = `go version go${requiredGoVersion(repositoryRoot)} ${goPlatform(runtime.platform)}/${goArchitecture(runtime.architecture)}`;
  if (runtime.goVersion !== expectedGo) {
    reject('runtime.goVersion must match the pinned Go toolchain and Node runtime');
  }

  const source = requireExactKeys(report.source, ['gitCommit', 'image', 'natsServerSHA256'], 'source');
  if (
    !/^[a-f0-9]{40}$/.test(source.gitCommit ?? '') ||
    source.image !== expectedImage ||
    typeof source.natsServerSHA256 !== 'string' ||
    !sha256Pattern.test(source.natsServerSHA256)
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
  if (JSON.stringify(goTests.expected) !== JSON.stringify([natsSnapshotGoTest])) {
    reject('goTests.expected must contain the fixed snapshot recovery contract');
  }
  if (
    !Array.isArray(goTests.passed) ||
    goTests.passed.length > 1 ||
    (goTests.passed.length === 1 && goTests.passed[0] !== natsSnapshotGoTest)
  ) {
    reject('goTests.passed must be an ordered subset of the fixed snapshot recovery contract');
  }

  const outputs = requireExactKeys(
    report.outputs,
    [
      'environment', 'natsServer', 'natsServerChecksum', 'serverLog', 'snapshot', 'snapshotReport',
      'testOutput', 'testStatus',
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
    ['serverLog', 'nats-snapshot-restore.log', 8 * 1024 * 1024],
    ['snapshot', 'source-stream.snapshot', 64 * 1024 * 1024],
    ['snapshotReport', 'snapshot-restore-report.json', 256 * 1024],
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
  const snapshotComplete = Object.values(optionalPaths).every((value) => value !== null);
  const expectedStatus = execution.exitCode === 0 && snapshotComplete && execution.error === null
    ? 'passed'
    : 'failed';
  if (report.status !== expectedStatus) {
    reject('status must match the Go exit, snapshot artifact completeness, and execution error');
  }
  if (report.status === 'passed' && JSON.stringify(goTests.passed) !== JSON.stringify([natsSnapshotGoTest])) {
    reject('passed evidence must contain the non-skipped snapshot recovery Go contract');
  }
  if (
    report.status === 'failed' &&
    (typeof execution.error !== 'string' || execution.error.length === 0 || execution.error.length > 4096 || /\r/.test(execution.error))
  ) {
    reject('failed execution.error must contain a bounded error');
  }

  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    contract: 'nats-jetstream-snapshot-restore',
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
  if (JSON.stringify(extractPassedSnapshotTest(testOutput)) !== JSON.stringify(goTests.passed)) {
    reject('test-output.txt no longer matches the reported snapshot Go contract result');
  }
  if (
    report.status === 'passed' &&
    (
      !new RegExp(`^=== RUN   ${natsSnapshotGoTest}$`, 'm').test(testOutput) ||
      !new RegExp(`^--- PASS: ${natsSnapshotGoTest} `, 'm').test(testOutput) ||
      new RegExp(`^--- SKIP: ${natsSnapshotGoTest} `, 'm').test(testOutput) ||
      !/^PASS$/m.test(testOutput)
    )
  ) {
    reject('passed test-output.txt must contain the non-skipped snapshot Go contract and final PASS');
  }
  if (snapshotComplete) {
    verifySnapshotSemantics({
      reportPath: optionalPaths.snapshotReport,
      snapshotPath: optionalPaths.snapshot,
      serverLogPath: optionalPaths.serverLog,
    });
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only NATS snapshot boundary');
  }

  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  if (!existsSync(checksumPath)) {
    reject('SHA256SUMS is missing');
  }
  const checksumStats = lstatSync(checksumPath);
  if (!checksumStats.isFile() || checksumStats.isSymbolicLink() || checksumStats.size > 32 * 1024) {
    reject('SHA256SUMS must be a regular file no larger than 32 KiB');
  }
  if (readFileSync(checksumPath, 'utf8') !== buildNatsSnapshotChecksums(evidenceRoot)) {
    reject('SHA256SUMS must contain the exact ordered NATS snapshot evidence artifact set');
  }

  return {
    report,
    artifactPaths: [...checksumArtifactNames(evidenceRoot), 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, name)))
      .sort(),
  };
}
