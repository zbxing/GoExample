import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';

export const prometheusRuleSchemaVersion = 3;
export const promtoolVersion = '3.5.0';
export const promtoolModule = 'github.com/prometheus/prometheus/cmd/promtool';
export const prometheusModuleVersion = 'v0.305.0';
export const prometheusModuleSum = 'h1:UO/LsM32/E9yBDtvQj8tN+WwhbyWKR10lO35vmFLx0U=';
export const prometheusGoModSum = 'h1:JG+jKIDUJ9Bn97anZiCjwCxRyAx+lpcEQ0QnZlUlbwY=';
export const promtoolRevision = '8be3a9560fbdd18a94dedec4b747c35178177202';
export const promtoolLdflags = [
  `-X github.com/prometheus/common/version.Version=${promtoolVersion}`,
  `-X github.com/prometheus/common/version.Revision=${promtoolRevision}`,
  '-X github.com/prometheus/common/version.Branch=HEAD',
  '-X github.com/prometheus/common/version.BuildUser=goexample-pinned-build',
  '-X github.com/prometheus/common/version.BuildDate=20250714-15:34:17',
].join(' ');
export const promtoolGoModSha256 = 'a374ca6c38dfa98f35abf6d460f1ad37f1b23628d91c87f4367e726e01a3aedc';
export const promtoolGoSumSha256 = '73371f5b30c14a1b89c1461e8929669c8a24f4b6bd3fd21c781d14af52ab278e';
export const prometheusRulePaths = Object.freeze([
  'support/deploy/prometheus/rules/goexample-slo.yml',
]);
export const prometheusRuleTestPaths = Object.freeze([
  'support/deploy/prometheus/tests/goexample-slo.test.yml',
]);
export const prometheusConfigPaths = Object.freeze([
  'support/deploy/prometheus/prometheus.yml',
]);

const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const limitations = Object.freeze([
  'the complete Go dependency checksum set is pinned, but external module and Go toolchain distributions are not independently attested',
  'configuration parsing, referenced-rule validation, PromQL linting, and deterministic rule unit tests do not prove a running Prometheus or Alertmanager deployment',
  'target telemetry, notification delivery, paging, ownership, and controlled alert drills remain not recorded',
]);

function reject(message) {
  throw new Error(`Prometheus rule evidence: ${message}`);
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, 'r');
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
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

function requireExitCode(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    reject(`${name} must be an exit code from 0 through 255`);
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
    reject(`${name} must stay inside the Prometheus rule evidence directory`);
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
  const toolRoot = path.join(repositoryRoot, 'tools', 'promtool');
  const goModPath = path.join(toolRoot, 'go.mod');
  const goSumPath = path.join(toolRoot, 'go.sum');
  const goMod = readFileSync(goModPath, 'utf8');
  const goSum = readFileSync(goSumPath, 'utf8');
  if (
    !goMod.startsWith('module goexample.dev/tools/promtool\n') ||
    !/^go 1\.25\.0$/m.test(goMod) ||
    !/^toolchain go1\.25\.13$/m.test(goMod) ||
    !new RegExp(`^tool ${promtoolModule.replaceAll('/', '\\/')}$`, 'm').test(goMod) ||
    !new RegExp(`^\\s*github\\.com/prometheus/prometheus\\s+${prometheusModuleVersion.replaceAll('.', '\\.')}\\s+// indirect$`, 'm').test(goMod) ||
    /^(?:replace|exclude|retract)\b/m.test(goMod)
  ) {
    reject('tools/promtool/go.mod has an invalid module, toolchain, tool, version, or dependency override');
  }
  if (hashFile(goModPath) !== promtoolGoModSha256 || hashFile(goSumPath) !== promtoolGoSumSha256) {
    reject('tools/promtool module files no longer match the pinned complete dependency closure');
  }
  const sums = new Set(goSum.split(/\r?\n/));
  if (!sums.has(`github.com/prometheus/prometheus ${prometheusModuleVersion} ${prometheusModuleSum}`)) {
    reject('tools/promtool/go.sum must pin the Prometheus module checksum');
  }
  if (!sums.has(`github.com/prometheus/prometheus ${prometheusModuleVersion}/go.mod ${prometheusGoModSum}`)) {
    reject('tools/promtool/go.sum must pin the Prometheus go.mod checksum');
  }
  return {
    goMod: describeFile(goModPath, repositoryRoot),
    goSum: describeFile(goSumPath, repositoryRoot),
  };
}

function collectRuleScope(repositoryRoot) {
  return prometheusRulePaths.map((rulePath) => {
    const filePath = path.join(repositoryRoot, ...rulePath.split('/'));
    if (!existsSync(filePath)) {
      reject(`rule file is missing: ${rulePath}`);
    }
    return describeFile(filePath, repositoryRoot);
  });
}

function collectRuleTestScope(repositoryRoot) {
  return prometheusRuleTestPaths.map((testPath) => {
    const filePath = path.join(repositoryRoot, ...testPath.split('/'));
    if (!existsSync(filePath)) {
      reject(`rule test file is missing: ${testPath}`);
    }
    return describeFile(filePath, repositoryRoot);
  });
}

function collectConfigScope(repositoryRoot) {
  return prometheusConfigPaths.map((configPath) => {
    const filePath = path.join(repositoryRoot, ...configPath.split('/'));
    if (!existsSync(filePath)) {
      reject(`Prometheus config file is missing: ${configPath}`);
    }
    return describeFile(filePath, repositoryRoot);
  });
}

export function buildPrometheusRuleReport({
  repositoryRoot,
  evidenceRoot,
  binaryPath,
  goVersion,
  platform,
  startedAt,
  endedAt,
  buildExitCode,
  versionExitCode,
  checkConfigExitCode,
  checkRulesExitCode,
  testRulesExitCode,
  buildOutputPath,
  versionOutputPath,
  checkConfigOutputPath,
  checkRulesOutputPath,
  testRulesOutputPath,
}) {
  return {
    schemaVersion: prometheusRuleSchemaVersion,
    status: buildExitCode === 0 && versionExitCode === 0 && checkConfigExitCode === 0 && checkRulesExitCode === 0 && testRulesExitCode === 0
      ? 'passed'
      : 'failed',
    tool: {
      name: 'promtool',
      version: promtoolVersion,
      module: promtoolModule,
      moduleVersion: prometheusModuleVersion,
      moduleSum: prometheusModuleSum,
      goModSum: prometheusGoModSum,
      revision: promtoolRevision,
      goVersion,
      platform,
      moduleFiles: verifyToolPin(repositoryRoot),
      binary: binaryPath && existsSync(binaryPath) ? describeFile(binaryPath, evidenceRoot) : null,
    },
    scope: {
      configs: collectConfigScope(repositoryRoot),
      included: collectRuleScope(repositoryRoot),
      tests: collectRuleTestScope(repositoryRoot),
    },
    commands: {
      build: ['go', 'build', '-mod=readonly', '-trimpath', '-ldflags', promtoolLdflags, '-o', '<evidence-binary>', promtoolModule],
      version: ['promtool', '--version'],
      checkConfig: ['promtool', 'check', 'config', '--lint=all', '--lint-fatal', ...prometheusConfigPaths],
      checkRules: ['promtool', 'check', 'rules', '--lint=all', '--lint-fatal', ...prometheusRulePaths],
      testRules: ['promtool', 'test', 'rules', ...prometheusRuleTestPaths],
    },
    execution: {
      startedAt,
      endedAt,
      buildExitCode,
      versionExitCode,
      checkConfigExitCode,
      checkRulesExitCode,
      testRulesExitCode,
    },
    outputs: {
      build: describeFile(buildOutputPath, evidenceRoot),
      version: describeFile(versionOutputPath, evidenceRoot),
      checkConfig: describeFile(checkConfigOutputPath, evidenceRoot),
      checkRules: describeFile(checkRulesOutputPath, evidenceRoot),
      testRules: describeFile(testRulesOutputPath, evidenceRoot),
    },
    limitations: [...limitations],
  };
}

export function verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  if (!existsSync(reportPath)) {
    reject('report.json is missing');
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('report.json must contain valid JSON');
  }
  const document = requireExactKeys(
    report,
    ['commands', 'execution', 'limitations', 'outputs', 'schemaVersion', 'scope', 'status', 'tool'],
    'report',
  );
  if (document.schemaVersion !== prometheusRuleSchemaVersion) {
    reject(`schemaVersion must equal ${prometheusRuleSchemaVersion}`);
  }
  if (document.status !== 'passed') {
    reject('status must equal passed for verified evidence');
  }

  const tool = requireExactKeys(
    document.tool,
    ['binary', 'goModSum', 'goVersion', 'module', 'moduleFiles', 'moduleSum', 'moduleVersion', 'name', 'platform', 'revision', 'version'],
    'tool',
  );
  if (
    tool.name !== 'promtool' ||
    tool.version !== promtoolVersion ||
    tool.module !== promtoolModule ||
    tool.moduleVersion !== prometheusModuleVersion ||
    tool.moduleSum !== prometheusModuleSum ||
    tool.goModSum !== prometheusGoModSum ||
    tool.revision !== promtoolRevision ||
    tool.goVersion !== readRequiredGoVersion(repositoryRoot)
  ) {
    reject('tool identity does not match the pinned Prometheus module and Go toolchain');
  }
  if (typeof tool.platform !== 'string' || !/^(?:linux|win32)\/(?:x64|arm64)$/.test(tool.platform)) {
    reject('tool.platform must identify a supported platform');
  }
  if (JSON.stringify(tool.moduleFiles) !== JSON.stringify(verifyToolPin(repositoryRoot))) {
    reject('tool.moduleFiles no longer match the pinned tool inputs');
  }
  const binaryPath = verifyFileRecord(tool.binary, evidenceRoot, 'tool.binary', 512 * 1024 * 1024);
  const expectedBinaryName = tool.platform.startsWith('win32/') ? 'promtool.exe' : 'promtool';
  if (path.basename(binaryPath) !== expectedBinaryName) {
    reject(`tool.binary must be named ${expectedBinaryName}`);
  }

  const scope = requireExactKeys(document.scope, ['configs', 'included', 'tests'], 'scope');
  if (JSON.stringify(scope.configs) !== JSON.stringify(collectConfigScope(repositoryRoot))) {
    reject('scope.configs no longer matches the repository Prometheus config files');
  }
  if (JSON.stringify(scope.included) !== JSON.stringify(collectRuleScope(repositoryRoot))) {
    reject('scope.included no longer matches the repository rule files');
  }
  if (JSON.stringify(scope.tests) !== JSON.stringify(collectRuleTestScope(repositoryRoot))) {
    reject('scope.tests no longer matches the repository rule test files');
  }
  const expectedCommands = {
    build: ['go', 'build', '-mod=readonly', '-trimpath', '-ldflags', promtoolLdflags, '-o', '<evidence-binary>', promtoolModule],
    version: ['promtool', '--version'],
    checkConfig: ['promtool', 'check', 'config', '--lint=all', '--lint-fatal', ...prometheusConfigPaths],
    checkRules: ['promtool', 'check', 'rules', '--lint=all', '--lint-fatal', ...prometheusRulePaths],
    testRules: ['promtool', 'test', 'rules', ...prometheusRuleTestPaths],
  };
  if (JSON.stringify(document.commands) !== JSON.stringify(expectedCommands)) {
    reject('commands do not match the fixed promtool build and validation invocation');
  }

  const execution = requireExactKeys(
    document.execution,
    ['buildExitCode', 'checkConfigExitCode', 'checkRulesExitCode', 'endedAt', 'startedAt', 'testRulesExitCode', 'versionExitCode'],
    'execution',
  );
  requireCanonicalTimestamp(execution.startedAt, 'execution.startedAt');
  requireCanonicalTimestamp(execution.endedAt, 'execution.endedAt');
  if (Date.parse(execution.endedAt) < Date.parse(execution.startedAt)) {
    reject('execution.endedAt must not precede execution.startedAt');
  }
  for (const name of ['buildExitCode', 'versionExitCode', 'checkConfigExitCode', 'checkRulesExitCode', 'testRulesExitCode']) {
    requireExitCode(execution[name], `execution.${name}`);
    if (execution[name] !== 0) {
      reject(`execution.${name} must be zero for verified evidence`);
    }
  }

  const outputs = requireExactKeys(document.outputs, ['build', 'checkConfig', 'checkRules', 'testRules', 'version'], 'outputs');
  const buildOutputPath = verifyFileRecord(outputs.build, evidenceRoot, 'outputs.build', 2 * 1024 * 1024);
  const versionOutputPath = verifyFileRecord(outputs.version, evidenceRoot, 'outputs.version', 256 * 1024);
  const checkConfigOutputPath = verifyFileRecord(outputs.checkConfig, evidenceRoot, 'outputs.checkConfig', 2 * 1024 * 1024);
  const checkRulesOutputPath = verifyFileRecord(outputs.checkRules, evidenceRoot, 'outputs.checkRules', 2 * 1024 * 1024);
  const testRulesOutputPath = verifyFileRecord(outputs.testRules, evidenceRoot, 'outputs.testRules', 2 * 1024 * 1024);
  const versionOutput = readFileSync(versionOutputPath, 'utf8');
  const checkConfigOutput = readFileSync(checkConfigOutputPath, 'utf8');
  const checkRulesOutput = readFileSync(checkRulesOutputPath, 'utf8');
  const testRulesOutput = readFileSync(testRulesOutputPath, 'utf8');
  if (
    !versionOutput.includes(`promtool, version ${promtoolVersion}`) ||
    !versionOutput.includes(`revision: ${promtoolRevision}`) ||
    !versionOutput.includes(`go version:       ${tool.goVersion}`)
  ) {
    reject('version output does not identify the pinned promtool version');
  }
  if (
    !prometheusConfigPaths.every((configPath) => checkConfigOutput.includes(configPath)) ||
    !/SUCCESS:\s+\d+\s+rule files found/.test(checkConfigOutput) ||
    !/is valid prometheus config file syntax/.test(checkConfigOutput)
  ) {
    reject('check-config output does not contain the scoped successful config and rule result');
  }
  if (!prometheusRulePaths.every((rulePath) => checkRulesOutput.includes(rulePath)) || !/SUCCESS:\s+\d+\s+rules found/.test(checkRulesOutput)) {
    reject('check-rules output does not contain the scoped successful rule count');
  }
  if (!/^stdout:\r?\n {2}SUCCESS\r?\n\r?\n\r?\nstderr:\r?\n?$/.test(testRulesOutput)) {
    reject('test-rules output does not contain a successful rule test result');
  }
  if (JSON.stringify(document.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the local evidence boundary');
  }

  return {
    report: document,
    artifactPaths: [reportPath, binaryPath, buildOutputPath, versionOutputPath, checkConfigOutputPath, checkRulesOutputPath, testRulesOutputPath]
      .map((filePath) => relativePath(repositoryRoot, filePath)),
  };
}
