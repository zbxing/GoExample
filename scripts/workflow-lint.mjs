import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionlintModule,
  buildWorkflowLintReport,
  collectWorkflowLintScope,
  verifyWorkflowLintEvidence,
} from './lib/workflow-lint.mjs';
import { isolatedGoToolchainEnvironment } from './lib/go-toolchain-environment.mjs';
import { runEvidenceCommand } from './lib/evidence-command.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultEvidenceRoot = path.join(tempRoot, 'workflow-artifacts', 'workflow-lint');
const toolRoot = path.join(repositoryRoot, 'tools', 'actionlint');

function fail(message) {
  throw new Error(`Workflow lint: ${message}`);
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
  const workflowArtifactsRoot = path.join(tempRoot, 'workflow-artifacts');
  if (!isWithin(workflowArtifactsRoot, evidenceRoot)) {
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
  return runEvidenceCommand(command, args, options);
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

function runLint(evidenceRoot) {
  const version = requiredGoVersion();
  const workflows = collectWorkflowLintScope(repositoryRoot).map((entry) => path.join(repositoryRoot, ...entry.path.split('/')));
  const goCache = path.join(tempRoot, 'gocache');
  const goModuleCache = path.join(tempRoot, 'gomodcache');
  const goTemporaryRoot = path.join(tempRoot, 'go-tmp');
  const goEnvironment = isolatedGoToolchainEnvironment(process.env, {
    GOWORK: 'off',
    GOCACHE: goCache,
    GOMODCACHE: goModuleCache,
    GOTMPDIR: goTemporaryRoot,
  });
  const goCommand = findGo(version, goEnvironment);
  for (const directory of [goCache, goModuleCache, goTemporaryRoot]) {
    mkdirSync(directory, { recursive: true });
  }

  rmSync(evidenceRoot, { recursive: true, force: true });
  mkdirSync(evidenceRoot, { recursive: true });
  const binaryPath = path.join(evidenceRoot, process.platform === 'win32' ? 'actionlint.exe' : 'actionlint');
  const buildOutputPath = path.join(evidenceRoot, 'build-output.txt');
  const versionOutputPath = path.join(evidenceRoot, 'version-output.txt');
  const lintOutputPath = path.join(evidenceRoot, 'lint-output.txt');
  const reportPath = path.join(evidenceRoot, 'report.json');
  const startedAt = new Date().toISOString();

  const build = commandResult(
    goCommand,
    ['build', '-mod=readonly', '-trimpath', '-o', binaryPath, actionlintModule],
    { cwd: toolRoot, env: goEnvironment },
  );
  writeOutput(buildOutputPath, build);
  const versionResult = build.status === 0 && existsSync(binaryPath)
    ? commandResult(binaryPath, ['-version'], { cwd: repositoryRoot, env: process.env })
    : { status: 1, stdout: '', stderr: 'actionlint build did not produce an executable\n' };
  writeOutput(versionOutputPath, versionResult);
  const lint = build.status === 0 && versionResult.status === 0
    ? commandResult(binaryPath, workflows, { cwd: repositoryRoot, env: process.env })
    : { status: 1, stdout: '', stderr: 'actionlint execution was skipped because setup failed\n' };
  writeOutput(lintOutputPath, lint);

  const report = buildWorkflowLintReport({
    repositoryRoot,
    evidenceRoot,
    binaryPath,
    goVersion: `go${version}`,
    platform: `${process.platform}/${process.arch}`,
    startedAt,
    endedAt: new Date().toISOString(),
    buildExitCode: build.status,
    versionExitCode: versionResult.status,
    lintExitCode: lint.status,
    buildOutputPath,
    versionOutputPath,
    lintOutputPath,
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (build.status !== 0 || versionResult.status !== 0 || lint.status !== 0) {
    process.stderr.write(capturedOutput(build));
    process.stderr.write(capturedOutput(versionResult));
    process.stderr.write(capturedOutput(lint));
    fail(`actionlint failed; evidence is available at ${path.relative(repositoryRoot, evidenceRoot)}`);
  }
  const verified = verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot });
  console.log(`Workflow lint passed: ${verified.report.scope.included.length} non-MSFront workflows with actionlint ${verified.report.tool.version}`);
  console.log(`Workflow lint evidence: ${path.relative(repositoryRoot, reportPath)}`);
}

function main() {
  const { task, evidenceRoot } = parseArguments();
  if (task === 'verify') {
    const verified = verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot });
    console.log(`Workflow lint evidence verified: ${verified.report.scope.included.length} non-MSFront workflows`);
    return;
  }
  runLint(evidenceRoot);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
