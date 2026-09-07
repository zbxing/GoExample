import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  contractCommandDiagnosticCharacterLimit,
  contractCommandMaximumDurationMs,
  contractCommandMaximumOutputBytes,
  createContractCommandRunner,
} from '../../scripts/lib/contract-command.mjs';

function childProcess({ code = 0, signal = null, stdout = '', stderr = '', autoClose = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.kill = (value) => {
    child.killCalls.push(value);
    return true;
  };
  if (autoClose) queueMicrotask(() => {
    if (stdout) child.stdout.end(stdout);
    else child.stdout.end();
    if (stderr) child.stderr.end(stderr);
    else child.stderr.end();
    child.emit('close', code, signal);
  });
  return child;
}

test('contract command runner uses bounded non-shell options and captures output', async () => {
  const calls = [];
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return childProcess({ stdout: 'ok\n', stderr: 'diagnostic\n' });
    },
    now: () => 10,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });

  const result = await runner('docker', ['version'], { env: { PATH: 'test' }, timeoutMs: 30_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ok\n');
  assert.equal(result.stderr, 'diagnostic\n');
  assert.deepEqual(calls[0].options, {
    cwd: 'C:\\repo',
    env: { PATH: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: 'SIGTERM',
  });
});

test('contract command runner validates before spawning', async () => {
  let spawnCount = 0;
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      spawnCount += 1;
      return childProcess();
    },
  });
  for (const [command, args, options] of [
    ['', [], {}],
    ['docker', [null], {}],
    ['docker', [], { timeoutMs: 0 }],
    ['docker', [], { timeoutMs: contractCommandMaximumDurationMs + 1 }],
    ['docker', [], { maxOutputBytes: contractCommandMaximumOutputBytes + 1 }],
    ['docker', [], { env: null }],
  ]) {
    await assert.rejects(runner(command, args, options), /Contract command/);
  }
  assert.equal(spawnCount, 0);
});

test('contract command runner classifies timeout and requests SIGTERM once', async () => {
  let timerCallback;
  let child;
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      child = childProcess();
      return child;
    },
    setTimeout(callback, timeout) {
      assert.equal(timeout, 1_000);
      timerCallback = callback;
      return 7;
    },
    clearTimeout() {},
  });
  const pending = runner('docker', ['pull', 'image'], { timeoutMs: 1_000 });
  timerCallback();
  await assert.rejects(pending, (error) => {
    assert.equal(error.classification, 'timeout');
    assert.match(error.message, /after 1000 ms/);
    return true;
  });
  assert.deepEqual(child.killCalls, ['SIGTERM']);
});

test('contract command runner bounds output and diagnostics', async () => {
  let child;
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      child = childProcess({ autoClose: false });
      queueMicrotask(() => child.stdout.emit('data', '12345'));
      return child;
    },
  });
  await assert.rejects(
    runner('docker', ['exec', 'private-secret'], { maxOutputBytes: 4 }),
    (error) => {
      assert.equal(error.classification, 'output overflow');
      assert.match(error.message, /exceeded 4 bytes/);
      assert.doesNotMatch(error.message, /private-secret/);
      return true;
    },
  );
  assert.deepEqual(child.killCalls, ['SIGTERM']);

  const diagnostic = 'x'.repeat(contractCommandDiagnosticCharacterLimit * 2);
  const failing = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      const candidate = childProcess({ code: 1, stderr: diagnostic });
      return candidate;
    },
  });
  await assert.rejects(failing('docker', ['run'], {}), (error) => {
    assert.equal(error.classification, 'nonzero exit');
    assert.match(error.message, /status 1/);
    assert.ok(error.message.length < contractCommandDiagnosticCharacterLimit + 100);
    return true;
  });
});

test('contract command runner applies the output limit across stdout and stderr', async () => {
  let child;
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      child = childProcess({ autoClose: false });
      queueMicrotask(() => {
        child.stdout.emit('data', '123');
        child.stderr.emit('data', '45');
      });
      return child;
    },
  });
  await assert.rejects(
    runner('docker', ['version'], { maxOutputBytes: 4 }),
    (error) => {
      assert.equal(error.classification, 'output overflow');
      return true;
    },
  );
  assert.deepEqual(child.killCalls, ['SIGTERM']);
});

test('allowFailure returns classified failures without throwing', async () => {
  const runner = createContractCommandRunner({
    cwd: 'C:\\repo',
    spawn() {
      return childProcess({ code: 2, signal: null });
    },
  });
  const result = await runner('docker', ['logs'], { allowFailure: true });
  assert.equal(result.status, 2);
  assert.equal(result.signal, null);
  assert.equal(result.outputExceeded, false);
});
