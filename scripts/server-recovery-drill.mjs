import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serverRecoveryGoArguments,
  serverRecoveryLimitations,
  serverRecoveryScenarios,
} from './lib/server-recovery-evidence.mjs';
import {
  isolatedGoToolchainEnvironment,
  selectRepositoryToolCommand,
} from './lib/go-toolchain-environment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const recoveryRoot = path.join(tempRoot, 'recovery');
const outputRoot = path.join(recoveryRoot, 'server-local');
const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
const toolchainMatch = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);

const scenarios = serverRecoveryScenarios;

function fail(message) {
  console.error(`Server recovery drill: ${message}`);
  process.exit(1);
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
  console.log(JSON.stringify({ schemaVersion: 1, scenarios }, null, 2));
  process.exit(0);
}
if (args.length > 0) {
  fail(`unknown argument: ${args[0]}`);
}
if (!toolchainMatch) {
  fail('go.work must declare an exact Go patch toolchain');
}
if (!isWithin(recoveryRoot, outputRoot)) {
  fail('output directory must stay inside .temp/recovery');
}

const goExecutableName = process.platform === 'win32' ? 'go.exe' : 'go';
const goCommand = selectRepositoryToolCommand({
  configuredCommand: process.env.GO_BINARY,
  repositoryCandidates: [
    path.join(tempRoot, 'toolchain', `go${toolchainMatch[1]}`, 'go', 'bin', goExecutableName),
    path.join(tempRoot, 'toolchain', 'go', 'bin', goExecutableName),
  ],
  fallbackCommand: 'go',
}).command;
const goTemporaryRoot = path.join(tempRoot, 'go-tmp');
const goCacheRoot = path.join(tempRoot, 'gocache');
mkdirSync(recoveryRoot, { recursive: true });
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
mkdirSync(goTemporaryRoot, { recursive: true });
mkdirSync(goCacheRoot, { recursive: true });

const environment = isolatedGoToolchainEnvironment(process.env, {
  GOCACHE: goCacheRoot,
  GOTMPDIR: goTemporaryRoot,
  GOFLAGS: '',
  GOWORK: path.join(repositoryRoot, 'go.work'),
  REDIS_TEST_URL: '',
});
const gitCommitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});
const goVersionResult = spawnSync(goCommand, ['version'], {
  cwd: repositoryRoot,
  env: environment,
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});
const results = [];

for (const scenario of scenarios) {
  const commandArgs = serverRecoveryGoArguments(scenario);
  const startedAt = new Date();
  const started = performance.now();
  const result = spawnSync(goCommand, commandArgs, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutPath = path.join(outputRoot, `${scenario.id}.stdout.txt`);
  const stderrPath = path.join(outputRoot, `${scenario.id}.stderr.txt`);
  writeFileSync(stdoutPath, stdout, 'utf8');
  writeFileSync(stderrPath, stderr, 'utf8');
  const passed = result.status === 0 && !result.signal && !result.error;
  results.push({
    id: scenario.id,
    scope: 'local_contract',
    package: scenario.package,
    tests: scenario.tests,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now() - started),
    status: passed ? 'passed' : 'failed',
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    spawnErrorCode: result.error?.code ?? null,
    stdout: { path: relativePath(stdoutPath), bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { path: relativePath(stderrPath), bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
  });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${scenario.id} (${results.at(-1).durationMs} ms)`);
}

const passed = results.every((result) => result.status === 'passed');
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'local_contract_only',
  status: passed ? 'passed' : 'failed',
  repository: { gitCommit: gitCommitResult.status === 0 ? gitCommitResult.stdout.trim() : 'unknown' },
  toolchain: { go: goVersionResult.status === 0 ? goVersionResult.stdout.trim() : 'unavailable' },
  scenarios: results,
  limitations: [...serverRecoveryLimitations],
};
const summaryPath = path.join(outputRoot, 'summary.json');
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Server recovery drill ${summary.status}; summary written to ${relativePath(summaryPath)}`);
if (!passed) {
  process.exitCode = 1;
}
