import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

// A porcelain status line is normally well below 128 bytes. This permits
// hundreds of thousands of paths while keeping each synchronous command bound
// to 64 MiB instead of Node's 1 MiB default or an unbounded allocation.
export const maximumCommandOutputBytes = 64 * 1024 * 1024;
export const maximumCommandDurationMs = 30_000;

const retryableLaunchErrorCodes = new Set(['ENOENT', 'EINVAL']);
const goVersionPattern = /^go version go\d+\.\d+\.\d+ [a-z0-9]+\/[a-z0-9]+$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;

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

export function runBoundedCommand(command, args, {
  cwd,
  raw = false,
  spawn = spawnSync,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? 'cmd.exe',
  timeoutMs = maximumCommandDurationMs,
} = {}) {
  validateCommandDuration(timeoutMs);
  const spawnOptions = {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: maximumCommandOutputBytes,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  };
  const candidates = platform === 'win32' && !path.isAbsolute(command)
    ? [command, `${command}.cmd`, `${command}.exe`]
    : [command];
  for (const candidate of candidates) {
    const result = spawn(candidate, args, spawnOptions);
    if (result.status === 0) {
      return commandOutput(result, raw);
    }
    if (!isRetryableLaunchFailure(result)) {
      return null;
    }
  }
  if (platform === 'win32' && !path.isAbsolute(command)) {
    const result = spawn(
      commandShell,
      ['/d', '/s', '/c', [command, ...args].join(' ')],
      spawnOptions,
    );
    if (result.status === 0) {
      return commandOutput(result, raw);
    }
  }
  return null;
}

export function readBoundedGoVersion(command, {
  cwd,
  run = runBoundedCommand,
} = {}) {
  const value = `${run(command, ['version'], { cwd }) ?? ''}`.trim();
  return goVersionPattern.test(value) ? value : null;
}

export function readBoundedGitCommit({
  cwd,
  run = runBoundedCommand,
} = {}) {
  const value = `${run('git', ['rev-parse', 'HEAD'], { cwd }) ?? ''}`.trim();
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
