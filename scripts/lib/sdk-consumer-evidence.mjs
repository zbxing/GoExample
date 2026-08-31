import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const sdkConsumerEvidenceSchemaVersion = 1;
export const sdkConsumerTests = Object.freeze([
  'TestHealthProbeMigratesFromDeprecatedAliasToCanonicalReadiness',
  'TestHealthProbeRejectsUnavailableAndMalformedResponses',
  'TestGeneratedBillingSDKReadsSummaryFromIndependentFrameworkService',
  'TestGeneratedBillingSDKInvokesEveryPublicOperationThroughFrameworkHandler',
]);
export const sdkConsumerBillingOperations = Object.freeze([
  'getServiceInfo',
  'getMetrics',
  'getLegacyHealth',
  'getLegacyReadiness',
  'getLegacyStartup',
  'getSystemInfo',
  'getLiveness',
  'getReadiness',
  'getStartup',
  'getExampleHello',
  'postExampleEcho',
  'postExampleValidate',
  'getExampleDelay',
  'getBillingSummary',
]);
export const sdkConsumerGoArguments = Object.freeze([
  'test',
  '-v',
  '-count=1',
  '-timeout=90s',
  `-run=^(${sdkConsumerTests.join('|')})$`,
  './support/consumer/HealthProbe/cmd/healthprobe',
  './Services/Billing/internal/billingapi',
]);
export const sdkConsumerLimitations = Object.freeze([
  'proves repository-local HealthProbe migration and Billing generated-SDK integration behavior only',
  'does not establish an external consumer cross-version matrix, a formal SDK tag, or package publication',
  'does not establish deprecation-window execution, target deployment migration, or production consumer ownership',
  'does not establish remote provenance, target identity, target dependencies, or production availability evidence',
]);
export const sdkConsumerArtifactNames = Object.freeze([
  'go-output.txt',
  'go-error.txt',
  'go-status.txt',
  'report.json',
  'SHA256SUMS',
]);

const checksumArtifactNames = sdkConsumerArtifactNames.filter((name) => name !== 'SHA256SUMS');
const sha256Pattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumArtifactBytes = 4 * 1024 * 1024;
const maximumReportBytes = 1024 * 1024;
export const sdkConsumerProcessTimeoutMs = 120_000;
const executionBudgetMs = 150_000;

function reject(message) {
  throw new Error(`SDK consumer evidence: ${message}`);
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

function toolCandidates(repositoryRoot, executableName, environmentValue) {
  const version = requiredGoVersion(repositoryRoot);
  return [
    environmentValue?.trim(),
    path.join(repositoryRoot, '.temp', 'toolchain', `go${version}`, 'go', 'bin', executableName),
    path.join(repositoryRoot, '.temp', 'toolchain', 'go', 'bin', executableName),
    executableName,
  ].filter(Boolean);
}

export function resolveSDKConsumerGoCommand(repositoryRoot) {
  const executableName = process.platform === 'win32' ? 'go.exe' : 'go';
  return toolCandidates(repositoryRoot, executableName, process.env.GO_BINARY)
    .find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate));
}

function currentGoVersion(repositoryRoot) {
  const result = spawnSync(resolveSDKConsumerGoCommand(repositoryRoot), ['version'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const value = `${result.stdout ?? ''}`.trim();
  if (result.status !== 0 || !/^go version go\d+\.\d+\.\d+ [a-z0-9]+\/[a-z0-9]+$/.test(value)) {
    reject('cannot resolve the Go toolchain identity');
  }
  return value;
}

function currentGitCommit(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const value = `${result.stdout ?? ''}`.trim();
  if (result.status !== 0 || !gitCommitPattern.test(value)) {
    reject('cannot resolve the current Git commit');
  }
  return value;
}

function sourcePaths() {
  return {
    packageDocument: 'package.json',
    workspace: 'go.work',
    projectManifest: 'contracts/projects.json',
    projectContractDocs: 'docs/openapi/project-contracts.md',
    exampleSDKVersion: 'SDK/GoExample/VERSION',
    exampleSDKModule: 'SDK/GoExample/go.mod',
    exampleSDKClient: 'SDK/GoExample/client.gen.go',
    exampleSDKReleaseManifest: 'SDK/GoExample/release-manifest.json',
    billingSDKVersion: 'SDK/Billing/VERSION',
    billingSDKModule: 'SDK/Billing/go.mod',
    billingSDKClient: 'SDK/Billing/client.gen.go',
    billingSDKReleaseManifest: 'SDK/Billing/release-manifest.json',
    healthProbeModule: 'support/consumer/HealthProbe/go.mod',
    healthProbeSums: 'support/consumer/HealthProbe/go.sum',
    healthProbeReadme: 'support/consumer/HealthProbe/README.md',
    healthProbeMain: 'support/consumer/HealthProbe/cmd/healthprobe/main.go',
    healthProbeTests: 'support/consumer/HealthProbe/cmd/healthprobe/main_test.go',
    billingModule: 'Services/Billing/go.mod',
    billingReadme: 'Services/Billing/README.md',
    billingRoutes: 'Services/Billing/internal/billingapi/routes.go',
    billingContractTests: 'Services/Billing/internal/billingapi/openapi_contract_test.go',
    billingSDKTests: 'Services/Billing/internal/billingapi/sdk_integration_test.go',
    sdkGenerator: 'scripts/go-sdk.mjs',
    sdkReleaseVerifier: 'scripts/lib/sdk-release.mjs',
    evidenceRunner: 'scripts/sdk-consumer-evidence.mjs',
    evidenceVerifier: 'scripts/lib/sdk-consumer-evidence.mjs',
    evidenceTests: '__test__/node/sdk-consumer-evidence.test.mjs',
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

function parseJSON(filePath, name, maximumBytes = maximumReportBytes) {
  requireRegularFile(filePath, name, maximumBytes);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    reject(`${name} must contain valid JSON`);
  }
}

function consumerContract() {
  return {
    consumers: [
      {
        name: 'HealthProbe',
        modulePath: 'support/consumer/HealthProbe',
        packagePath: './support/consumer/HealthProbe/cmd/healthprobe',
        testCount: 2,
        canonicalPath: '/readyz',
        deprecatedPath: '/api/health/ready',
      },
      {
        name: 'Billing',
        modulePath: 'Services/Billing',
        packagePath: './Services/Billing/internal/billingapi',
        testCount: 2,
        operationCount: sdkConsumerBillingOperations.length,
        operationIds: [...sdkConsumerBillingOperations],
      },
    ],
    assertions: {
      healthProbeCanonicalReadiness: true,
      deprecatedReadinessHeadersBound: true,
      billingOperationMatrixBound: true,
      billingFrameworkHandlerBound: true,
      generatedSDKVersionsBound: true,
      externalMigrationNotChecked: true,
    },
  };
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

function verifySuccessfulGoOutput(content) {
  if (content.includes('--- FAIL:') || !/(?:^|\n)PASS\r?\n/.test(content)) {
    reject('go-output.txt must contain a successful Go test result');
  }
  for (const testName of sdkConsumerTests) {
    if (!new RegExp(`^--- PASS: ${testName} \\(`, 'm').test(content)) {
      reject(`go-output.txt is missing the passed marker for ${testName}`);
    }
  }
  for (const operationId of sdkConsumerBillingOperations) {
    if (!new RegExp(`^    --- PASS: ${sdkConsumerTests[3]}/${operationId} \\(`, 'm').test(content)) {
      reject(`go-output.txt is missing the passed Billing operation marker for ${operationId}`);
    }
  }
}

export function expectedSDKConsumerGoOutput() {
  const parents = sdkConsumerTests.map((testName) => `--- PASS: ${testName} (0.00s)`);
  const operations = sdkConsumerBillingOperations
    .map((operationId) => `    --- PASS: ${sdkConsumerTests[3]}/${operationId} (0.00s)`)
    .join('\n');
  return [
    '=== RUN   TestHealthProbeMigratesFromDeprecatedAliasToCanonicalReadiness',
    parents[0],
    '=== RUN   TestHealthProbeRejectsUnavailableAndMalformedResponses',
    parents[1],
    '=== RUN   TestGeneratedBillingSDKReadsSummaryFromIndependentFrameworkService',
    parents[2],
    '=== RUN   TestGeneratedBillingSDKInvokesEveryPublicOperationThroughFrameworkHandler',
    operations,
    parents[3],
    'PASS',
    '',
  ].join('\n');
}

function verifyChecksums(evidenceRoot) {
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, 'SHA256SUMS', maximumReportBytes);
  const expected = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  if (readFileSync(checksumPath, 'utf8') !== expected) {
    reject('SHA256SUMS must contain the exact ordered SDK consumer evidence artifact set');
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
  const expected = [...sdkConsumerArtifactNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    reject(`evidence directory files must be exactly ${expected.join(', ')}`);
  }
}

export function buildSDKConsumerEvidenceReport({ repositoryRoot, evidenceRoot, execution }) {
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
    schemaVersion: sdkConsumerEvidenceSchemaVersion,
    generatedAt: checkedExecution.completedAt,
    scope: 'local_sdk_consumer_migration_contract',
    status,
    command: ['go', ...sdkConsumerGoArguments],
    workingDirectory: '.',
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      go: currentGoVersion(repositoryRoot),
    },
    repository: { gitCommit: currentGitCommit(repositoryRoot) },
    execution: { ...checkedExecution },
    contract: {
      processTimeoutMs: sdkConsumerProcessTimeoutMs,
      ...consumerContract(),
    },
    source: collectSource(repositoryRoot),
    artifacts: {
      stdout: describeArtifact(evidenceRoot, 'go-output.txt'),
      stderr: describeArtifact(evidenceRoot, 'go-error.txt'),
      status: describeArtifact(evidenceRoot, 'go-status.txt'),
    },
    limitations: [...sdkConsumerLimitations],
  };
}

export function writeSDKConsumerEvidenceChecksums(evidenceRoot) {
  const content = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), content, 'utf8');
}

export function verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot }) {
  verifyDirectory(evidenceRoot);
  const report = requireExactKeys(
    parseJSON(path.join(evidenceRoot, 'report.json'), 'report.json'),
    [
      'artifacts', 'command', 'contract', 'execution', 'generatedAt', 'limitations', 'repository',
      'runtime', 'schemaVersion', 'scope', 'source', 'status', 'workingDirectory',
    ],
    'report',
  );
  if (report.schemaVersion !== sdkConsumerEvidenceSchemaVersion) {
    reject(`report.schemaVersion must equal ${sdkConsumerEvidenceSchemaVersion}`);
  }
  if (report.scope !== 'local_sdk_consumer_migration_contract' || report.workingDirectory !== '.') {
    reject('report must identify the fixed local SDK consumer migration contract');
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
  if (JSON.stringify(report.command) !== JSON.stringify(['go', ...sdkConsumerGoArguments])) {
    reject('report.command must match the fixed SDK consumer migration command');
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
  const contract = requireExactKeys(
    report.contract,
    ['assertions', 'consumers', 'processTimeoutMs'],
    'report.contract',
  );
  if (contract.processTimeoutMs !== sdkConsumerProcessTimeoutMs) {
    reject('report.contract.processTimeoutMs does not match the fixed execution budget');
  }
  const expectedContract = consumerContract();
  if (JSON.stringify(contract.consumers) !== JSON.stringify(expectedContract.consumers)) {
    reject('report.contract.consumers does not match the fixed SDK consumer project matrix');
  }
  if (JSON.stringify(contract.assertions) !== JSON.stringify(expectedContract.assertions)) {
    reject('report.contract.assertions must match the fixed SDK consumer assertions');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(sdkConsumerLimitations)) {
    reject('report.limitations must match the fixed repository-only boundary');
  }
  verifySource(report.source, repositoryRoot);
  const artifacts = requireExactKeys(report.artifacts, ['status', 'stderr', 'stdout'], 'report.artifacts');
  const stdoutPath = verifyFileRecord(
    artifacts.stdout,
    path.join(evidenceRoot, 'go-output.txt'),
    'go-output.txt',
    'report.artifacts.stdout',
  );
  const stderrPath = verifyFileRecord(
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
    verifySuccessfulGoOutput(readFileSync(stdoutPath, 'utf8'));
    if (readFileSync(stderrPath, 'utf8') !== '') {
      reject('go-error.txt must be empty for passed evidence');
    }
  }
  verifyChecksums(evidenceRoot);
  return {
    report,
    artifactPaths: sdkConsumerArtifactNames.map((name) =>
      repositoryRelativePath(repositoryRoot, path.join(evidenceRoot, name))),
  };
}
