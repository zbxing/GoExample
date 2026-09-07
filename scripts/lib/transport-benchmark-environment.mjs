import { createHash } from 'node:crypto';
import os from 'node:os';
import { runBoundedCommand } from './bounded-command.mjs';

const fingerprintFields = [
  ['runner.provider', (value) => value.runner.provider],
  ['runner.os', (value) => value.runner.os],
  ['runner.arch', (value) => value.runner.arch],
  ['runner.imageOS', (value) => value.runner.imageOS],
  ['runner.imageVersion', (value) => value.runner.imageVersion],
  ['cpu.model', (value) => value.cpu.model],
  ['cpu.logicalCpus', (value) => value.cpu.logicalCpus],
  ['toolchain.goVersion', (value) => value.toolchain.goVersion],
  ['execution.gomaxprocs', (value) => value.execution.gomaxprocs],
];

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are incompatible`);
  }
}

function normalizedString(value, label, maximumLength = 256) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximumLength || normalized !== value) {
    throw new Error(`${label} must be normalized and contain 1-${maximumLength} characters`);
  }
  return normalized;
}

function fingerprintPayload(value) {
  return {
    schemaVersion: value.schemaVersion,
    runner: {
      provider: value.runner.provider,
      os: value.runner.os,
      arch: value.runner.arch,
      imageOS: value.runner.imageOS,
      imageVersion: value.runner.imageVersion,
    },
    cpu: {
      model: value.cpu.model,
      logicalCpus: value.cpu.logicalCpus,
    },
    toolchain: { goVersion: value.toolchain.goVersion },
    execution: { gomaxprocs: value.execution.gomaxprocs },
  };
}

export function fingerprintSha256(value) {
  return createHash('sha256').update(JSON.stringify(fingerprintPayload(value))).digest('hex');
}

export function validateEnvironmentFingerprint(value, { requireGitHubActions = false } = {}) {
  requireObject(value, 'environmentFingerprint');
  requireExactKeys(
    value,
    ['schemaVersion', 'runner', 'cpu', 'toolchain', 'execution', 'sha256'],
    'environmentFingerprint',
  );
  if (value.schemaVersion !== 1) {
    throw new Error('environmentFingerprint schemaVersion must be 1');
  }

  requireObject(value.runner, 'environmentFingerprint.runner');
  requireExactKeys(
    value.runner,
    ['provider', 'os', 'arch', 'imageOS', 'imageVersion'],
    'environmentFingerprint.runner',
  );
  for (const field of ['provider', 'os', 'arch', 'imageOS', 'imageVersion']) {
    normalizedString(value.runner[field], `environmentFingerprint.runner.${field}`);
  }

  requireObject(value.cpu, 'environmentFingerprint.cpu');
  requireExactKeys(value.cpu, ['model', 'logicalCpus'], 'environmentFingerprint.cpu');
  normalizedString(value.cpu.model, 'environmentFingerprint.cpu.model', 512);
  if (!Number.isInteger(value.cpu.logicalCpus) || value.cpu.logicalCpus < 1) {
    throw new Error('environmentFingerprint.cpu.logicalCpus must be a positive integer');
  }

  requireObject(value.toolchain, 'environmentFingerprint.toolchain');
  requireExactKeys(value.toolchain, ['goVersion'], 'environmentFingerprint.toolchain');
  normalizedString(value.toolchain.goVersion, 'environmentFingerprint.toolchain.goVersion');
  if (!/^go\d+\.\d+(?:\.\d+)?$/.test(value.toolchain.goVersion)) {
    throw new Error('environmentFingerprint.toolchain.goVersion must be a stable Go version');
  }

  requireObject(value.execution, 'environmentFingerprint.execution');
  requireExactKeys(value.execution, ['gomaxprocs'], 'environmentFingerprint.execution');
  if (value.execution.gomaxprocs !== 2) {
    throw new Error('environmentFingerprint.execution.gomaxprocs must be 2');
  }

  if (!/^[a-f0-9]{64}$/.test(value.sha256) || value.sha256 !== fingerprintSha256(value)) {
    throw new Error('environmentFingerprint sha256 does not match its canonical fields');
  }
  if (requireGitHubActions && value.runner.provider !== 'github-actions') {
    throw new Error('environmentFingerprint runner.provider must be github-actions');
  }
  if (requireGitHubActions && value.runner.os.toLowerCase() !== 'linux') {
    throw new Error('environmentFingerprint runner.os must be Linux');
  }
  return value;
}

function requiredEnvironmentValue(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be set for a GitHub Actions benchmark`);
  }
  return value;
}

function goVersion(environment) {
  const configured = environment.TRANSPORT_BENCHMARK_GO_VERSION?.trim();
  if (configured) {
    return configured.startsWith('go') ? configured : `go${configured}`;
  }
  const command = environment.GO_BINARY?.trim() || (process.platform === 'win32' ? 'go.exe' : 'go');
  const value = runBoundedCommand(command, ['env', 'GOVERSION'], {
    env: environment,
  });
  if (value === null) {
    throw new Error('go env GOVERSION must succeed to fingerprint the benchmark toolchain');
  }
  return value;
}

export function captureEnvironmentFingerprint(environment = process.env) {
  const githubActions = environment.GITHUB_ACTIONS === 'true';
  const cpus = os.cpus();
  if (!cpus.length) {
    throw new Error('the runner CPU model and logical CPU count are unavailable');
  }
  if (!/^[1-9]\d*$/.test(environment.GOMAXPROCS ?? '')) {
    throw new Error('GOMAXPROCS must be a positive integer for the benchmark report');
  }

  const runner = githubActions
    ? {
      provider: 'github-actions',
      os: requiredEnvironmentValue(environment, 'RUNNER_OS'),
      arch: requiredEnvironmentValue(environment, 'RUNNER_ARCH'),
      imageOS: requiredEnvironmentValue(environment, 'ImageOS'),
      imageVersion: requiredEnvironmentValue(environment, 'ImageVersion'),
    }
    : {
      provider: 'local',
      os: process.platform,
      arch: process.arch,
      imageOS: `${process.platform}-${os.release()}`,
      imageVersion: os.version(),
    };
  const payload = {
    schemaVersion: 1,
    runner: Object.fromEntries(
      Object.entries(runner).map(([key, value]) => [key, normalizedString(value, `runner.${key}`)]),
    ),
    cpu: {
      model: normalizedString(cpus[0].model, 'cpu.model', 512),
      logicalCpus: cpus.length,
    },
    toolchain: { goVersion: normalizedString(goVersion(environment), 'toolchain.goVersion') },
    execution: { gomaxprocs: Number(environment.GOMAXPROCS) },
  };
  const fingerprint = { ...payload, sha256: fingerprintSha256(payload) };
  return validateEnvironmentFingerprint(fingerprint);
}

export function compareEnvironmentFingerprints(current, baseline) {
  return fingerprintFields.flatMap(([field, read]) => {
    const currentValue = read(current);
    const baselineValue = read(baseline);
    return currentValue === baselineValue ? [] : [{ field, baseline: baselineValue, current: currentValue }];
  });
}
