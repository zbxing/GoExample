import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileAtomicallySync } from './atomic-output.mjs';
import { assertOpenAPIDocument, resolveProjectDocument } from './project-contracts.mjs';

export const SDK_RELEASE_MANIFEST_FILE = 'release-manifest.json';
export const sdkReleaseCheckTimeoutMs = 90_000;
export const sdkReleaseCheckMaximumOutputBytes = 4 * 1024 * 1024;
export const sdkReleaseCheckDiagnosticCharacterLimit = 4_096;

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const GO_MODULE = /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function fail(message) {
  throw new Error(`SDK release readiness: ${message}`);
}

function monotonicNow() {
  return performance.now();
}

function readSDKReleaseCheckClock(now) {
  if (typeof now !== 'function') {
    fail('SDK check clock must be a function');
  }
  const value = now();
  if (!Number.isFinite(value) || value < 0) {
    fail('SDK check clock must return a non-negative finite number');
  }
  return value;
}

function validateSDKReleaseCheckTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > sdkReleaseCheckTimeoutMs
  ) {
    fail(`SDK check timeout must be a safe integer between 1 and ${sdkReleaseCheckTimeoutMs} milliseconds`);
  }
}

function remainingSDKReleaseCheckDuration(deadline, timeoutMs, now) {
  const remaining = Math.min(timeoutMs, Math.ceil(deadline - readSDKReleaseCheckClock(now)));
  return remaining > 0 ? remaining : null;
}

function boundedSDKReleaseCheckDiagnostic(value) {
  const diagnostic = `${value ?? ''}`.trim();
  if (diagnostic.length <= sdkReleaseCheckDiagnosticCharacterLimit) {
    return diagnostic;
  }
  const suffix = '\n...[truncated]';
  return `${diagnostic.slice(0, sdkReleaseCheckDiagnosticCharacterLimit - suffix.length)}${suffix}`;
}

function sdkReleaseCheckFailureDetail(result, timeoutMs) {
  const errorCode = result?.error?.code;
  if (errorCode === 'ETIMEDOUT') {
    return `timed out within the remaining ${timeoutMs} ms budget`;
  }
  if (errorCode === 'ENOBUFS') {
    return `output exceeded ${sdkReleaseCheckMaximumOutputBytes} bytes`;
  }
  if (result?.signal) {
    return `terminated by signal ${result.signal}`;
  }

  const diagnostic = boundedSDKReleaseCheckDiagnostic(
    result?.stderr || result?.error?.message,
  );
  if (errorCode) {
    return `failed to start (${errorCode})${diagnostic ? `: ${diagnostic}` : ''}`;
  }
  if (Number.isSafeInteger(result?.status)) {
    return `exited with status ${result.status}${diagnostic ? `: ${diagnostic}` : ''}`;
  }
  return diagnostic ? `failed without an exit status: ${diagnostic}` : 'failed without an exit status';
}

export function createSDKReleaseCheckRunner({
  cwd,
  sdkScriptPath,
  executable = process.execPath,
  timeoutMs = sdkReleaseCheckTimeoutMs,
  spawn = spawnSync,
  now = monotonicNow,
} = {}) {
  validateSDKReleaseCheckTimeout(timeoutMs);
  if (typeof cwd !== 'string' || cwd.length === 0) {
    fail('SDK check cwd must be a non-empty string');
  }
  if (typeof sdkScriptPath !== 'string' || sdkScriptPath.length === 0) {
    fail('SDK check script path must be a non-empty string');
  }
  if (typeof executable !== 'string' || executable.length === 0) {
    fail('SDK check executable must be a non-empty string');
  }
  if (typeof spawn !== 'function') {
    fail('SDK check spawn must be a function');
  }

  const deadline = readSDKReleaseCheckClock(now) + timeoutMs;
  return function verifyGeneratedSDK(projectName) {
    if (typeof projectName !== 'string' || projectName.length === 0) {
      fail('SDK check project name must be a non-empty string');
    }
    const remainingTimeoutMs = remainingSDKReleaseCheckDuration(deadline, timeoutMs, now);
    if (remainingTimeoutMs === null) {
      fail(`generated SDK check budget was exhausted before ${projectName}`);
    }

    let result;
    try {
      result = spawn(
        executable,
        [sdkScriptPath, 'check', '--project', projectName],
        {
          cwd,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
          maxBuffer: sdkReleaseCheckMaximumOutputBytes,
          timeout: remainingTimeoutMs,
          killSignal: 'SIGTERM',
        },
      );
    } catch (error) {
      result = { status: null, error };
    }
    if (result?.status === 0 && !result.error && !result.signal) {
      return;
    }
    fail(
      `generated SDK check failed for ${projectName}: ${sdkReleaseCheckFailureDetail(result, remainingTimeoutMs)}`,
    );
  };
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function requiredFile(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} is missing: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function escapeRegularExpression(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function readModulePath(goMod, sdkPath) {
  const match = goMod.match(/^module\s+([^\s]+)\s*$/m);
  if (!match || !GO_MODULE.test(match[1]) || match[1].includes('//')) {
    fail(`${sdkPath}/go.mod must declare a valid module path`);
  }
  const modulePath = match[1];
  const expectedSuffix = `/${sdkPath}`;
  if (!modulePath.endsWith(expectedSuffix)) {
    fail(`${sdkPath}/go.mod module ${modulePath} must end with ${expectedSuffix}`);
  }
  return modulePath;
}

function readReleaseDocumentation(sdkRoot, sdkPath, version) {
  const readme = requiredFile(path.join(sdkRoot, 'README.md'), `${sdkPath} README`);
  const versionStatement = `Current SDK version: \`${version}\`.`;
  if (!readme.includes(versionStatement)) {
    fail(`${sdkPath}/README.md must contain ${versionStatement}`);
  }

  const changelog = requiredFile(path.join(sdkRoot, 'CHANGELOG.md'), `${sdkPath} changelog`);
  const versionHeading = new RegExp(
    `^##\\s+(?:\\[)?${escapeRegularExpression(version)}(?:\\])?(?:\\s|$)`,
    'm',
  );
  if (!/^##\s+Unreleased(?:\s|$)/m.test(changelog) && !versionHeading.test(changelog)) {
    fail(`${sdkPath}/CHANGELOG.md must contain an Unreleased section or a ${version} release entry`);
  }
}

function collectOperations(document, source) {
  const operations = [];
  const seen = new Set();
  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      if (!operation || typeof operation !== 'object' || typeof operation.operationId !== 'string') {
        fail(`${source} has an operation without an operationId at ${method.toUpperCase()} ${routePath}`);
      }
      if (seen.has(operation.operationId)) {
        fail(`${source} repeats operationId ${operation.operationId}`);
      }
      seen.add(operation.operationId);
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path: routePath,
        deprecated: operation.deprecated === true,
      });
    }
  }
  if (operations.length === 0) {
    fail(`${source} has no publishable operations`);
  }
  return operations;
}

function validateGeneratedClient(client, sdkPath, sourceHash, version) {
  const sourceMatch = client.match(/^\/\/ Source SHA-256: ([a-f0-9]{64})$/m);
  if (!sourceMatch) {
    fail(`${sdkPath}/client.gen.go is missing its source SHA-256 header`);
  }
  if (sourceMatch[1] !== sourceHash) {
    fail(`${sdkPath}/client.gen.go source SHA-256 does not match its OpenAPI document`);
  }
  if (!client.includes(`const APIVersion = ${JSON.stringify(version)}`)) {
    fail(`${sdkPath}/client.gen.go API version does not match ${version}`);
  }
}

export function buildSDKReleaseManifest(repositoryRoot, project, { sourceCommit } = {}) {
  if (!COMMIT.test(sourceCommit ?? '')) {
    fail('sourceCommit must be a full lower-case Git commit SHA');
  }

  const sdkRoot = path.join(repositoryRoot, project.sdk.path);
  const sourceDocument = resolveProjectDocument(repositoryRoot, project);
  const document = assertOpenAPIDocument(sourceDocument.content, sourceDocument.source);
  const version = requiredFile(path.join(sdkRoot, 'VERSION'), `${project.sdk.path} version`).trim();
  if (!SEMVER.test(version)) {
    fail(`${project.sdk.path}/VERSION must contain an exact semantic version`);
  }
  if (version !== document.info.version) {
    fail(`${project.sdk.path}/VERSION ${version} does not match OpenAPI ${document.info.version}`);
  }

  const goMod = requiredFile(path.join(sdkRoot, 'go.mod'), `${project.sdk.path} go.mod`);
  const modulePath = readModulePath(goMod, project.sdk.path);
  const sourceHash = hash(sourceDocument.content);
  const client = requiredFile(path.join(sdkRoot, 'client.gen.go'), `${project.sdk.path} generated client`);
  validateGeneratedClient(client, project.sdk.path, sourceHash, version);
  readReleaseDocumentation(sdkRoot, project.sdk.path, version);
  const operations = collectOperations(document, sourceDocument.source);

  return {
    schemaVersion: 1,
    project: project.name,
    projectPath: project.projectPath,
    sdkPath: project.sdk.path,
    modulePath,
    sdkVersion: version,
    sourceCommit,
    expectedTag: `${project.sdk.path}/v${version}`,
    publication: 'not_checked',
    openapi: {
      source: sourceDocument.source,
      sha256: sourceHash,
      version: document.info.version,
      operationCount: operations.length,
      operations,
    },
    artifacts: {
      generatedClient: {
        path: 'client.gen.go',
        sha256: hash(client),
      },
      goMod: {
        path: 'go.mod',
        sha256: hash(goMod),
      },
    },
  };
}

function manifestPath(repositoryRoot, project) {
  return path.join(repositoryRoot, project.sdk.path, SDK_RELEASE_MANIFEST_FILE);
}

function encodedManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeSDKReleaseManifest(
  repositoryRoot,
  project,
  manifest,
  writeOutput = writeFileAtomicallySync,
) {
  writeOutput(manifestPath(repositoryRoot, project), encodedManifest(manifest), { encoding: 'utf8' });
}

export function verifySDKReleaseManifest(repositoryRoot, project, manifest) {
  const filePath = manifestPath(repositoryRoot, project);
  const actual = requiredFile(filePath, `${project.sdk.path} release manifest`);
  const expected = encodedManifest(manifest);
  if (actual !== expected) {
    fail(`${project.sdk.path}/${SDK_RELEASE_MANIFEST_FILE} is stale or has been modified; run yarn sdk:release:prepare`);
  }
}

export function assertReleaseManifestHashes(manifest) {
  if (!SHA256.test(manifest.openapi?.sha256 ?? '')) {
    fail('manifest OpenAPI SHA-256 is invalid');
  }
  for (const artifact of Object.values(manifest.artifacts ?? {})) {
    if (!SHA256.test(artifact?.sha256 ?? '')) {
      fail('manifest artifact SHA-256 is invalid');
    }
  }
}
