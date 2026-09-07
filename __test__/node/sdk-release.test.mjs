import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readProjectManifest, selectProject } from '../../scripts/lib/project-contracts.mjs';
import {
  buildSDKReleaseManifest,
  createSDKReleaseCheckRunner,
  sdkReleaseCheckDiagnosticCharacterLimit,
  sdkReleaseCheckMaximumOutputBytes,
  sdkReleaseCheckTimeoutMs,
  verifySDKReleaseManifest,
  writeSDKReleaseManifest,
} from '../../scripts/lib/sdk-release.mjs';

const commit = 'a'.repeat(40);

const sdkCheckOptions = {
  cwd: 'repository-root',
  sdkScriptPath: 'scripts/go-sdk.mjs',
  executable: 'node',
};

test('SDK release check runner applies bounded options and shares one decreasing deadline', () => {
  const calls = [];
  const clock = [100, 150, 450];
  const verifyGeneratedSDK = createSDKReleaseCheckRunner({
    ...sdkCheckOptions,
    timeoutMs: 1_000,
    now: () => clock.shift(),
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  verifyGeneratedSDK('Example');
  verifyGeneratedSDK('Billing');

  assert.deepEqual(calls.map(({ command }) => command), ['node', 'node']);
  assert.deepEqual(calls.map(({ args }) => args), [
    ['scripts/go-sdk.mjs', 'check', '--project', 'Example'],
    ['scripts/go-sdk.mjs', 'check', '--project', 'Billing'],
  ]);
  assert.deepEqual(calls.map(({ options }) => options.timeout), [950, 650]);
  for (const { options } of calls) {
    assert.equal(options.cwd, 'repository-root');
    assert.equal(options.encoding, 'utf8');
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.maxBuffer, sdkReleaseCheckMaximumOutputBytes);
    assert.equal(options.killSignal, 'SIGTERM');
  }
});

test('SDK release check runner rejects exhausted budgets and invalid clocks without spawning', () => {
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, sdkReleaseCheckTimeoutMs + 1]) {
    assert.throws(
      () => createSDKReleaseCheckRunner({ ...sdkCheckOptions, timeoutMs }),
      /SDK check timeout must be a safe integer/,
    );
  }
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createSDKReleaseCheckRunner({ ...sdkCheckOptions, now: () => value }),
      /SDK check clock must return a non-negative finite number/,
    );
  }

  let spawnCalls = 0;
  const clock = [10, 1_010];
  const verifyGeneratedSDK = createSDKReleaseCheckRunner({
    ...sdkCheckOptions,
    timeoutMs: 1_000,
    now: () => clock.shift(),
    spawn() {
      spawnCalls += 1;
      return { status: 0 };
    },
  });
  assert.throws(
    () => verifyGeneratedSDK('Example'),
    /generated SDK check budget was exhausted before Example/,
  );
  assert.equal(spawnCalls, 0);

  const invalidClock = [10, Number.NaN];
  const verifyWithInvalidClock = createSDKReleaseCheckRunner({
    ...sdkCheckOptions,
    now: () => invalidClock.shift(),
    spawn() {
      spawnCalls += 1;
      return { status: 0 };
    },
  });
  assert.throws(
    () => verifyWithInvalidClock('Example'),
    /SDK check clock must return a non-negative finite number/,
  );
  assert.equal(spawnCalls, 0);
});

test('SDK release check runner classifies timeout, signal, overflow, spawn, and exit failures', () => {
  const failures = [
    [{ status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }, /timed out within the remaining/],
    [{ status: null, signal: 'SIGTERM' }, /terminated by signal SIGTERM/],
    [{ status: null, error: Object.assign(new Error('overflow'), { code: 'ENOBUFS' }) }, /output exceeded 4194304 bytes/],
    [{ status: null, error: Object.assign(new Error('permission denied'), { code: 'EACCES' }) }, /failed to start \(EACCES\): permission denied/],
    [{ status: 2, stderr: 'invalid SDK' }, /exited with status 2: invalid SDK/],
    [undefined, /failed without an exit status/],
  ];

  for (const [result, expected] of failures) {
    const verifyGeneratedSDK = createSDKReleaseCheckRunner({
      ...sdkCheckOptions,
      now: () => 0,
      spawn: () => result,
    });
    assert.throws(() => verifyGeneratedSDK('Example'), expected);
  }

  const thrown = Object.assign(new Error('low-level failure'), { code: 'EIO' });
  const verifyThrownFailure = createSDKReleaseCheckRunner({
    ...sdkCheckOptions,
    now: () => 0,
    spawn() {
      throw thrown;
    },
  });
  assert.throws(
    () => verifyThrownFailure('Example'),
    /failed to start \(EIO\): low-level failure/,
  );
});

test('SDK release check runner bounds stderr diagnostics and never reports stdout', () => {
  const verifyGeneratedSDK = createSDKReleaseCheckRunner({
    ...sdkCheckOptions,
    now: () => 0,
    spawn: () => ({
      status: 1,
      stdout: 'stdout-must-not-be-reported',
      stderr: 's'.repeat(sdkReleaseCheckDiagnosticCharacterLimit + 1_000),
    }),
  });

  let failure;
  try {
    verifyGeneratedSDK('Example');
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.doesNotMatch(failure.message, /stdout-must-not-be-reported/);
  assert.match(failure.message, /\.\.\.\[truncated\]$/);
  assert.ok(failure.message.length <= sdkReleaseCheckDiagnosticCharacterLimit + 128);
});

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const document = {
    openapi: '3.1.0',
    info: { title: 'Fixture', version: '1.2.3' },
    paths: {
      '/readyz': {
        get: { operationId: 'getReadiness' },
      },
    },
  };
  const source = `${JSON.stringify(document, null, 2)}\n`;
  const sourceHash = createHash('sha256').update(source).digest('hex');
  await mkdir(path.join(root, 'Solutions', 'Fixture'), { recursive: true });
  await mkdir(path.join(root, 'SDK', 'Fixture'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'openapi'), { recursive: true });
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  await writeFile(path.join(root, 'Solutions', 'Fixture', 'go.mod'), 'module example.test/fixture\n', 'utf8');
  await writeFile(path.join(root, 'docs', 'openapi', 'fixture.json'), source, 'utf8');
  await writeFile(
    path.join(root, 'contracts', 'projects.json'),
    `${JSON.stringify({
      version: 1,
      projects: [
        {
          projectPath: 'Solutions/Fixture',
          contract: { repository: 'workspace', ref: 'worktree', document: 'docs/openapi/fixture.json' },
          sdk: { path: 'SDK/Fixture', package: 'fixture' },
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(root, 'SDK', 'Fixture', 'VERSION'), '1.2.3\n', 'utf8');
  await writeFile(path.join(root, 'SDK', 'Fixture', 'go.mod'), 'module example.test/SDK/Fixture\n', 'utf8');
  await writeFile(
    path.join(root, 'SDK', 'Fixture', 'client.gen.go'),
    `// Code generated by test; DO NOT EDIT.\n// Source SHA-256: ${sourceHash}\n\npackage fixture\n\nconst APIVersion = "1.2.3"\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'SDK', 'Fixture', 'README.md'),
    '# Fixture Go SDK\n\nCurrent SDK version: `1.2.3`.\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'SDK', 'Fixture', 'CHANGELOG.md'),
    '# Changelog\n\n## 1.2.3 - 2026-08-27\n\n- Initial release.\n',
    'utf8',
  );
  return { root, project: selectProject(readProjectManifest(root), 'Fixture') };
}

test('SDK release manifest binds the module, version, contract, and generated artifacts', async (t) => {
  const { root, project } = await makeFixture(t);
  const manifest = buildSDKReleaseManifest(root, project, { sourceCommit: commit });

  assert.equal(manifest.modulePath, 'example.test/SDK/Fixture');
  assert.equal(manifest.sdkVersion, '1.2.3');
  assert.equal(manifest.expectedTag, 'SDK/Fixture/v1.2.3');
  assert.equal(manifest.publication, 'not_checked');
  assert.equal(manifest.openapi.operationCount, 1);
  assert.deepEqual(manifest.openapi.operations, [
    { operationId: 'getReadiness', method: 'GET', path: '/readyz', deprecated: false },
  ]);
  assert.match(manifest.openapi.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.artifacts.generatedClient.sha256, /^[a-f0-9]{64}$/);

  writeSDKReleaseManifest(root, project, manifest);
  assert.doesNotThrow(() => verifySDKReleaseManifest(root, project, manifest));
});

test('SDK release manifest atomically replaces an existing file and preserves it on publication failure', async (t) => {
  const { root, project } = await makeFixture(t);
  const filePath = path.join(root, 'SDK', 'Fixture', 'release-manifest.json');
  const manifest = buildSDKReleaseManifest(root, project, { sourceCommit: commit });
  writeSDKReleaseManifest(root, project, manifest);

  const replacement = { ...manifest, sourceCommit: 'b'.repeat(40) };
  writeSDKReleaseManifest(root, project, replacement);
  const replacementBytes = `${JSON.stringify(replacement, null, 2)}\n`;
  assert.equal(await readFile(filePath, 'utf8'), replacementBytes);
  assert.doesNotThrow(() => verifySDKReleaseManifest(root, project, replacement));
  assert.deepEqual(
    (await readdir(path.dirname(filePath))).filter((name) => /^\.release-manifest\.json\..+\.tmp$/.test(name)),
    [],
  );

  const publicationFailure = new Error('injected SDK release manifest publication failure');
  let publicationAttempts = 0;
  assert.throws(
    () => writeSDKReleaseManifest(
      root,
      project,
      { ...replacement, sourceCommit: 'c'.repeat(40) },
      (outputPath, content, options) => {
        publicationAttempts += 1;
        assert.equal(outputPath, filePath);
        assert.match(content, /"sourceCommit": "c{40}"/);
        assert.deepEqual(options, { encoding: 'utf8' });
        throw publicationFailure;
      },
    ),
    (error) => error === publicationFailure,
  );
  assert.equal(publicationAttempts, 1);
  assert.equal(await readFile(filePath, 'utf8'), replacementBytes);
});

test('SDK release manifest rejects mismatched versions and missing release documentation', async (t) => {
  const { root, project } = await makeFixture(t);
  await writeFile(path.join(root, 'SDK', 'Fixture', 'VERSION'), '1.2.4\n', 'utf8');
  assert.throws(
    () => buildSDKReleaseManifest(root, project, { sourceCommit: commit }),
    /does not match OpenAPI/,
  );

  await writeFile(path.join(root, 'SDK', 'Fixture', 'VERSION'), '1.2.3\n', 'utf8');
  await rm(path.join(root, 'SDK', 'Fixture', 'README.md'));
  assert.throws(
    () => buildSDKReleaseManifest(root, project, { sourceCommit: commit }),
    /README is missing/,
  );
});

test('SDK release manifest verification detects manifest tampering', async (t) => {
  const { root, project } = await makeFixture(t);
  const manifest = buildSDKReleaseManifest(root, project, { sourceCommit: commit });
  writeSDKReleaseManifest(root, project, manifest);
  await writeFile(path.join(root, 'SDK', 'Fixture', 'release-manifest.json'), '{"schemaVersion":1}\n', 'utf8');

  assert.throws(
    () => verifySDKReleaseManifest(root, project, manifest),
    /is stale or has been modified/,
  );
});
