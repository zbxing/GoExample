import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileAtomicallySync } from './atomic-output.mjs';
import {
  maximumCommandDurationMs,
  runBoundedCommand,
} from './bounded-command.mjs';

export const PROJECT_CONTRACT_MANIFEST = 'contracts/projects.json';
export const MANAGED_SERVICE_ROOTS = ['Solutions', 'Services'];
const SHA256 = /^[a-f0-9]{40}$/;
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REFS = /^refs\/(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DOCUMENT_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const monotonicNow = () => performance.now();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Project contract manifest: ${message}`);
}

function normalizedRelativePath(value, field) {
  if (typeof value !== 'string' || value.trim() !== value || !value || path.isAbsolute(value)) {
    fail(`${field} must be a relative POSIX path`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (!DOCUMENT_PATH.test(normalized) || normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    fail(`${field} contains an unsafe path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function projectName(projectPath) {
  const parts = projectPath.split('/');
  return parts.at(-1);
}

function normalizeRef(value, field = 'ref') {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${field} must be a non-empty string`);
  }
  if (value === 'worktree') {
    return value;
  }
  if (!REFS.test(value)) {
    fail(`${field} must be worktree or an exact refs/heads/* or refs/tags/* ref`);
  }
  return value;
}

function normalizeRepository(value) {
  if (value === 'workspace') {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    fail('contract.repository must be workspace, a local path, or an HTTPS/SSH Git URL');
  }
  if (value.startsWith('-')) {
    fail('contract.repository cannot start with a dash');
  }
  if (CONTROL_CHARACTER.test(value)) {
    fail('contract.repository cannot contain control characters');
  }
  if (/^https:\/\//i.test(value)) {
    let repositoryURL;
    try {
      repositoryURL = new URL(value);
    } catch {
      fail('contract.repository must contain a valid HTTPS Git URL');
    }
    if (
      repositoryURL.username ||
      repositoryURL.password ||
      repositoryURL.search ||
      repositoryURL.hash
    ) {
      fail('contract.repository HTTPS URL cannot contain credentials, a query, or a fragment');
    }
    return value;
  }
  if (/^ssh:\/\//i.test(value) || /^git@[^:]+:.+/.test(value)) {
    return value;
  }
  if (path.isAbsolute(value) || value.startsWith('./') || value.startsWith('../')) {
    return value.replaceAll('\\', '/');
  }
  fail(`contract.repository must be workspace, a URL, or an explicit local path: ${JSON.stringify(value)}`);
}

function normalizeSDK(sdk, projectPath) {
  if (!isObject(sdk)) {
    fail(`${projectPath}.sdk must be an object`);
  }
  const sdkPath = normalizedRelativePath(sdk.path, `${projectPath}.sdk.path`);
  if (!sdkPath.startsWith('SDK/')) {
    fail(`${projectPath}.sdk.path must stay under SDK/`);
  }
  if (typeof sdk.package !== 'string' || !/^[a-z][a-z0-9_]*$/.test(sdk.package)) {
    fail(`${projectPath}.sdk.package must be a lower-case Go package name`);
  }
  return { path: sdkPath, package: sdk.package };
}

export function normalizeProjectEntry(entry, repositoryRoot) {
  if (!isObject(entry)) {
    fail('each project entry must be an object');
  }
  const projectPath = normalizedRelativePath(entry.projectPath, 'projectPath');
  const projectSegments = projectPath.split('/');
  if (projectSegments.length !== 2 || !MANAGED_SERVICE_ROOTS.includes(projectSegments[0])) {
    fail(`${projectPath}.projectPath must identify exactly one Solutions/<name> or Services/<name> directory`);
  }
  const name = projectName(projectPath);
  if (!PROJECT_NAME.test(name)) {
    fail(`${projectPath}.projectPath contains an unsafe project name`);
  }
  if (!isObject(entry.contract)) {
    fail(`${projectPath}.contract must be an object`);
  }
  const repository = normalizeRepository(entry.contract.repository);
  const ref = normalizeRef(entry.contract.ref, `${projectPath}.contract.ref`);
  const document = normalizedRelativePath(entry.contract.document, `${projectPath}.contract.document`);
  const resolvedCommit = entry.contract.resolvedCommit ?? null;
  if (repository !== 'workspace') {
    if (ref === 'worktree') {
      fail(`${projectPath}.contract.ref cannot be worktree for a remote contract`);
    }
    if (typeof resolvedCommit !== 'string' || !SHA256.test(resolvedCommit)) {
      fail(`${projectPath}.contract.resolvedCommit must be a 40-character lower-case commit SHA for remote contracts`);
    }
  } else if (resolvedCommit !== null && (typeof resolvedCommit !== 'string' || !SHA256.test(resolvedCommit))) {
    fail(`${projectPath}.contract.resolvedCommit must be null or a 40-character lower-case commit SHA`);
  }
  const sdk = normalizeSDK(entry.sdk, projectPath);
  const projectRoot = path.resolve(repositoryRoot, projectPath);
  const managedRoots = MANAGED_SERVICE_ROOTS.map((root) => path.resolve(repositoryRoot, root));
  if (!managedRoots.some((root) => projectRoot.startsWith(`${root}${path.sep}`))) {
    fail(`${projectPath}.projectPath resolves outside Solutions/ or Services/`);
  }
  if (!existsSync(path.join(projectRoot, 'go.mod'))) {
    fail(`${projectPath}.projectPath must contain go.mod`);
  }
  const sdkRoot = path.resolve(repositoryRoot, sdk.path);
  if (!sdkRoot.startsWith(`${path.resolve(repositoryRoot, 'SDK')}${path.sep}`)) {
    fail(`${projectPath}.sdk.path resolves outside SDK/`);
  }
  if (!existsSync(path.join(sdkRoot, 'go.mod'))) {
    fail(`${projectPath}.sdk.path must contain go.mod`);
  }
  return {
    name,
    projectPath,
    contract: { repository, ref, document, resolvedCommit },
    sdk,
  };
}

export function readProjectManifest(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, PROJECT_CONTRACT_MANIFEST);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${PROJECT_CONTRACT_MANIFEST}: ${error.message}`);
  }
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    fail('manifest must contain version 1 and a projects array');
  }
  if (parsed.projects.length === 0) {
    fail('projects array cannot be empty');
  }
  const entries = parsed.projects.map((entry) => normalizeProjectEntry(entry, repositoryRoot));
  const seenProjects = new Set();
  const seenSDKs = new Set();
  for (const entry of entries) {
    if (seenProjects.has(entry.projectPath)) {
      fail(`duplicate projectPath ${entry.projectPath}`);
    }
    if (seenSDKs.has(entry.sdk.path)) {
      fail(`duplicate sdk.path ${entry.sdk.path}`);
    }
    seenProjects.add(entry.projectPath);
    seenSDKs.add(entry.sdk.path);
  }
  return { version: parsed.version, projects: entries };
}

export function selectProject(manifest, selector = 'Example') {
  const normalized = selector.replaceAll('\\', '/');
  const name = normalized.split('/').at(-1);
  const match = manifest.projects.find((entry) => entry.name === name || entry.projectPath === normalized);
  if (!match) {
    fail(`project ${JSON.stringify(selector)} is not listed in ${PROJECT_CONTRACT_MANIFEST}`);
  }
  return match;
}

function validateProjectContractGitDuration(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > maximumCommandDurationMs
  ) {
    throw new RangeError(
      `Project contract Git timeout must be a safe integer between 1 and ${maximumCommandDurationMs} milliseconds`,
    );
  }
}

function readProjectContractGitClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Project contract Git clock must return a finite number');
  }
  return timestamp;
}

function remainingProjectContractGitDuration(deadline, timeoutMs, now) {
  const remaining = Math.min(timeoutMs, Math.ceil(deadline - readProjectContractGitClock(now)));
  return remaining > 0 ? remaining : null;
}

export function createProjectContractGitRunner(repositoryRoot, {
  run = runBoundedCommand,
  now = monotonicNow,
  timeoutMs = maximumCommandDurationMs,
} = {}) {
  validateProjectContractGitDuration(timeoutMs);
  if (typeof run !== 'function' || typeof now !== 'function') {
    throw new TypeError('Project contract Git runner and clock must be functions');
  }
  const deadline = readProjectContractGitClock(now) + timeoutMs;
  const environment = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  };

  return (args, { allowFailure = false } = {}) => {
    const remainingTimeoutMs = remainingProjectContractGitDuration(deadline, timeoutMs, now);
    let output = null;
    if (remainingTimeoutMs !== null) {
      try {
        output = run('git', args, {
          cwd: repositoryRoot,
          env: environment,
          raw: true,
          timeoutMs: remainingTimeoutMs,
        });
      } catch {
        output = null;
      }
    }
    if (output === null && !allowFailure) {
      fail(`git ${args[0] ?? 'command'} failed within the ${timeoutMs} ms total budget`);
    }
    return output;
  };
}

function cacheRoot(repositoryRoot, entry) {
  const key = createHash('sha256').update(entry.contract.repository).digest('hex').slice(0, 24);
  return path.join(repositoryRoot, '.temp', 'contracts', '.git', key);
}

function materializedPath(repositoryRoot, entry) {
  return path.join(
    repositoryRoot,
    '.temp',
    'contracts',
    entry.name,
    entry.contract.resolvedCommit,
    entry.contract.document.replaceAll('/', path.sep),
  );
}

function ensureCommit(repositoryRoot, entry, gitRunner, { fetchRemote, verifyRef = true } = {}) {
  const cache = cacheRoot(repositoryRoot, entry);
  if (fetchRemote && verifyRef) {
    const resolved = resolveRef(repositoryRoot, entry.contract.repository, entry.contract.ref, { gitRunner });
    if (resolved !== entry.contract.resolvedCommit) {
      fail(`${entry.projectPath} ${entry.contract.ref} resolves to ${resolved}, expected pinned ${entry.contract.resolvedCommit}`);
    }
  }
  if (!existsSync(cache)) {
    if (!fetchRemote) {
      fail(`${entry.projectPath} external contract is not materialized; run yarn contracts:materialize --project ${entry.name} --fetch`);
    }
    mkdirSync(path.dirname(cache), { recursive: true });
    gitRunner(['init', '--bare', cache]);
  }
  const check = gitRunner(['--git-dir', cache, 'cat-file', '-e', `${entry.contract.resolvedCommit}^{commit}`], { allowFailure: true });
  if (check === null && fetchRemote) {
    const fetchTarget = verifyRef ? entry.contract.ref : entry.contract.resolvedCommit;
    gitRunner(['--git-dir', cache, 'fetch', '--no-tags', '--depth=1', entry.contract.repository, fetchTarget]);
  }
  const verified = gitRunner(['--git-dir', cache, 'cat-file', '-e', `${entry.contract.resolvedCommit}^{commit}`], { allowFailure: true });
  if (verified === null) {
    fail(`${entry.projectPath} contract commit ${entry.contract.resolvedCommit} is unavailable locally`);
  }
  return cache;
}

export function resolveProjectDocument(repositoryRoot, entry, {
  fetchRemote = false,
  verifyRef = true,
  gitRef = null,
  gitRunner = null,
  writeOutput = writeFileAtomicallySync,
} = {}) {
  const contract = entry.contract;
  const runGit = () => gitRunner ?? createProjectContractGitRunner(repositoryRoot);
  if (contract.repository === 'workspace') {
    const workspacePath = path.resolve(repositoryRoot, contract.document);
    if (gitRef) {
      const result = runGit()(['show', `${gitRef}:${contract.document}`]);
      return {
        content: result,
        source: `${gitRef}:${contract.document}`,
        path: workspacePath,
        commit: null,
      };
    }
    if (!workspacePath.startsWith(`${repositoryRoot}${path.sep}`) || !existsSync(workspacePath)) {
      fail(`${entry.projectPath} workspace contract document does not exist: ${contract.document}`);
    }
    return {
      content: readFileSync(workspacePath, 'utf8'),
      source: contract.document,
      path: workspacePath,
      commit: contract.resolvedCommit,
    };
  }
  const projectGitRunner = runGit();
  const cache = ensureCommit(repositoryRoot, entry, projectGitRunner, { fetchRemote, verifyRef });
  const result = projectGitRunner(['--git-dir', cache, 'show', `${contract.resolvedCommit}:${contract.document}`]);
  const target = materializedPath(repositoryRoot, entry);
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target) || readFileSync(target, 'utf8') !== result) {
    writeOutput(target, result, { encoding: 'utf8' });
  }
  return {
    content: result,
    source: `${contract.repository}@${contract.ref}#${contract.resolvedCommit}:${contract.document}`,
    path: target,
    commit: contract.resolvedCommit,
  };
}

export function resolveRef(repositoryRoot, repository, ref, { gitRunner = null } = {}) {
  if (repository === 'workspace') {
    return null;
  }
  if (!REFS.test(ref)) {
    fail(`cannot resolve non-pinned ref ${ref}`);
  }
  const result = (gitRunner ?? createProjectContractGitRunner(repositoryRoot))(
    ['ls-remote', repository, ref, `${ref}^{}`],
  );
  const commits = result
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter((value) => SHA256.test(value));
  const commit = commits.at(-1);
  if (!commit) {
    fail(`${repository} does not expose ${ref}`);
  }
  return commit;
}

export function assertOpenAPIDocument(content, source) {
  let document;
  try {
    document = JSON.parse(content);
  } catch (error) {
    fail(`${source} is not valid JSON: ${error.message}`);
  }
  if (!isObject(document) || typeof document.openapi !== 'string' || !document.openapi.startsWith('3.')) {
    fail(`${source} must be an OpenAPI 3.x document`);
  }
  if (!isObject(document.info) || typeof document.info.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(document.info.version)) {
    fail(`${source} must declare an exact semantic info.version`);
  }
  if (!isObject(document.paths)) {
    fail(`${source} must define a paths object`);
  }
  return document;
}

export function validateProjectContracts(repositoryRoot, {
  project = null,
  fetchRemote = false,
  gitRunner = null,
} = {}) {
  const manifest = readProjectManifest(repositoryRoot);
  const selected = project ? [selectProject(manifest, project)] : manifest.projects;
  const projectGitRunner = gitRunner ?? createProjectContractGitRunner(repositoryRoot);
  const resolved = selected.map((entry) => {
    const document = resolveProjectDocument(repositoryRoot, entry, {
      fetchRemote,
      gitRunner: projectGitRunner,
    });
    assertOpenAPIDocument(document.content, document.source);
    return { entry, ...document };
  });
  return { manifest, projects: resolved };
}
