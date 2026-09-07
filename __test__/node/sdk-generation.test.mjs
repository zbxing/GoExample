import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeFileAtomicallySync } from '../../scripts/lib/atomic-output.mjs';
import {
  maximumCommandDurationMs,
  maximumCommandOutputBytes,
} from '../../scripts/lib/bounded-command.mjs';
import {
  formatGoFileWithCandidatesSync,
  formatGeneratedGoSDKSourceSync,
  maximumFormatterDiagnosticCharacters,
  publishGeneratedGoSDKSync,
} from '../../scripts/lib/sdk-generation.mjs';

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdkRoot = path.join(root, 'SDK', 'Fixture');
  const stagingRoot = path.join(root, '.temp', 'sdk-generation');
  const clientPath = path.join(sdkRoot, 'client.gen.go');
  const versionPath = path.join(sdkRoot, 'VERSION');
  await mkdir(sdkRoot, { recursive: true });
  await writeFile(clientPath, 'old client\n', 'utf8');
  await writeFile(versionPath, '1.0.0\n', 'utf8');
  return { stagingRoot, clientPath, versionPath };
}

test('SDK formatter applies bounded non-shell process options', () => {
  const calls = [];
  const cwd = path.join(os.tmpdir(), 'goexample-sdk-formatter');
  const filePath = path.join(cwd, 'client.gen.go');

  formatGoFileWithCandidatesSync(filePath, {
    candidates: ['gofmt'],
    cwd,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.deepEqual(calls, [{
    command: 'gofmt',
    args: ['-w', filePath],
    options: {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: maximumCommandOutputBytes,
      timeout: maximumCommandDurationMs,
      killSignal: 'SIGTERM',
    },
  }]);
});

test('SDK formatter only falls back for missing or invalid launch candidates', () => {
  const cwd = path.join(os.tmpdir(), 'goexample-sdk-formatter');
  const filePath = path.join(cwd, 'client.gen.go');
  const absentAbsoluteCandidate = path.join(cwd, 'missing-gofmt');
  const calls = [];

  formatGoFileWithCandidatesSync(filePath, {
    candidates: [absentAbsoluteCandidate, 'missing-gofmt', 'invalid-gofmt', 'gofmt'],
    cwd,
    fileExists(candidate) {
      assert.equal(candidate, absentAbsoluteCandidate);
      return false;
    },
    spawn(command) {
      calls.push(command);
      if (command === 'missing-gofmt') {
        return { status: null, error: { code: 'ENOENT' } };
      }
      if (command === 'invalid-gofmt') {
        return { status: null, error: { code: 'EINVAL' } };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.deepEqual(calls, ['missing-gofmt', 'invalid-gofmt', 'gofmt']);
});

test('SDK formatter does not fall back after timeout, signal, overflow, permission, or exit failure', () => {
  const cwd = path.join(os.tmpdir(), 'goexample-sdk-formatter');
  const filePath = path.join(cwd, 'client.gen.go');
  const cases = [
    {
      result: { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } },
      expected: /timed out after 30000 ms/,
    },
    {
      result: { status: null, signal: 'SIGKILL' },
      expected: /terminated by signal SIGKILL/,
    },
    {
      result: { status: null, error: { code: 'ENOBUFS' } },
      expected: /output exceeded 67108864 bytes/,
    },
    {
      result: { status: null, error: { code: 'EACCES', message: 'permission denied' } },
      expected: /permission denied/,
    },
    {
      result: { status: 2, stderr: 'invalid Go source' },
      expected: /invalid Go source/,
    },
  ];

  for (const { result, expected } of cases) {
    let callCount = 0;
    assert.throws(
      () => formatGoFileWithCandidatesSync(filePath, {
        candidates: ['configured-gofmt', 'fallback-gofmt'],
        cwd,
        spawn() {
          callCount += 1;
          return result;
        },
      }),
      expected,
    );
    assert.equal(callCount, 1);
  }
});

test('SDK formatter bounds stderr included in failure diagnostics', () => {
  const cwd = path.join(os.tmpdir(), 'goexample-sdk-formatter');
  const filePath = path.join(cwd, 'client.gen.go');
  const largeStderr = 'x'.repeat(maximumFormatterDiagnosticCharacters * 4);

  assert.throws(
    () => formatGoFileWithCandidatesSync(filePath, {
      candidates: ['gofmt'],
      cwd,
      spawn() {
        return { status: 2, stderr: largeStderr };
      },
    }),
    (error) => {
      assert.match(error.message, /^gofmt failed: x+\.\.\.$/);
      assert.ok(
        error.message.length <= maximumFormatterDiagnosticCharacters + 'gofmt failed: '.length,
      );
      return true;
    },
  );
});

test('SDK generation formats only a staged client and removes the staging directory', async (t) => {
  const { stagingRoot, clientPath } = await makeFixture(t);
  let formattedPath = null;
  const formatted = formatGeneratedGoSDKSourceSync('package fixture\nfunc generated(){}\n', {
    stagingRoot,
    formatFile(filePath) {
      formattedPath = filePath;
      writeFileSync(filePath, 'package fixture\n\nfunc generated() {}\n', 'utf8');
    },
  });

  assert.equal(formatted, 'package fixture\n\nfunc generated() {}\n');
  assert.notEqual(formattedPath, clientPath);
  assert.equal(path.dirname(path.dirname(formattedPath)), stagingRoot);
  assert.equal(await readFile(clientPath, 'utf8'), 'old client\n');
  assert.deepEqual(await readdir(stagingRoot), []);
});

test('SDK generation preserves canonical files and cleans staging when the formatter fails', async (t) => {
  const { stagingRoot, clientPath, versionPath } = await makeFixture(t);
  const formatterFailure = new Error('injected SDK formatter failure');

  assert.throws(
    () => formatGeneratedGoSDKSourceSync('invalid go source\n', {
      stagingRoot,
      formatFile() {
        throw formatterFailure;
      },
    }),
    (error) => error === formatterFailure,
  );
  assert.equal(await readFile(clientPath, 'utf8'), 'old client\n');
  assert.equal(await readFile(versionPath, 'utf8'), '1.0.0\n');
  assert.deepEqual(await readdir(stagingRoot), []);
});

test('SDK generation uses a unique staging directory for every invocation', async (t) => {
  const { stagingRoot } = await makeFixture(t);
  const stagedPaths = [];
  for (let index = 0; index < 2; index += 1) {
    formatGeneratedGoSDKSourceSync(`package fixture\n// ${index}\n`, {
      stagingRoot,
      formatFile(filePath) {
        stagedPaths.push(filePath);
      },
    });
  }

  assert.equal(stagedPaths.length, 2);
  assert.notEqual(path.dirname(stagedPaths[0]), path.dirname(stagedPaths[1]));
  assert.deepEqual(await readdir(stagingRoot), []);
});

test('SDK publication atomically replaces the generated client and version', async (t) => {
  const { clientPath, versionPath } = await makeFixture(t);

  publishGeneratedGoSDKSync({
    clientPath,
    versionPath,
    formattedSource: 'new formatted client\n',
    version: '2.0.0',
  });

  assert.equal(await readFile(clientPath, 'utf8'), 'new formatted client\n');
  assert.equal(await readFile(versionPath, 'utf8'), '2.0.0\n');
  assert.deepEqual(
    (await readdir(path.dirname(clientPath))).filter((name) => /^\.(?:client\.gen\.go|VERSION)\..+\.tmp$/.test(name)),
    [],
  );
});

test('SDK publication rolls back the client when version publication fails', async (t) => {
  const { clientPath, versionPath } = await makeFixture(t);
  const publicationFailure = new Error('injected SDK version publication failure');
  let publicationAttempts = 0;

  assert.throws(
    () => publishGeneratedGoSDKSync({
      clientPath,
      versionPath,
      formattedSource: 'new formatted client\n',
      version: '2.0.0',
      writeOutput(outputPath, data, options) {
        publicationAttempts += 1;
        if (publicationAttempts === 2) {
          assert.equal(outputPath, versionPath);
          throw publicationFailure;
        }
        writeFileAtomicallySync(outputPath, data, options);
      },
    }),
    (error) => error === publicationFailure,
  );

  assert.equal(publicationAttempts, 3, 'the completed client publication must be rolled back');
  assert.equal(await readFile(clientPath, 'utf8'), 'old client\n');
  assert.equal(await readFile(versionPath, 'utf8'), '1.0.0\n');

  const rollbackFailure = new Error('injected SDK client rollback failure');
  publicationAttempts = 0;
  assert.throws(
    () => publishGeneratedGoSDKSync({
      clientPath,
      versionPath,
      formattedSource: 'new client with failed rollback\n',
      version: '3.0.0',
      writeOutput(outputPath, data, options) {
        publicationAttempts += 1;
        if (publicationAttempts === 2) {
          throw publicationFailure;
        }
        if (publicationAttempts === 3) {
          throw rollbackFailure;
        }
        writeFileAtomicallySync(outputPath, data, options);
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, publicationFailure);
      assert.deepEqual(error.errors, [publicationFailure, rollbackFailure]);
      return true;
    },
  );
  assert.equal(publicationAttempts, 3);
  assert.equal(await readFile(clientPath, 'utf8'), 'new client with failed rollback\n');
  assert.equal(await readFile(versionPath, 'utf8'), '1.0.0\n');
});
