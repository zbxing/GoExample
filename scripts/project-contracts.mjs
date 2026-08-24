import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readProjectManifest,
  resolveRef,
  selectProject,
  validateProjectContracts,
} from './lib/project-contracts.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`Project contracts: ${message}`);
  process.exit(1);
}

function parseArguments(args) {
  const options = { task: args[0] ?? 'check', project: null, fetchRemote: false };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    const [name, inlineValue] = argument.split('=', 2);
    if (name === '--fetch') {
      if (inlineValue !== undefined) {
        fail('--fetch does not accept a value');
      }
      options.fetchRemote = true;
      continue;
    }
    if (name !== '--project') {
      fail(`unknown argument ${argument}`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) {
      fail('--project requires a value');
    }
    options.project = value;
  }
  if (!['check', 'materialize', 'resolve'].includes(options.task)) {
    fail(`unknown task ${options.task}; expected check, materialize, or resolve`);
  }
  if (options.task === 'resolve' && !options.project) {
    fail('resolve requires --project');
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
try {
  if (options.task === 'resolve') {
    const manifest = readProjectManifest(repositoryRoot);
    const entry = selectProject(manifest, options.project);
    if (entry.contract.repository === 'workspace') {
      console.log(`${entry.projectPath}: workspace (no external ref to resolve)`);
    } else {
      const commit = resolveRef(repositoryRoot, entry.contract.repository, entry.contract.ref);
      if (commit !== entry.contract.resolvedCommit) {
        fail(`${entry.projectPath} ${entry.contract.ref} resolves to ${commit}, expected pinned ${entry.contract.resolvedCommit}`);
      }
      console.log(`${entry.projectPath}: ${entry.contract.ref} -> ${commit}`);
    }
  } else {
    const result = validateProjectContracts(repositoryRoot, {
      project: options.project,
      fetchRemote: options.fetchRemote || options.task === 'materialize',
    });
    for (const { entry, source, content, commit } of result.projects) {
      const operationCount = Object.values(JSON.parse(content).paths ?? {})
        .reduce((count, item) => count + ['get', 'post', 'put', 'patch', 'delete'].filter((method) => item[method]).length, 0);
      console.log(`${entry.projectPath}: ${source} (${commit ?? 'worktree'}, ${operationCount} operations)`);
    }
  }
} catch (error) {
  fail(error.message);
}
