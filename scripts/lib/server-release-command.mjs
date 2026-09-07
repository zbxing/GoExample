import { spawnSync } from 'node:child_process';

export const serverReleaseCommandMaximumDurationMs = 600_000;
export const serverReleaseMetadataCommandTimeoutMs = 30_000;
export const serverReleaseDependencyCommandTimeoutMs = 120_000;
export const serverReleaseBuildCommandTimeoutMs = 180_000;
export const serverReleaseTaskCommandTimeoutMs = 600_000;
export const serverReleaseCommandMaximumOutputBytes = 8 * 1024 * 1024;
export const serverReleaseCommandDiagnosticCharacterLimit = 4_096;

function validateTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > serverReleaseCommandMaximumDurationMs
  ) {
    throw new RangeError(
      `Server release command timeout must be a safe integer between 1 and ${serverReleaseCommandMaximumDurationMs} milliseconds`,
    );
  }
}

function boundedDiagnostic(value) {
  const diagnostic = `${value ?? ''}`.trim();
  if (diagnostic.length <= serverReleaseCommandDiagnosticCharacterLimit) {
    return diagnostic;
  }
  const suffix = '\n...[truncated]';
  return `${diagnostic.slice(0, serverReleaseCommandDiagnosticCharacterLimit - suffix.length)}${suffix}`;
}

function failureDetail(result, timeoutMs) {
  const errorCode = result?.error?.code;
  if (errorCode === 'ETIMEDOUT') {
    return `timed out after ${timeoutMs} ms`;
  }
  if (errorCode === 'ENOBUFS') {
    return `output exceeded ${serverReleaseCommandMaximumOutputBytes} bytes`;
  }
  if (result?.signal) {
    return `terminated by signal ${result.signal}`;
  }

  const diagnostic = boundedDiagnostic(result?.stderr || result?.error?.message);
  if (errorCode) {
    return `failed to start (${errorCode})${diagnostic ? `: ${diagnostic}` : ''}`;
  }
  if (Number.isSafeInteger(result?.status)) {
    return `exited with status ${result.status}${diagnostic ? `: ${diagnostic}` : ''}`;
  }
  return diagnostic ? `failed without an exit status: ${diagnostic}` : 'failed without an exit status';
}

export function createServerReleaseCommandRunner({ cwd, spawn = spawnSync } = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Server release command cwd must be a non-empty string');
  }
  if (typeof spawn !== 'function') {
    throw new TypeError('Server release command spawn must be a function');
  }

  return function runServerReleaseCommand(command, args, {
    cwd: commandCwd = cwd,
    env = process.env,
    description = command,
    timeoutMs,
  } = {}) {
    if (typeof command !== 'string' || command.length === 0) {
      throw new TypeError('Server release command must be a non-empty string');
    }
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('Server release command arguments must be an array of strings');
    }
    if (typeof commandCwd !== 'string' || commandCwd.length === 0) {
      throw new TypeError('Server release command cwd must be a non-empty string');
    }
    if (typeof description !== 'string' || description.length === 0) {
      throw new TypeError('Server release command description must be a non-empty string');
    }
    validateTimeout(timeoutMs);

    let result;
    try {
      result = spawn(command, args, {
        cwd: commandCwd,
        env,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        maxBuffer: serverReleaseCommandMaximumOutputBytes,
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
      });
    } catch (error) {
      result = { status: null, error };
    }
    if (result?.status === 0 && !result.error && !result.signal) {
      return `${result.stdout ?? ''}`.trim();
    }
    throw new Error(`${description} failed: ${failureDetail(result, timeoutMs)}`);
  };
}
