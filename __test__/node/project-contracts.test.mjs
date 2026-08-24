import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertOpenAPIDocument,
  normalizeProjectEntry,
  readProjectManifest,
  resolveProjectDocument,
  resolveRef,
  selectProject,
} from '../../scripts/lib/project-contracts.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('project contract manifest maps Example to the workspace OpenAPI document', async () => {
  const manifest = readProjectManifest(repositoryRoot);
  const example = selectProject(manifest, 'Example');
  assert.equal(example.projectPath, 'Proj/Example');
  assert.equal(example.contract.repository, 'workspace');
  assert.equal(example.contract.ref, 'worktree');
  assert.equal(example.contract.document, 'docs/openapi/openapi.json');
  assert.equal(example.sdk.path, 'SDK/GoExample');
  assert.equal(example.sdk.package, 'goexample');
  const document = assertOpenAPIDocument(
    await readFile(path.join(repositoryRoot, example.contract.document), 'utf8'),
    example.contract.document,
  );
  assert.equal(document.info.version, '1.4.0');
});

test('project contract manifest rejects unpinned remote refs and unsafe mappings', () => {
  const base = {
    projectPath: 'Proj/Example',
    contract: {
      repository: 'https://example.invalid/contracts.git',
      ref: 'refs/heads/main',
      document: 'openapi/example.json',
    },
    sdk: { path: 'SDK/GoExample', package: 'goexample' },
  };
  assert.throws(
    () => normalizeProjectEntry(base, repositoryRoot),
    /resolvedCommit must be a 40-character lower-case commit SHA/,
  );
  assert.throws(
    () => normalizeProjectEntry({ ...base, projectPath: '../Escape' }, repositoryRoot),
    /contains an unsafe path/,
  );
  assert.throws(
    () => normalizeProjectEntry({ ...base, contract: { ...base.contract, resolvedCommit: 'A'.repeat(40) } }, repositoryRoot),
    /lower-case commit SHA/,
  );
});

test('project contract entries require distinct project and SDK paths', () => {
  const manifest = readProjectManifest(repositoryRoot);
  assert.equal(new Set(manifest.projects.map((entry) => entry.projectPath)).size, manifest.projects.length);
  assert.equal(new Set(manifest.projects.map((entry) => entry.sdk.path)).size, manifest.projects.length);
  assert.throws(() => selectProject(manifest, 'Missing'), /is not listed/);
});

test('external project contracts materialize a pinned tag without a submodule checkout', async () => {
  const remoteRoot = await mkdtemp(path.join(os.tmpdir(), 'goexample-openapi-remote-'));
  let materializedRoot;
  let cachePath;
  try {
    execFileSync('git', ['init', remoteRoot], { cwd: repositoryRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'contract-test@example.invalid'], { cwd: remoteRoot });
    execFileSync('git', ['config', 'user.name', 'Contract Test'], { cwd: remoteRoot });
    await mkdir(path.join(remoteRoot, 'openapi'), { recursive: true });
    await writeFile(
      path.join(remoteRoot, 'openapi', 'billing.json'),
      `${JSON.stringify({ openapi: '3.1.0', info: { title: 'Billing', version: '2.3.0' }, paths: {} }, null, 2)}\n`,
      'utf8',
    );
    execFileSync('git', ['add', 'openapi/billing.json'], { cwd: remoteRoot });
    execFileSync('git', ['commit', '-m', 'add billing contract'], { cwd: remoteRoot, stdio: 'ignore' });
    execFileSync('git', ['tag', 'billing-v2.3.0'], { cwd: remoteRoot });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: remoteRoot, encoding: 'utf8' }).trim();
    const entry = normalizeProjectEntry(
      {
        projectPath: 'Proj/Example',
        contract: {
          repository: remoteRoot,
          ref: 'refs/tags/billing-v2.3.0',
          resolvedCommit: commit,
          document: 'openapi/billing.json',
        },
        sdk: { path: 'SDK/GoExample', package: 'goexample' },
      },
      repositoryRoot,
    );
    assert.equal(resolveRef(repositoryRoot, entry.contract.repository, entry.contract.ref), commit);
    const resolved = resolveProjectDocument(repositoryRoot, entry, { fetchRemote: true });
    assert.equal(resolved.commit, commit);
    assert.match(resolved.source, /refs\/tags\/billing-v2\.3\.0/);
    assert.equal(JSON.parse(resolved.content).info.version, '2.3.0');
    materializedRoot = path.join(repositoryRoot, '.temp', 'contracts', 'Example', commit);
    cachePath = path.join(
      repositoryRoot,
      '.temp',
      'contracts',
      '.git',
      createHash('sha256').update(entry.contract.repository).digest('hex').slice(0, 24),
    );
  } finally {
    await rm(remoteRoot, { recursive: true, force: true });
    if (materializedRoot) {
      await rm(materializedRoot, { recursive: true, force: true });
    }
    if (cachePath) {
      await rm(cachePath, { recursive: true, force: true });
    }
  }
});
