import { spawn as nativeSpawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const contractCommandMaximumDurationMs = 150_000;
export const contractCommandDefaultTimeoutMs = 60_000;
export const contractCommandMaximumOutputBytes = 8 * 1024 * 1024;
export const contractCommandDiagnosticCharacterLimit = 4_096;

const monotonicNow = () => performance.now();

function boundedDiagnostic(value) {
  const diagnostic = `${value ?? ''}`.trim();
  if (diagnostic.length <= contractCommandDiagnosticCharacterLimit) {
    return diagnostic;
  }
  const suffix = '\n...[truncated]';
  return `${diagnostic.slice(0, contractCommandDiagnosticCharacterLimit - suffix.length)}${suffix}`;
}

function validateTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > contractCommandMaximumDurationMs
  ) {
    throw new RangeError(
      `Contract command timeout must be a safe integer between 1 and ${contractCommandMaximumDurationMs} milliseconds`,
    );
  }
}

function validateOutputLimit(maxOutputBytes) {
  if (
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > contractCommandMaximumOutputBytes
  ) {
    throw new RangeError(
      `Contract command output limit must be a safe integer between 1 and ${contractCommandMaximumOutputBytes} bytes`,
    );
  }
}

function failure(command, classification, detail, result) {
  const suffix = detail ? `: ${boundedDiagnostic(detail)}` : '';
  const error = new Error(`Contract command "${command}" ${classification}${suffix}`);
  error.name = 'ContractCommandError';
  error.command = command;
  error.classification = classification;
  error.result = result;
  return error;
}

function validateInput(command, args, options, defaultCwd) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('Contract command must be a non-empty string');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Contract command arguments must be an array of strings');
  }
  const cwd = options.cwd ?? defaultCwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Contract command cwd must be a non-empty string');
  }
  if (typeof options.env !== 'object' || options.env === null || Array.isArray(options.env)) {
    throw new TypeError('Contract command environment must be an object');
  }
  validateTimeout(options.timeoutMs);
  validateOutputLimit(options.maxOutputBytes);
  return cwd;
}

function runCommand(command, args, options, dependencies) {
  const {
    cwd,
    env,
    timeoutMs,
    maxOutputBytes,
    allowFailure,
    spawn,
    now,
    schedule,
    cancel,
    deadline,
  } = dependencies;

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let timer = null;
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;

    const result = (status, signal = null, error = null) => ({
      status,
      signal,
      stdout,
      stderr,
      outputExceeded,
      spawnErrorCode: error?.code ?? null,
    });
    const finish = (candidate, error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        cancel(timer);
      }
      if (error && !allowFailure) {
        reject(error);
      } else {
        resolve(candidate);
      }
    };
    const terminate = () => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // The close event or settled result still records the failure.
      }
    };
    const failOnce = (classification, detail, candidate) => {
      const error = failure(command, classification, detail, candidate);
      finish(candidate, error);
    };
    const collect = (stream, chunk) => {
      if (settled || outputExceeded) {
        return stream;
      }
      const text = `${chunk}`;
      const chunkBytes = Buffer.byteLength(text);
      if (outputBytes + chunkBytes > maxOutputBytes) {
        outputExceeded = true;
        terminate();
        failOnce('output overflow', `exceeded ${maxOutputBytes} bytes`, result(1));
        return stream;
      }
      outputBytes += chunkBytes;
      return stream + text;
    };

    timer = schedule(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      terminate();
      failOnce('timeout', `after ${timeoutMs} ms`, result(1));
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
      });
    } catch (error) {
      failOnce('spawn failure', error?.message, result(1, null, error));
      return;
    }

    if (!child || typeof child.on !== 'function') {
      failOnce('missing status', undefined, result(1));
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.on('error', (error) => {
      if (timedOut || outputExceeded || settled) {
        return;
      }
      failOnce('spawn failure', error?.message, result(1, null, error));
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      const candidate = result(Number.isSafeInteger(code) ? code : 1, signal);
      if (timedOut || now() >= deadline) {
        timedOut = true;
        failOnce('timeout', `after ${timeoutMs} ms`, candidate);
      } else if (signal) {
        failOnce('signal', signal, candidate);
      } else if (code === 0) {
        finish(candidate);
      } else if (Number.isSafeInteger(code)) {
        failOnce('nonzero exit', `status ${code}`, candidate);
      } else {
        failOnce('missing status', undefined, candidate);
      }
    });
  });
}

export function createContractCommandRunner({
  cwd,
  spawn = nativeSpawn,
  now = monotonicNow,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = clearTimeout,
} = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Contract command runner cwd must be a non-empty string');
  }
  if (typeof spawn !== 'function' || typeof now !== 'function') {
    throw new TypeError('Contract command runner dependencies must be callable');
  }
  if (typeof schedule !== 'function' || typeof cancel !== 'function') {
    throw new TypeError('Contract command runner timer functions must be callable');
  }

  return async function runContractCommand(command, args = [], options = {}) {
    const normalized = {
      ...options,
      env: Object.hasOwn(options, 'env') ? options.env : process.env,
      timeoutMs: Object.hasOwn(options, 'timeoutMs')
        ? options.timeoutMs
        : contractCommandDefaultTimeoutMs,
      maxOutputBytes: Object.hasOwn(options, 'maxOutputBytes')
        ? options.maxOutputBytes
        : contractCommandMaximumOutputBytes,
      allowFailure: options.allowFailure === true,
    };
    const commandCwd = validateInput(command, args, normalized, cwd);
    const startedAt = now();
    if (!Number.isFinite(startedAt)) {
      throw new TypeError('Contract command clock must return a finite number');
    }
    return runCommand(command, args, normalized, {
      cwd: commandCwd,
      env: normalized.env,
      timeoutMs: normalized.timeoutMs,
      maxOutputBytes: normalized.maxOutputBytes,
      allowFailure: normalized.allowFailure,
      spawn,
      now,
      schedule,
      cancel,
      deadline: startedAt + normalized.timeoutMs,
    });
  };
}
