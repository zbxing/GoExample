import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runServerRecoveryDrill,
  serverRecoveryEvidenceProcessTimeoutMs,
} from '../../scripts/lib/server-recovery-command.mjs';

const baseOptions = {
  cwd: 'repository-root',
  scriptPath: 'scripts/server-recovery-drill.mjs',
  nodePath: 'node',
};

test('server recovery drill runner applies bounded non-shell options', () => {
  const calls = [];
  const result = runServerRecoveryDrill({
    ...baseOptions,
    env: { GOFLAGS: '' },
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null, error: null };
    },
  });

  assert.deepEqual(result, { status: 0, signal: null, spawnErrorCode: null });
  assert.deepEqual(calls, [{
    command: 'node',
    args: ['scripts/server-recovery-drill.mjs'],
    options: {
      cwd: 'repository-root',
      env: { GOFLAGS: '' },
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      timeout: serverRecoveryEvidenceProcessTimeoutMs,
      killSignal: 'SIGTERM',
    },
  }]);
});

test('server recovery drill runner classifies timeout, signal, spawn, nonzero, and missing status', () => {
  const cases = [
    [{ status: null, signal: 'SIGTERM', error: Object.assign(new Error('late'), { code: 'ETIMEDOUT' }) }, { status: null, signal: 'SIGTERM', spawnErrorCode: 'ETIMEDOUT' }],
    [{ status: null, signal: 'SIGINT', error: null }, { status: null, signal: 'SIGINT', spawnErrorCode: null }],
    [{ status: null, signal: null, error: Object.assign(new Error('denied'), { code: 'EACCES' }) }, { status: null, signal: null, spawnErrorCode: 'EACCES' }],
    [{ status: 7, signal: null, error: null }, { status: 7, signal: null, spawnErrorCode: null }],
    [{ status: undefined, signal: undefined, error: undefined }, { status: null, signal: null, spawnErrorCode: null }],
  ];

  for (const [spawnResult, expected] of cases) {
    assert.deepEqual(
      runServerRecoveryDrill({ ...baseOptions, spawnSync: () => spawnResult }),
      expected,
    );
  }
});

test('server recovery drill runner rejects invalid inputs without spawning', () => {
  let spawnCount = 0;
  const spawnSync = () => {
    spawnCount += 1;
    return { status: 0 };
  };

  for (const timeoutMs of [0, -1, 1.5, Number.NaN, serverRecoveryEvidenceProcessTimeoutMs + 1]) {
    assert.throws(
      () => runServerRecoveryDrill({ ...baseOptions, timeoutMs, spawnSync }),
      /timeout must be a safe integer/,
    );
  }
  assert.throws(() => runServerRecoveryDrill({ ...baseOptions, cwd: '', spawnSync }), /cwd must be a non-empty string/);
  assert.throws(() => runServerRecoveryDrill({ ...baseOptions, scriptPath: '', spawnSync }), /script path must be a non-empty string/);
  assert.throws(() => runServerRecoveryDrill({ ...baseOptions, spawnSync: null }), /spawnSync must be callable/);
  assert.equal(spawnCount, 0);
});
