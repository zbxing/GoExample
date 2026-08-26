import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironmentFingerprint } from './lib/transport-benchmark-environment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const candidateRoot = path.join(repositoryRoot, '.temp', 'transport-baseline-artifact');
const benchmarkRoot = path.join(repositoryRoot, '.temp', 'transport-benchmark');
const workflow = '.github/workflows/go-transport-benchmark.yml';
const reportScope = 'linux_loopback_combined_client_server_harness';
const maximumCandidateBytes = 2 * 1024 * 1024;
const trustedEvents = new Set(['push', 'workflow_dispatch']);
const unavailableReasons = new Set([
  'no_trusted_successful_run',
  'artifact_download_failed',
  'pull_request_not_eligible',
]);
const workloadNames = [
  'steady-c1',
  'steady-c2',
  'steady-c4',
  'steady-c8',
  'steady-c16',
  'steady-c32',
  'steady-c64',
  'steady-c128',
  'connection-churn-c16',
];
const scenarioWorkloads = [
  {
    name: 'response-32k-c16',
    requests: 800,
    concurrency: 16,
    expectedStatus: 200,
    dependencyDelayNanos: 0,
    minimumPayloadBytes: 32 * 1024,
  },
  {
    name: 'auth-reject-c16',
    requests: 1200,
    concurrency: 16,
    expectedStatus: 401,
    dependencyDelayNanos: 0,
    minimumPayloadBytes: 1,
  },
  {
    name: 'dependency-delay-5ms-c32',
    requests: 800,
    concurrency: 32,
    expectedStatus: 200,
    dependencyDelayNanos: 5_000_000,
    minimumPayloadBytes: 1,
  },
];
const transports = ['fiber', 'net-http'];

function fail(message) {
  console.error(`Transport benchmark baseline: ${message}`);
  process.exit(1);
}

function parseArguments(command) {
  const allowed = command === 'prepare'
    ? new Set([
      '--candidate',
      '--output',
      '--provenance',
      '--repository',
      '--run-id',
      '--head-sha',
      '--head-branch',
      '--event',
      '--artifact-name',
    ])
    : command === 'unavailable'
      ? new Set(['--output', '--provenance', '--reason'])
      : null;
  if (!allowed) {
    fail('command must be prepare or unavailable');
  }
  const options = {};
  const args = process.argv.slice(3);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!allowed.has(option)) {
      fail(`unknown argument: ${option}`);
    }
    if (options[option] !== undefined) {
      fail(`${option} may only be specified once`);
    }
    if (!value || value.startsWith('--')) {
      fail(`${option} requires a value`);
    }
    options[option] = value;
  }
  for (const option of allowed) {
    if (options[option] === undefined) {
      fail(`${option} is required`);
    }
  }
  return options;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function requirePath(root, value, label) {
  const resolved = path.resolve(repositoryRoot, value);
  if (!isWithin(root, resolved)) {
    fail(`${label} must stay inside ${path.relative(repositoryRoot, root).replaceAll('\\', '/')}`);
  }
  return resolved;
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function requireRegularOutput(filePath, label) {
  if (existsSync(filePath) && !lstatSync(filePath).isFile()) {
    fail(`${label} must be a regular file`);
  }
}

function writeJSON(filePath, value) {
  requireRegularOutput(filePath, 'provenance output');
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function removeBaseline(filePath) {
  requireRegularOutput(filePath, 'baseline output');
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function validateCandidate(candidate) {
  if (candidate.schemaVersion !== 4 || candidate.scope !== reportScope) {
    fail('candidate must be a schemaVersion 4 transport capacity and scenario report');
  }
  try {
    validateEnvironmentFingerprint(candidate.environmentFingerprint, { requireGitHubActions: true });
  } catch (error) {
    fail(`candidate ${error.message}`);
  }
  if (!Number.isInteger(Date.parse(candidate.generatedAt))) {
    fail('candidate generatedAt must be an ISO timestamp');
  }
  if (!candidate.capacity || !Array.isArray(candidate.capacity.workloads)) {
    fail('candidate capacity workloads are missing');
  }
  const names = candidate.capacity.workloads.map((workload) => workload?.name);
  if (
    names.length !== workloadNames.length
    || new Set(names).size !== workloadNames.length
    || workloadNames.some((name) => !names.includes(name))
  ) {
    fail('candidate workload matrix is incompatible');
  }
  for (const workload of candidate.capacity.workloads) {
    for (const transport of transports) {
      const median = workload.results?.[transport]?.median;
      if (
        !median
        || !(median.throughputRps > 0)
        || !Number.isInteger(median.p95Nanos)
        || median.p95Nanos < 1
        || !Number.isInteger(median.p99Nanos)
        || median.p99Nanos < 1
      ) {
        fail(`candidate is missing a valid ${workload.name}/${transport} median`);
      }
    }
  }
  if (!candidate.scenarios || !Array.isArray(candidate.scenarios.workloads)) {
    fail('candidate scenario workloads are missing');
  }
  const scenarioNames = candidate.scenarios.workloads.map((scenario) => scenario?.name);
  if (
    scenarioNames.length !== scenarioWorkloads.length
    || new Set(scenarioNames).size !== scenarioWorkloads.length
    || scenarioWorkloads.some((scenario) => !scenarioNames.includes(scenario.name))
  ) {
    fail('candidate scenario matrix is incompatible');
  }
  for (const candidateScenario of candidate.scenarios.workloads) {
    const scenario = scenarioWorkloads.find((entry) => entry.name === candidateScenario.name);
    if (
      candidateScenario.requests !== scenario.requests
      || candidateScenario.concurrency !== scenario.concurrency
      || candidateScenario.expectedStatus !== scenario.expectedStatus
      || candidateScenario.dependencyDelayNanos !== scenario.dependencyDelayNanos
      || !Number.isInteger(candidateScenario.payloadBytes)
      || candidateScenario.payloadBytes < scenario.minimumPayloadBytes
    ) {
      fail(`candidate scenario contract is incompatible for ${candidateScenario.name}`);
    }
    for (const transport of transports) {
      const result = candidateScenario.results?.[transport];
      const median = result?.median;
      if (
        result?.rounds !== 5
        || !median
        || !(median.throughputRps > 0)
        || !Number.isInteger(median.p50Nanos)
        || median.p50Nanos < 1
        || !Number.isInteger(median.p95Nanos)
        || median.p95Nanos < 1
        || !Number.isInteger(median.p99Nanos)
        || median.p99Nanos < 1
      ) {
        fail(`candidate is missing a valid ${candidateScenario.name}/${transport} scenario median`);
      }
    }
  }
}

function validateSource(options) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options['--repository'])) {
    fail('repository must be an owner/name pair');
  }
  if (!/^[1-9]\d*$/.test(options['--run-id'])) {
    fail('run-id must be a positive integer');
  }
  if (!/^[a-fA-F0-9]{40}$/.test(options['--head-sha'])) {
    fail('head-sha must contain 40 hexadecimal characters');
  }
  if (
    options['--head-branch'].length > 255
    || /[\u0000-\u001f\u007f]/.test(options['--head-branch'])
    || options['--head-branch'].trim() !== options['--head-branch']
  ) {
    fail('head-branch is invalid');
  }
  if (!trustedEvents.has(options['--event'])) {
    fail('event must be push or workflow_dispatch');
  }
  const expectedPrefix = `go-transport-benchmark-${options['--run-id']}-`;
  if (
    !options['--artifact-name'].startsWith(expectedPrefix)
    || !/^[A-Za-z0-9_.-]+$/.test(options['--artifact-name'])
  ) {
    fail('artifact-name does not match the selected workflow run');
  }
}

function unavailable(outputPath, provenancePath, reason, source = undefined) {
  removeBaseline(outputPath);
  writeJSON(provenancePath, {
    schemaVersion: 1,
    status: 'not_available',
    reason,
    ...(source ? { source } : {}),
  });
  console.log(`Transport benchmark baseline not available: ${reason}`);
}

function prepare(options) {
  validateSource(options);
  const candidatePath = requirePath(candidateRoot, options['--candidate'], 'candidate');
  const outputPath = requirePath(benchmarkRoot, options['--output'], 'baseline output');
  const provenancePath = requirePath(benchmarkRoot, options['--provenance'], 'provenance output');
  removeBaseline(outputPath);
  const source = {
    repository: options['--repository'],
    workflow,
    runId: Number(options['--run-id']),
    url: `https://github.com/${options['--repository']}/actions/runs/${options['--run-id']}`,
    event: options['--event'],
    headBranch: options['--head-branch'],
    headSha: options['--head-sha'].toLowerCase(),
    artifactName: options['--artifact-name'],
  };
  if (!existsSync(candidatePath)) {
    unavailable(outputPath, provenancePath, 'compatible_candidate_missing', source);
    return;
  }
  const stat = lstatSync(candidatePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumCandidateBytes) {
    fail(`candidate must be a non-empty regular file no larger than ${maximumCandidateBytes} bytes`);
  }
  const raw = readFileSync(candidatePath, 'utf8');
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    fail(`candidate is not valid JSON: ${error.message}`);
  }
  validateCandidate(candidate);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, raw, 'utf8');
  writeJSON(provenancePath, {
    schemaVersion: 1,
    status: 'selected',
    source,
    candidate: {
      input: relativePath(candidatePath),
      output: relativePath(outputPath),
      bytes: stat.size,
      sha256: createHash('sha256').update(raw).digest('hex'),
      reportSchemaVersion: candidate.schemaVersion,
      reportScope: candidate.scope,
      generatedAt: candidate.generatedAt,
      environmentFingerprintSha256: candidate.environmentFingerprint.sha256,
    },
  });
  console.log(`Transport benchmark baseline prepared from workflow run ${source.runId}`);
}

const command = process.argv[2];
const options = parseArguments(command);
if (command === 'prepare') {
  prepare(options);
} else {
  const provenancePath = requirePath(
    benchmarkRoot,
    options['--provenance'],
    'provenance output',
  );
  if (!unavailableReasons.has(options['--reason'])) {
    fail('reason is not an allowed unavailable reason');
  }
  const outputPath = requirePath(benchmarkRoot, options['--output'], 'baseline output');
  unavailable(outputPath, provenancePath, options['--reason']);
}
