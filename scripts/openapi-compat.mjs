import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOpenAPIBreakingChanges } from './lib/openapi-compat.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDocument = 'docs/openapi/openapi.json';

function fail(message) {
  console.error(`OpenAPI compatibility: ${message}`);
  process.exit(1);
}

function parseArguments(args) {
  const options = { base: null, baseRef: null, current: defaultDocument };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [name, inlineValue] = argument.split('=', 2);
    if (!['--base', '--base-ref', '--current'].includes(name)) {
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

function readFromGit(reference) {
  const result = spawnSync('git', ['show', `${reference}:${defaultDocument}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`cannot read ${defaultDocument} from ${reference}: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout;
}

const options = parseArguments(process.argv.slice(2));
const baselineSource = options.base ?? `${options.baseRef}:${defaultDocument}`;
const baselineContent = options.base === null ? readFromGit(options.baseRef) : readRepositoryFile(options.base);
const currentContent = readRepositoryFile(options.current);

let issues;
try {
  issues = findOpenAPIBreakingChanges(
    parseDocument(baselineContent, baselineSource),
    parseDocument(currentContent, options.current),
  );
} catch (error) {
  fail(error.message);
}

if (issues.length > 0) {
  console.error(`OpenAPI compatibility: ${issues.length} breaking change(s) found:`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`OpenAPI compatibility: ${options.current} is backward compatible with ${baselineSource}`);
