import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOpenAPIBreakingChanges } from './lib/openapi-compat.mjs';
import {
  normalizeProjectEntry,
  readProjectManifest,
  resolveProjectDocument,
  selectProject,
} from './lib/project-contracts.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDocument = 'docs/openapi/openapi.json';

function fail(message) {
  console.error(`OpenAPI compatibility: ${message}`);
  process.exit(1);
}

function parseArguments(args) {
  const options = { base: null, baseRef: null, current: defaultDocument, project: null, allProjects: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [name, inlineValue] = argument.split('=', 2);
    if (name === '--all-projects') {
      if (inlineValue !== undefined) {
        fail('--all-projects does not accept a value');
      }
      options.allProjects = true;
      continue;
    }
    if (!['--base', '--base-ref', '--current', '--project'].includes(name)) {
      fail(`unknown argument ${argument}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (!value || value.startsWith('--')) {
      fail(`${name} requires a value`);
    }
    options[name === '--base-ref' ? 'baseRef' : name.slice(2)] = value;
  }
  if ((options.base === null) === (options.baseRef === null)) {
    fail('specify exactly one of --base or --base-ref');
  }
  if (options.allProjects && (options.project !== null || options.base !== null)) {
    fail('--all-projects requires --base-ref and cannot be combined with --project or --base');
  }
  return options;
}

function parseDocument(content, source) {
  try {
    return JSON.parse(content);
  } catch (error) {
    fail(`${source} is not valid JSON: ${error.message}`);
  }
}

function readRepositoryFile(requestedPath) {
  const absolutePath = path.resolve(repositoryRoot, requestedPath);
  const relative = path.relative(repositoryRoot, absolutePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`path must identify a file inside the repository: ${requestedPath}`);
  }
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    fail(`cannot read ${requestedPath}: ${error.message}`);
  }
}

function readFromGitPath(reference, requestedPath, { optional = false } = {}) {
  const result = spawnSync('git', ['show', `${reference}:${requestedPath}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (optional) {
      return null;
    }
    fail(`cannot read ${requestedPath} from ${reference}: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout;
}

function readManifestAtRef(reference) {
  const content = readFromGitPath(reference, 'contracts/projects.json', { optional: true });
  if (content === null) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    fail(`cannot parse project contract manifest from ${reference}: ${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    fail(`project contract manifest at ${reference} is invalid`);
  }
  return parsed;
}

function rawProjectEntry(manifest, selector) {
  const normalized = selector.replaceAll('\\', '/');
  return manifest.projects.find((entry) => (
    entry?.projectPath === normalized
    || entry?.projectPath === `Proj/${normalized.replace(/^Proj\//, '')}`
  ));
}

function currentProjectDocument(project) {
  try {
    return resolveProjectDocument(repositoryRoot, project, { fetchRemote: false });
  } catch (error) {
    fail(error.message);
  }
}

function baselineProjectDocument(project) {
  try {
    return resolveProjectDocument(repositoryRoot, project, { fetchRemote: true, verifyRef: false });
  } catch (error) {
    fail(`${project.projectPath} baseline materialization failed: ${error.message}`);
  }
}

function compareProject(project, currentDocument, baselineDocument) {
  let issues;
  try {
    issues = findOpenAPIBreakingChanges(
      parseDocument(baselineDocument.content, baselineDocument.source),
      parseDocument(currentDocument.content, currentDocument.source),
    );
  } catch (error) {
    fail(error.message);
  }
  if (issues.length > 0) {
    console.error(`OpenAPI compatibility: ${project.projectPath} has ${issues.length} breaking change(s):`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    return false;
  }
  console.log(`OpenAPI compatibility: ${project.projectPath} ${currentDocument.source} is backward compatible with ${baselineDocument.source}`);
  return true;
}

function baselineForProject(reference, project, baselineManifest) {
  if (project.contract.repository !== 'workspace') {
    return baselineProjectDocument(project);
  }
  return {
    content: readFromGitPath(reference, project.contract.document),
    source: `${reference}:${project.contract.document}`,
  };
}

const options = parseArguments(process.argv.slice(2));

if (options.allProjects) {
  let currentManifest;
  try {
    currentManifest = readProjectManifest(repositoryRoot);
  } catch (error) {
    fail(error.message);
  }
  const baselineManifest = readManifestAtRef(options.baseRef);
  let failed = false;
  for (const project of currentManifest.projects) {
    const currentDocument = currentProjectDocument(project);
    let baselineProject;
    if (baselineManifest) {
      const raw = rawProjectEntry(baselineManifest, project.projectPath);
      if (!raw) {
        console.log(`OpenAPI compatibility: ${project.projectPath} is new at ${options.baseRef}; no baseline comparison required`);
        continue;
      }
      try {
        baselineProject = normalizeProjectEntry(raw, repositoryRoot);
      } catch (error) {
        fail(`${project.projectPath} baseline manifest entry is invalid: ${error.message}`);
      }
    } else if (project.name === 'Example') {
      baselineProject = { ...project, contract: { repository: 'workspace', ref: 'worktree', document: defaultDocument, resolvedCommit: null } };
    } else {
      console.log(`OpenAPI compatibility: ${project.projectPath} is new at ${options.baseRef}; no baseline manifest exists`);
      continue;
    }
    const baselineDocument = baselineForProject(options.baseRef, baselineProject, baselineManifest);
    if (!compareProject(project, currentDocument, baselineDocument)) {
      failed = true;
    }
  }
  if (failed) {
    process.exit(1);
  }
  process.exit(0);
}

if (options.project) {
  let manifest;
  try {
    manifest = readProjectManifest(repositoryRoot);
  } catch (error) {
    fail(error.message);
  }
  const project = selectProject(manifest, options.project);
  const currentDocument = currentProjectDocument(project);
  let baselineDocument;
  if (options.base !== null) {
    baselineDocument = { content: readRepositoryFile(options.base), source: options.base };
  } else {
    const baselineManifest = readManifestAtRef(options.baseRef);
    if (!baselineManifest && project.name === 'Example') {
      baselineDocument = { content: readFromGitPath(options.baseRef, defaultDocument), source: `${options.baseRef}:${defaultDocument}` };
    } else if (!baselineManifest) {
      fail(`${project.projectPath} has no baseline project contract manifest at ${options.baseRef}`);
    } else {
      const raw = rawProjectEntry(baselineManifest, project.projectPath);
      if (!raw) {
        fail(`${project.projectPath} is not listed at ${options.baseRef}`);
      }
      const baselineProject = normalizeProjectEntry(raw, repositoryRoot);
      baselineDocument = baselineForProject(options.baseRef, baselineProject, baselineManifest);
    }
  }
  if (!compareProject(project, currentDocument, baselineDocument)) {
    process.exit(1);
  }
  process.exit(0);
}

const baselineDocument = options.base === null
  ? { content: readFromGitPath(options.baseRef, defaultDocument), source: `${options.baseRef}:${defaultDocument}` }
  : { content: readRepositoryFile(options.base), source: options.base };
const currentDocument = { content: readRepositoryFile(options.current), source: options.current };
if (!compareProject({ projectPath: 'workspace' }, currentDocument, baselineDocument)) {
  process.exit(1);
}
