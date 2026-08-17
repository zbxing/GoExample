import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const frontRoot = path.join(repositoryRoot, 'MSFront');
const task = process.argv[2] ?? 'dev';
const forwardArguments = process.argv.slice(3);
const scriptTasks = new Set([
  'dev',
  'build',
  'start',
  'lint',
  'lint:fix',
  'test',
  'migrate',
  'typegen',
  'typecheck',
]);

if (task !== 'install' && !scriptTasks.has(task)) {
  console.error(`Unknown MSFront task: ${task}`);
  process.exit(1);
}

const yarnArguments =
  task === 'install'
    ? ['install', '--frozen-lockfile', '--non-interactive', ...forwardArguments]
    : ['run', task, ...forwardArguments];
const packageManagerPath = process.env.npm_execpath;
const runningFromYarn = packageManagerPath && path.basename(packageManagerPath).toLowerCase().includes('yarn');
const command = runningFromYarn
  ? process.execPath
  : process.platform === 'win32'
    ? 'yarn.cmd'
    : 'yarn';
const commandArguments = runningFromYarn ? [packageManagerPath, ...yarnArguments] : yarnArguments;
const child = spawn(command, commandArguments, {
  cwd: frontRoot,
  env: process.env,
  stdio: 'inherit',
  shell: !runningFromYarn && process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`Unable to start Yarn: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`MSFront task stopped by signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
