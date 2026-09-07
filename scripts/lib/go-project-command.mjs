import { spawn as nativeSpawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const goProjectCommandMaximumDurationMs = 20 * 60_000;
export const goProjectCommandDiagnosticCharacterLimit = 4_096;
export const goProjectTaskBudgetMs = Object.freeze({
  run: null,
  'api-compat': 5 * 60_000,
  'api-snapshot': 5 * 60_000,
  vet: 10 * 60_000,
  build: 10 * 60_000,
  test: 15 * 60_000,
  cover: 15 * 60_000,
  bench: 15 * 60_000,
  'bench-transports': 20 * 60_000,
  'soak-transports': 20 * 60_000,
  race: 20 * 60_000,
  vuln: 20 * 60_000,
});

const monotonicNow = () => performance.now();

function boundedDiagnostic(value) {
  const diagnostic = `${value ?? ''}`.trim();
  if (diagnostic.length <= goProjectCommandDiagnosticCharacterLimit) {
    return diagnostic;
  }
  const suffix = '\n...[truncated]';
  return `${diagnostic.slice(0, goProjectCommandDiagnosticCharacterLimit - suffix.length)}${suffix}`;
}

function readClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Go project command clock must return a finite number');
  }
  return timestamp;
}

function validateBudget(budgetMs) {
  if (budgetMs === null) {
    return;
  }
  if (
    !Number.isSafeInteger(budgetMs) ||
    budgetMs <= 0 ||
    budgetMs > goProjectCommandMaximumDurationMs
  ) {
    throw new RangeError(
      `Go project task budget must be null or a safe integer between 1 and ${goProjectCommandMaximumDurationMs} milliseconds`,
    );
  }
}

function validateInput({ task, executable, commands, cwd, env, budgetMs }) {
  if (typeof task !== 'string' || task.length === 0) {
    throw new TypeError('Go project task must be a non-empty string');
  }
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new TypeError('Go project executable must be a non-empty string');
  }
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new TypeError('Go project commands must be a non-empty array');
  }
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new TypeError('Go project command environment must be an object');
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length === 0)) {
    throw new TypeError('Go project command cwd must be a non-empty string');
  }
  validateBudget(budgetMs);
  for (const [index, command] of commands.entries()) {
    if (typeof command !== 'object' || command === null || Array.isArray(command)) {
      throw new TypeError(`Go project command ${index} must be an object`);
    }
    const commandCwd = command.cwd ?? cwd;
    if (typeof commandCwd !== 'string' || commandCwd.length === 0) {
      throw new TypeError(`Go project command ${index} cwd must be a non-empty string`);
    }
    if (!Array.isArray(command.args) || command.args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError(`Go project command ${index} arguments must be an array of strings`);
    }
  }
}

function failureMessage(task, index, classification, detail) {
  const suffix = detail ? `: ${boundedDiagnostic(detail)}` : '';
  return `Go project task "${task}" command ${index} ${classification}${suffix}`;
}

function createFailure(task, index, classification, {
  detail,
  exitCode = 1,
  signal = null,
} = {}) {
  const error = new Error(failureMessage(task, index, classification, detail));
  error.name = 'GoProjectCommandError';
  error.classification = classification;
  error.task = task;
  error.commandIndex = index;
  error.exitCode = Number.isSafeInteger(exitCode) && exitCode > 0 ? exitCode : 1;
  error.signal = signal;
  return error;
}

function remainingTimeout(deadline, now) {
  const remaining = Math.ceil(deadline - readClock(now));
  return remaining > 0 ? remaining : null;
}

function runChild({ task, index, executable, command, env, timeoutMs, spawn, schedule, cancel }) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timedOut = false;
    let timer = null;

    const settleFailure = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        cancel(timer);
      }
      reject(error);
    };
    const settleSuccess = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        cancel(timer);
      }
      resolve();
    };

    // Register the backup timer before spawning so a slow launch is covered by
    // the same per-command deadline as the process body.
    if (timeoutMs !== null) {
      timer = schedule(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        try {
          child?.kill('SIGTERM');
        } catch {
          // The close event still determines the final process state.
        }
        settleFailure(createFailure(task, index, 'timeout', {
          detail: `after ${timeoutMs} ms`,
        }));
      }, timeoutMs);
    }

    try {
      const options = {
        cwd: command.cwd,
        env,
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        ...(timeoutMs === null ? {} : { timeout: timeoutMs, killSignal: 'SIGTERM' }),
      };
      child = spawn(executable, command.args, options);
    } catch (error) {
      settleFailure(createFailure(task, index, 'spawn failure', {
        detail: error?.message,
      }));
      return;
    }

    if (!child || typeof child.on !== 'function') {
      settleFailure(createFailure(task, index, 'missing status'));
      return;
    }
    child.on('error', (error) => {
      if (timedOut || error?.code === 'ETIMEDOUT') {
        settleFailure(createFailure(task, index, 'timeout', {
          detail: timeoutMs === null ? undefined : `after ${timeoutMs} ms`,
        }));
        return;
      }
      settleFailure(createFailure(task, index, 'spawn failure', {
        detail: error?.message,
      }));
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      if (timedOut) {
        settleFailure(createFailure(task, index, 'timeout', {
          detail: timeoutMs === null ? undefined : `after ${timeoutMs} ms`,
        }));
        return;
      }
      if (signal) {
        settleFailure(createFailure(task, index, 'signal', { detail: signal, signal }));
        return;
      }
      if (code === 0) {
        settleSuccess();
        return;
      }
      if (Number.isSafeInteger(code)) {
        settleFailure(createFailure(task, index, 'nonzero exit', {
          detail: `status ${code}`,
          exitCode: code,
        }));
        return;
      }
      settleFailure(createFailure(task, index, 'missing status'));
    });
  });
}

export function createGoProjectCommandRunner({
  spawn = nativeSpawn,
  now = monotonicNow,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = clearTimeout,
} = {}) {
  if (typeof spawn !== 'function') {
    throw new TypeError('Go project command spawn must be a function');
  }
  if (typeof now !== 'function') {
    throw new TypeError('Go project command clock must be a function');
  }
  if (typeof schedule !== 'function' || typeof cancel !== 'function') {
    throw new TypeError('Go project command timer functions must be callable');
  }

  return async function runGoProjectTask({
    task,
    executable,
    commands,
    cwd,
    env = process.env,
    budgetMs,
  } = {}) {
    validateInput({ task, executable, commands, cwd, env, budgetMs });
    const deadline = budgetMs === null ? null : readClock(now) + budgetMs;
    const results = [];
    for (const [index, command] of commands.entries()) {
      const timeoutMs = deadline === null ? null : remainingTimeout(deadline, now);
      if (timeoutMs === null && deadline !== null) {
        throw createFailure(task, index, 'budget exhausted');
      }
      await runChild({
        task,
        index,
        executable,
        command: { ...command, cwd: command.cwd ?? cwd },
        env,
        timeoutMs,
        spawn,
        schedule,
        cancel,
      });
      results.push({ index, timeoutMs });
    }
    return results;
  };
}
