import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  createServerReleaseCommandRunner,
  serverReleaseCommandDiagnosticCharacterLimit,
  serverReleaseCommandMaximumDurationMs,
  serverReleaseCommandMaximumOutputBytes,
  serverReleaseMetadataCommandTimeoutMs,
} from '../../scripts/lib/server-release-command.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const releaseRoot = path.join(repositoryRoot, '.temp', 'server-release-test', `${process.pid}`);
const releaseRootRelative = path.relative(repositoryRoot, releaseRoot);
const scriptPath = path.join(repositoryRoot, 'scripts', 'server-release.mjs');

function run(task, environment = {}) {
  return spawnSync(process.execPath, [scriptPath, task], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment, SERVER_RELEASE_ROOT: releaseRootRelative },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function encodeChecksums(entries) {
  return entries.map(([sha256, name]) => `${sha256}  ${name}\n`).join('');
}

test('server release command runner applies bounded non-shell options', () => {
  const calls = [];
  const environment = { GOFLAGS: '-mod=readonly' };
  const runCommand = createServerReleaseCommandRunner({
    cwd: repositoryRoot,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null, error: null, stdout: ' go version go1.25.13 windows/amd64 \n' };
    },
  });

  assert.equal(
    runCommand('go', ['version'], {
      description: 'go version',
      env: environment,
      timeoutMs: serverReleaseMetadataCommandTimeoutMs,
    }),
    'go version go1.25.13 windows/amd64',
  );
  assert.deepEqual(calls, [{
    command: 'go',
    args: ['version'],
    options: {
      cwd: repositoryRoot,
      env: environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: serverReleaseCommandMaximumOutputBytes,
      timeout: serverReleaseMetadataCommandTimeoutMs,
      killSignal: 'SIGTERM',
    },
  }]);
});

test('server release command runner rejects invalid inputs without spawning', () => {
  let spawnCount = 0;
  const runCommand = createServerReleaseCommandRunner({
    cwd: repositoryRoot,
    spawn() {
      spawnCount += 1;
      return { status: 0, stdout: '' };
    },
  });

  for (const timeoutMs of [undefined, 0, -1, 1.5, Number.NaN, serverReleaseCommandMaximumDurationMs + 1]) {
    assert.throws(
      () => runCommand('go', ['version'], { timeoutMs }),
      /timeout must be a safe integer/,
    );
  }
  assert.throws(() => runCommand('', [], { timeoutMs: 1 }), /must be a non-empty string/);
  assert.throws(() => runCommand('go', [null], { timeoutMs: 1 }), /array of strings/);
  assert.throws(
    () => runCommand('go', [], { description: '', timeoutMs: 1 }),
    /description must be a non-empty string/,
  );
  assert.equal(spawnCount, 0);
});

test('server release command runner classifies timeout, signal, overflow, spawn, exit, and missing-status failures', () => {
  const failures = [
    [{ status: null, error: Object.assign(new Error('late'), { code: 'ETIMEDOUT' }) }, /timed out after 30000 ms/],
    [{ status: null, signal: 'SIGTERM' }, /terminated by signal SIGTERM/],
    [{ status: null, error: Object.assign(new Error('large'), { code: 'ENOBUFS' }) }, /output exceeded 8388608 bytes/],
    [{ status: null, error: Object.assign(new Error('permission denied'), { code: 'EACCES' }) }, /failed to start \(EACCES\): permission denied/],
    [{ status: 2, stderr: 'compile failed', stdout: 'private output' }, /exited with status 2: compile failed/],
    [{ status: null, stderr: 'no status', stdout: 'private output' }, /failed without an exit status: no status/],
  ];

  for (const [result, pattern] of failures) {
    const runCommand = createServerReleaseCommandRunner({
      cwd: repositoryRoot,
      spawn() {
        return result;
      },
    });
    assert.throws(
      () => runCommand('go', ['build'], { description: 'build', timeoutMs: 30_000 }),
      pattern,
    );
  }
});

test('server release command runner bounds stderr diagnostics and never reports stdout', () => {
  const runCommand = createServerReleaseCommandRunner({
    cwd: repositoryRoot,
    spawn() {
      return {
        status: 1,
        stderr: 'x'.repeat(serverReleaseCommandDiagnosticCharacterLimit * 2),
        stdout: 'private-success-output',
      };
    },
  });

  let error;
  assert.throws(
    () => runCommand('go', ['build'], { description: 'build', timeoutMs: 30_000 }),
    (candidate) => {
      error = candidate;
      return /\.\.\.\[truncated\]$/.test(candidate.message);
    },
  );
  assert.ok(error.message.length < serverReleaseCommandDiagnosticCharacterLimit + 100);
  assert.doesNotMatch(error.message, /private-success-output/);
});

test('server release build is bounded and rejects artifact or metadata tampering', async (t) => {
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  await rm(releaseRoot, { recursive: true, force: true });

  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const checksumPath = path.join(releaseRoot, 'SHA256SUMS');
  const sourceManifestPath = path.join(releaseRoot, 'source-manifest.json');
  const reproducibilityReportPath = path.join(releaseRoot, 'reproducibility-report.json');
  const poisonedGoRoot = path.join(releaseRoot, 'foreign-go-root');
  const poisonedEnvironment = { GOROOT: poisonedGoRoot };

  const built = run('build', poisonedEnvironment);
  assert.equal(built.status, 0, built.stderr);
  const buildManifestSource = await readFile(manifestPath, 'utf8');
  const buildSourceManifestSource = await readFile(sourceManifestPath, 'utf8');
  const buildManifest = JSON.parse(buildManifestSource);
  assert.equal(
    await readFile(checksumPath, 'utf8'),
    encodeChecksums([
      [buildManifest.subject.sha256, buildManifest.subject.name],
      [createHash('sha256').update(buildManifestSource).digest('hex'), 'release-manifest.json'],
      [createHash('sha256').update(buildSourceManifestSource).digest('hex'), 'source-manifest.json'],
    ]),
  );
  const verified = run('verify', poisonedEnvironment);
  assert.equal(verified.status, 0, verified.stderr);
  const reproducible = run('reproducible', poisonedEnvironment);
  assert.equal(reproducible.status, 0, reproducible.stderr);
  const reproducibleRerun = run('reproducible', poisonedEnvironment);
  assert.equal(reproducibleRerun.status, 0, reproducibleRerun.stderr);

  const manifestSource = await readFile(manifestPath, 'utf8');
  const checksumSource = await readFile(checksumPath, 'utf8');
  const sourceManifestSource = await readFile(sourceManifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource);
  const sourceManifest = JSON.parse(sourceManifestSource);
  const artifactPath = path.join(releaseRoot, manifest.subject.name);
  const artifact = await readFile(artifactPath);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.scope, 'goexample_server_release');
  assert.deepEqual(manifest.target, { os: 'linux', architecture: 'amd64', cgoEnabled: false });
  assert.equal(manifest.build.toolchain, 'go1.25.13');
  assert.equal(manifest.build.trimpath, true);
  assert.equal(manifest.build.buildVCS, false);
  assert.deepEqual(manifest.source.manifest, {
    name: 'source-manifest.json',
    bytes: Buffer.byteLength(sourceManifestSource),
    sha256: createHash('sha256').update(sourceManifestSource).digest('hex'),
  });
  assert.equal(sourceManifest.schemaVersion, 1);
  assert.equal(sourceManifest.scope, 'goexample_server_release_sources');
  assert.equal(sourceManifest.entrypoint, './Solutions/Example/cmd/server');
  assert.deepEqual(sourceManifest.files.map((file) => file.path), [...sourceManifest.files.map((file) => file.path)].sort());
  assert.equal(new Set(sourceManifest.files.map((file) => file.path)).size, sourceManifest.files.length);
  for (const requiredPath of [
    'go.work',
    'package.json',
    'scripts/server-release.mjs',
    'scripts/lib/server-release-command.mjs',
    'Framework/go.mod',
    'Framework/go.sum',
    'Solutions/Example/go.mod',
    'Solutions/Example/go.sum',
    'Solutions/Example/cmd/server/main.go',
  ]) {
    assert.ok(sourceManifest.files.some((file) => file.path === requiredPath), `missing source input ${requiredPath}`);
  }
  assert.ok(sourceManifest.files.every((file) => !file.path.startsWith('.temp/')));
  assert.equal(artifact.subarray(0, 4).toString('hex'), '7f454c46');

  const reproducibilityReportSource = await readFile(reproducibilityReportPath, 'utf8');
  const reproducibilityReport = JSON.parse(reproducibilityReportSource);
  assert.equal(
    checksumSource,
    encodeChecksums([
      [manifest.subject.sha256, manifest.subject.name],
      [createHash('sha256').update(manifestSource).digest('hex'), 'release-manifest.json'],
      [createHash('sha256').update(sourceManifestSource).digest('hex'), 'source-manifest.json'],
      [
        createHash('sha256').update(reproducibilityReportSource).digest('hex'),
        'reproducibility-report.json',
      ],
    ]),
  );
  assert.equal(reproducibilityReport.schemaVersion, 3);
  assert.equal(reproducibilityReport.scope, 'goexample_server_release_reproducibility');
  assert.deepEqual(reproducibilityReport.subject, manifest.subject);
  assert.deepEqual(reproducibilityReport.sourceManifest, manifest.source.manifest);
  assert.equal(reproducibilityReport.sourceCommit, manifest.build.commit);
  assert.deepEqual(reproducibilityReport.buildIsolation, {
    goBuildCache: 'separate-empty-directories',
    goTemporaryDirectory: 'separate-empty-directories',
    moduleCache: 'shared',
  });
  assert.equal(reproducibilityReport.runs.length, 2);
  assert.ok(reproducibilityReport.runs.every((run) => run.artifactSHA256 === manifest.subject.sha256));
  assert.ok(reproducibilityReport.runs.every((run) => run.sourceManifestSHA256 === manifest.source.manifest.sha256));
  assert.ok(reproducibilityReport.runs.every((run) => run.goBuildCacheEmptyBeforeBuild === true));
  assert.ok(reproducibilityReport.runs.every((run) => run.goBuildCachePopulatedAfterBuild === true));
  assert.ok(reproducibilityReport.runs.every((run) => run.goTemporaryDirectoryEmptyBeforeBuild === true));
  assert.equal(new Set(reproducibilityReport.runs.map((run) => run.goBuildCacheId)).size, 2);
  assert.equal(new Set(reproducibilityReport.runs.map((run) => run.goTemporaryDirectoryId)).size, 2);

  reproducibilityReport.runs[0].goBuildCacheId = reproducibilityReport.runs[1].goBuildCacheId;
  await writeFile(reproducibilityReportPath, `${JSON.stringify(reproducibilityReport, null, 2)}\n`, 'utf8');
  const isolationTampered = run('verify');
  assert.equal(isolationTampered.status, 1);
  assert.match(isolationTampered.stderr, /reproducibility report does not match the verified release/);
  await writeFile(reproducibilityReportPath, reproducibilityReportSource, 'utf8');

  const sourceReferenceTampered = JSON.parse(sourceManifestSource);
  sourceReferenceTampered.files[0].sha256 = '0'.repeat(64);
  await writeFile(sourceManifestPath, `${JSON.stringify(sourceReferenceTampered, null, 2)}\n`, 'utf8');
  const sourceReferenceRejected = run('verify');
  assert.equal(sourceReferenceRejected.status, 1);
  assert.match(sourceReferenceRejected.stderr, /source manifest does not match the release manifest reference/);
  await writeFile(sourceManifestPath, sourceManifestSource, 'utf8');

  const sourceOmissionTampered = JSON.parse(sourceManifestSource);
  sourceOmissionTampered.files = sourceOmissionTampered.files.filter((file) => file.path !== 'scripts/server-release.mjs');
  const sourceOmissionSource = `${JSON.stringify(sourceOmissionTampered, null, 2)}\n`;
  const sourceOmissionManifest = JSON.parse(manifestSource);
  sourceOmissionManifest.source.manifest.bytes = Buffer.byteLength(sourceOmissionSource);
  sourceOmissionManifest.source.manifest.sha256 = createHash('sha256').update(sourceOmissionSource).digest('hex');
  await writeFile(sourceManifestPath, sourceOmissionSource, 'utf8');
  await writeFile(manifestPath, `${JSON.stringify(sourceOmissionManifest, null, 2)}\n`, 'utf8');
  const sourceOmissionRejected = run('verify');
  assert.equal(sourceOmissionRejected.status, 1);
  assert.match(sourceOmissionRejected.stderr, /does not exactly match the current server release input closure/);
  await writeFile(sourceManifestPath, sourceManifestSource, 'utf8');
  await writeFile(manifestPath, manifestSource, 'utf8');

  const sourcePathTampered = JSON.parse(sourceManifestSource);
  sourcePathTampered.files[0].path = '../outside';
  const sourcePathSource = `${JSON.stringify(sourcePathTampered, null, 2)}\n`;
  const sourcePathManifest = JSON.parse(manifestSource);
  sourcePathManifest.source.manifest.bytes = Buffer.byteLength(sourcePathSource);
  sourcePathManifest.source.manifest.sha256 = createHash('sha256').update(sourcePathSource).digest('hex');
  await writeFile(sourceManifestPath, sourcePathSource, 'utf8');
  await writeFile(manifestPath, `${JSON.stringify(sourcePathManifest, null, 2)}\n`, 'utf8');
  const sourcePathRejected = run('verify');
  assert.equal(sourcePathRejected.status, 1);
  assert.match(sourcePathRejected.stderr, /source manifest file 0 path is unsafe/);
  await writeFile(sourceManifestPath, sourceManifestSource, 'utf8');
  await writeFile(manifestPath, manifestSource, 'utf8');

  const sourceReportTampered = JSON.parse(reproducibilityReportSource);
  sourceReportTampered.sourceManifest.sha256 = '0'.repeat(64);
  await writeFile(reproducibilityReportPath, `${JSON.stringify(sourceReportTampered, null, 2)}\n`, 'utf8');
  const sourceReportRejected = run('verify');
  assert.equal(sourceReportRejected.status, 1);
  assert.match(sourceReportRejected.stderr, /reproducibility report metadata is invalid/);
  await writeFile(reproducibilityReportPath, reproducibilityReportSource, 'utf8');

  const subjectReportTampered = JSON.parse(reproducibilityReportSource);
  subjectReportTampered.subject.sha256 = '0'.repeat(64);
  await writeFile(reproducibilityReportPath, `${JSON.stringify(subjectReportTampered, null, 2)}\n`, 'utf8');
  const reportTampered = run('verify');
  assert.equal(reportTampered.status, 1);
  assert.match(reportTampered.stderr, /reproducibility report metadata is invalid/);
  await writeFile(reproducibilityReportPath, reproducibilityReportSource, 'utf8');

  await appendFile(artifactPath, 'tampered');
  const artifactTampered = run('verify');
  assert.equal(artifactTampered.status, 1);
  assert.match(artifactTampered.stderr, /size does not match|SHA-256 does not match/);

  await writeFile(artifactPath, artifact);
  await writeFile(checksumPath, `${'0'.repeat(64)}  ${manifest.subject.name}\n`, 'utf8');
  const checksumTampered = run('verify');
  assert.equal(checksumTampered.status, 1);
  assert.match(checksumTampered.stderr, /SHA256SUMS/);

  const checksumLines = checksumSource.trimEnd().split('\n');
  await writeFile(checksumPath, `${checksumLines.slice(0, -1).join('\n')}\n`, 'utf8');
  const checksumSubjectRemoved = run('verify');
  assert.equal(checksumSubjectRemoved.status, 1);
  assert.match(checksumSubjectRemoved.stderr, /SHA256SUMS/);

  await writeFile(checksumPath, `${checksumSource}${'0'.repeat(64)}  unexpected-subject\n`, 'utf8');
  const checksumSubjectAdded = run('verify');
  assert.equal(checksumSubjectAdded.status, 1);
  assert.match(checksumSubjectAdded.stderr, /SHA256SUMS/);

  await writeFile(checksumPath, checksumSource, 'utf8');
  manifest.subject.name = '../outside';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestTampered = run('verify');
  assert.equal(manifestTampered.status, 1);
  assert.match(manifestTampered.stderr, /manifest subject is invalid/);
});
