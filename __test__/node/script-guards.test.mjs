import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function runScript(relativePath, args = [], environment = {}) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, relativePath), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('Go project runner rejects project paths outside Proj', () => {
  const result = runScript('scripts/go-project.mjs', ['test'], { GO_PROJECT: '../Framework' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GO_PROJECT must contain only/);
});

test('MSFront runner rejects unknown tasks before spawning Yarn', () => {
  const result = runScript('scripts/msfront.mjs', ['unknown-task']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown MSFront task: unknown-task/);
});
