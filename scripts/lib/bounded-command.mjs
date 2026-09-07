import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// A porcelain status line is normally well below 128 bytes. This permits
// hundreds of thousands of paths while keeping each synchronous command bound
// to 64 MiB instead of Node's 1 MiB default or an unbounded allocation.
export const maximumCommandOutputBytes = 64 * 1024 * 1024;
export const maximumCommandDurationMs = 30_000;

const retryableLaunchErrorCodes = new Set(['ENOENT', 'EINVAL']);
const goVersionPattern = /^go version go\d+\.\d+\.\d+ [a-z0-9]+\/[a-z0-9]+$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const windowsShellTokenPattern = /^[A-Za-z0-9_.,\\/:=+@-]+$/;
const monotonicNow = () => performance.now();

function validateCommandDuration(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > maximumCommandDurationMs
  ) {
    throw new RangeError(
      `Command timeout must be a safe integer between 1 and ${maximumCommandDurationMs} milliseconds`,
    );
  }
}

function commandOutput(result, raw) {
  const output = `${result.stdout ?? ''}`;
  return raw ? output : output.trim() || null;
}

function isRetryableLaunchFailure(result) {
  return result.status === null && retryableLaunchErrorCodes.has(result.error?.code);
}

function readCommandClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Command clock must return a finite number');
  }
  return timestamp;
}

function remainingCommandDuration(deadline, timeoutMs, now) {
  const remaining = Math.min(timeoutMs, Math.ceil(deadline - readCommandClock(now)));
  return remaining > 0 ? remaining : null;
}

function windowsShellCommand(command, args) {
  const tokens = [command, ...args];
  return tokens.every(
    (token) => typeof token === 'string' && windowsShellTokenPattern.test(token),
  )
    ? tokens.join(' ')
    : null;
}

function commandExecutionPlan(command, platform) {
  if (platform !== 'win32') {
    return { candidates: [command], shellFallback: false };
  }

  const extension = path.win32.extname(command).toLowerCase();
  const isBatchCommand = extension === '.cmd' || extension === '.bat';
  if (path.win32.isAbsolute(command) || extension !== '') {
    return { candidates: [command], shellFallback: isBatchCommand };
  }

  return {
    candidates: [command, `${command}.cmd`, `${command}.exe`],
    shellFallback: true,
  };
}

export function runBoundedCommand(command, args, {
  cwd,
  env,
  raw = false,
  spawn = spawnSync,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? 'cmd.exe',
  timeoutMs = maximumCommandDurationMs,
  now = monotonicNow,
} = {}) {
  validateCommandDuration(timeoutMs);
  const deadline = readCommandClock(now) + timeoutMs;
  const spawnOptions = {
    cwd,
    ...(env === undefined ? {} : { env }),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: maximumCommandOutputBytes,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  };
  const spawnWithinBudget = (candidate, candidateArgs) => {
    const remainingTimeoutMs = remainingCommandDuration(deadline, timeoutMs, now);
    return remainingTimeoutMs === null
      ? null
      : spawn(candidate, candidateArgs, {
          ...spawnOptions,
          timeout: remainingTimeoutMs,
        });
  };
  const plan = commandExecutionPlan(command, platform);
  for (const candidate of plan.candidates) {
    const result = spawnWithinBudget(candidate, args);
    if (result === null) {
      return null;
    }
    if (result.status === 0) {
      return commandOutput(result, raw);
    }
    if (!isRetryableLaunchFailure(result)) {
      return null;
    }
  }
  if (plan.shellFallback) {
    const shellCommand = windowsShellCommand(command, args);
    if (shellCommand === null) {
      return null;
    }
    const result = spawnWithinBudget(
      commandShell,
      ['/d', '/s', '/v:off', '/c', shellCommand],
    );
    if (result === null) {
      return null;
    }
    if (result.status === 0) {
      return commandOutput(result, raw);
    }
  }
  return null;
}

export function readBoundedGoVersion(command, {
  cwd,
  env,
  run = runBoundedCommand,
} = {}) {
  const options = env === undefined ? { cwd } : { cwd, env };
  const value = `${run(command, ['version'], options) ?? ''}`.trim();
  return goVersionPattern.test(value) ? value : null;
}

export function readBoundedGitCommit({
  cwd,
  env,
  run = runBoundedCommand,
} = {}) {
  const options = env === undefined ? { cwd } : { cwd, env };
  const value = `${run('git', ['rev-parse', 'HEAD'], options) ?? ''}`.trim();
  return gitCommitPattern.test(value) ? value : null;
}

export function summarizeGitStatus(status) {
  if (typeof status !== 'string') {
    throw new TypeError('Git status must be a string');
  }
  const dirty = status.length > 0;
  return {
    dirty,
    changedFileCount: dirty ? status.split('\n').filter(Boolean).length : 0,
    statusSha256: createHash('sha256').update(status).digest('hex'),
  };
}
