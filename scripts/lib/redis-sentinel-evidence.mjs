import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const redisSentinelEvidenceSchemaVersion = 1;
export const redisSentinelCheckpointNames = Object.freeze([
  'discovery',
  'replication_before_failover',
  'master_changed',
  'clients_reconnected',
  'rate_limit_atomic',
  'lock_owner_safe',
]);

const expectedImage = 'redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232';
const expectedCommand = Object.freeze(['yarn', 'redis:sentinel:contract']);
const expectedContainerNames = Object.freeze(['master', 'replica', 'sentinel-1', 'sentinel-2', 'sentinel-3']);
const expectedReadyNames = Object.freeze(['master', 'replica link', 'sentinel 1 quorum', 'sentinel 2 quorum', 'sentinel 3 quorum']);
const baseArtifactNames = Object.freeze([
  'environment.txt',
  'contract-output.txt',
  'test-output.txt',
  'test-status.txt',
]);
const expectedTopology = Object.freeze({
  masterName: 'goexample-primary',
  dataNodes: 2,
  sentinels: 3,
  dataACL: true,
  sentinelACL: true,
  hostNetwork: true,
  tlsEnabled: false,
});
const limitations = Object.freeze([
  'the Docker host network, ports, ACL credentials, Redis data and Sentinel quorum are ephemeral non-production fixtures',
  'the local contract does not prove target TLS, Redis Cluster, eviction, network partition, rolling upgrade, capacity, latency, alerting, backup, restore, RPO or RTO',
  'productionSharedStore remains not_recorded until signed target-environment Redis HA and recovery evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`Redis Sentinel evidence: ${message}`);
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
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    reject(`${name} keys must be exactly ${sortedExpectedKeys.join(', ')}`);
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
    reject(`${name} must stay inside the Redis Sentinel evidence directory`);
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
    adapter: describeFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis.go'), repositoryRoot),
    config: describeFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), repositoryRoot),
    frameworkGoMod: describeFile(path.join(repositoryRoot, 'Framework', 'go.mod'), repositoryRoot),
    frameworkGoSum: describeFile(path.join(repositoryRoot, 'Framework', 'go.sum'), repositoryRoot),
    integrationTest: describeFile(
      path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_sentinel_integration_test.go'),
      repositoryRoot,
    ),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'redis-sentinel-contract.mjs'), repositoryRoot),
    runbook: describeFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), repositoryRoot),
    verifier: describeFile(path.join(repositoryRoot, 'scripts', 'lib', 'redis-sentinel-evidence.mjs'), repositoryRoot),
    workflow: describeFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), repositoryRoot),
  };
}

function requireOrderedPrefix(values, expected, name, status) {
  if (!Array.isArray(values) || values.length > expected.length) {
    reject(`${name} must contain at most ${expected.length} ordered values`);
  }
  if (status === 'passed' && values.length !== expected.length) {
    reject(`passed evidence must contain all ${expected.length} ${name}`);
  }
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== expected[index]) {
      reject(`${name}[${index}] must equal ${expected[index]}`);
    }
  }
}

function validatePorts(values, status) {
  if (!Array.isArray(values) || values.length > 5) {
    reject('infrastructure.ports must contain at most five ports');
  }
  if (status === 'passed' && values.length !== 5) {
    reject('passed evidence must contain all five reserved ports');
  }
  const seen = new Set();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 65535 || seen.has(value)) {
      reject('infrastructure.ports must contain unique TCP ports between 1 and 65535');
    }
    seen.add(value);
  }
}

function parseEnvironment(content) {
  const lines = content.split('\n');
  if (lines.at(-1) !== '') {
    reject('environment.txt must end with a newline');
  }
  lines.pop();
  const expectedNames = [
    'contract',
    'platform',
    'architecture',
    'node',
    'go',
    'docker',
    'git_commit',
    'image',
    'topology',
    'ports',
    'tls_enabled',
    'local_contract_only',
    'target_redis_ha',
  ];
  if (lines.length !== expectedNames.length) {
    reject(`environment.txt must contain exactly ${expectedNames.length} fields`);
  }
  const values = {};
  for (let index = 0; index < expectedNames.length; index += 1) {
    const separator = lines[index].indexOf('=');
    const name = separator >= 0 ? lines[index].slice(0, separator) : '';
    const value = separator >= 0 ? lines[index].slice(separator + 1) : '';
    if (name !== expectedNames[index] || /[\r\n]/.test(value) || (name !== 'ports' && value.length === 0)) {
      reject(`environment.txt field ${index + 1} must be ${expectedNames[index]}`);
    }
    values[name] = value;
  }
  return values;
}

function extractCheckpoints(content) {
  return [...content.matchAll(/sentinel-checkpoint=([a-z_]+)/g)].map((match) => match[1]);
}

function extractInfrastructure(content) {
  const started = [...content.matchAll(/^started ([a-z0-9-]+): [a-f0-9]{12,64}$/gm)].map((match) => match[1]);
  const ready = [...content.matchAll(/^(master|replica link|sentinel [1-3] quorum): ready after \d+ attempt\(s\)$/gm)]
    .map((match) => match[1]);
  return { started, ready };
}

function validateContainerNames(containerNames, status) {
  requireOrderedPrefix(containerNames, expectedContainerNames, 'container names', status);
  return containerNames;
}

function checksumArtifactNames(containerNames) {
  return [
    ...baseArtifactNames,
    ...containerNames.map((name) => `container-logs/${name}.log`),
    'report.json',
  ];
}

export function buildRedisSentinelChecksums(evidenceRoot, containerNames) {
  validateContainerNames(containerNames, containerNames.length === expectedContainerNames.length ? 'passed' : 'failed');
  return `${checksumArtifactNames(containerNames)
    .map((name) => `${hashFile(path.join(evidenceRoot, ...name.split('/')))}  ${name}`)
    .join('\n')}\n`;
}

export function buildRedisSentinelEvidenceReport({
  repositoryRoot,
  evidenceRoot,
  nodeVersion,
  platform,
  architecture,
  goVersion,
  dockerVersion,
  gitCommit,
  startedAt,
  endedAt,
  exitCode,
  error,
  containerNames,
  ports,
}) {
  const status = exitCode === 0 ? 'passed' : 'failed';
  validateContainerNames(containerNames, status);
  validatePorts(ports, status);
  const contractOutput = readFileSync(path.join(evidenceRoot, 'contract-output.txt'), 'utf8');
  const testOutput = readFileSync(path.join(evidenceRoot, 'test-output.txt'), 'utf8');
  const infrastructure = extractInfrastructure(contractOutput);
  if (JSON.stringify(infrastructure.started) !== JSON.stringify(containerNames)) {
    reject('contract-output.txt started containers no longer match the archived log set');
  }
  return {
    schemaVersion: redisSentinelEvidenceSchemaVersion,
    status,
    command: [...expectedCommand],
    runtime: { nodeVersion, platform, architecture, goVersion, dockerVersion },
    source: { gitCommit, image: expectedImage },
    topology: { ...expectedTopology },
    scope: collectScope(repositoryRoot),
    execution: { startedAt, endedAt, exitCode, error: error ?? null },
    infrastructure: { ...infrastructure, ports: [...ports] },
    checkpoints: extractCheckpoints(testOutput),
    outputs: {
      environment: describeFile(path.join(evidenceRoot, 'environment.txt'), evidenceRoot),
      contractOutput: describeFile(path.join(evidenceRoot, 'contract-output.txt'), evidenceRoot),
      testOutput: describeFile(path.join(evidenceRoot, 'test-output.txt'), evidenceRoot),
      testStatus: describeFile(path.join(evidenceRoot, 'test-status.txt'), evidenceRoot),
      containerLogs: containerNames.map((name) =>
        describeFile(path.join(evidenceRoot, 'container-logs', `${name}.log`), evidenceRoot)),
    },
    limitations: [...limitations],
  };
}

export function verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }) {
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
      'checkpoints', 'command', 'execution', 'infrastructure', 'limitations', 'outputs', 'runtime',
      'schemaVersion', 'scope', 'source', 'status', 'topology',
    ],
    'report',
  );
  if (report.schemaVersion !== redisSentinelEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${redisSentinelEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed Redis Sentinel contract invocation');
  }

  const runtime = requireExactKeys(
    report.runtime,
    ['architecture', 'dockerVersion', 'goVersion', 'nodeVersion', 'platform'],
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
  const expectedGo = requiredGoVersion(repositoryRoot);
  const expectedGoRuntime = `go version go${expectedGo} ${goPlatform(runtime.platform)}/${goArchitecture(runtime.architecture)}`;
  if (
    report.status === 'passed' &&
    runtime.goVersion !== expectedGoRuntime
  ) {
    reject(`runtime.goVersion must equal ${expectedGoRuntime}`);
  }
  if (
    report.status === 'failed' &&
    runtime.goVersion !== 'unavailable' &&
    runtime.goVersion !== expectedGoRuntime
  ) {
    reject('failed runtime.goVersion must be unavailable or match the pinned Go toolchain and Node runtime');
  }
  if (
    typeof runtime.dockerVersion !== 'string' ||
    (runtime.dockerVersion !== 'unavailable' && !/^[A-Za-z0-9.+_-]{1,64}$/.test(runtime.dockerVersion)) ||
    (report.status === 'passed' && runtime.dockerVersion === 'unavailable')
  ) {
    reject('runtime.dockerVersion must identify the Docker server for passed evidence');
  }

  const source = requireExactKeys(report.source, ['gitCommit', 'image'], 'source');
  if (!/^[a-f0-9]{40}$|^unavailable$/.test(source.gitCommit ?? '') || source.image !== expectedImage) {
    reject('source must bind the repository commit and exact pinned Redis image');
  }
  if (JSON.stringify(report.topology) !== JSON.stringify(expectedTopology)) {
    reject('topology must preserve the fixed ACL-separated local Sentinel contract');
  }
  const expectedScope = collectScope(repositoryRoot);
  if (JSON.stringify(report.scope) !== JSON.stringify(expectedScope)) {
    reject('scope no longer matches the Redis adapter, config, toolchain, test, runner, runbook, verifier, and workflow');
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
  if ((execution.exitCode === 0 ? 'passed' : 'failed') !== report.status) {
    reject('status must match execution.exitCode');
  }
  if (report.status === 'passed' && execution.error !== null) {
    reject('passed execution.error must be null');
  }
  if (
    report.status === 'failed' &&
    (typeof execution.error !== 'string' || execution.error.length === 0 || execution.error.length > 4096)
  ) {
    reject('failed execution.error must contain a bounded error');
  }

  const infrastructure = requireExactKeys(report.infrastructure, ['ports', 'ready', 'started'], 'infrastructure');
  requireOrderedPrefix(infrastructure.started, expectedContainerNames, 'infrastructure.started', report.status);
  requireOrderedPrefix(infrastructure.ready, expectedReadyNames, 'infrastructure.ready', report.status);
  validatePorts(infrastructure.ports, report.status);
  requireOrderedPrefix(report.checkpoints, redisSentinelCheckpointNames, 'checkpoints', report.status);

  const outputs = requireExactKeys(
    report.outputs,
    ['containerLogs', 'contractOutput', 'environment', 'testOutput', 'testStatus'],
    'outputs',
  );
  const environmentPath = verifyFileRecord(outputs.environment, evidenceRoot, 'outputs.environment', 'environment.txt', 64 * 1024);
  const contractOutputPath = verifyFileRecord(
    outputs.contractOutput,
    evidenceRoot,
    'outputs.contractOutput',
    'contract-output.txt',
    256 * 1024,
  );
  const testOutputPath = verifyFileRecord(outputs.testOutput, evidenceRoot, 'outputs.testOutput', 'test-output.txt', 1024 * 1024);
  const testStatusPath = verifyFileRecord(outputs.testStatus, evidenceRoot, 'outputs.testStatus', 'test-status.txt', 1024);
  if (!Array.isArray(outputs.containerLogs) || outputs.containerLogs.length !== infrastructure.started.length) {
    reject('outputs.containerLogs must match the started container prefix');
  }
  for (let index = 0; index < outputs.containerLogs.length; index += 1) {
    verifyFileRecord(
      outputs.containerLogs[index],
      evidenceRoot,
      `outputs.containerLogs[${index}]`,
      `container-logs/${infrastructure.started[index]}.log`,
      4 * 1024 * 1024,
    );
  }

  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    contract: 'redis-sentinel-failover',
    platform: runtime.platform,
    architecture: runtime.architecture,
    node: runtime.nodeVersion,
    go: runtime.goVersion,
    docker: runtime.dockerVersion,
    git_commit: source.gitCommit,
    image: source.image,
    topology: '1-master,1-replica,3-sentinels',
    ports: infrastructure.ports.join(','),
    tls_enabled: 'false',
    local_contract_only: 'true',
    target_redis_ha: 'not_recorded',
  };
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    reject('environment.txt no longer matches report runtime, source, topology, ports, and limitations');
  }

  const contractOutput = readFileSync(contractOutputPath, 'utf8');
  const observedInfrastructure = extractInfrastructure(contractOutput);
  if (JSON.stringify(observedInfrastructure) !== JSON.stringify({
    started: infrastructure.started,
    ready: infrastructure.ready,
  })) {
    reject('contract-output.txt no longer matches the reported infrastructure lifecycle');
  }
  const failureLine = execution.error === null ? null : `failure: ${execution.error}`;
  if (
    (report.status === 'passed' && /^failure:/m.test(contractOutput)) ||
    (report.status === 'failed' && !contractOutput.split('\n').includes(failureLine))
  ) {
    reject('contract-output.txt no longer matches execution.error');
  }

  const testOutput = readFileSync(testOutputPath, 'utf8');
  if (JSON.stringify(extractCheckpoints(testOutput)) !== JSON.stringify(report.checkpoints)) {
    reject('test-output.txt no longer matches the reported checkpoints');
  }
  if (
    report.status === 'passed' &&
    (
      !/^=== RUN   TestRedisSentinelFailoverReconnectsSharedStateClients$/m.test(testOutput) ||
      !/^--- PASS: TestRedisSentinelFailoverReconnectsSharedStateClients /m.test(testOutput) ||
      !/^PASS$/m.test(testOutput) ||
      /--- SKIP: TestRedisSentinelFailoverReconnectsSharedStateClients /m.test(testOutput)
    )
  ) {
    reject('passed test-output.txt must contain the non-skipped Redis Sentinel Go contract result');
  }
  if (report.status === 'failed' && /^--- PASS: TestRedisSentinelFailoverReconnectsSharedStateClients /m.test(testOutput)) {
    reject('failed test-output.txt must not contain a passed Redis Sentinel Go contract result');
  }
  if (readFileSync(testStatusPath, 'utf8') !== `exit_code=${execution.exitCode}\n`) {
    reject('test-status.txt no longer matches execution.exitCode');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only Redis Sentinel evidence boundary');
  }

  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  if (!existsSync(checksumPath)) {
    reject('SHA256SUMS is missing');
  }
  const checksumStats = lstatSync(checksumPath);
  if (!checksumStats.isFile() || checksumStats.isSymbolicLink() || checksumStats.size > 32 * 1024) {
    reject('SHA256SUMS must be a regular file no larger than 32 KiB');
  }
  if (readFileSync(checksumPath, 'utf8') !== buildRedisSentinelChecksums(evidenceRoot, infrastructure.started)) {
    reject('SHA256SUMS must contain the exact ordered Redis Sentinel evidence artifact set');
  }

  return {
    report,
    artifactPaths: [...checksumArtifactNames(infrastructure.started), 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, ...name.split('/'))))
      .sort(),
  };
}
