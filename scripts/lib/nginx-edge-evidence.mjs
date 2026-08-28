import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const nginxEdgeEvidenceSchemaVersion = 1;
export const nginxEdgeChecksumArtifactNames = Object.freeze([
  'environment.txt',
  'test-output.json',
  'nginx.log',
  'test-status.txt',
  'report.json',
]);

const expectedImage = 'nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';
const expectedCommand = Object.freeze(['yarn', 'edge:contract']);
const expectedEvents = Object.freeze([
  Object.freeze({ name: 'tls_http2_trace', status: 200, alpn: 'h2' }),
  Object.freeze({ name: 'header_limit', status: 431 }),
  Object.freeze({ name: 'upstream_503_passthrough', status: 503 }),
  Object.freeze({ name: 'upstream_502', status: 502 }),
  Object.freeze({ name: 'upstream_504', status: 504 }),
  Object.freeze({ name: 'upload_interruption_propagated' }),
  Object.freeze({ name: 'sigquit_drain', status: 200 }),
]);
const limitations = Object.freeze([
  'the loopback certificate, DNS name, upstream, and Docker network are non-production fixtures',
  'a GitHub-hosted Docker contract does not prove the selected target edge, real certificate or DNS ownership, HTTP/3, capacity, disconnect propagation, or rollback',
  'targetEdge remains not_recorded until signed target-environment evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`Nginx edge evidence: ${message}`);
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
    reject(`${name} must stay inside the Nginx edge evidence directory`);
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

function collectScope(repositoryRoot) {
  return {
    contract: describeFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'goexample-nginx.contract.json'), repositoryRoot),
    renderer: describeFile(path.join(repositoryRoot, 'scripts', 'nginx-edge.mjs'), repositoryRoot),
    runner: describeFile(path.join(repositoryRoot, 'scripts', 'nginx-edge-contract.mjs'), repositoryRoot),
    runbook: describeFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'README.md'), repositoryRoot),
    verifier: describeFile(path.join(repositoryRoot, 'scripts', 'lib', 'nginx-edge-evidence.mjs'), repositoryRoot),
    workflow: describeFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), repositoryRoot),
  };
}

function validateEvents(events, status) {
  if (!Array.isArray(events) || events.length > expectedEvents.length) {
    reject(`events must contain at most ${expectedEvents.length} ordered scenarios`);
  }
  if (status === 'passed' && events.length !== expectedEvents.length) {
    reject(`passed evidence must contain all ${expectedEvents.length} scenarios`);
  }
  for (let index = 0; index < events.length; index += 1) {
    const actual = events[index];
    const expected = expectedEvents[index];
    const expectedKeys = expected.name === 'tls_http2_trace'
      ? ['alpn', 'name', 'status', 'tls']
      : Object.keys(expected);
    requireExactKeys(actual, expectedKeys, `events[${index}]`);
    if (actual.name !== expected.name) {
      reject(`events[${index}].name must equal ${expected.name}`);
    }
    if ('status' in expected && actual.status !== expected.status) {
      reject(`events[${index}].status must equal ${expected.status}`);
    }
    if ('alpn' in expected && actual.alpn !== expected.alpn) {
      reject(`events[${index}].alpn must equal ${expected.alpn}`);
    }
    if (expected.name === 'tls_http2_trace' && !/^TLSv1\.[23]$/.test(actual.tls)) {
      reject('events[0].tls must record TLSv1.2 or TLSv1.3');
    }
  }
}

function parseEnvironment(content) {
  const lines = content.split('\n');
  if (lines.at(-1) !== '') {
    reject('environment.txt must end with a newline');
  }
  lines.pop();
  const expectedNames = ['runner_os', 'runner_arch', 'git_commit', 'node', 'nginx_image', 'contract'];
  if (lines.length !== expectedNames.length) {
    reject('environment.txt must contain exactly six fields');
  }
  const values = {};
  for (let index = 0; index < expectedNames.length; index += 1) {
    const separator = lines[index].indexOf('=');
    const name = separator >= 0 ? lines[index].slice(0, separator) : '';
    const value = separator >= 0 ? lines[index].slice(separator + 1) : '';
    if (name !== expectedNames[index] || value.length === 0 || /[\r\n]/.test(value)) {
      reject(`environment.txt field ${index + 1} must be ${expectedNames[index]} with a non-empty value`);
    }
    values[name] = value;
  }
  return values;
}

export function buildNginxEdgeChecksums(evidenceRoot) {
  return `${nginxEdgeChecksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}`)
    .join('\n')}\n`;
}

export function buildNginxEdgeEvidenceReport({
  repositoryRoot,
  evidenceRoot,
  nodeVersion,
  platform,
  architecture,
  runnerOS,
  runnerArch,
  gitCommit,
  startedAt,
  endedAt,
  exitCode,
  events,
}) {
  const status = exitCode === 0 ? 'passed' : 'failed';
  return {
    schemaVersion: nginxEdgeEvidenceSchemaVersion,
    status,
    command: [...expectedCommand],
    runtime: { nodeVersion, platform, architecture, runnerOS, runnerArch },
    source: { gitCommit, image: expectedImage },
    scope: collectScope(repositoryRoot),
    execution: { startedAt, endedAt, exitCode },
    events: structuredClone(events),
    outputs: {
      environment: describeFile(path.join(evidenceRoot, 'environment.txt'), evidenceRoot),
      testOutput: describeFile(path.join(evidenceRoot, 'test-output.json'), evidenceRoot),
      nginxLog: describeFile(path.join(evidenceRoot, 'nginx.log'), evidenceRoot),
      testStatus: describeFile(path.join(evidenceRoot, 'test-status.txt'), evidenceRoot),
    },
    limitations: [...limitations],
  };
}

export function verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }) {
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
    ['command', 'events', 'execution', 'limitations', 'outputs', 'runtime', 'schemaVersion', 'scope', 'source', 'status'],
    'report',
  );
  if (report.schemaVersion !== nginxEdgeEvidenceSchemaVersion || !['passed', 'failed'].includes(report.status)) {
    reject(`report must be a passed or failed schemaVersion ${nginxEdgeEvidenceSchemaVersion} document`);
  }
  if (JSON.stringify(report.command) !== JSON.stringify(expectedCommand)) {
    reject('command must equal the fixed edge contract invocation');
  }

  const runtime = requireExactKeys(
    report.runtime,
    ['architecture', 'nodeVersion', 'platform', 'runnerArch', 'runnerOS'],
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
  for (const name of ['runnerOS', 'runnerArch']) {
    if (typeof runtime[name] !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(runtime[name])) {
      reject(`runtime.${name} must be a bounded runner identifier`);
    }
  }

  const source = requireExactKeys(report.source, ['gitCommit', 'image'], 'source');
  if (!/^[a-f0-9]{40}$|^unknown$/.test(source.gitCommit ?? '') || source.image !== expectedImage) {
    reject('source must bind the repository commit and exact pinned Nginx image');
  }
  const expectedScope = collectScope(repositoryRoot);
  if (JSON.stringify(report.scope) !== JSON.stringify(expectedScope)) {
    reject('scope no longer matches the Nginx contract, renderer, runner, runbook, verifier, and workflow');
  }

  const execution = requireExactKeys(report.execution, ['endedAt', 'exitCode', 'startedAt'], 'execution');
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
  validateEvents(report.events, report.status);

  const outputs = requireExactKeys(report.outputs, ['environment', 'nginxLog', 'testOutput', 'testStatus'], 'outputs');
  const environmentPath = verifyFileRecord(outputs.environment, evidenceRoot, 'outputs.environment', 'environment.txt', 64 * 1024);
  const testOutputPath = verifyFileRecord(outputs.testOutput, evidenceRoot, 'outputs.testOutput', 'test-output.json', 256 * 1024);
  const nginxLogPath = verifyFileRecord(outputs.nginxLog, evidenceRoot, 'outputs.nginxLog', 'nginx.log', 4 * 1024 * 1024);
  const testStatusPath = verifyFileRecord(outputs.testStatus, evidenceRoot, 'outputs.testStatus', 'test-status.txt', 1024);

  const environment = parseEnvironment(readFileSync(environmentPath, 'utf8'));
  const expectedEnvironment = {
    runner_os: runtime.runnerOS,
    runner_arch: runtime.runnerArch,
    git_commit: source.gitCommit,
    node: runtime.nodeVersion,
    nginx_image: source.image,
    contract: expectedScope.contract.path,
  };
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    reject('environment.txt no longer matches report runtime, source, and scope');
  }

  let testOutput;
  try {
    testOutput = JSON.parse(readFileSync(testOutputPath, 'utf8'));
  } catch {
    reject('test-output.json must contain valid JSON');
  }
  requireExactKeys(testOutput, ['error', 'events', 'localContractOnly', 'status'], 'testOutput');
  if (
    testOutput.localContractOnly !== true ||
    testOutput.status !== report.status ||
    JSON.stringify(testOutput.events) !== JSON.stringify(report.events)
  ) {
    reject('test-output.json no longer matches the report status and events');
  }
  if (report.status === 'passed' && testOutput.error !== null) {
    reject('passed test-output.json must contain a null error');
  }
  if (
    report.status === 'failed' &&
    (typeof testOutput.error !== 'string' || testOutput.error.length === 0 || testOutput.error.length > 4096)
  ) {
    reject('failed test-output.json must contain a bounded error');
  }
  if (readFileSync(testStatusPath, 'utf8') !== `exit_code=${execution.exitCode}\n`) {
    reject('test-status.txt no longer matches execution.exitCode');
  }
  readFileSync(nginxLogPath, 'utf8');

  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local-only Nginx edge evidence boundary');
  }
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  if (!existsSync(checksumPath)) {
    reject('SHA256SUMS is missing');
  }
  const checksumStats = lstatSync(checksumPath);
  if (!checksumStats.isFile() || checksumStats.isSymbolicLink() || checksumStats.size > 16 * 1024) {
    reject('SHA256SUMS must be a regular file no larger than 16 KiB');
  }
  if (readFileSync(checksumPath, 'utf8') !== buildNginxEdgeChecksums(evidenceRoot)) {
    reject('SHA256SUMS must contain the exact ordered Nginx evidence artifact set');
  }

  return {
    report,
    artifactPaths: [...nginxEdgeChecksumArtifactNames, 'SHA256SUMS']
      .map((name) => relativePath(repositoryRoot, path.join(evidenceRoot, name)))
      .sort(),
  };
}
