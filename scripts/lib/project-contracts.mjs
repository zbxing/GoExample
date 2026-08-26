import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const PROJECT_CONTRACT_MANIFEST = 'contracts/projects.json';
export const MANAGED_SERVICE_ROOTS = ['Solutions', 'Services'];
const SHA256 = /^[a-f0-9]{40}$/;
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REFS = /^refs\/(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DOCUMENT_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

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
  if (/^https:\/\//i.test(value) || /^ssh:\/\//i.test(value) || /^git@[^:]+:.+/.test(value)) {
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

function git(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(`git ${args[0] ?? ''} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
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

function ensureCommit(repositoryRoot, entry, { fetchRemote, verifyRef = true } = {}) {
  const cache = cacheRoot(repositoryRoot, entry);
  if (fetchRemote && verifyRef) {
    const resolved = resolveRef(repositoryRoot, entry.contract.repository, entry.contract.ref);
    if (resolved !== entry.contract.resolvedCommit) {
      fail(`${entry.projectPath} ${entry.contract.ref} resolves to ${resolved}, expected pinned ${entry.contract.resolvedCommit}`);
    }
  }
  if (!existsSync(cache)) {
    if (!fetchRemote) {
      fail(`${entry.projectPath} external contract is not materialized; run yarn contracts:materialize --project ${entry.name} --fetch`);
    }
    mkdirSync(path.dirname(cache), { recursive: true });
    git(repositoryRoot, ['init', '--bare', cache]);
  }
  const check = git(repositoryRoot, ['--git-dir', cache, 'cat-file', '-e', `${entry.contract.resolvedCommit}^{commit}`], { allowFailure: true });
  if (check.status !== 0 && fetchRemote) {
    const fetchTarget = verifyRef ? entry.contract.ref : entry.contract.resolvedCommit;
    git(repositoryRoot, ['--git-dir', cache, 'fetch', '--no-tags', '--depth=1', entry.contract.repository, fetchTarget]);
  }
  const verified = git(repositoryRoot, ['--git-dir', cache, 'cat-file', '-e', `${entry.contract.resolvedCommit}^{commit}`], { allowFailure: true });
  if (verified.status !== 0) {
    fail(`${entry.projectPath} contract commit ${entry.contract.resolvedCommit} is unavailable locally`);
  }
  return cache;
}

export function resolveProjectDocument(repositoryRoot, entry, { fetchRemote = false, verifyRef = true, gitRef = null } = {}) {
  const contract = entry.contract;
  if (contract.repository === 'workspace') {
    const workspacePath = path.resolve(repositoryRoot, contract.document);
    if (gitRef) {
      const result = git(repositoryRoot, ['show', `${gitRef}:${contract.document}`]);
      return {
        content: result.stdout,
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
  const cache = ensureCommit(repositoryRoot, entry, { fetchRemote, verifyRef });
  const result = git(repositoryRoot, ['--git-dir', cache, 'show', `${contract.resolvedCommit}:${contract.document}`]);
  const target = materializedPath(repositoryRoot, entry);
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target) || readFileSync(target, 'utf8') !== result.stdout) {
    writeFileSync(target, result.stdout, 'utf8');
  }
  return {
    content: result.stdout,
    source: `${contract.repository}@${contract.ref}#${contract.resolvedCommit}:${contract.document}`,
    path: target,
    commit: contract.resolvedCommit,
  };
}

export function resolveRef(repositoryRoot, repository, ref) {
  if (repository === 'workspace') {
    return null;
  }
  if (!REFS.test(ref)) {
    fail(`cannot resolve non-pinned ref ${ref}`);
  }
  const result = git(repositoryRoot, ['ls-remote', repository, ref, `${ref}^{}`]);
  const commits = result.stdout
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

export function validateProjectContracts(repositoryRoot, { project = null, fetchRemote = false } = {}) {
  const manifest = readProjectManifest(repositoryRoot);
  const selected = project ? [selectProject(manifest, project)] : manifest.projects;
  const resolved = selected.map((entry) => {
    const document = resolveProjectDocument(repositoryRoot, entry, { fetchRemote });
    assertOpenAPIDocument(document.content, document.source);
    return { entry, ...document };
  });
  return { manifest, projects: resolved };
}
