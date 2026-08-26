import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const task = process.argv[2];
const entrypoint = './Solutions/Example/cmd/server';
const maxArtifactBytes = 128 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Server release: ${message}`);
  process.exit(1);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveReleaseRoot() {
  const requested = process.env.SERVER_RELEASE_ROOT?.trim() || path.join('.temp', 'server-release');
  const releaseRoot = path.resolve(repositoryRoot, requested);
  if (!isWithin(tempRoot, releaseRoot)) {
    fail('SERVER_RELEASE_ROOT must resolve to a child directory of the repository .temp directory');
  }
  return releaseRoot;
}

function requireRegularFile(filePath, name) {
  if (!existsSync(filePath)) {
    fail(`${name} does not exist`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`${name} must be a regular file and not a symbolic link`);
  }
  return stats;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}`.trim() || `${result.stdout ?? ''}`.trim();
    fail(`${options.description ?? command} failed${detail ? `: ${detail}` : ''}`);
  }
  return `${result.stdout ?? ''}`.trim();
}

function git(args, description) {
  return run('git', args, { description });
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(assertObject(value, name)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${name} fields do not match the release schema`);
  }
}

const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
const toolchainVersion = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m)?.[1];
if (!toolchainVersion) {
  fail('go.work must declare an exact Go patch toolchain');
}
const packageDocument = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const releaseVersion = packageDocument.version;
if (typeof releaseVersion !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(releaseVersion)) {
  fail('package.json version must be a safe semantic version');
}
const artifactName = `goexample-api_${releaseVersion}_linux_amd64`;
const releaseRoot = resolveReleaseRoot();
const artifactPath = path.join(releaseRoot, artifactName);
const manifestPath = path.join(releaseRoot, 'release-manifest.json');
const checksumPath = path.join(releaseRoot, 'SHA256SUMS');
const executableName = process.platform === 'win32' ? 'go.exe' : 'go';
const goCandidates = [
  process.env.GO_BINARY?.trim(),
  path.join(tempRoot, 'toolchain', `go${toolchainVersion}`, 'go', 'bin', executableName),
  path.join(tempRoot, 'toolchain', 'go', 'bin', executableName),
  executableName,
].filter(Boolean);
const goCommand = goCandidates.find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate));
if (!goCommand) {
  fail('Go was not found; run yarn env or set GO_BINARY');
}

function goEnvironment() {
  const goCacheRoot = process.env.GOCACHE?.trim() || path.join(tempRoot, 'gocache');
  const goTemporaryRoot = process.env.GOTMPDIR?.trim() || path.join(tempRoot, 'go-tmp');
  mkdirSync(goCacheRoot, { recursive: true });
  mkdirSync(goTemporaryRoot, { recursive: true });
  const environment = {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
    GOTOOLCHAIN: 'local',
    GOCACHE: goCacheRoot,
    GOTMPDIR: goTemporaryRoot,
  };
  const pathKey = Object.keys(environment).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  if (path.isAbsolute(goCommand)) {
    environment[pathKey] = `${path.dirname(goCommand)}${path.delimiter}${environment[pathKey] ?? ''}`;
  }
  return environment;
}

function validateGoVersion(environment) {
  const output = run(goCommand, ['version'], {
    env: environment,
    description: 'go version',
  });
  if (!new RegExp(`^go version go${toolchainVersion.replaceAll('.', '\\.')} `).test(output)) {
    fail(`Go toolchain must be exactly go${toolchainVersion}`);
  }
  return output;
}

function verifyELF(binary) {
  if (
    binary.length < 20 ||
    binary[0] !== 0x7f ||
    binary[1] !== 0x45 ||
    binary[2] !== 0x4c ||
    binary[3] !== 0x46 ||
    binary[4] !== 2 ||
    binary[5] !== 1 ||
    binary.readUInt16LE(18) !== 0x3e
  ) {
    fail('release artifact must be a little-endian ELF64 amd64 binary');
  }
}

function build() {
  const environment = goEnvironment();
  const goVersion = validateGoVersion(environment);
  const commit = git(['rev-parse', 'HEAD'], 'resolve Git commit');
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    fail('Git commit must be a full lowercase SHA-1');
  }
  const commitTime = git(['show', '-s', '--format=%cI', 'HEAD'], 'resolve Git commit time');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(commitTime)) {
    fail('Git commit time must be a canonical ISO-8601 timestamp');
  }
  const sourceDirty = git(['status', '--porcelain=v1', '--untracked-files=no'], 'inspect Git status') !== '';
  if (process.env.SERVER_RELEASE_REQUIRE_CLEAN === 'true' && sourceDirty) {
    fail('release source must be clean when SERVER_RELEASE_REQUIRE_CLEAN=true');
  }

  rmSync(releaseRoot, { recursive: true, force: true });
  mkdirSync(releaseRoot, { recursive: true });
  const ldflags = [
    '-s',
    '-w',
    `-X main.version=${releaseVersion}`,
    `-X main.commit=${commit}`,
    `-X main.buildTime=${commitTime}`,
  ].join(' ');
  run(
    goCommand,
    ['build', '-trimpath', '-buildvcs=false', '-ldflags', ldflags, '-o', artifactPath, entrypoint],
    { env: environment, description: 'build Linux server release' },
  );
  chmodSync(artifactPath, 0o755);
  const stats = requireRegularFile(artifactPath, 'release artifact');
  if (stats.size <= 0 || stats.size > maxArtifactBytes) {
    fail(`release artifact size must be between 1 and ${maxArtifactBytes} bytes`);
  }
  const binary = readFileSync(artifactPath);
  verifyELF(binary);
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const manifest = {
    schemaVersion: 1,
    scope: 'goexample_server_release',
    subject: {
      name: artifactName,
      bytes: stats.size,
      sha256,
    },
    target: {
      os: 'linux',
      architecture: 'amd64',
      cgoEnabled: false,
    },
    build: {
      version: releaseVersion,
      commit,
      commitTime,
      toolchain: `go${toolchainVersion}`,
      goVersion,
      trimpath: true,
      buildVCS: false,
    },
    source: {
      repository: 'github.com/zbxing/goexample',
      entrypoint,
      dirty: sourceDirty,
    },
    limitations: [
      'a local checksum is not a signature or provenance attestation',
      'signedRelease remains not_recorded until a remote GitHub attestation is generated and verified',
      'the linux_amd64 artifact does not prove target deployment, rollout, or runtime behavior',
    ],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(checksumPath, `${sha256}  ${artifactName}\n`, 'utf8');
  console.log(`Server release built: ${path.relative(repositoryRoot, artifactPath)}`);
}

function verify() {
  requireRegularFile(manifestPath, 'release manifest');
  requireRegularFile(checksumPath, 'release checksums');
  const manifestBytes = readFileSync(manifestPath);
  if (manifestBytes.length === 0 || manifestBytes.length > 64 * 1024) {
    fail('release manifest must be between 1 byte and 64 KiB');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('release manifest must contain valid JSON');
  }
  assertExactKeys(manifest, ['schemaVersion', 'scope', 'subject', 'target', 'build', 'source', 'limitations'], 'manifest');
  assertExactKeys(manifest.subject, ['name', 'bytes', 'sha256'], 'manifest.subject');
  assertExactKeys(manifest.target, ['os', 'architecture', 'cgoEnabled'], 'manifest.target');
  assertExactKeys(
    manifest.build,
    ['version', 'commit', 'commitTime', 'toolchain', 'goVersion', 'trimpath', 'buildVCS'],
    'manifest.build',
  );
  assertExactKeys(manifest.source, ['repository', 'entrypoint', 'dirty'], 'manifest.source');
  if (manifest.schemaVersion !== 1 || manifest.scope !== 'goexample_server_release') {
    fail('release manifest schema version or scope is invalid');
  }
  if (
    manifest.subject.name !== artifactName ||
    !Number.isSafeInteger(manifest.subject.bytes) ||
    manifest.subject.bytes <= 0 ||
    manifest.subject.bytes > maxArtifactBytes ||
    typeof manifest.subject.sha256 !== 'string' ||
    !sha256Pattern.test(manifest.subject.sha256)
  ) {
    fail('release manifest subject is invalid');
  }
  if (manifest.target.os !== 'linux' || manifest.target.architecture !== 'amd64' || manifest.target.cgoEnabled !== false) {
    fail('release manifest target must be linux/amd64 with CGO disabled');
  }
  if (
    manifest.build.version !== releaseVersion ||
    !/^[a-f0-9]{40}$/.test(manifest.build.commit) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(manifest.build.commitTime) ||
    manifest.build.toolchain !== `go${toolchainVersion}` ||
    typeof manifest.build.goVersion !== 'string' ||
    !manifest.build.goVersion.startsWith(`go version go${toolchainVersion} `) ||
    manifest.build.trimpath !== true ||
    manifest.build.buildVCS !== false
  ) {
    fail('release manifest build metadata is invalid');
  }
  if (
    manifest.source.repository !== 'github.com/zbxing/goexample' ||
    manifest.source.entrypoint !== entrypoint ||
    typeof manifest.source.dirty !== 'boolean'
  ) {
    fail('release manifest source metadata is invalid');
  }
  if (
    !Array.isArray(manifest.limitations) ||
    manifest.limitations.length !== 3 ||
    manifest.limitations.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    fail('release manifest limitations must contain the three evidence boundaries');
  }

  const artifactStats = requireRegularFile(artifactPath, 'release artifact');
  if (artifactStats.size !== manifest.subject.bytes || statSync(artifactPath).size !== manifest.subject.bytes) {
    fail('release artifact size does not match the manifest');
  }
  const binary = readFileSync(artifactPath);
  verifyELF(binary);
  if (hashFile(artifactPath) !== manifest.subject.sha256) {
    fail('release artifact SHA-256 does not match the manifest');
  }
  const checksums = readFileSync(checksumPath, 'utf8');
  if (checksums !== `${manifest.subject.sha256}  ${artifactName}\n`) {
    fail('SHA256SUMS must contain exactly the attested release subject');
  }
  console.log(`Server release verified: ${artifactName} (${manifest.subject.sha256})`);
}

if (task === 'build') {
  build();
} else if (task === 'verify') {
  verify();
} else {
  fail('task must be build or verify');
}
