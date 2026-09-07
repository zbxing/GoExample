import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertOpenAPIDocument,
  createProjectContractGitRunner,
  normalizeProjectEntry,
  readProjectManifest,
  resolveProjectDocument,
  resolveRef,
  selectProject,
} from '../../scripts/lib/project-contracts.mjs';
import { maximumCommandDurationMs } from '../../scripts/lib/bounded-command.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('project contract manifest maps Example to the workspace OpenAPI document', async () => {
  const manifest = readProjectManifest(repositoryRoot);
  const example = selectProject(manifest, 'Example');
  assert.equal(example.projectPath, 'Solutions/Example');
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

test('workspace project contracts bypass materialized output', () => {
  const manifest = readProjectManifest(repositoryRoot);
  const example = selectProject(manifest, 'Example');
  const resolved = resolveProjectDocument(repositoryRoot, example, {
    writeOutput() {
      assert.fail('workspace contracts must not publish a materialized cache');
    },
  });
  assert.equal(resolved.path, path.join(repositoryRoot, example.contract.document));
  assert.equal(assertOpenAPIDocument(resolved.content, resolved.source).info.version, '1.4.0');
});

test('project contract manifest maps Billing to an independent Framework service contract', async () => {
  const manifest = readProjectManifest(repositoryRoot);
  const billing = selectProject(manifest, 'Billing');
  assert.equal(billing.projectPath, 'Services/Billing');
  assert.equal(billing.contract.repository, 'workspace');
  assert.equal(billing.contract.document, 'docs/openapi/billing.json');
  assert.equal(billing.sdk.path, 'SDK/Billing');
  assert.equal(billing.sdk.package, 'billing');
  const document = assertOpenAPIDocument(
    await readFile(path.join(repositoryRoot, billing.contract.document), 'utf8'),
    billing.contract.document,
  );
  assert.equal(document.info.version, '1.0.0');
  assert.ok(document.paths['/api/v1/billing/summary']);
});

test('project contract manifest rejects unpinned remote refs and unsafe mappings', () => {
  const base = {
    projectPath: 'Solutions/Example',
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
  assert.throws(
    () => normalizeProjectEntry({
      ...base,
      contract: {
        ...base.contract,
        repository: 'https://token:secret@example.invalid/contracts.git',
      },
    }, repositoryRoot),
    (error) => {
      assert.match(error.message, /HTTPS URL cannot contain credentials, a query, or a fragment/);
      assert.doesNotMatch(error.message, /token|secret/);
      return true;
    },
  );
  assert.throws(
    () => normalizeProjectEntry({
      ...base,
      contract: {
        ...base.contract,
        repository: 'https://example.invalid/contracts.git?access_token=secret',
      },
    }, repositoryRoot),
    /HTTPS URL cannot contain credentials, a query, or a fragment/,
  );
  assert.throws(
    () => normalizeProjectEntry({
      ...base,
      contract: {
        ...base.contract,
        repository: 'https://example.invalid/contracts.git\nforged-log-line',
      },
    }, repositoryRoot),
    /cannot contain control characters/,
  );
});

test('project contract Git runner shares one bounded monotonic budget', () => {
  const calls = [];
  const timestamps = [100, 150, 475, 1_100];
  const runner = createProjectContractGitRunner(repositoryRoot, {
    timeoutMs: 1_000,
    now: () => timestamps.shift(),
    run(command, args, options) {
      calls.push({ command, args, options });
      return calls.length === 1 ? '' : 'document\n';
    },
  });

  assert.equal(runner(['cat-file', '-e', 'commit']), '');
  assert.equal(runner(['show', 'commit:openapi.json']), 'document\n');
  assert.equal(runner(['fetch'], { allowFailure: true }), null);
  assert.equal(calls.length, 2, 'budget exhaustion must prevent another Git invocation');
  assert.deepEqual(calls.map(({ command }) => command), ['git', 'git']);
  assert.deepEqual(calls.map(({ options }) => options.timeoutMs), [950, 625]);
  for (const { options } of calls) {
    assert.equal(options.cwd, repositoryRoot);
    assert.equal(options.raw, true);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GCM_INTERACTIVE, 'Never');
  }

  const failed = createProjectContractGitRunner(repositoryRoot, {
    timeoutMs: 1_000,
    now: () => 0,
    run: () => null,
  });
  assert.throws(
    () => failed(['fetch', 'https://token:secret@example.invalid/contracts.git']),
    (error) => {
      assert.match(error.message, /git fetch failed within the 1000 ms total budget/);
      assert.doesNotMatch(error.message, /token|secret|example\.invalid/);
      return true;
    },
  );

  for (const timeoutMs of [0, -1, 1.5, Number.NaN, maximumCommandDurationMs + 1]) {
    assert.throws(
      () => createProjectContractGitRunner(repositoryRoot, { timeoutMs }),
      /timeout must be a safe integer/,
    );
  }
  assert.throws(
    () => createProjectContractGitRunner(repositoryRoot, { now: () => Number.NaN }),
    /clock must return a finite number/,
  );
  const invalidClock = createProjectContractGitRunner(repositoryRoot, {
    now: (() => {
      const values = [0, Number.NaN];
      return () => values.shift();
    })(),
  });
  assert.throws(() => invalidClock(['status']), /clock must return a finite number/);
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
        projectPath: 'Solutions/Example',
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
    assert.equal(resolved.path, path.join(materializedRoot, 'openapi', 'billing.json'));
    assert.equal(await readFile(resolved.path, 'utf8'), resolved.content);

    await writeFile(resolved.path, 'last complete cache\n', 'utf8');
    let failedPublicationCount = 0;
    assert.throws(
      () => resolveProjectDocument(repositoryRoot, entry, {
        writeOutput(outputPath, content, options) {
          failedPublicationCount += 1;
          assert.equal(outputPath, resolved.path);
          assert.equal(content, resolved.content);
          assert.deepEqual(options, { encoding: 'utf8' });
          throw new Error('injected contract cache publication failure');
        },
      }),
      /injected contract cache publication failure/,
    );
    assert.equal(failedPublicationCount, 1);
    assert.equal(await readFile(resolved.path, 'utf8'), 'last complete cache\n');

    const repaired = resolveProjectDocument(repositoryRoot, entry);
    assert.equal(await readFile(repaired.path, 'utf8'), repaired.content);
    const materializedDirectory = path.dirname(repaired.path);
    assert.deepEqual(
      (await readdir(materializedDirectory)).filter((name) => /^\.billing\.json\..+\.tmp$/.test(name)),
      [],
    );
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
