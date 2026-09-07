import { spawnSync as nativeSpawnSync } from 'node:child_process';

// Evidence commands are synchronous because their reports are assembled in order,
// but they still need the same bounded process contract as asynchronous runners.
export const evidenceCommandMaximumDurationMs = 180_000;
export const evidenceCommandMaximumOutputBytes = 2 * 1024 * 1024;

function validateTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > evidenceCommandMaximumDurationMs
  ) {
    throw new RangeError(
      `Evidence command timeout must be a safe integer between 1 and ${evidenceCommandMaximumDurationMs} milliseconds`,
    );
  }
}

export function runEvidenceCommand(command, args = [], {
  cwd,
  env,
  timeoutMs = evidenceCommandMaximumDurationMs,
  spawnSync = nativeSpawnSync,
} = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('Evidence command must be a non-empty string');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Evidence command arguments must be an array of strings');
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Evidence command cwd must be a non-empty string');
  }
  if (typeof spawnSync !== 'function') {
    throw new TypeError('Evidence command spawnSync must be callable');
  }
  validateTimeout(timeoutMs);

  let result;
  try {
    result = spawnSync(command, args, {
      cwd,
      ...(env === undefined ? {} : { env }),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: evidenceCommandMaximumOutputBytes,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });
  } catch (error) {
    result = { status: null, signal: null, error };
  }

  return {
    status: Number.isSafeInteger(result?.status) ? result.status : 1,
    signal: result?.signal ?? null,
    timedOut: result?.error?.code === 'ETIMEDOUT',
    stdout: `${result?.stdout ?? ''}`,
    stderr: `${result?.stderr ?? result?.error?.message ?? ''}`,
  };
}
