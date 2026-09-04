import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPrometheusRuleReport,
  prometheusConfigPaths,
  prometheusRulePaths,
  prometheusRuleTestPaths,
  promtoolLdflags,
  promtoolModule,
  verifyPrometheusRuleEvidence,
} from './lib/prometheus-rules.mjs';
import { isolatedGoToolchainEnvironment } from './lib/go-toolchain-environment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'prometheus-rules');
const toolRoot = path.join(repositoryRoot, 'tools', 'promtool');
const prometheusRoot = path.join(repositoryRoot, 'support', 'deploy', 'prometheus');
const validationCredentialPath = path.join(prometheusRoot, 'secrets', 'goexample_metrics_token');
const validationCredential = 'promtool-validation-fixture-not-a-production-secret';
const maximumCommandOutput = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(`Prometheus rules: ${message}`);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseArguments() {
  const args = process.argv.slice(2);
  let task = 'run';
  let evidenceDirectory = null;
  if (args[0] === 'run' || args[0] === 'verify') {
    task = args.shift();
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== '--evidence-dir' || evidenceDirectory !== null) {
      fail(`unknown or duplicate argument: ${argument}`);
    }
    evidenceDirectory = args[index + 1];
    index += 1;
    if (!evidenceDirectory || evidenceDirectory.startsWith('--')) {
      fail('--evidence-dir requires a path');
    }
  }
  const evidenceRoot = path.resolve(repositoryRoot, evidenceDirectory ?? path.relative(repositoryRoot, defaultEvidenceRoot));
  if (!isWithin(path.join(tempRoot, 'workflow-artifacts'), evidenceRoot)) {
    fail('evidence directory must stay inside .temp/workflow-artifacts');
  }
  return { task, evidenceRoot };
}

function requiredGoVersion() {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  const match = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);
  if (!match) {
    fail('go.work must declare an exact Go toolchain version');
  }
  return match[1];
}

function commandResult(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: maximumCommandOutput,
  });
  return {
    status: Number.isSafeInteger(result.status) ? result.status : 1,
    stdout: `${result.stdout ?? ''}`,
    stderr: `${result.stderr ?? result.error?.message ?? ''}`,
  };
}

function findGo(version, environment) {
  const executable = process.platform === 'win32' ? 'go.exe' : 'go';
  const candidates = [
    environment.GO_BINARY?.trim(),
    path.join(tempRoot, 'toolchain', `go${version}`, 'go', 'bin', executable),
    path.join(tempRoot, 'toolchain', 'go', 'bin', executable),
    'go',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = commandResult(candidate, ['version'], { cwd: repositoryRoot, env: environment });
    if (result.status === 0 && result.stdout.includes(`go version go${version} `)) {
      return candidate;
    }
  }
  fail(`Go ${version} was not found; run yarn env or set GO_BINARY`);
}

function capturedOutput(result) {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function writeOutput(filePath, result) {
  writeFileSync(filePath, capturedOutput(result), 'utf8');
}

function runRules(evidenceRoot) {
  const version = requiredGoVersion();
  const goCache = path.join(tempRoot, 'gocache-promtool');
  const goTemporaryRoot = path.join(tempRoot, 'go-tmp-promtool');
  const goEnvironment = isolatedGoToolchainEnvironment(process.env, {
    GOWORK: 'off',
    GOCACHE: goCache,
    GOTMPDIR: goTemporaryRoot,
  });
  const goCommand = findGo(version, goEnvironment);
  for (const directory of [goCache, goTemporaryRoot]) {
    mkdirSync(directory, { recursive: true });
  }

  rmSync(evidenceRoot, { recursive: true, force: true });
  mkdirSync(evidenceRoot, { recursive: true });
  const binaryPath = path.join(evidenceRoot, process.platform === 'win32' ? 'promtool.exe' : 'promtool');
  const buildOutputPath = path.join(evidenceRoot, 'build-output.txt');
  const versionOutputPath = path.join(evidenceRoot, 'version-output.txt');
  const checkConfigOutputPath = path.join(evidenceRoot, 'check-config-output.txt');
  const checkRulesOutputPath = path.join(evidenceRoot, 'check-rules-output.txt');
  const testRulesOutputPath = path.join(evidenceRoot, 'test-rules-output.txt');
  const reportPath = path.join(evidenceRoot, 'report.json');
  const startedAt = new Date().toISOString();

  const build = commandResult(
    goCommand,
    ['build', '-mod=readonly', '-trimpath', '-ldflags', promtoolLdflags, '-o', binaryPath, promtoolModule],
    { cwd: toolRoot, env: goEnvironment },
  );
  writeOutput(buildOutputPath, build);
  const versionResult = build.status === 0 && existsSync(binaryPath)
    ? commandResult(binaryPath, ['--version'], { cwd: repositoryRoot, env: process.env })
    : { status: 1, stdout: '', stderr: 'promtool build did not produce an executable\n' };
  writeOutput(versionOutputPath, versionResult);
  let checkConfig;
  if (build.status !== 0 || versionResult.status !== 0) {
    checkConfig = { status: 1, stdout: '', stderr: 'promtool config validation was skipped because setup failed\n' };
  } else if (existsSync(validationCredentialPath)) {
    checkConfig = { status: 1, stdout: '', stderr: 'refusing to use an existing Prometheus credential during validation\n' };
  } else {
    mkdirSync(path.dirname(validationCredentialPath), { recursive: true });
    writeFileSync(validationCredentialPath, `${validationCredential}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      checkConfig = commandResult(
        binaryPath,
        ['check', 'config', '--lint=all', '--lint-fatal', ...prometheusConfigPaths],
        { cwd: repositoryRoot, env: process.env },
      );
    } finally {
      rmSync(validationCredentialPath, { force: true });
    }
  }
  writeOutput(checkConfigOutputPath, checkConfig);
  const checkRules = checkConfig.status === 0
    ? commandResult(
        binaryPath,
        ['check', 'rules', '--lint=all', '--lint-fatal', ...prometheusRulePaths],
        { cwd: repositoryRoot, env: process.env },
      )
    : { status: 1, stdout: '', stderr: 'promtool rule validation was skipped because setup failed\n' };
  writeOutput(checkRulesOutputPath, checkRules);
  const testRules = checkRules.status === 0
    ? commandResult(
        binaryPath,
        ['test', 'rules', ...prometheusRuleTestPaths],
        { cwd: repositoryRoot, env: process.env },
      )
    : { status: 1, stdout: '', stderr: 'promtool rule tests were skipped because validation failed\n' };
  writeOutput(testRulesOutputPath, testRules);

  const report = buildPrometheusRuleReport({
    repositoryRoot,
    evidenceRoot,
    binaryPath,
    goVersion: `go${version}`,
    platform: `${process.platform}/${process.arch}`,
    startedAt,
    endedAt: new Date().toISOString(),
    buildExitCode: build.status,
    versionExitCode: versionResult.status,
    checkConfigExitCode: checkConfig.status,
    checkRulesExitCode: checkRules.status,
    testRulesExitCode: testRules.status,
    buildOutputPath,
    versionOutputPath,
    checkConfigOutputPath,
    checkRulesOutputPath,
    testRulesOutputPath,
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (build.status !== 0 || versionResult.status !== 0 || checkConfig.status !== 0 || checkRules.status !== 0 || testRules.status !== 0) {
    process.stderr.write(capturedOutput(build));
    process.stderr.write(capturedOutput(versionResult));
    process.stderr.write(capturedOutput(checkConfig));
    process.stderr.write(capturedOutput(checkRules));
    process.stderr.write(capturedOutput(testRules));
    fail(`promtool failed; evidence is available at ${path.relative(repositoryRoot, evidenceRoot)}`);
  }
  const verified = verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot });
  console.log(`Prometheus validation passed: ${verified.report.scope.configs.length} config, ${verified.report.scope.included.length} rule file, and ${verified.report.scope.tests.length} test file with promtool ${verified.report.tool.version}`);
  console.log(`Prometheus rule evidence: ${path.relative(repositoryRoot, reportPath)}`);
}

function main() {
  const { task, evidenceRoot } = parseArguments();
  if (task === 'verify') {
    const verified = verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot });
    console.log(`Prometheus evidence verified: ${verified.report.scope.configs.length} config, ${verified.report.scope.included.length} rule file, and ${verified.report.scope.tests.length} test file`);
    return;
  }
  runRules(evidenceRoot);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
