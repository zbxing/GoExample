import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readSDKConsumerMatrix, verifySDKConsumerMatrix } from '../../scripts/lib/sdk-consumer-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('SDK consumer matrix verifies project, release, and deprecation boundaries', () => {
  const result = spawnSync(process.execPath, ['scripts/sdk-consumer-matrix.mjs', 'check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 repository-local consumers/);
  const packageDocument = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(packageDocument.scripts['sdk:matrix:check'], 'node scripts/sdk-consumer-matrix.mjs check');
  assert.match(
    readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    /Verify SDK consumer migration matrix/,
  );
  assert.match(
    readFileSync(path.join(repositoryRoot, 'docs', 'openapi', 'project-contracts.md'), 'utf8'),
    /yarn sdk:matrix:check/,
  );
  assert.deepEqual(verifySDKConsumerMatrix(repositoryRoot), { schemaVersion: 1, consumerCount: 2 });
});

test('SDK consumer matrix rejects a shortened deprecation window', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  const matrix = JSON.parse(await readFile(path.join(repositoryRoot, 'contracts', 'sdk-consumer-matrix.json'), 'utf8'));
  matrix.sunset.minimumWindowDays = 185;
  await writeFile(path.join(root, 'contracts', 'sdk-consumer-matrix.json'), `${JSON.stringify(matrix)}\n`, 'utf8');
  assert.throws(() => readSDKConsumerMatrix(root), /sunset window is shorter/);
});

test('SDK consumer matrix rejects claimed publication or deployment', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  const matrix = JSON.parse(await readFile(path.join(repositoryRoot, 'contracts', 'sdk-consumer-matrix.json'), 'utf8'));
  matrix.release.formalTag = 'recorded';
  await writeFile(path.join(root, 'contracts', 'sdk-consumer-matrix.json'), `${JSON.stringify(matrix)}\n`, 'utf8');
  assert.throws(() => readSDKConsumerMatrix(root), /release status must keep/);
});

test('SDK consumer matrix rejects duplicate consumers and unsafe paths', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  const matrix = JSON.parse(await readFile(path.join(repositoryRoot, 'contracts', 'sdk-consumer-matrix.json'), 'utf8'));
  matrix.consumers[1].name = matrix.consumers[0].name;
  await writeFile(path.join(root, 'contracts', 'sdk-consumer-matrix.json'), `${JSON.stringify(matrix)}\n`, 'utf8');
  assert.throws(() => readSDKConsumerMatrix(root), /consumers must have unique names/);
  matrix.consumers[1].name = 'Billing';
  matrix.consumers[1].sdkPath = '../SDK/Billing';
  await writeFile(path.join(root, 'contracts', 'sdk-consumer-matrix.json'), `${JSON.stringify(matrix)}\n`, 'utf8');
  assert.throws(() => readSDKConsumerMatrix(root), /is invalid/);
});
