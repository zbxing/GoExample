import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const projectsRoot = path.join(repositoryRoot, 'Proj');
const frameworkRoot = path.join(repositoryRoot, 'Framework');
const projectName = process.env.GO_PROJECT?.trim() || 'Example';
const task = process.argv[2] ?? 'run';

if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(projectName)) {
  console.error('GO_PROJECT must contain only letters, numbers, underscores, or hyphens.');
  process.exit(1);
}

const projectRoot = path.resolve(projectsRoot, projectName);
if (!projectRoot.startsWith(`${projectsRoot}${path.sep}`)) {
  console.error('GO_PROJECT resolves outside the Proj directory.');
  process.exit(1);
}
if (!existsSync(path.join(frameworkRoot, 'go.mod'))) {
  console.error('Framework/go.mod was not found.');
  process.exit(1);
}
if (!existsSync(path.join(projectRoot, 'go.mod'))) {
  console.error(`Go project "${projectName}" was not found under Proj.`);
  process.exit(1);
}

const projectPattern = `./Proj/${projectName}/...`;
const frameworkPattern = './Framework/...';
const outputRoot = path.join(repositoryRoot, '.temp');
const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
const workspacePackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const toolchainMatch = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);
if (!toolchainMatch) {
  console.error('go.work must declare a toolchain version.');
  process.exit(1);
}
const localGoCandidates = [
  path.join(
    outputRoot,
    'toolchain',
    `go${toolchainMatch[1]}`,
    'go',
    'bin',
    process.platform === 'win32' ? 'go.exe' : 'go',
  ),
  path.join(outputRoot, 'toolchain', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go'),
];
const executableName = `${projectName.toLowerCase()}-server${process.platform === 'win32' ? '.exe' : ''}`;
const buildVersion = /^[A-Za-z0-9._+-]+$/.test(workspacePackage.version)
  ? workspacePackage.version
  : 'dev';
const gitCommitResult = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  shell: false,
});
const buildCommit = /^[a-f0-9]{7,40}$/i.test(gitCommitResult.stdout?.trim() ?? '')
  ? gitCommitResult.stdout.trim()
  : 'unknown';
const buildTime = new Date().toISOString();
const taskDefinitions = {
  run: { cwd: projectRoot, args: ['run', './cmd/server'] },
  test: { cwd: repositoryRoot, args: ['test', frameworkPattern, projectPattern] },
  cover: {
    cwd: repositoryRoot,
    args: [
      'test',
      `-coverprofile=${path.join(outputRoot, 'coverage', `${projectName}.out`)}`,
      frameworkPattern,
      projectPattern,
    ],
  },
  bench: {
    cwd: repositoryRoot,
    args: [
      'test',
      '-run=^$',
      '-bench=.',
      '-benchmem',
      './Framework/httpapi',
      './Framework/observability',
      './Framework/health',
    ],
  },
  race: { cwd: repositoryRoot, args: ['test', '-race', frameworkPattern, projectPattern] },
  vuln: {
    commands: [
      {
        cwd: frameworkRoot,
        args: ['run', 'golang.org/x/vuln/cmd/govulncheck@v1.1.4', './...'],
      },
      {
        cwd: projectRoot,
        args: ['run', 'golang.org/x/vuln/cmd/govulncheck@v1.1.4', './...'],
      },
    ],
  },
  vet: { cwd: repositoryRoot, args: ['vet', frameworkPattern, projectPattern] },
  build: {
    cwd: repositoryRoot,
    args: [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.version=${buildVersion} -X main.commit=${buildCommit} -X main.buildTime=${buildTime}`,
      '-o',
      path.join(outputRoot, 'bin', executableName),
      `./Proj/${projectName}/cmd/server`,
    ],
  },
};

if (!(task in taskDefinitions)) {
  console.error(`Unknown Go project task: ${task}`);
  process.exit(1);
}

mkdirSync(path.join(outputRoot, 'bin'), { recursive: true });
mkdirSync(path.join(outputRoot, 'coverage'), { recursive: true });
const goTemporaryRoot = process.env.GOTMPDIR?.trim() || path.join(outputRoot, 'go-tmp');
mkdirSync(goTemporaryRoot, { recursive: true });
const goEnvironment = { ...process.env, GOTMPDIR: goTemporaryRoot };

const goCommand =
  process.env.GO_BINARY?.trim() || localGoCandidates.find((candidate) => existsSync(candidate)) || 'go';
const govulncheckCommand = [
  process.env.GOVULNCHECK_BINARY?.trim(),
  path.join(outputRoot, 'bin', process.platform === 'win32' ? 'govulncheck.exe' : 'govulncheck'),
].find((candidate) => candidate && existsSync(candidate));
const goCommandDirectory = existsSync(goCommand) ? path.dirname(path.resolve(goCommand)) : null;
const pathEnvironmentKey =
  Object.keys(process.env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
const executablePath = process.env.Path ?? process.env.PATH ?? '';
const goEnvironmentWithPath = {
  ...goEnvironment,
  [pathEnvironmentKey]: goCommandDirectory
    ? `${goCommandDirectory}${path.delimiter}${executablePath}`
    : executablePath,
};
const definition = taskDefinitions[task];
const commands = definition.commands ?? [definition];

function runCommand(index) {
  if (index >= commands.length) {
    return;
  }

  const command = commands[index];
  const executable = task === 'vuln' && govulncheckCommand ? govulncheckCommand : goCommand;
  const args = task === 'vuln' && govulncheckCommand ? ['./...'] : command.args;
  const child = spawn(executable, args, {
    cwd: command.cwd,
    env: goEnvironmentWithPath,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`Unable to start ${executable}: ${error.message}`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Go project task stopped by signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    if (code !== 0) {
      process.exitCode = code ?? 1;
      return;
    }
    runCommand(index + 1);
  });
}

runCommand(0);
