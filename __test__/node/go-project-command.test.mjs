import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  createGoProjectCommandRunner,
  goProjectCommandDiagnosticCharacterLimit,
  goProjectCommandMaximumDurationMs,
  goProjectTaskBudgetMs,
} from '../../scripts/lib/go-project-command.mjs';

const command = (index) => ({ cwd: `C:\\work\\${index}`, args: [`arg-${index}`] });

function successfulSpawn(calls, { closeCode = 0, closeSignal = null } = {}) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', closeCode, closeSignal));
    return child;
  };
}

test('Go project runner applies a decreasing total budget and safe spawn options', async () => {
  const calls = [];
  const timers = [];
  let clock = 0;
  const runner = createGoProjectCommandRunner({
    spawn: successfulSpawn(calls),
    now: () => {
      const value = clock;
      clock += value === 0 ? 1_000 : 2_000;
      return value;
    },
    setTimeout(callback, timeout) {
      timers.push({ callback, timeout });
      return timers.length;
    },
    clearTimeout() {},
  });

  await runner({
    task: 'bench-transports',
    executable: 'go.exe',
    commands: [command(1), command(2)],
    env: { GOFLAGS: '-mod=readonly' },
    budgetMs: 20_000,
  });

  assert.deepEqual(calls.map(({ executable, args }) => ({ executable, args })), [
    { executable: 'go.exe', args: ['arg-1'] },
    { executable: 'go.exe', args: ['arg-2'] },
  ]);
  assert.equal(calls[0].options.cwd, 'C:\\work\\1');
  assert.equal(calls[0].options.env.GOFLAGS, '-mod=readonly');
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.killSignal, 'SIGTERM');
  assert.ok(calls[0].options.timeout > calls[1].options.timeout);
  assert.ok(calls[1].options.timeout > 0);
  assert.deepEqual(timers.map(({ timeout }) => timeout), [19_000, 17_000]);
});

test('run task explicitly has no timeout or kill signal', async () => {
  const calls = [];
  const runner = createGoProjectCommandRunner({
    spawn: successfulSpawn(calls),
    now: () => 0,
    setTimeout() {
      throw new Error('run must not schedule a timeout');
    },
  });

  await runner({
    task: 'run',
    executable: 'go.exe',
    commands: [command(1)],
    env: {},
    budgetMs: null,
  });
  assert.equal('timeout' in calls[0].options, false);
  assert.equal('killSignal' in calls[0].options, false);
});

test('runner validates all input before spawning', async () => {
  let spawnCount = 0;
  const runner = createGoProjectCommandRunner({
    spawn() {
      spawnCount += 1;
      return new EventEmitter();
    },
  });

  for (const input of [
    {},
    { task: 'test', executable: '', commands: [command(1)], env: {}, budgetMs: 1 },
    { task: 'test', executable: 'go', commands: [], env: {}, budgetMs: 1 },
    { task: 'test', executable: 'go', commands: [{ cwd: '', args: [] }], env: {}, budgetMs: 1 },
    { task: 'test', executable: 'go', commands: [{ cwd: 'C:\\work', args: [null] }], env: {}, budgetMs: 1 },
    { task: 'test', executable: 'go', commands: [command(1)], env: {}, budgetMs: 0 },
    { task: 'test', executable: 'go', commands: [command(1)], env: {}, budgetMs: goProjectCommandMaximumDurationMs + 1 },
  ]) {
    await assert.rejects(runner(input), /Go project/);
  }
  assert.equal(spawnCount, 0);
});

test('budget exhaustion prevents later commands from spawning', async () => {
  const calls = [];
  const clocks = [0, 1, 11];
  const runner = createGoProjectCommandRunner({
    spawn: successfulSpawn(calls),
    now: () => clocks.shift() ?? 11,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });

  await assert.rejects(
    runner({
      task: 'test',
      executable: 'go',
      commands: [command(1), command(2)],
      env: {},
      budgetMs: 5,
    }),
    (error) => error.classification === 'budget exhausted' && error.commandIndex === 1,
  );
  assert.equal(calls.length, 1);
});

test('timeout requests SIGTERM and settles only once', async () => {
  let timeoutCallback;
  let killSignal;
  const runner = createGoProjectCommandRunner({
    spawn() {
      const child = new EventEmitter();
      child.kill = (signal) => {
        killSignal = signal;
      };
      return child;
    },
    now: () => 0,
    setTimeout(callback) {
      timeoutCallback = callback;
      return 1;
    },
    clearTimeout() {},
  });
  const pending = runner({
    task: 'test',
    executable: 'go',
    commands: [command(1)],
    env: {},
    budgetMs: 100,
  });
  timeoutCallback();
  await assert.rejects(pending, (error) => error.classification === 'timeout');
  assert.equal(killSignal, 'SIGTERM');
});

test('spawn, signal, missing-status, and nonzero failures are classified and stop later commands', async () => {
  const cases = [
    {
      classification: 'spawn failure',
      spawn() {
        throw Object.assign(new Error('launch detail'), { code: 'EACCES' });
      },
    },
    {
      classification: 'signal',
      spawn() {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        return child;
      },
    },
    {
      classification: 'missing status',
      spawn() {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', null, null));
        return child;
      },
    },
    {
      classification: 'nonzero exit',
      spawn() {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', 23, null));
        return child;
      },
    },
  ];
  for (const { classification, spawn } of cases) {
    let spawnCount = 0;
    const runner = createGoProjectCommandRunner({
      spawn(...args) {
        spawnCount += 1;
        return spawn(...args);
      },
    });
    await assert.rejects(
      runner({ task: 'test', executable: 'go', commands: [command(1), command(2)], env: {}, budgetMs: 100 }),
      (error) => error.classification === classification && error.commandIndex === 0,
    );
    assert.equal(spawnCount, 1);
  }
});

test('spawn diagnostics are bounded and do not include command arguments or output', async () => {
  const secretArgument = 'private-argument';
  const runner = createGoProjectCommandRunner({
    spawn() {
      throw new Error('x'.repeat(goProjectCommandDiagnosticCharacterLimit * 2));
    },
  });
  await assert.rejects(
    runner({
      task: 'test',
      executable: 'go',
      commands: [{ cwd: 'C:\\work', args: [secretArgument] }],
      env: {},
      budgetMs: 100,
    }),
    (error) => {
      assert.equal(error.classification, 'spawn failure');
      assert.ok(error.message.length <= goProjectCommandDiagnosticCharacterLimit + 100);
      assert.doesNotMatch(error.message, new RegExp(secretArgument));
      assert.match(error.message, /\.\.\.\[truncated\]$/);
      return true;
    },
  );
});

test('task budget map keeps the long-lived run exception and documented tiers', () => {
  assert.equal(goProjectTaskBudgetMs.run, null);
  assert.equal(goProjectTaskBudgetMs['api-compat'], 5 * 60_000);
  assert.equal(goProjectTaskBudgetMs['api-snapshot'], 5 * 60_000);
  assert.equal(goProjectTaskBudgetMs.vet, 10 * 60_000);
  assert.equal(goProjectTaskBudgetMs.build, 10 * 60_000);
  assert.equal(goProjectTaskBudgetMs.test, 15 * 60_000);
  assert.equal(goProjectTaskBudgetMs.cover, 15 * 60_000);
  assert.equal(goProjectTaskBudgetMs.bench, 15 * 60_000);
  for (const task of ['bench-transports', 'soak-transports', 'race', 'vuln']) {
    assert.equal(goProjectTaskBudgetMs[task], 20 * 60_000);
  }
});
