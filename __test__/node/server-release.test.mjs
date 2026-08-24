import assert from 'node:assert/strict';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const releaseRoot = path.join(repositoryRoot, '.temp', 'server-release-test', `${process.pid}`);
const releaseRootRelative = path.relative(repositoryRoot, releaseRoot);
const scriptPath = path.join(repositoryRoot, 'scripts', 'server-release.mjs');

function run(task) {
  return spawnSync(process.execPath, [scriptPath, task], {
    cwd: repositoryRoot,
    env: { ...process.env, SERVER_RELEASE_ROOT: releaseRootRelative },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

test('server release build is bounded and rejects artifact or metadata tampering', async (t) => {
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  await rm(releaseRoot, { recursive: true, force: true });

  const built = run('build');
  assert.equal(built.status, 0, built.stderr);
  const verified = run('verify');
  assert.equal(verified.status, 0, verified.stderr);

  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const checksumPath = path.join(releaseRoot, 'SHA256SUMS');
  const manifestSource = await readFile(manifestPath, 'utf8');
  const checksumSource = await readFile(checksumPath, 'utf8');
  const manifest = JSON.parse(manifestSource);
  const artifactPath = path.join(releaseRoot, manifest.subject.name);
  const artifact = await readFile(artifactPath);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, 'goexample_server_release');
  assert.deepEqual(manifest.target, { os: 'linux', architecture: 'amd64', cgoEnabled: false });
  assert.equal(manifest.build.toolchain, 'go1.25.13');
  assert.equal(manifest.build.trimpath, true);
  assert.equal(manifest.build.buildVCS, false);
  assert.equal(artifact.subarray(0, 4).toString('hex'), '7f454c46');
  assert.match(checksumSource, /^[a-f0-9]{64}  goexample-api_0\.1\.0_linux_amd64\n$/);

  await appendFile(artifactPath, 'tampered');
  const artifactTampered = run('verify');
  assert.equal(artifactTampered.status, 1);
  assert.match(artifactTampered.stderr, /size does not match|SHA-256 does not match/);

  await writeFile(artifactPath, artifact);
  await writeFile(checksumPath, `${'0'.repeat(64)}  ${manifest.subject.name}\n`, 'utf8');
  const checksumTampered = run('verify');
  assert.equal(checksumTampered.status, 1);
  assert.match(checksumTampered.stderr, /SHA256SUMS/);

  await writeFile(checksumPath, checksumSource, 'utf8');
  manifest.subject.name = '../outside';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestTampered = run('verify');
  assert.equal(manifestTampered.status, 1);
  assert.match(manifestTampered.stderr, /manifest subject is invalid/);
});
