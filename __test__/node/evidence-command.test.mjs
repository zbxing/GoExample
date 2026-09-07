import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evidenceCommandMaximumDurationMs,
  evidenceCommandMaximumOutputBytes,
  runEvidenceCommand,
} from '../../scripts/lib/evidence-command.mjs';

const cwd = process.cwd();

test('evidence commands use bounded non-shell options and preserve output', () => {
  let call;
  const result = runEvidenceCommand('tool', ['--check'], {
    cwd,
    timeoutMs: 30_000,
    spawnSync(command, args, options) {
      call = { command, args, options };
      return { status: 0, stdout: 'ok\n', stderr: '' };
    },
  });

  assert.deepEqual(result, {
    status: 0,
    signal: null,
    timedOut: false,
    stdout: 'ok\n',
    stderr: '',
  });
  assert.equal(call.command, 'tool');
  assert.deepEqual(call.args, ['--check']);
  assert.equal(call.options.cwd, cwd);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.maxBuffer, evidenceCommandMaximumOutputBytes);
  assert.equal(call.options.timeout, 30_000);
  assert.equal(call.options.killSignal, 'SIGTERM');
});

test('evidence commands classify timeout, signal, missing status, and nonzero exits', () => {
  const timeout = runEvidenceCommand('tool', [], {
    cwd,
    spawnSync() {
      return { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'timed out' } };
    },
  });
  assert.equal(timeout.status, 1);
  assert.equal(timeout.signal, 'SIGTERM');
  assert.equal(timeout.timedOut, true);
  assert.match(timeout.stderr, /timed out/);

  const signal = runEvidenceCommand('tool', [], {
    cwd,
    spawnSync() {
      return { status: null, signal: 'SIGTERM' };
    },
  });
  assert.deepEqual(signal, {
    status: 1,
    signal: 'SIGTERM',
    timedOut: false,
    stdout: '',
    stderr: '',
  });

  const missing = runEvidenceCommand('tool', [], {
    cwd,
    spawnSync() {
      return {};
    },
  });
  assert.equal(missing.status, 1);

  const nonzero = runEvidenceCommand('tool', [], {
    cwd,
    spawnSync() {
      return { status: 7, stdout: '', stderr: 'failed' };
    },
  });
  assert.equal(nonzero.status, 7);
  assert.equal(nonzero.stderr, 'failed');
});

test('evidence command validates duration and spawn dependencies', () => {
  assert.throws(
    () => runEvidenceCommand('tool', [], { cwd, timeoutMs: evidenceCommandMaximumDurationMs + 1 }),
    /timeout must be a safe integer/,
  );
  assert.throws(
    () => runEvidenceCommand('tool', [], { cwd, spawnSync: null }),
    /spawnSync must be callable/,
  );
  assert.throws(
    () => runEvidenceCommand('tool', [], { cwd: '', spawnSync() {} }),
    /cwd must be a non-empty string/,
  );
});
