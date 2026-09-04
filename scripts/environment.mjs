import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fileMatchesSha256, findGoArchiveChecksum } from './lib/go-download.mjs';
import { isolatedGoToolchainEnvironment } from './lib/go-toolchain-environment.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const frontRoot = path.join(repositoryRoot, 'MSFront');
const toolchainRoot = path.join(repositoryRoot, '.temp', 'toolchain');
const goExecutableName = process.platform === 'win32' ? 'go.exe' : 'go';
const requiredGoVersion = readRequiredGoVersion();

function readRequiredGoVersion() {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  const match = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);
  if (!match) {
    throw new Error('go.work must declare a toolchain version.');
  }
  return match[1];
}

function yarnInvocation(args) {
  const packageManagerPath = process.env.npm_execpath;
  if (packageManagerPath && path.basename(packageManagerPath).toLowerCase().includes('yarn')) {
    return { command: process.execPath, args: [packageManagerPath, ...args], shell: false };
  }
  return {
    command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    args,
    shell: process.platform === 'win32',
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: options.shell ?? false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

async function runYarn(args, cwd) {
  const invocation = yarnInvocation(args);
  await run(invocation.command, invocation.args, { cwd, shell: invocation.shell });
}

function yarnTreeIsCurrent(cwd) {
  if (!existsSync(path.join(cwd, 'node_modules'))) {
    return false;
  }
  const invocation = yarnInvocation(['check', '--verify-tree']);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: invocation.shell,
  });
  return result.status === 0;
}

function goVersion(command) {
  const result = spawnSync(command, ['version'], { encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    return null;
  }
  const match = result.stdout.match(/go version go(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function findGo() {
  const candidates = [
    { command: process.env.GO_BINARY?.trim(), repositoryManaged: false },
    {
      command: path.join(toolchainRoot, `go${requiredGoVersion}`, 'go', 'bin', goExecutableName),
      repositoryManaged: true,
    },
    {
      command: path.join(toolchainRoot, 'go', 'bin', goExecutableName),
      repositoryManaged: true,
    },
    { command: 'go', repositoryManaged: false },
  ].filter((candidate) => candidate.command);

  for (const candidate of candidates) {
    const version = goVersion(candidate.command);
    if (version === requiredGoVersion) {
      return { ...candidate, version };
    }
  }
  return null;
}

function goArchive() {
  const platformNames = { win32: 'windows', linux: 'linux', darwin: 'darwin' };
  const architectureNames = { x64: 'amd64', arm64: 'arm64' };
  const platformName = platformNames[process.platform];
  const architectureName = architectureNames[process.arch];
  if (!platformName || !architectureName) {
    throw new Error(`Automatic Go setup does not support ${process.platform}/${process.arch}. Set GO_BINARY manually.`);
  }
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const fileName = `go${requiredGoVersion}.${platformName}-${architectureName}.${extension}`;
  return { fileName, url: `https://go.dev/dl/${fileName}`, extension };
}

async function installGo() {
  const archive = goArchive();
  const installRoot = path.join(toolchainRoot, `go${requiredGoVersion}`);
  const archivePath = path.join(toolchainRoot, archive.fileName);
  const partialPath = `${archivePath}.part`;
  mkdirSync(installRoot, { recursive: true });

  console.log('[env] Reading the official Go download checksum');
  const metadataResponse = await fetch('https://go.dev/dl/?mode=json&include=all');
  if (!metadataResponse.ok) {
    throw new Error(`Unable to read Go download metadata: HTTP ${metadataResponse.status}`);
  }
  const expectedChecksum = findGoArchiveChecksum(
    await metadataResponse.json(),
    requiredGoVersion,
    archive.fileName,
  );

  if (existsSync(archivePath) && (await fileMatchesSha256(archivePath, expectedChecksum))) {
    console.log(`[env] Reusing verified Go archive: ${archive.fileName}`);
  } else {
    console.log(`[env] Downloading Go ${requiredGoVersion} from ${archive.url}`);
    try {
      const response = await fetch(archive.url);
      if (!response.ok || !response.body) {
        throw new Error(`Unable to download Go: HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));
      if (!(await fileMatchesSha256(partialPath, expectedChecksum))) {
        throw new Error(`Go archive SHA-256 verification failed for ${archive.fileName}.`);
      }
      rmSync(archivePath, { force: true });
      renameSync(partialPath, archivePath);
    } catch (error) {
      rmSync(partialPath, { force: true });
      throw error;
    }
  }

  if (process.platform === 'win32') {
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:GOEXAMPLE_GO_ARCHIVE -DestinationPath $env:GOEXAMPLE_GO_INSTALL_ROOT -Force',
      ],
      {
        env: {
          ...process.env,
          GOEXAMPLE_GO_ARCHIVE: archivePath,
          GOEXAMPLE_GO_INSTALL_ROOT: installRoot,
        },
      },
    );
  } else {
    await run('tar', ['-xzf', archivePath, '-C', installRoot]);
  }

  const command = path.join(installRoot, 'go', 'bin', goExecutableName);
  const version = goVersion(command);
  if (!version) {
    throw new Error(`Go extraction completed but ${command} is not executable.`);
  }
  return { command, version, repositoryManaged: true };
}

function goModuleRoots() {
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  const useBlock = workspace.match(/^use\s*\(([^]*?)^\)/m)?.[1];
  if (!useBlock) {
    throw new Error('go.work must declare workspace modules in a use block.');
  }
  const modulePaths = useBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
  if (modulePaths.length === 0) {
    throw new Error('go.work must contain at least one workspace module.');
  }
  return modulePaths.map((modulePath) => {
    if (!modulePath.startsWith('./') || modulePath.includes('..')) {
      throw new Error(`go.work contains an unsafe workspace module path: ${modulePath}`);
    }
    const moduleRoot = path.resolve(repositoryRoot, modulePath);
    if (
      !moduleRoot.startsWith(`${repositoryRoot}${path.sep}`) ||
      !existsSync(path.join(moduleRoot, 'go.mod'))
    ) {
      throw new Error(`go.work module was not found inside the repository: ${modulePath}`);
    }
    return moduleRoot;
  });
}

async function main() {
  console.log('[env] Installing root Yarn dependencies');
  await runYarn(['install', '--frozen-lockfile', '--non-interactive'], repositoryRoot);

  let go = findGo();
  if (!go) {
    go = await installGo();
  }
  console.log(`[env] Using Go ${go.version}: ${go.command}`);

  const goEnvironment = go.repositoryManaged
    ? isolatedGoToolchainEnvironment(process.env, { GOWORK: 'off' })
    : { ...process.env, GOWORK: 'off' };
  for (const moduleRoot of goModuleRoots()) {
    console.log(`[env] Downloading Go dependencies: ${path.relative(repositoryRoot, moduleRoot)}`);
    await run(go.command, ['-C', moduleRoot, 'mod', 'download'], { env: goEnvironment });
    await run(go.command, ['-C', moduleRoot, 'mod', 'verify'], { env: goEnvironment });
  }

  console.log('[env] Installing MSFront Yarn dependencies');
  if (yarnTreeIsCurrent(frontRoot)) {
    console.log('[env] MSFront dependency tree is already current');
  } else {
    await runYarn(['install', '--frozen-lockfile', '--non-interactive'], frontRoot);
  }
  console.log('[env] Environment is ready');
}

main().catch((error) => {
  console.error(`[env] ${error.message}`);
  process.exitCode = 1;
});
