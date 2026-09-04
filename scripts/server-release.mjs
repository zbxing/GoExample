import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isolatedGoToolchainEnvironment,
  selectRepositoryToolCommand,
} from './lib/go-toolchain-environment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const task = process.argv[2];
const entrypoint = './Solutions/Example/cmd/server';
const maxArtifactBytes = 128 * 1024 * 1024;
const maxSourceManifestBytes = 1024 * 1024;
const maxSourceInputFiles = 4096;
const maxSourceInputFileBytes = 16 * 1024 * 1024;
const maxSourceInputTotalBytes = 64 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sourceInputFields = [
  'GoFiles',
  'CgoFiles',
  'CFiles',
  'CXXFiles',
  'MFiles',
  'HFiles',
  'FFiles',
  'SFiles',
  'SwigFiles',
  'SwigCXXFiles',
  'SysoFiles',
  'EmbedFiles',
];
const sourceManifestLimitations = [
  'covers repository-local build inputs selected for the pinned target plus the workspace, module, version, and build-script files',
  'does not independently attest external module bytes, the Go toolchain distribution, the complete build environment, or remote provenance',
];

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

function encodeChecksums(entries) {
  return entries.map(([sha256, name]) => `${sha256}  ${name}\n`).join('');
}

function encodeJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function parseJSONSequence(source, name) {
  const values = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? '')) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }
    if (source[index] !== '{') {
      fail(`${name} must contain a sequence of JSON objects`);
    }
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let completed = false;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            values.push(JSON.parse(source.slice(start, index + 1)));
          } catch {
            fail(`${name} must contain valid JSON objects`);
          }
          index += 1;
          completed = true;
          break;
        }
      }
    }
    if (!completed) {
      fail(`${name} contains an incomplete JSON object`);
    }
  }
  return values;
}

function repositoryRelativePath(filePath, name) {
  if (!isWithin(repositoryRoot, filePath)) {
    fail(`${name} must stay inside the repository`);
  }
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function resolveRepositoryInput(recordedPath, name) {
  if (
    typeof recordedPath !== 'string' ||
    recordedPath.length === 0 ||
    Buffer.byteLength(recordedPath, 'utf8') > 512 ||
    /[\\\x00-\x1f\x7f]/.test(recordedPath) ||
    path.posix.isAbsolute(recordedPath) ||
    path.posix.normalize(recordedPath) !== recordedPath ||
    recordedPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${name} path is unsafe`);
  }
  const resolved = path.resolve(repositoryRoot, ...recordedPath.split('/'));
  if (!isWithin(repositoryRoot, resolved)) {
    fail(`${name} path must stay inside the repository`);
  }
  return resolved;
}

function collectSourceManifest(environment) {
  const fields = ['Dir', 'Module', ...sourceInputFields].join(',');
  const output = run(goCommand, ['list', '-deps', `-json=${fields}`, entrypoint], {
    env: environment,
    description: 'resolve repository-local server release inputs',
  });
  const packages = parseJSONSequence(output, 'go list output');
  if (packages.length === 0) {
    fail('go list did not return the server dependency closure');
  }

  const inputs = new Map();
  function addInput(filePath, name) {
    const resolved = path.resolve(filePath);
    const relativePath = repositoryRelativePath(resolved, name);
    const stats = requireRegularFile(resolved, name);
    if (stats.size > maxSourceInputFileBytes) {
      fail(`${name} exceeds the source input size limit`);
    }
    inputs.set(relativePath, resolved);
  }

  for (const relativePath of ['go.work', 'package.json', 'scripts/server-release.mjs']) {
    addInput(path.join(repositoryRoot, ...relativePath.split('/')), `source input ${relativePath}`);
  }
  const workspaceSum = path.join(repositoryRoot, 'go.work.sum');
  if (existsSync(workspaceSum)) {
    addInput(workspaceSum, 'source input go.work.sum');
  }

  for (const packageData of packages) {
    if (typeof packageData?.Dir !== 'string') {
      continue;
    }
    const packageDirectory = path.resolve(packageData.Dir);
    const replacementDirectory = packageData.Module?.Replace?.Dir;
    const repositoryReplacement =
      typeof replacementDirectory === 'string' &&
      isWithin(repositoryRoot, path.resolve(replacementDirectory)) &&
      !isWithin(tempRoot, path.resolve(replacementDirectory));
    if (
      !isWithin(repositoryRoot, packageDirectory) ||
      isWithin(tempRoot, packageDirectory) ||
      (packageData.Module?.Main !== true && !repositoryReplacement)
    ) {
      continue;
    }
    for (const field of sourceInputFields) {
      const fileNames = packageData[field];
      if (!Array.isArray(fileNames)) {
        continue;
      }
      for (const fileName of fileNames) {
        if (typeof fileName !== 'string' || fileName.length === 0) {
          fail(`go list returned an invalid ${field} entry`);
        }
        const filePath = path.resolve(packageDirectory, fileName);
        if (!isWithin(packageDirectory, filePath)) {
          fail(`go list ${field} entry must stay inside its package directory`);
        }
        addInput(filePath, `source input ${field}`);
      }
    }

    const moduleGoMod = packageData.Module?.Replace?.GoMod ?? packageData.Module?.GoMod;
    if (typeof moduleGoMod === 'string') {
      const goModPath = path.resolve(moduleGoMod);
      if (isWithin(repositoryRoot, goModPath)) {
        addInput(goModPath, 'source input module go.mod');
        const goSumPath = path.join(path.dirname(goModPath), 'go.sum');
        if (existsSync(goSumPath)) {
          addInput(goSumPath, 'source input module go.sum');
        }
      }
    }
  }

  const paths = [...inputs.keys()].sort();
  if (paths.length === 0 || paths.length > maxSourceInputFiles) {
    fail(`source manifest must contain between 1 and ${maxSourceInputFiles} files`);
  }
  let totalBytes = 0;
  const files = paths.map((relativePath) => {
    const filePath = inputs.get(relativePath);
    const stats = requireRegularFile(filePath, `source input ${relativePath}`);
    totalBytes += stats.size;
    if (totalBytes > maxSourceInputTotalBytes) {
      fail('source inputs exceed the total size limit');
    }
    return {
      path: relativePath,
      bytes: stats.size,
      sha256: hashFile(filePath),
    };
  });
  return {
    schemaVersion: 1,
    scope: 'goexample_server_release_sources',
    entrypoint,
    files,
    limitations: sourceManifestLimitations,
  };
}

function verifySourceManifest(reference, environment) {
  assertExactKeys(reference, ['name', 'bytes', 'sha256'], 'manifest.source.manifest');
  if (
    reference.name !== sourceManifestName ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes <= 0 ||
    reference.bytes > maxSourceManifestBytes ||
    typeof reference.sha256 !== 'string' ||
    !sha256Pattern.test(reference.sha256)
  ) {
    fail('release source manifest reference is invalid');
  }
  const stats = requireRegularFile(sourceManifestPath, 'source manifest');
  if (stats.size !== reference.bytes || hashFile(sourceManifestPath) !== reference.sha256) {
    fail('source manifest does not match the release manifest reference');
  }
  const source = readFileSync(sourceManifestPath, 'utf8');
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    fail('source manifest must contain valid JSON');
  }
  assertExactKeys(document, ['schemaVersion', 'scope', 'entrypoint', 'files', 'limitations'], 'source manifest');
  if (
    document.schemaVersion !== 1 ||
    document.scope !== 'goexample_server_release_sources' ||
    document.entrypoint !== entrypoint ||
    !Array.isArray(document.files) ||
    document.files.length === 0 ||
    document.files.length > maxSourceInputFiles ||
    !Array.isArray(document.limitations) ||
    document.limitations.length !== sourceManifestLimitations.length ||
    document.limitations.some((value, index) => value !== sourceManifestLimitations[index])
  ) {
    fail('source manifest metadata is invalid');
  }
  let previousPath = null;
  let totalBytes = 0;
  for (const [index, file] of document.files.entries()) {
    assertExactKeys(file, ['path', 'bytes', 'sha256'], `source manifest file ${index}`);
    const filePath = resolveRepositoryInput(file.path, `source manifest file ${index}`);
    if (previousPath !== null && previousPath >= file.path) {
      fail('source manifest file paths must be unique and sorted');
    }
    previousPath = file.path;
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > maxSourceInputFileBytes ||
      typeof file.sha256 !== 'string' ||
      !sha256Pattern.test(file.sha256)
    ) {
      fail(`source manifest file ${index} metadata is invalid`);
    }
    totalBytes += file.bytes;
    if (totalBytes > maxSourceInputTotalBytes) {
      fail('source manifest files exceed the total size limit');
    }
    const inputStats = requireRegularFile(filePath, `source manifest input ${file.path}`);
    if (inputStats.size !== file.bytes || hashFile(filePath) !== file.sha256) {
      fail(`source manifest input does not match: ${file.path}`);
    }
  }
  if (source !== encodeJSON(collectSourceManifest(environment))) {
    fail('source manifest does not exactly match the current server release input closure');
  }
}

function readReleaseSnapshot(root, name) {
  const localManifestPath = path.join(root, 'release-manifest.json');
  const localChecksumPath = path.join(root, 'SHA256SUMS');
  const localSourceManifestPath = path.join(root, 'source-manifest.json');
  requireRegularFile(localManifestPath, `${name} manifest`);
  requireRegularFile(localChecksumPath, `${name} checksums`);
  const sourceManifestStats = requireRegularFile(localSourceManifestPath, `${name} source manifest`);
  const manifestSource = readFileSync(localManifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    fail(`${name} manifest must contain valid JSON`);
  }
  const subjectName = manifest?.subject?.name;
  if (typeof subjectName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(subjectName)) {
    fail(`${name} manifest subject is invalid`);
  }
  const localArtifactPath = path.join(root, subjectName);
  const artifactStats = requireRegularFile(localArtifactPath, `${name} artifact`);
  return {
    manifest,
    manifestSHA256: hashFile(localManifestPath),
    manifestSource,
    checksumSource: readFileSync(localChecksumPath, 'utf8'),
    sourceManifestSource: readFileSync(localSourceManifestPath, 'utf8'),
    sourceManifestSHA256: hashFile(localSourceManifestPath),
    sourceManifestBytes: sourceManifestStats.size,
    artifactSHA256: hashFile(localArtifactPath),
    artifactBytes: artifactStats.size,
  };
}

function verifyReproducibilityReport(manifest) {
  if (!existsSync(reproducibilityReportPath)) {
    return;
  }
  requireRegularFile(reproducibilityReportPath, 'reproducibility report');
  const bytes = readFileSync(reproducibilityReportPath);
  if (bytes.length === 0 || bytes.length > 16 * 1024) {
    fail('reproducibility report must be between 1 byte and 16 KiB');
  }
  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('reproducibility report must contain valid JSON');
  }
  assertExactKeys(
    report,
    ['schemaVersion', 'scope', 'subject', 'sourceManifest', 'sourceCommit', 'buildIsolation', 'runs', 'limitations'],
    'reproducibility report',
  );
  assertExactKeys(report.subject, ['name', 'bytes', 'sha256'], 'reproducibility report subject');
  assertExactKeys(report.sourceManifest, ['name', 'bytes', 'sha256'], 'reproducibility report sourceManifest');
  assertExactKeys(
    report.buildIsolation,
    ['goBuildCache', 'goTemporaryDirectory', 'moduleCache'],
    'reproducibility report buildIsolation',
  );
  if (
    report.schemaVersion !== 3 ||
    report.scope !== 'goexample_server_release_reproducibility' ||
    report.subject.name !== manifest.subject.name ||
    report.subject.bytes !== manifest.subject.bytes ||
    report.subject.sha256 !== manifest.subject.sha256 ||
    report.sourceManifest.name !== manifest.source.manifest.name ||
    report.sourceManifest.bytes !== manifest.source.manifest.bytes ||
    report.sourceManifest.sha256 !== manifest.source.manifest.sha256 ||
    report.sourceCommit !== manifest.build.commit ||
    report.buildIsolation.goBuildCache !== 'separate-empty-directories' ||
    report.buildIsolation.goTemporaryDirectory !== 'separate-empty-directories' ||
    report.buildIsolation.moduleCache !== 'shared' ||
    !Array.isArray(report.runs) ||
    report.runs.length !== 2 ||
    !Array.isArray(report.limitations) ||
    report.limitations.length !== 2
  ) {
    fail('reproducibility report metadata is invalid');
  }
  const manifestSHA256 = hashFile(manifestPath);
  for (const [index, run] of report.runs.entries()) {
    assertExactKeys(
      run,
      [
        'id',
        'artifactSHA256',
        'manifestSHA256',
        'sourceManifestSHA256',
        'goBuildCacheId',
        'goBuildCacheEmptyBeforeBuild',
        'goBuildCachePopulatedAfterBuild',
        'goTemporaryDirectoryId',
        'goTemporaryDirectoryEmptyBeforeBuild',
      ],
      `reproducibility report run ${index}`,
    );
    const expectedID = index === 0 ? 'first' : 'second';
    if (
      run.id !== expectedID ||
      run.artifactSHA256 !== manifest.subject.sha256 ||
      run.manifestSHA256 !== manifestSHA256 ||
      run.sourceManifestSHA256 !== manifest.source.manifest.sha256 ||
      run.goBuildCacheId !== `${expectedID}-cache` ||
      run.goBuildCacheEmptyBeforeBuild !== true ||
      run.goBuildCachePopulatedAfterBuild !== true ||
      run.goTemporaryDirectoryId !== `${expectedID}-tmp` ||
      run.goTemporaryDirectoryEmptyBeforeBuild !== true
    ) {
      fail('reproducibility report does not match the verified release');
    }
  }
  const expectedLimitations = [
    'same-host output repeatability and repository-local source hashes still share the module cache and do not independently attest external module bytes, the toolchain distribution, the complete build environment, or remote provenance',
    'matching binaries do not prove target deployment, rollout, or runtime behavior',
  ];
  if (report.limitations.some((value, index) => value !== expectedLimitations[index])) {
    fail('reproducibility report limitations are invalid');
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
const sourceManifestName = 'source-manifest.json';
const sourceManifestPath = path.join(releaseRoot, sourceManifestName);
const reproducibilityReportPath = path.join(releaseRoot, 'reproducibility-report.json');
const reproducibilityWorkRoot = path.join(tempRoot, 'server-release-reproducibility');
const executableName = process.platform === 'win32' ? 'go.exe' : 'go';
const goCommand = selectRepositoryToolCommand({
  configuredCommand: process.env.GO_BINARY,
  repositoryCandidates: [
    path.join(tempRoot, 'toolchain', `go${toolchainVersion}`, 'go', 'bin', executableName),
    path.join(tempRoot, 'toolchain', 'go', 'bin', executableName),
  ],
  fallbackCommand: executableName,
}).command;
if (!goCommand) {
  fail('Go was not found; run yarn env or set GO_BINARY');
}

function coreChecksumSource(manifest) {
  return encodeChecksums([
    [manifest.subject.sha256, manifest.subject.name],
    [hashFile(manifestPath), 'release-manifest.json'],
    [hashFile(sourceManifestPath), sourceManifestName],
  ]);
}

function expectedChecksumSource(manifest) {
  const source = coreChecksumSource(manifest);
  return existsSync(reproducibilityReportPath)
    ? `${source}${encodeChecksums([[hashFile(reproducibilityReportPath), 'reproducibility-report.json']])}`
    : source;
}

function snapshotCoreChecksumSource(snapshot) {
  return encodeChecksums([
    [snapshot.artifactSHA256, snapshot.manifest.subject.name],
    [snapshot.manifestSHA256, 'release-manifest.json'],
    [snapshot.sourceManifestSHA256, sourceManifestName],
  ]);
}

function goEnvironment() {
  const goCacheRoot = process.env.GOCACHE?.trim() || path.join(tempRoot, 'gocache');
  const goTemporaryRoot = process.env.GOTMPDIR?.trim() || path.join(tempRoot, 'go-tmp');
  mkdirSync(goCacheRoot, { recursive: true });
  mkdirSync(goTemporaryRoot, { recursive: true });
  const environment = isolatedGoToolchainEnvironment(process.env, {
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
    GOTOOLCHAIN: 'local',
    GOCACHE: goCacheRoot,
    GOTMPDIR: goTemporaryRoot,
  });
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
  const sourceManifestSource = encodeJSON(collectSourceManifest(environment));
  const commit = git(['rev-parse', 'HEAD'], 'resolve Git commit');
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    fail('Git commit must be a full lowercase SHA-1');
  }
  const commitTime = git(['show', '-s', '--format=%cI', 'HEAD'], 'resolve Git commit time');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(commitTime)) {
    fail('Git commit time must be a canonical ISO-8601 timestamp');
  }
  const sourceDirty = git(['status', '--porcelain=v1', '--untracked-files=all'], 'inspect Git status') !== '';
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
    ['build', '-p=1', '-trimpath', '-buildvcs=false', '-ldflags', ldflags, '-o', artifactPath, entrypoint],
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
  if (sourceManifestSource !== encodeJSON(collectSourceManifest(environment))) {
    fail('server release inputs changed while the artifact was being built');
  }
  writeFileSync(sourceManifestPath, sourceManifestSource, 'utf8');
  const sourceManifestStats = requireRegularFile(sourceManifestPath, 'source manifest');
  const manifest = {
    schemaVersion: 2,
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
      manifest: {
        name: sourceManifestName,
        bytes: sourceManifestStats.size,
        sha256: hashFile(sourceManifestPath),
      },
    },
    limitations: [
      'repository-local source hashes do not independently attest external module bytes, the toolchain distribution, the complete build environment, or remote provenance',
      'signedRelease remains not_recorded until a remote GitHub attestation is generated and verified',
      'the linux_amd64 artifact does not prove target deployment, rollout, or runtime behavior',
    ],
  };
  writeFileSync(manifestPath, encodeJSON(manifest), 'utf8');
  writeFileSync(checksumPath, expectedChecksumSource(manifest), 'utf8');
  console.log(`Server release built: ${path.relative(repositoryRoot, artifactPath)}`);
}

function verify() {
  const environment = goEnvironment();
  validateGoVersion(environment);
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
  assertExactKeys(manifest.source, ['repository', 'entrypoint', 'dirty', 'manifest'], 'manifest.source');
  if (manifest.schemaVersion !== 2 || manifest.scope !== 'goexample_server_release') {
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
  verifySourceManifest(manifest.source.manifest, environment);
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
  verifyReproducibilityReport(manifest);
  const checksums = readFileSync(checksumPath, 'utf8');
  if (checksums !== expectedChecksumSource(manifest)) {
    fail('SHA256SUMS must contain exactly the expected attested release subjects');
  }
  console.log(`Server release verified: ${artifactName} (${manifest.subject.sha256})`);
}

function runReleaseTask(taskName, targetRoot, description, environment = {}) {
  const requestedRoot = path.relative(repositoryRoot, targetRoot);
  if (!requestedRoot || path.isAbsolute(requestedRoot) || requestedRoot.startsWith(`..${path.sep}`)) {
    fail(`${description} root must stay inside the repository`);
  }
  run(process.execPath, [fileURLToPath(import.meta.url), taskName], {
    env: {
      ...process.env,
      ...environment,
      SERVER_RELEASE_ROOT: requestedRoot,
    },
    description,
  });
}

function reproducible() {
  verify();
  const canonical = readReleaseSnapshot(releaseRoot, 'canonical release');
  const canonicalCoreChecksums = snapshotCoreChecksumSource(canonical);
  const workRoot = path.join(reproducibilityWorkRoot, `${process.pid}`);
  if (!isWithin(tempRoot, workRoot)) {
    fail('reproducibility work root must stay inside the repository .temp directory');
  }
  const firstRoot = path.join(workRoot, 'first');
  const secondRoot = path.join(workRoot, 'second');
  rmSync(workRoot, { recursive: true, force: true });
  try {
    const isolation = new Map();
    for (const [name, root] of [['first', firstRoot], ['second', secondRoot]]) {
      const goBuildCache = path.join(workRoot, 'go-build-cache', name);
      const goTemporaryDirectory = path.join(workRoot, 'go-tmp', name);
      for (const [directory, description] of [
        [goBuildCache, `${name} Go build cache`],
        [goTemporaryDirectory, `${name} Go temporary directory`],
      ]) {
        if (!isWithin(workRoot, directory)) {
          fail(`${description} must stay inside the reproducibility work root`);
        }
        mkdirSync(directory, { recursive: true });
        if (readdirSync(directory).length !== 0) {
          fail(`${description} must be empty before the witness build`);
        }
      }
      const environment = { GOCACHE: goBuildCache, GOTMPDIR: goTemporaryDirectory };
      runReleaseTask('build', root, `build ${name} reproducibility witness`, environment);
      if (readdirSync(goBuildCache).length === 0) {
        fail(`${name} Go build cache was not populated by the witness build`);
      }
      runReleaseTask('verify', root, `verify ${name} reproducibility witness`, environment);
      isolation.set(name, {
        goBuildCacheId: `${name}-cache`,
        goBuildCacheEmptyBeforeBuild: true,
        goBuildCachePopulatedAfterBuild: true,
        goTemporaryDirectoryId: `${name}-tmp`,
        goTemporaryDirectoryEmptyBeforeBuild: true,
      });
    }
    const first = readReleaseSnapshot(firstRoot, 'first reproducibility witness');
    const second = readReleaseSnapshot(secondRoot, 'second reproducibility witness');
    for (const snapshot of [first, second]) {
      if (
        snapshot.manifestSource !== canonical.manifestSource ||
        snapshot.checksumSource !== canonicalCoreChecksums ||
        snapshot.sourceManifestSource !== canonical.sourceManifestSource ||
        snapshot.artifactSHA256 !== canonical.artifactSHA256 ||
        snapshot.artifactBytes !== canonical.artifactBytes
      ) {
        fail('reproducibility witnesses do not exactly match the canonical release');
      }
    }
    const report = {
      schemaVersion: 3,
      scope: 'goexample_server_release_reproducibility',
      subject: {
        name: canonical.manifest.subject.name,
        bytes: canonical.artifactBytes,
        sha256: canonical.artifactSHA256,
      },
      sourceCommit: canonical.manifest.build.commit,
      sourceManifest: canonical.manifest.source.manifest,
      buildIsolation: {
        goBuildCache: 'separate-empty-directories',
        goTemporaryDirectory: 'separate-empty-directories',
        moduleCache: 'shared',
      },
      runs: [
        {
          id: 'first',
          artifactSHA256: first.artifactSHA256,
          manifestSHA256: first.manifestSHA256,
          sourceManifestSHA256: first.sourceManifestSHA256,
          ...isolation.get('first'),
        },
        {
          id: 'second',
          artifactSHA256: second.artifactSHA256,
          manifestSHA256: second.manifestSHA256,
          sourceManifestSHA256: second.sourceManifestSHA256,
          ...isolation.get('second'),
        },
      ],
      limitations: [
        'same-host output repeatability and repository-local source hashes still share the module cache and do not independently attest external module bytes, the toolchain distribution, the complete build environment, or remote provenance',
        'matching binaries do not prove target deployment, rollout, or runtime behavior',
      ],
    };
    writeFileSync(reproducibilityReportPath, encodeJSON(report), 'utf8');
    writeFileSync(checksumPath, expectedChecksumSource(canonical.manifest), 'utf8');
    verify();
    console.log(`Server release output is reproducible across two separate build directories: ${artifactName} (${canonical.artifactSHA256})`);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

if (task === 'build') {
  build();
} else if (task === 'verify') {
  verify();
} else if (task === 'reproducible') {
  reproducible();
} else {
  fail('task must be build, verify, or reproducible');
}
