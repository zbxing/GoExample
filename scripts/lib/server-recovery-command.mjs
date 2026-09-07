import { spawnSync as nativeSpawnSync } from 'node:child_process';

// Four recovery scenarios run serially and each has a 60 second process budget.
// The outer budget leaves bounded headroom for startup and report assembly.
export const serverRecoveryEvidenceProcessTimeoutMs = 300_000;

function validateTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > serverRecoveryEvidenceProcessTimeoutMs
  ) {
    throw new RangeError(
      `Server recovery evidence timeout must be a safe integer between 1 and ${serverRecoveryEvidenceProcessTimeoutMs} milliseconds`,
    );
  }
}

export function runServerRecoveryDrill({
  cwd,
  scriptPath,
  env = process.env,
  timeoutMs = serverRecoveryEvidenceProcessTimeoutMs,
  nodePath = process.execPath,
  spawnSync = nativeSpawnSync,
} = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Server recovery evidence cwd must be a non-empty string');
  }
  if (typeof scriptPath !== 'string' || scriptPath.length === 0) {
    throw new TypeError('Server recovery evidence script path must be a non-empty string');
  }
  if (typeof nodePath !== 'string' || nodePath.length === 0) {
    throw new TypeError('Server recovery evidence node path must be a non-empty string');
  }
  if (typeof spawnSync !== 'function') {
    throw new TypeError('Server recovery evidence spawnSync must be callable');
  }
  validateTimeout(timeoutMs);

  let result;
  try {
    result = spawnSync(nodePath, [scriptPath], {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });
  } catch (error) {
    result = { status: null, signal: null, error };
  }

  return {
    status: Number.isSafeInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    spawnErrorCode: result?.error?.code ?? null,
  };
}
