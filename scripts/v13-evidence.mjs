import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultIndex = path.join(tempRoot, 'evidence', 'v13.json');
const statusValues = new Set(['not_recorded', 'recorded', 'failed']);
const packageScopes = new Map([
  ['V13-01', 'target edge and protocol evidence'],
  ['V13-02', 'target Redis HA and recovery evidence'],
  ['V13-03', 'production identity and policy evidence'],
  ['V13-04', 'production audit closure evidence'],
  ['V13-05', 'target database and messaging evidence'],
  ['V13-06', 'remote performance and capacity evidence'],
  ['V13-07', 'orchestration and signed release evidence'],
  ['V13-08', 'second consumer and SDK migration evidence'],
  ['V13-09', 'target soak, fault, and RPO/RTO evidence'],
]);
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`V13 evidence: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', shell: false, windowsHide: true });
  return result.status === 0 ? `${result.stdout ?? ''}`.trim() || 'unknown' : 'unknown';
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const positional = args.filter((arg) => arg !== '--verify');
  if (positional.length > 1 || positional.some((arg) => arg.startsWith('--'))) {
    fail('usage: [--verify] [path]');
  }
  return { verify, file: path.resolve(repositoryRoot, positional[0] ?? path.relative(repositoryRoot, defaultIndex)) };
}

function ensureIndexPath(filePath) {
  const relative = path.relative(tempRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !relative.toLowerCase().endsWith('.json')) {
    fail('index must be a .json file inside the repository .temp directory');
  }
}

function skeleton() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: { gitCommit: run('git', ['rev-parse', 'HEAD']) },
    workPackages: [...packageScopes].map(([id, scope]) => ({
      id,
      scope,
      status: 'not_recorded',
      targetEnvironment: null,
      immutableVersion: null,
      runUrl: null,
      fingerprint: { runner: null, toolchain: null, environment: null },
      outputs: [],
      reason: 'No immutable target-environment run and archived artifact has been recorded.',
    })),
  };
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function requireString(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string${nullable ? ' or null' : ''}`);
}

function resolveArtifact(value, name) {
  requireString(value, name);
  if (value.includes('\\') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.normalize(value) !== value || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail(`${name} contains an unsafe path`);
  }
  if (!value.startsWith('.temp/')) fail(`${name} must be inside .temp`);
  const resolved = path.resolve(repositoryRoot, ...value.split('/'));
  const relative = path.relative(tempRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`${name} escapes .temp`);
  return resolved;
}

function verifyOutput(output, name) {
  const item = requireObject(output, name);
  const filePath = resolveArtifact(item.path, `${name}.path`);
  if (!existsSync(filePath)) fail(`${name} is missing: ${item.path}`);
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${name} must be a regular file: ${item.path}`);
  if (!Number.isSafeInteger(item.bytes) || item.bytes < 1) fail(`${name}.bytes must be a positive safe integer`);
  if (stats.size !== item.bytes) fail(`${name} size mismatch: ${item.path}`);
  if (typeof item.sha256 !== 'string' || !sha256Pattern.test(item.sha256)) fail(`${name}.sha256 must be a lowercase SHA-256 digest`);
  if (hashFile(filePath) !== item.sha256) fail(`${name} hash mismatch: ${item.path}`);
}

function verifyDocument(document) {
  requireObject(document, 'document');
  if (document.schemaVersion !== 1) fail('schemaVersion must be 1');
  requireString(document.generatedAt, 'generatedAt');
  const repository = requireObject(document.repository, 'repository');
  requireString(repository.gitCommit, 'repository.gitCommit');
  if (!Array.isArray(document.workPackages) || document.workPackages.length !== packageScopes.size) fail('workPackages must contain exactly V13-01 through V13-09');
  const seen = new Set();
  for (const [index, raw] of document.workPackages.entries()) {
    const item = requireObject(raw, `workPackages[${index}]`);
    const id = item.id;
    if (!packageScopes.has(id) || seen.has(id)) fail(`workPackages[${index}].id is not a unique V13 package`);
    seen.add(id);
    if (item.scope !== packageScopes.get(id)) fail(`${id}.scope does not match the fixed V13 scope`);
    if (!statusValues.has(item.status)) fail(`${id}.status must be recorded, failed, or not_recorded`);
    requireString(item.reason, `${id}.reason`);
    requireString(item.targetEnvironment, `${id}.targetEnvironment`, { nullable: true });
    requireString(item.immutableVersion, `${id}.immutableVersion`, { nullable: true });
    requireString(item.runUrl, `${id}.runUrl`, { nullable: true });
    const fingerprint = requireObject(item.fingerprint, `${id}.fingerprint`);
    for (const field of ['runner', 'toolchain', 'environment']) requireString(fingerprint[field], `${id}.fingerprint.${field}`, { nullable: true });
    if (!Array.isArray(item.outputs)) fail(`${id}.outputs must be an array`);
    const outputPaths = new Set();
    for (const [outputIndex, output] of item.outputs.entries()) {
      const outputName = `${id}.outputs[${outputIndex}]`;
      verifyOutput(output, outputName);
      if (outputPaths.has(output.path)) fail(`${id}.outputs contains a duplicate path`);
      outputPaths.add(output.path);
    }
    if (item.status === 'recorded') {
      if (item.targetEnvironment === null || /^local(?:$|[-_])/i.test(item.targetEnvironment)) fail(`${id} recorded requires a non-local targetEnvironment`);
      if (item.immutableVersion === null) fail(`${id} recorded requires immutableVersion`);
      if (item.runUrl === null || !/^https:\/\//.test(item.runUrl)) fail(`${id} recorded requires an https runUrl`);
      if (Object.values(fingerprint).some((value) => value === null)) fail(`${id} recorded requires a complete fingerprint`);
      if (item.outputs.length === 0) fail(`${id} recorded requires at least one archived output`);
    }
    if (item.status === 'not_recorded' && item.targetEnvironment !== null && !/^local(?:$|[-_])/i.test(item.targetEnvironment)) fail(`${id} not_recorded cannot claim a non-local target environment`);
  }
  if (seen.size !== packageScopes.size) fail('workPackages is missing a V13 package');
}

const { verify, file } = parseArgs();
ensureIndexPath(file);
if (verify) {
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) fail(`index must be a regular file: ${relativePath(file)}`);
  let document;
  try { document = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('index is not valid JSON'); }
  verifyDocument(document);
  console.log(`V13 evidence verified: ${relativePath(file)}`);
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  const document = skeleton();
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`V13 evidence index written to ${relativePath(file)}`);
}
