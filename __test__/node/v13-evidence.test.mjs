import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repositoryRoot, 'scripts', 'v13-evidence.mjs');

function run(file, verify = false) {
  return spawnSync(process.execPath, [script, ...(verify ? ['--verify'] : []), file], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('V13 evidence index generates and verifies all packages as not_recorded', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const index = path.join(root, 'index.json');
  try {
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const verified = run(index, true);
    assert.equal(verified.status, 0, verified.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    assert.equal(document.workPackages.length, 9);
    assert.ok(document.workPackages.every((item) => item.status === 'not_recorded'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V13 evidence verifier accepts complete immutable recorded evidence', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const artifact = path.join(root, 'run.txt');
  const index = path.join(root, 'index.json');
  try {
    const bytes = Buffer.from('target run passed\n');
    await writeFile(artifact, bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    const packageItem = document.workPackages[0];
    packageItem.status = 'recorded';
    packageItem.targetEnvironment = 'prod-linux-edge-01';
    packageItem.immutableVersion = 'sha256:release-123';
    packageItem.runUrl = 'https://ci.example.invalid/runs/123';
    packageItem.fingerprint = { runner: 'runner-abc', toolchain: 'go1.25.0', environment: 'image@sha256:abc' };
    packageItem.outputs = [{ path: `.temp/${path.relative(path.join(repositoryRoot, '.temp'), artifact).split(path.sep).join('/')}`, bytes: bytes.length, sha256: hash }];
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const verified = run(index, true);
    assert.equal(verified.status, 0, verified.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V13 evidence verifier rejects forged recorded state and unsafe artifact paths', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const index = path.join(root, 'index.json');
  try {
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    document.workPackages[0].status = 'recorded';
    document.workPackages[0].targetEnvironment = 'prod';
    const forged = await writeFile(index, `${JSON.stringify(document, null, 2)}\n`).then(() => run(index, true));
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /immutableVersion|runUrl|fingerprint|outputs/);

    document.workPackages[0].status = 'not_recorded';
    document.workPackages[0].targetEnvironment = 'local-loopback';
    document.workPackages[0].outputs = [{ path: '.temp/../outside.txt', bytes: 1, sha256: '0'.repeat(64) }];
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const unsafe = run(index, true);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /unsafe path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
