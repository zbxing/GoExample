import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const workflowLintSchemaVersion = 1;
export const actionlintModule = 'github.com/rhysd/actionlint/cmd/actionlint';
export const actionlintVersion = 'v1.7.12';
export const actionlintModuleSum = 'h1:vQ4GeJN86C0QH+gTUQcs8McmK62OLT3kmakPMtEWYnY=';
export const actionlintGoModSum = 'h1:krOUhujIsJusovkaYzQ/VNH8PFexjNKqU0q5XI/4w+g=';
export const excludedWorkflowPaths = Object.freeze([
  '.github/workflows/msfront-browser.yml',
  '.github/workflows/msfront-quality.yml',
]);

const expectedToolRequirements = Object.freeze([
  'github.com/bmatcuk/doublestar/v4 v4.10.0',
  'github.com/clipperhouse/uax29/v2 v2.7.0 // indirect',
  'github.com/fatih/color v1.19.0',
  'github.com/mattn/go-colorable v0.1.14',
  'github.com/mattn/go-isatty v0.0.20 // indirect',
  'github.com/mattn/go-runewidth v0.0.21',
  'github.com/mattn/go-shellwords v1.0.12',
  'github.com/rhysd/actionlint v1.7.12',
  'github.com/robfig/cron/v3 v3.0.1',
  'go.yaml.in/yaml/v4 v4.0.0-rc.3',
  'golang.org/x/sync v0.20.0',
  'golang.org/x/sys v0.42.0',
].sort());

const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`Workflow lint evidence: ${message}`);
}

function relativePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
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

function requireExitCode(value, name) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 255)) {
    reject(`${name} must be null or an exit code from 0 through 255`);
  }
}

function requireCanonicalTimestamp(value, name) {
  if (
    typeof value !== 'string' ||
    !canonicalTimestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    reject(`${name} must be a canonical UTC timestamp`);
  }
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
    reject(`${name} must stay inside the workflow lint evidence directory`);
  }
  return resolved;
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

function verifyFileRecord(record, evidenceRoot, name, maximumBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
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

function readRequiredGoVersion(repositoryRoot) {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  const match = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);
  if (!match) {
    reject('go.work must declare an exact Go toolchain version');
  }
  return `go${match[1]}`;
}

function verifyToolPin(repositoryRoot) {
  const toolRoot = path.join(repositoryRoot, 'tools', 'actionlint');
  const goMod = readFileSync(path.join(toolRoot, 'go.mod'), 'utf8');
  const goSum = readFileSync(path.join(toolRoot, 'go.sum'), 'utf8');
  if (
    !goMod.startsWith('module goexample.dev/tools/actionlint\n') ||
    !/^go 1\.25\.0$/m.test(goMod) ||
    !/^toolchain go1\.25\.13$/m.test(goMod) ||
    /^(?:replace|exclude|retract)\b/m.test(goMod)
  ) {
    reject('tools/actionlint/go.mod has an invalid module, toolchain, or dependency override');
  }
  const requirements = [...goMod.matchAll(/^\s*([^\s]+)\s+(v[^\s]+)(\s+\/\/ indirect)?$/gm)]
    .map((match) => `${match[1]} ${match[2]}${match[3] ?? ''}`)
    .sort();
  if (JSON.stringify(requirements) !== JSON.stringify(expectedToolRequirements)) {
    reject('tools/actionlint/go.mod dependency set does not match the pinned actionlint command closure');
  }
  const pins = [...goMod.matchAll(/^\s*github\.com\/rhysd\/actionlint\s+(v\d+\.\d+\.\d+)(?:\s+\/\/.*)?$/gm)];
  if (pins.length !== 1 || pins[0][1] !== actionlintVersion) {
    reject(`tools/actionlint/go.mod must pin exactly ${actionlintVersion}`);
  }
  if (!goSum.split(/\r?\n/).includes(`github.com/rhysd/actionlint ${actionlintVersion} ${actionlintModuleSum}`)) {
    reject('tools/actionlint/go.sum must pin the actionlint module checksum');
  }
  if (!goSum.split(/\r?\n/).includes(`github.com/rhysd/actionlint ${actionlintVersion}/go.mod ${actionlintGoModSum}`)) {
    reject('tools/actionlint/go.sum must pin the actionlint go.mod checksum');
  }
}

export function collectWorkflowLintScope(repositoryRoot) {
  const workflowsRoot = path.join(repositoryRoot, '.github', 'workflows');
  const excluded = new Set(excludedWorkflowPaths);
  const foundExcluded = new Set();
  const included = [];

  for (const entry of readdirSync(workflowsRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!/\.ya?ml$/i.test(entry.name)) {
      continue;
    }
    const filePath = path.join(workflowsRoot, entry.name);
    const workflowPath = relativePath(repositoryRoot, filePath);
    if (excluded.has(workflowPath)) {
      if (!entry.isFile() || entry.isSymbolicLink?.()) {
        reject(`excluded workflow must remain a regular file: ${workflowPath}`);
      }
      foundExcluded.add(workflowPath);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink?.()) {
      reject(`workflow must be a regular file: ${workflowPath}`);
    }
    included.push(describeFile(filePath, repositoryRoot));
  }

  if (JSON.stringify([...foundExcluded].sort()) !== JSON.stringify([...excluded].sort())) {
    reject('the explicit MSFront workflow exclusion list no longer matches the repository');
  }
  if (included.length === 0) {
    reject('at least one non-MSFront workflow must be linted');
  }
  return included;
}

export function buildWorkflowLintReport({
  repositoryRoot,
  evidenceRoot,
  binaryPath,
  goVersion,
  platform,
  startedAt,
  endedAt,
  buildExitCode,
  versionExitCode,
  lintExitCode,
  buildOutputPath,
  versionOutputPath,
  lintOutputPath,
}) {
  return {
    schemaVersion: workflowLintSchemaVersion,
    tool: {
      module: actionlintModule,
      version: actionlintVersion,
      moduleSum: actionlintModuleSum,
      goModSum: actionlintGoModSum,
      binary: binaryPath && existsSync(binaryPath) ? describeFile(binaryPath, evidenceRoot) : null,
    },
    scope: {
      included: collectWorkflowLintScope(repositoryRoot),
      excluded: [...excludedWorkflowPaths],
    },
    execution: {
      goVersion,
      platform,
      startedAt,
      endedAt,
      buildExitCode,
      versionExitCode,
      lintExitCode,
    },
    outputs: {
      build: describeFile(buildOutputPath, evidenceRoot),
      version: describeFile(versionOutputPath, evidenceRoot),
      lint: describeFile(lintOutputPath, evidenceRoot),
    },
  };
}

export function verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot }) {
  verifyToolPin(repositoryRoot);
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
  const report = requireExactKeys(parsed, ['execution', 'outputs', 'schemaVersion', 'scope', 'tool'], 'report');
  if (report.schemaVersion !== workflowLintSchemaVersion) {
    reject(`schemaVersion must equal ${workflowLintSchemaVersion}`);
  }

  const tool = requireExactKeys(report.tool, ['binary', 'goModSum', 'module', 'moduleSum', 'version'], 'tool');
  if (
    tool.module !== actionlintModule ||
    tool.version !== actionlintVersion ||
    tool.moduleSum !== actionlintModuleSum ||
    tool.goModSum !== actionlintGoModSum
  ) {
    reject('tool identity or module checksums do not match the repository pin');
  }
  if (tool.binary === null) {
    reject('a successful report must include the built actionlint binary hash');
  }
  const binaryPath = verifyFileRecord(tool.binary, evidenceRoot, 'tool.binary', 64 * 1024 * 1024);

  const scope = requireExactKeys(report.scope, ['excluded', 'included'], 'scope');
  if (JSON.stringify(scope.excluded) !== JSON.stringify(excludedWorkflowPaths)) {
    reject('scope.excluded must match the explicit MSFront exclusions');
  }
  const expectedIncluded = collectWorkflowLintScope(repositoryRoot);
  if (JSON.stringify(scope.included) !== JSON.stringify(expectedIncluded)) {
    reject('scope.included no longer matches every non-MSFront workflow and its current hash');
  }

  const execution = requireExactKeys(
    report.execution,
    ['buildExitCode', 'endedAt', 'goVersion', 'lintExitCode', 'platform', 'startedAt', 'versionExitCode'],
    'execution',
  );
  const expectedGoVersion = readRequiredGoVersion(repositoryRoot);
  if (execution.goVersion !== expectedGoVersion) {
    reject(`execution.goVersion must equal ${expectedGoVersion}`);
  }
  if (typeof execution.platform !== 'string' || !/^[a-z0-9]+\/[a-z0-9]+$/.test(execution.platform)) {
    reject('execution.platform must be a platform/architecture pair');
  }
  requireCanonicalTimestamp(execution.startedAt, 'execution.startedAt');
  requireCanonicalTimestamp(execution.endedAt, 'execution.endedAt');
  const duration = Date.parse(execution.endedAt) - Date.parse(execution.startedAt);
  if (duration < 0 || duration > 30 * 60 * 1000) {
    reject('execution timestamps must describe a non-negative run no longer than 30 minutes');
  }
  for (const name of ['buildExitCode', 'versionExitCode', 'lintExitCode']) {
    requireExitCode(execution[name], `execution.${name}`);
    if (execution[name] !== 0) {
      reject(`execution.${name} must be zero for verified evidence`);
    }
  }

  const outputs = requireExactKeys(report.outputs, ['build', 'lint', 'version'], 'outputs');
  const buildOutputPath = verifyFileRecord(outputs.build, evidenceRoot, 'outputs.build', 2 * 1024 * 1024);
  const versionOutputPath = verifyFileRecord(outputs.version, evidenceRoot, 'outputs.version', 128 * 1024);
  const lintOutputPath = verifyFileRecord(outputs.lint, evidenceRoot, 'outputs.lint', 2 * 1024 * 1024);
  const versionOutput = readFileSync(versionOutputPath, 'utf8');
  if (!versionOutput.includes(`\n${actionlintVersion}\n`) || !versionOutput.includes(`built with ${expectedGoVersion} compiler`)) {
    reject('actionlint version output does not bind the pinned module and Go toolchain');
  }

  return {
    report,
    artifactPaths: [reportPath, binaryPath, buildOutputPath, versionOutputPath, lintOutputPath]
      .map((filePath) => relativePath(repositoryRoot, filePath))
      .sort(),
  };
}
