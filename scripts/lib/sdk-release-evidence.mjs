import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  assertReleaseManifestHashes,
  buildSDKReleaseManifest,
  verifySDKReleaseManifest,
} from './sdk-release.mjs';
import { readProjectManifest, selectProject } from './project-contracts.mjs';

export const sdkReleaseEvidenceSchemaVersion = 1;
export const sdkReleaseEvidenceProjects = Object.freeze([
  Object.freeze({
    name: 'Example',
    sdkPath: 'SDK/GoExample',
    version: '1.4.0',
    expectedTag: 'SDK/GoExample/v1.4.0',
    openAPISource: 'docs/openapi/openapi.json',
    operationCount: 26,
  }),
  Object.freeze({
    name: 'Billing',
    sdkPath: 'SDK/Billing',
    version: '1.0.0',
    expectedTag: 'SDK/Billing/v1.0.0',
    openAPISource: 'docs/openapi/billing.json',
    operationCount: 14,
  }),
]);
export const sdkReleaseEvidenceArguments = Object.freeze([
  'scripts/sdk-release.mjs',
  'verify',
]);
export const sdkReleaseEvidenceLimitations = Object.freeze([
  'proves repository-local generated SDK drift checks and deterministic release-readiness manifest validation only',
  'does not query, create, verify, or publish the expected Git module tags or packages',
  'does not establish an external consumer cross-version matrix, deprecation-window execution, or target deployment migration',
  'does not establish remote provenance, registry distribution, independent toolchain attestation, or production support ownership',
]);
export const sdkReleaseEvidenceArtifactNames = Object.freeze([
  'verification-output.txt',
  'verification-error.txt',
  'verification-status.txt',
  'report.json',
  'SHA256SUMS',
]);

const checksumArtifactNames = sdkReleaseEvidenceArtifactNames.filter((name) => name !== 'SHA256SUMS');
const sha256Pattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumArtifactBytes = 4 * 1024 * 1024;
const maximumReportBytes = 1024 * 1024;
export const sdkReleaseProcessTimeoutMs = 120_000;
const executionBudgetMs = 150_000;

function reject(message) {
  throw new Error(`SDK release evidence: ${message}`);
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

export function resolveSDKReleaseGofmtCommand(repositoryRoot) {
  const executableName = process.platform === 'win32' ? 'gofmt.exe' : 'gofmt';
  return toolCandidates(repositoryRoot, executableName, process.env.GOFMT_BINARY)
    .find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate));
}

function resolveGoCommand(repositoryRoot) {
  const executableName = process.platform === 'win32' ? 'go.exe' : 'go';
  return toolCandidates(repositoryRoot, executableName, process.env.GO_BINARY)
    .find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate));
}

function currentGoVersion(repositoryRoot) {
  const result = spawnSync(resolveGoCommand(repositoryRoot), ['version'], {
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
    exampleOpenAPI: 'docs/openapi/openapi.json',
    billingOpenAPI: 'docs/openapi/billing.json',
    exampleVersion: 'SDK/GoExample/VERSION',
    exampleReadme: 'SDK/GoExample/README.md',
    exampleChangelog: 'SDK/GoExample/CHANGELOG.md',
    exampleGoMod: 'SDK/GoExample/go.mod',
    exampleClient: 'SDK/GoExample/client.gen.go',
    exampleReleaseManifest: 'SDK/GoExample/release-manifest.json',
    billingVersion: 'SDK/Billing/VERSION',
    billingReadme: 'SDK/Billing/README.md',
    billingChangelog: 'SDK/Billing/CHANGELOG.md',
    billingGoMod: 'SDK/Billing/go.mod',
    billingClient: 'SDK/Billing/client.gen.go',
    billingReleaseManifest: 'SDK/Billing/release-manifest.json',
    sdkGenerator: 'scripts/go-sdk.mjs',
    sdkReleaseRunner: 'scripts/sdk-release.mjs',
    sdkReleaseVerifier: 'scripts/lib/sdk-release.mjs',
    projectContractVerifier: 'scripts/lib/project-contracts.mjs',
    evidenceRunner: 'scripts/sdk-release-evidence.mjs',
    evidenceVerifier: 'scripts/lib/sdk-release-evidence.mjs',
    evidenceTests: '__test__/node/sdk-release-evidence.test.mjs',
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

function projectSummaries(repositoryRoot, requireStrictVerification) {
  const projectManifest = readProjectManifest(repositoryRoot);
  if (
    projectManifest.projects.length !== sdkReleaseEvidenceProjects.length ||
    projectManifest.projects.some((project, index) => project.name !== sdkReleaseEvidenceProjects[index].name)
  ) {
    reject('contracts/projects.json must contain the exact ordered SDK release evidence project set');
  }
  const summaries = sdkReleaseEvidenceProjects.map((expected) => {
    const project = selectProject(projectManifest, expected.name);
    const relativeManifestPath = `${expected.sdkPath}/release-manifest.json`;
    const releaseManifest = parseJSON(
      path.join(repositoryRoot, ...relativeManifestPath.split('/')),
      relativeManifestPath,
    );
    const summary = {
      name: releaseManifest.project,
      sdkPath: releaseManifest.sdkPath,
      version: releaseManifest.sdkVersion,
      expectedTag: releaseManifest.expectedTag,
      openAPISource: releaseManifest.openapi?.source,
      operationCount: releaseManifest.openapi?.operationCount,
      sourceCommit: releaseManifest.sourceCommit,
      publication: releaseManifest.publication,
    };
    const expectedSummary = {
      ...expected,
      sourceCommit: summary.sourceCommit,
      publication: 'not_checked',
    };
    if (
      !gitCommitPattern.test(summary.sourceCommit ?? '') ||
      JSON.stringify(summary) !== JSON.stringify(expectedSummary)
    ) {
      reject(`${relativeManifestPath} does not match the fixed release-readiness project contract`);
    }
    if (requireStrictVerification) {
      const rebuilt = buildSDKReleaseManifest(repositoryRoot, project, {
        sourceCommit: releaseManifest.sourceCommit,
      });
      assertReleaseManifestHashes(rebuilt);
      verifySDKReleaseManifest(repositoryRoot, project, rebuilt);
    }
    return summary;
  });
  if (new Set(summaries.map((project) => project.sourceCommit)).size !== 1) {
    reject('SDK release manifests must bind the same release source commit');
  }
  return summaries;
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

export function expectedSDKReleaseEvidenceOutput() {
  return `${sdkReleaseEvidenceProjects.map((project) =>
    `Verified ${project.sdkPath}/release-manifest.json for expected tag ${project.expectedTag} (publication not checked).`
  ).join('\n')}\n`;
}

function verifySuccessfulOutput(stdout, stderr) {
  if (stdout !== expectedSDKReleaseEvidenceOutput()) {
    reject('verification-output.txt must contain the exact ordered SDK release readiness markers');
  }
  if (stderr !== '') {
    reject('verification-error.txt must be empty for passed evidence');
  }
}

function verifyChecksums(evidenceRoot) {
  const checksumPath = path.join(evidenceRoot, 'SHA256SUMS');
  requireRegularFile(checksumPath, 'SHA256SUMS', maximumReportBytes);
  const expected = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  if (readFileSync(checksumPath, 'utf8') !== expected) {
    reject('SHA256SUMS must contain the exact ordered SDK release evidence artifact set');
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
  const expected = [...sdkReleaseEvidenceArtifactNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    reject(`evidence directory files must be exactly ${expected.join(', ')}`);
  }
}

function contractAssertions() {
  return {
    generatedSDKDriftChecked: true,
    releaseManifestDeterministic: true,
    openAPIHashBound: true,
    generatedClientHashBound: true,
    goModuleHashBound: true,
    releaseSourceCommitBound: true,
    operationMetadataBound: true,
    documentationVersionBound: true,
    publicationNotChecked: true,
  };
}

export function buildSDKReleaseEvidenceReport({ repositoryRoot, evidenceRoot, execution }) {
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
  return {
    schemaVersion: sdkReleaseEvidenceSchemaVersion,
    generatedAt: checkedExecution.completedAt,
    scope: 'local_sdk_release_readiness_contract',
    status,
    command: ['node', ...sdkReleaseEvidenceArguments],
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
      processTimeoutMs: sdkReleaseProcessTimeoutMs,
      projects: projectSummaries(repositoryRoot, status === 'passed'),
      assertions: contractAssertions(),
    },
    source: collectSource(repositoryRoot),
    artifacts: {
      stdout: describeArtifact(evidenceRoot, 'verification-output.txt'),
      stderr: describeArtifact(evidenceRoot, 'verification-error.txt'),
      status: describeArtifact(evidenceRoot, 'verification-status.txt'),
    },
    limitations: [...sdkReleaseEvidenceLimitations],
  };
}

export function writeSDKReleaseEvidenceChecksums(evidenceRoot) {
  const content = checksumArtifactNames
    .map((name) => `${hashFile(path.join(evidenceRoot, name))}  ${name}\n`)
    .join('');
  writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), content, 'utf8');
}

export function verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot }) {
  verifyDirectory(evidenceRoot);
  const report = requireExactKeys(
    parseJSON(path.join(evidenceRoot, 'report.json'), 'report.json'),
    [
      'artifacts', 'command', 'contract', 'execution', 'generatedAt', 'limitations', 'repository',
      'runtime', 'schemaVersion', 'scope', 'source', 'status', 'workingDirectory',
    ],
    'report',
  );
  if (report.schemaVersion !== sdkReleaseEvidenceSchemaVersion) {
    reject(`report.schemaVersion must equal ${sdkReleaseEvidenceSchemaVersion}`);
  }
  if (report.scope !== 'local_sdk_release_readiness_contract' || report.workingDirectory !== '.') {
    reject('report must identify the fixed local SDK release readiness contract');
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
  if (JSON.stringify(report.command) !== JSON.stringify(['node', ...sdkReleaseEvidenceArguments])) {
    reject('report.command must match the fixed SDK release readiness command');
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
    ['assertions', 'processTimeoutMs', 'projects'],
    'report.contract',
  );
  if (contract.processTimeoutMs !== sdkReleaseProcessTimeoutMs) {
    reject('report.contract.processTimeoutMs does not match the fixed execution budget');
  }
  const expectedProjects = projectSummaries(repositoryRoot, report.status === 'passed');
  if (JSON.stringify(contract.projects) !== JSON.stringify(expectedProjects)) {
    reject('report.contract.projects does not match the fixed SDK release project matrix');
  }
  const assertions = requireExactKeys(
    contract.assertions,
    Object.keys(contractAssertions()),
    'report.contract.assertions',
  );
  if (JSON.stringify(assertions) !== JSON.stringify(contractAssertions())) {
    reject('report.contract.assertions must match the fixed SDK release readiness assertions');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(sdkReleaseEvidenceLimitations)) {
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
    artifactPaths: sdkReleaseEvidenceArtifactNames.map((name) =>
      repositoryRelativePath(repositoryRoot, path.join(evidenceRoot, name))),
  };
}
