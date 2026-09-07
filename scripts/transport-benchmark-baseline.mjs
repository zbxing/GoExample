import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeFileAtomicallySync,
  writeFilesWithRollbackSync,
} from './lib/atomic-output.mjs';
import { validateEnvironmentFingerprint } from './lib/transport-benchmark-environment.mjs';
import {
  transportBenchmarkExpectedRounds,
  verifyTransportBenchmarkRoundStabilityMetadata,
  verifyTransportBenchmarkRoundStabilityResult,
} from './lib/transport-benchmark-stability.mjs';

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
  'report_schema_migration',
]);
const recordedUnavailableReasons = new Set([
  ...unavailableReasons,
  'compatible_candidate_missing',
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
const capacityTransports = ['fiber', 'net-http', 'framework-net-http'];
const scenarioTransports = ['fiber', 'framework-net-http'];

function fail(message) {
  console.error(`Transport benchmark baseline: ${message}`);
  process.exit(1);
}

function validateRoundStabilityMetadata(value, label) {
  try {
    verifyTransportBenchmarkRoundStabilityMetadata(value, label);
  } catch (error) {
    fail(error.message);
  }
}

function validateRoundStabilityResult(result, label) {
  try {
    verifyTransportBenchmarkRoundStabilityResult(result, label);
  } catch (error) {
    fail(error.message);
  }
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
      : command === 'verify'
        ? new Set(['--output', '--provenance'])
        : null;
  if (!allowed) {
    fail('command must be prepare, unavailable, or verify');
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
  writeFileAtomicallySync(filePath, encodeJSON(value));
}

function encodeJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function removeBaseline(filePath) {
  requireRegularOutput(filePath, 'baseline output');
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function validateCandidate(candidate) {
  if (candidate.schemaVersion !== 6 || candidate.scope !== reportScope) {
    fail('candidate must be a schemaVersion 6 transport capacity and scenario report');
  }
  validateRoundStabilityMetadata(candidate.roundStability, 'candidate roundStability');
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
  if (!candidate.latency || candidate.latency.payloadBytes !== candidate.capacity.payloadBytes) {
    fail('candidate latency and capacity payloadBytes must match');
  }
  for (const transport of capacityTransports) {
    const result = candidate.latency.results?.[transport];
    const median = result?.median;
    validateRoundStabilityResult(result, `candidate latency ${transport}`);
    if (
      !median
      || !(median.throughputRps > 0)
      || !Number.isInteger(median.p50Nanos)
      || median.p50Nanos < 1
      || !Number.isInteger(median.p95Nanos)
      || median.p95Nanos < 1
      || !Number.isInteger(median.p99Nanos)
      || median.p99Nanos < 1
    ) {
      fail(`candidate is missing a valid latency ${transport} median`);
    }
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
    for (const transport of capacityTransports) {
      const result = workload.results?.[transport];
      const median = result?.median;
      validateRoundStabilityResult(result, `candidate capacity ${workload.name}/${transport}`);
      if (
        !median
        || !(median.throughputRps > 0)
        || !Number.isInteger(median.p50Nanos)
        || median.p50Nanos < 1
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
    for (const transport of scenarioTransports) {
      const result = candidateScenario.results?.[transport];
      const median = result?.median;
      validateRoundStabilityResult(
        result,
        `candidate scenario ${candidateScenario.name}/${transport}`,
      );
      if (
        result?.rounds !== transportBenchmarkExpectedRounds
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

function validateRecordedSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('provenance source must be an object');
  }
  if (
    typeof source.repository !== 'string'
    || !Number.isSafeInteger(source.runId)
    || source.runId < 1
    || typeof source.headSha !== 'string'
    || typeof source.headBranch !== 'string'
    || typeof source.event !== 'string'
    || typeof source.artifactName !== 'string'
  ) {
    fail('provenance source fields are invalid');
  }
  validateSource({
    '--repository': source.repository,
    '--run-id': String(source.runId),
    '--head-sha': source.headSha,
    '--head-branch': source.headBranch,
    '--event': source.event,
    '--artifact-name': source.artifactName,
  });
  if (source.workflow !== workflow) {
    fail('provenance source workflow is invalid');
  }
  const expectedURL = `https://github.com/${source.repository}/actions/runs/${source.runId}`;
  if (source.url !== expectedURL) {
    fail('provenance source URL is invalid');
  }
}

function readJSON(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} does not exist`);
  }
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumCandidateBytes) {
    fail(`${label} must be a non-empty regular file no larger than ${maximumCandidateBytes} bytes`);
  }
  const raw = readFileSync(filePath, 'utf8');
  try {
    return { raw, stat, value: JSON.parse(raw) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function verifySelection(outputPath, provenancePath) {
  requireRegularOutput(outputPath, 'baseline output');
  requireRegularOutput(provenancePath, 'provenance output');
  const provenance = readJSON(provenancePath, 'provenance').value;
  if (provenance.schemaVersion !== 1) {
    fail('provenance schemaVersion must be 1');
  }
  if (provenance.status === 'not_available') {
    if (!recordedUnavailableReasons.has(provenance.reason)) {
      fail('provenance not_available reason is invalid');
    }
    if (existsSync(outputPath)) {
      fail('not_available provenance must not have a baseline output');
    }
    if (provenance.source !== undefined) {
      validateRecordedSource(provenance.source);
    }
    console.log(`Transport benchmark baseline verified as not available: ${provenance.reason}`);
    return;
  }
  if (provenance.status !== 'selected') {
    fail('provenance status must be selected or not_available');
  }
  validateRecordedSource(provenance.source);
  const baseline = readJSON(outputPath, 'baseline');
  validateCandidate(baseline.value);
  const candidate = provenance.candidate;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('selected provenance candidate must be an object');
  }
  if (typeof candidate.input !== 'string' || candidate.input.length === 0) {
    fail('selected provenance candidate input is invalid');
  }
  requirePath(candidateRoot, candidate.input, 'provenance candidate input');
  const expectedSha256 = createHash('sha256').update(baseline.raw).digest('hex');
  if (candidate.output !== relativePath(outputPath)) {
    fail('selected provenance candidate output does not match the baseline path');
  }
  if (candidate.bytes !== baseline.stat.size) {
    fail('selected provenance candidate byte count does not match the baseline');
  }
  if (candidate.sha256 !== expectedSha256) {
    fail('selected provenance candidate sha256 does not match the baseline');
  }
  if (
    candidate.reportSchemaVersion !== baseline.value.schemaVersion
    || candidate.reportScope !== baseline.value.scope
    || candidate.generatedAt !== baseline.value.generatedAt
    || candidate.environmentFingerprintSha256 !== baseline.value.environmentFingerprint.sha256
  ) {
    fail('selected provenance candidate metadata does not match the baseline');
  }
  console.log(`Transport benchmark baseline selection verified for workflow run ${provenance.source.runId}`);
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
  requireRegularOutput(outputPath, 'baseline output');
  requireRegularOutput(provenancePath, 'provenance output');
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
  if (candidate.schemaVersion === 5 && candidate.scope === reportScope) {
    unavailable(outputPath, provenancePath, 'report_schema_migration', source);
    return;
  }
  validateCandidate(candidate);
  const provenance = {
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
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  mkdirSync(path.dirname(provenancePath), { recursive: true });
  writeFilesWithRollbackSync([
    { outputPath, data: raw },
    { outputPath: provenancePath, data: encodeJSON(provenance) },
  ]);
  console.log(`Transport benchmark baseline prepared from workflow run ${source.runId}`);
}

const command = process.argv[2];
const options = parseArguments(command);
if (command === 'prepare') {
  prepare(options);
} else if (command === 'unavailable') {
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
} else {
  const outputPath = requirePath(benchmarkRoot, options['--output'], 'baseline output');
  const provenancePath = requirePath(
    benchmarkRoot,
    options['--provenance'],
    'provenance output',
  );
  verifySelection(outputPath, provenancePath);
}
