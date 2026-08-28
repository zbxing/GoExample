import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const natsRestartEvidenceSchemaVersion = 1;
export const natsRestartGoTest = 'TestRealNATSJetStreamRestartRecovery';

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
const restartArtifactNames = Object.freeze([
  'nats-before-restart.log',
  'nats-after-restart.log',
  'restart-report.json',
]);
const expectedContract = Object.freeze({
  scope: 'single_node_same_file_store_process_restart',
  storage: 'file',
  replicas: 1,
  abruptRestarts: 1,
  persistedMessages: 3,
  workerAckWaitNanos: 9_000_000_000,
});
const limitations = Object.freeze([
  'the NATS server, file store, streams, durable consumers, subjects, credentials and port are disposable non-production fixtures',
  'the local same-file-store restart does not prove disk-corruption recovery, cross-host or cross-zone failover, target capacity, production authorization, atomic settlement, exactly-once, backup, PITR, RPO or RTO',
  'natsBroker remains not_recorded until signed target-environment broker recovery evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`NATS restart evidence: ${message}`);
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

function requireRegularFile(filePath, root, maximumBytes) {
  if (!existsSync(filePath)) {
    reject(`${relativePath(root, filePath)} is missing`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maximumBytes) {
    reject(`${relativePath(root, filePath)} must be a non-empty regular file no larger than ${maximumBytes} bytes`);
  }
  return filePath;
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
    reject(`${name} must stay inside the NATS restart evidence directory`);
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
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > maximumBytes) {
    reject(`${name}.bytes must be between 1 and ${maximumBytes}`);
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
    restartTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'restart_integration_test.go'),
      repositoryRoot,
    ),
    frameworkGoMod: describeFile(path.join(repositoryRoot, 'Framework', 'go.mod'), repositoryRoot),
    frameworkGoSum: describeFile(path.join(repositoryRoot, 'Framework', 'go.sum'), repositoryRoot),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'nats-restart-evidence.mjs'), repositoryRoot),
    verifier: describeFile(
      path.join(repositoryRoot, 'scripts', 'lib', 'nats-restart-evidence.mjs'),
      repositoryRoot,
    ),
    behaviorTest: describeFile(
      path.join(repositoryRoot, '__test__', 'node', 'nats-restart-evidence.test.mjs'),
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

function extractPassedRestartTest(content) {
  return new RegExp(`^--- PASS: ${natsRestartGoTest} `, 'm').test(content) ? [natsRestartGoTest] : [];
}

function checksumArtifactNames(evidenceRoot) {
  return [
    ...baseArtifactNames,
    ...restartArtifactNames.filter((name) => existsSync(path.join(evidenceRoot, name))),
    'report.json',
  ];
}

export function buildNatsRestartChecksums(evidenceRoot) {
  return `${checksumArtifactNames(evidenceRoot)
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}`)
    .join('\n')}\n`;
}

export function verifyNatsRestartContractArtifacts({ evidenceRoot }) {
  const beforeLogPath = requireRegularFile(
    path.join(evidenceRoot, 'nats-before-restart.log'),
    evidenceRoot,
    8 * 1024 * 1024,
  );
  const afterLogPath = requireRegularFile(
    path.join(evidenceRoot, 'nats-after-restart.log'),
    evidenceRoot,
    8 * 1024 * 1024,
  );
  const restartReportPath = requireRegularFile(
    path.join(evidenceRoot, 'restart-report.json'),
    evidenceRoot,
    256 * 1024,
  );
  let report;
  try {
    report = JSON.parse(readFileSync(restartReportPath, 'utf8'));
  } catch {
    reject('restart-report.json must contain valid JSON');
  }
  report = requireExactKeys(
    report,
    [
      'abruptRestarts', 'acknowledged', 'deadLettered', 'deliveryCountAfterRestart',
      'deliveryCountBeforeRestart', 'leasePreflightPassed', 'persistedMessages',
      'recoveredStreamSequence', 'redeliveryObserved', 'replicas', 'requiredLeaseNanos',
      'schemaVersion', 'shortLeaseRejected', 'sourceAckPending', 'sourceMessagesPending',
      'status', 'storage', 'workerAckWaitNanos',
    ],
    'restart report',
  );
  if (
    report.schemaVersion !== 1 ||
    report.status !== 'passed' ||
    report.storage !== expectedContract.storage ||
    report.replicas !== expectedContract.replicas ||
    report.abruptRestarts !== expectedContract.abruptRestarts ||
    report.persistedMessages !== expectedContract.persistedMessages ||
    report.recoveredStreamSequence !== 1 ||
    report.deliveryCountBeforeRestart !== 1 ||
    report.deliveryCountAfterRestart !== 1 ||
    report.redeliveryObserved !== true ||
    report.acknowledged !== 1 ||
    report.deadLettered !== 1 ||
    report.sourceAckPending !== 0 ||
    report.sourceMessagesPending !== 0 ||
    report.shortLeaseRejected !== true ||
    report.leasePreflightPassed !== true ||
    !Number.isSafeInteger(report.requiredLeaseNanos) ||
    report.requiredLeaseNanos <= 0 ||
    report.workerAckWaitNanos !== expectedContract.workerAckWaitNanos ||
    report.requiredLeaseNanos > report.workerAckWaitNanos
  ) {
    reject('restart report does not satisfy the fixed single-node same-file-store recovery contract');
  }
  for (const [name, logPath] of [
    ['nats-before-restart.log', beforeLogPath],
    ['nats-after-restart.log', afterLogPath],
  ]) {
    const content = readFileSync(logPath, 'utf8');
    for (const marker of [
      'Starting nats-server',
      'Version:  2.14.5',
      'Starting JetStream',
      'Server is ready',
    ]) {
      if (!content.includes(marker)) {
        reject(`${name} is missing ${marker}`);
      }
    }
    if ((content.match(/Starting nats-server/g) ?? []).length !== 1) {
      reject(`${name} must contain exactly one NATS server start`);
    }
  }
  return {
    report,
    artifactPaths: [beforeLogPath, afterLogPath, restartReportPath],
  };
}

export function buildNatsRestartEvidenceReport({ repositoryRoot, evidenceRoot }) {
  const environment = parseEnvironment(readFileSync(path.join(evidenceRoot, 'environment.txt'), 'utf8'));
  const testOutput = readFileSync(path.join(evidenceRoot, 'test-output.txt'), 'utf8');
  const exitCode = readExitStatus(path.join(evidenceRoot, 'test-status.txt'));
  const natsServerSHA256 = readBinaryChecksum(path.join(evidenceRoot, 'nats-server-binary.sha256'));
  const restartComplete = restartArtifactNames.every((name) => existsSync(path.join(evidenceRoot, name)));
  const status = exitCode === 0 && restartComplete ? 'passed' : 'failed';
  const error = status === 'passed'
    ? null
    : exitCode === 0
      ? 'NATS restart artifacts were incomplete'
      : `NATS Go contract exited with code ${exitCode}`;
  return {
    schemaVersion: natsRestartEvidenceSchemaVersion,
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
      expected: [natsRestartGoTest],
      passed: extractPassedRestartTest(testOutput),
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
      beforeLog: optionalDescription(evidenceRoot, 'nats-before-restart.log'),
      afterLog: optionalDescription(evidenceRoot, 'nats-after-restart.log'),
      restartReport: optionalDescription(evidenceRoot, 'restart-report.json'),
    },
    limitations: [...limitations],
  };
}

export function verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  requireRegularFile(reportPath, evidenceRoot, 256 * 1024);
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
  if (report.schemaVersion !== natsRestartEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${natsRestartEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed real NATS contract invocation');
  }
  if (JSON.stringify(report.contract) !== JSON.stringify(expectedContract)) {
    reject('contract must preserve the fixed single-node restart semantics');
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
  if (JSON.stringify(goTests.expected) !== JSON.stringify([natsRestartGoTest])) {
    reject('goTests.expected must contain the fixed restart recovery contract');
  }
  if (
    !Array.isArray(goTests.passed) ||
    goTests.passed.length > 1 ||
    (goTests.passed.length === 1 && goTests.passed[0] !== natsRestartGoTest)
  ) {
    reject('goTests.passed must be an ordered subset of the fixed restart recovery contract');
  }

  const outputs = requireExactKeys(
    report.outputs,
    [
      'afterLog', 'beforeLog', 'environment', 'natsServer', 'natsServerChecksum',
      'restartReport', 'testOutput', 'testStatus',
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
    ['beforeLog', 'nats-before-restart.log', 8 * 1024 * 1024],
    ['afterLog', 'nats-after-restart.log', 8 * 1024 * 1024],
    ['restartReport', 'restart-report.json', 256 * 1024],
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
  const restartComplete = Object.values(optionalPaths).every((value) => value !== null);
  const expectedStatus = execution.exitCode === 0 && restartComplete && execution.error === null
    ? 'passed'
    : 'failed';
  if (report.status !== expectedStatus) {
    reject('status must match the Go exit, restart artifact completeness, and execution error');
  }
  if (report.status === 'passed' && JSON.stringify(goTests.passed) !== JSON.stringify([natsRestartGoTest])) {
    reject('passed evidence must contain the non-skipped restart recovery Go contract');
  }
  if (
    report.status === 'failed' &&
    (typeof execution.error !== 'string' || execution.error.length === 0 || execution.error.length > 4096 || /\r/.test(execution.error))
  ) {
    reject('failed execution.error must contain a bounded error');
  }

  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    contract: 'nats-jetstream-restart-recovery',
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
  if (JSON.stringify(extractPassedRestartTest(testOutput)) !== JSON.stringify(goTests.passed)) {
    reject('test-output.txt no longer matches the reported restart Go contract result');
  }
  if (
    report.status === 'passed' &&
    (
      !new RegExp(`^=== RUN   ${natsRestartGoTest}$`, 'm').test(testOutput) ||
      !new RegExp(`^--- PASS: ${natsRestartGoTest} `, 'm').test(testOutput) ||
      new RegExp(`^--- SKIP: ${natsRestartGoTest} `, 'm').test(testOutput) ||
      !/^PASS$/m.test(testOutput)
    )
  ) {
    reject('passed test-output.txt must contain the non-skipped restart Go contract and final PASS');
  }
  if (restartComplete) {
    verifyNatsRestartContractArtifacts({ evidenceRoot });
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only NATS restart boundary');
  }

  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, evidenceRoot, 32 * 1024);
  if (readFileSync(checksumPath, 'utf8') !== buildNatsRestartChecksums(evidenceRoot)) {
    reject('SHA256SUMS must contain the exact ordered NATS restart evidence artifact set');
  }

  return {
    report,
    artifactPaths: [...checksumArtifactNames(evidenceRoot), 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, name)))
      .sort(),
  };
}
