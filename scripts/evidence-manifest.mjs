import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultOutput = path.join(tempRoot, 'evidence', 'manifest.json');

function fail(message) {
  console.error(`Evidence manifest: ${message}`);
  process.exit(1);
}

function parseOutputArgument() {
  const args = process.argv.slice(2);
  let output = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') {
      if (output !== null) {
        fail('output may only be specified once');
      }
      output = args[index + 1];
      index += 1;
      if (!output || output.startsWith('--')) {
        fail('--output requires a path');
      }
      continue;
    }
    if (argument.startsWith('--output=')) {
      if (output !== null) {
        fail('output may only be specified once');
      }
      output = argument.slice('--output='.length);
      if (!output) {
        fail('--output requires a path');
      }
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  return output;
}

function resolveOutputPath() {
  const requestedOutput = parseOutputArgument();
  const outputPath = path.resolve(repositoryRoot, requestedOutput ?? path.relative(repositoryRoot, defaultOutput));
  const relativeToTemp = path.relative(tempRoot, outputPath);
  if (
    !relativeToTemp ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp) ||
    !relativeToTemp.toLowerCase().endsWith('.json')
  ) {
    fail('output must be a .json file inside the repository .temp directory');
  }
  return outputPath;
}

function run(command, args) {
  const candidates = process.platform === 'win32' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0) {
      return `${result.stdout ?? ''}`.trim() || null;
    }
  }
  if (process.platform === 'win32' && !path.isAbsolute(command)) {
    const commandShell = process.env.ComSpec ?? 'cmd.exe';
    const result = spawnSync(commandShell, ['/d', '/s', '/c', [command, ...args].join(' ')], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0) {
      return `${result.stdout ?? ''}`.trim() || null;
    }
  }
  return null;
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function walkFiles(directory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function describeFile(filePath) {
  const stats = lstatSync(filePath);
  return {
    path: relativePath(filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function describeInput(inputPath) {
  const filePath = path.join(repositoryRoot, inputPath);
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    return { path: inputPath, present: false };
  }
  const stats = lstatSync(filePath);
  return {
    path: inputPath,
    present: true,
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function collectEvidence(outputPath) {
  const roots = [
    ['coverage', path.join(tempRoot, 'coverage')],
    ['benchmark', path.join(tempRoot, 'transport-benchmark')],
    ['profiles', path.join(tempRoot, 'profiles')],
    ['sbom', path.join(tempRoot, 'sbom')],
    ['scans', path.join(tempRoot, 'scans')],
    ['workflowArtifacts', path.join(tempRoot, 'workflow-artifacts')],
    ['deployment', path.join(tempRoot, 'deployment')],
    ['recovery', path.join(tempRoot, 'recovery')],
  ];
  const filesByRoot = new Map(
    roots.map(([name, root]) => [
      name,
      walkFiles(root).filter((filePath) => filePath !== outputPath && isWithin(tempRoot, filePath)),
    ]),
  );
  const benchmarkFiles = filesByRoot.get('benchmark') ?? [];
  const profileFiles = [
    ...(filesByRoot.get('profiles') ?? []),
    ...benchmarkFiles.filter((filePath) => path.extname(filePath).toLowerCase() === '.pprof'),
  ];
  filesByRoot.set(
    'benchmark',
    benchmarkFiles.filter((filePath) => path.extname(filePath).toLowerCase() !== '.pprof'),
  );
  filesByRoot.set('profiles', [...new Set(profileFiles)].sort((left, right) => left.localeCompare(right)));
  return Object.fromEntries(
    roots.map(([name]) => [name, (filesByRoot.get(name) ?? []).map(describeFile)]),
  );
}

const outputPath = resolveOutputPath();
mkdirSync(path.dirname(outputPath), { recursive: true });
mkdirSync(tempRoot, { recursive: true });

const gitStatus = run('git', ['status', '--porcelain=v1']) ?? '';
const gitCommit = run('git', ['rev-parse', 'HEAD']);
const evidence = collectEvidence(outputPath);
const benchmarkFiles = [...(evidence.benchmark ?? []), ...(evidence.profiles ?? [])];
const runningInGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const benchmarkStatusArtifact = (evidence.benchmark ?? []).find((artifact) =>
  artifact.path.endsWith('/benchmark-status.txt'),
);
const benchmarkStatus = benchmarkStatusArtifact
  ? readFileSync(path.join(repositoryRoot, benchmarkStatusArtifact.path), 'utf8').match(/exit_code=(\d+)/)?.[1]
  : null;
const linuxRemoteBenchmarkStatus =
  runningInGitHubActions && process.platform === 'linux' && benchmarkFiles.length > 0 && benchmarkStatus
    ? benchmarkStatus === '0'
      ? 'recorded'
      : 'failed'
    : 'not_recorded';
const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
const toolchainVersion = workspace.match(/^toolchain\s+(\S+)$/m)?.[1] ?? null;
const localGoCandidates = toolchainVersion
  ? [
      path.join(
        tempRoot,
        'toolchain',
        toolchainVersion,
        'go',
        'bin',
        process.platform === 'win32' ? 'go.exe' : 'go',
      ),
      path.join(tempRoot, 'toolchain', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go'),
    ]
  : [];
const goVersion = localGoCandidates.find((candidate) => existsSync(candidate));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: {
    root: '.',
    gitCommit: gitCommit ?? 'unknown',
    dirty: gitStatus.length > 0,
    changedFileCount: gitStatus ? gitStatus.split('\n').filter(Boolean).length : 0,
  },
  toolchain: {
    node: process.version,
    yarn: run('yarn', ['--version']) ?? 'unavailable',
    go: (goVersion ? run(goVersion, ['version']) : run('go', ['version'])) ?? 'unavailable',
    goToolchain: toolchainVersion ?? 'undeclared',
  },
  inputs: [
    'go.work',
    'go.work.sum',
    'Framework/go.mod',
    'Framework/go.sum',
    'Proj/Example/go.mod',
    'Proj/Example/go.sum',
    'package.json',
    'yarn.lock',
  ].map(describeInput),
  evidence,
  boundaries: {
    linuxRemoteBenchmark: {
      status: linuxRemoteBenchmarkStatus,
      reason:
        linuxRemoteBenchmarkStatus === 'recorded'
          ? 'benchmark files were produced and exited successfully on a GitHub Actions Linux runner'
          : linuxRemoteBenchmarkStatus === 'failed'
            ? 'benchmark files were produced on a GitHub Actions Linux runner but the recorded command failed'
            : 'a local manifest cannot prove a successful remote Linux workflow run',
    },
    productionSharedStore: {
      status: 'not_recorded',
      reason: 'no production or equivalent pre-production shared Storage/Locker run was found',
    },
    otelCollector: {
      status: 'not_recorded',
      reason: 'no running OpenTelemetry collector/exporter evidence was found',
    },
    postgresRecovery: {
      status: 'not_recorded',
      reason: 'no PostgreSQL failure and recovery drill artifact was found',
    },
    signedRelease: {
      status: 'not_recorded',
      reason: 'no signature or provenance attestation artifact was found',
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Evidence manifest written to ${relativePath(outputPath)}`);
