import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureEnvironmentFingerprint,
  compareEnvironmentFingerprints,
  validateEnvironmentFingerprint,
} from './lib/transport-benchmark-environment.mjs';
import {
  createTransportBenchmarkRoundStabilityMetadata,
  summarizeTransportBenchmarkRoundStability,
  transportBenchmarkExpectedRounds,
  verifyTransportBenchmarkRoundStabilityMetadata,
  verifyTransportBenchmarkRoundStabilityResult,
} from './lib/transport-benchmark-stability.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'transport-benchmark');
const expectedRounds = transportBenchmarkExpectedRounds;
const capacityTransports = ['fiber', 'net-http', 'framework-net-http'];
const scenarioTransports = ['fiber', 'framework-net-http'];
const supportedTransports = new Set([...capacityTransports, ...scenarioTransports]);
const capacityKneePeakFraction = 0.9;
const regressionThresholds = {
  maxThroughputRegressionFraction: 0.1,
  maxP95IncreaseFraction: 0.2,
  maxP99IncreaseFraction: 0.25,
};
const steadyWorkloads = [
  { name: 'steady-c1', requests: 600, concurrency: 1, keepAlive: true },
  { name: 'steady-c2', requests: 600, concurrency: 2, keepAlive: true },
  { name: 'steady-c4', requests: 800, concurrency: 4, keepAlive: true },
  { name: 'steady-c8', requests: 1200, concurrency: 8, keepAlive: true },
  { name: 'steady-c16', requests: 2000, concurrency: 16, keepAlive: true },
  { name: 'steady-c32', requests: 3000, concurrency: 32, keepAlive: true },
  { name: 'steady-c64', requests: 4000, concurrency: 64, keepAlive: true },
  { name: 'steady-c128', requests: 6000, concurrency: 128, keepAlive: true },
];
const workloads = [
  ...steadyWorkloads,
  { name: 'connection-churn-c16', requests: 800, concurrency: 16, keepAlive: false },
];
const expectedWorkloadNames = workloads.map((workload) => workload.name);
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
const expectedScenarioNames = scenarioWorkloads.map((scenario) => scenario.name);

function fail(message) {
  console.error(`Transport benchmark report: ${message}`);
  process.exit(1);
}

function summarizeRoundStability(measurements, label) {
  try {
    return summarizeTransportBenchmarkRoundStability(measurements, label);
  } catch (error) {
    fail(error.message);
  }
}

function verifyRoundStabilityMetadata(value, label) {
  try {
    verifyTransportBenchmarkRoundStabilityMetadata(value, label);
  } catch (error) {
    fail(error.message);
  }
}

function verifyRoundStabilityResult(result, label) {
  try {
    verifyTransportBenchmarkRoundStabilityResult(result, label);
  } catch (error) {
    fail(error.message);
  }
}

function parseArguments() {
  const options = {
    input: path.join(evidenceRoot, 'transport-benchmark.txt'),
    output: path.join(evidenceRoot, 'transport-capacity-report.json'),
    baseline: null,
  };
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!['--input', '--output', '--baseline'].includes(option)) {
      fail(`unknown argument: ${option}`);
    }
    if (seen.has(option)) {
      fail(`${option} may only be specified once`);
    }
    if (!value || value.startsWith('--')) {
      fail(`${option} requires a path`);
    }
    seen.add(option);
    options[option.slice(2)] = path.resolve(repositoryRoot, value);
  }
  return options;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function requireFiniteNumber(measurement, field, { integer = false, minimum = 0 } = {}) {
  const value = measurement[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(`${field} must be a finite number >= ${minimum}`);
  }
  if (integer && !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  return value;
}

function parseMeasurements(raw, marker) {
  const measurements = [];
  for (const line of raw.split(/\r?\n/)) {
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }
    const encoded = line.slice(markerIndex + marker.length).trim();
    try {
      measurements.push(JSON.parse(encoded));
    } catch (error) {
      fail(`${marker} contains invalid JSON: ${error.message}`);
    }
  }
  return measurements;
}

function validateCommon(measurement) {
  if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement)) {
    fail('each measurement must be a JSON object');
  }
  if (measurement.schemaVersion !== 1) {
    fail('each measurement must use schemaVersion 1');
  }
  if (!supportedTransports.has(measurement.transport)) {
    fail(`unexpected transport: ${measurement.transport}`);
  }
  requireFiniteNumber(measurement, 'payloadBytes', { integer: true, minimum: 1 });
  requireFiniteNumber(measurement, 'throughputRps', { minimum: Number.MIN_VALUE });
  for (const field of ['p50Nanos', 'p95Nanos', 'p99Nanos']) {
    requireFiniteNumber(measurement, field, { integer: true, minimum: 1 });
  }
  requireFiniteNumber(measurement, 'errorRate');
  if (measurement.errorRate !== 0) {
    fail('all measurement error rates must be zero');
  }
}

function groupExactRounds(measurements, keyFor, expectedKeys, label) {
  const groups = new Map();
  for (const measurement of measurements) {
    const key = keyFor(measurement);
    if (!expectedKeys.includes(key)) {
      fail(`unexpected ${label} matrix entry: ${key}`);
    }
    const group = groups.get(key) ?? [];
    group.push(measurement);
    groups.set(key, group);
  }
  for (const key of expectedKeys) {
    const count = groups.get(key)?.length ?? 0;
    if (count !== expectedRounds) {
      fail(`${label} ${key} has ${count} rounds; expected ${expectedRounds}`);
    }
  }
  return groups;
}

function assertStablePayload(measurements, label) {
  const payloads = new Set(measurements.map((measurement) => measurement.payloadBytes));
  if (payloads.size !== 1) {
    fail(`${label} payloadBytes must remain stable across rounds and transports`);
  }
  return measurements[0].payloadBytes;
}

function median(measurements, field) {
  const values = measurements.map((measurement) => measurement[field]).sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function ratio(numerator, denominator) {
  if (!(denominator > 0)) {
    fail('directional ratio denominator must be positive');
  }
  return Number((numerator / denominator).toFixed(6));
}

function summarizeLatency(measurements) {
  for (const measurement of measurements) {
    validateCommon(measurement);
    if (measurement.requests !== 2000 || measurement.concurrency !== 16) {
      fail('latency measurements must use 2000 requests at concurrency 16');
    }
  }
  const groups = groupExactRounds(
    measurements,
    (measurement) => measurement.transport,
    capacityTransports,
    'latency',
  );
  const results = Object.fromEntries(
    capacityTransports.map((transport) => {
      const group = groups.get(transport);
      return [transport, {
        rounds: group.length,
        median: {
          throughputRps: median(group, 'throughputRps'),
          p50Nanos: median(group, 'p50Nanos'),
          p95Nanos: median(group, 'p95Nanos'),
          p99Nanos: median(group, 'p99Nanos'),
        },
        stability: summarizeRoundStability(group, `latency ${transport}`),
      }];
    }),
  );
  return {
    payloadBytes: assertStablePayload(measurements, 'latency'),
    results,
    directionalRatios: compare(results.fiber.median, results['net-http'].median),
    frameworkAdapterRatios: compareFrameworkAdapter(results),
  };
}

function summarizeCapacityMeasurement(group, label) {
  const medianFields = [
    'throughputRps',
    'p50Nanos',
    'p95Nanos',
    'p99Nanos',
    'connectionWaitP95Nanos',
    'connectionDials',
    'maxInFlight',
    'totalAllocBytes',
    'mallocs',
    'gcCycles',
    'gcPauseNanos',
  ];
  const summary = Object.fromEntries(medianFields.map((field) => [field, median(group, field)]));
  summary.goroutineDelta = median(
    group.map((measurement) => ({ value: measurement.goroutinesAfter - measurement.goroutinesBefore })),
    'value',
  );
  summary.openFileDescriptorDelta = median(
    group.map((measurement) => ({
      value: measurement.openFileDescriptorsAfter - measurement.openFileDescriptorsBefore,
    })),
    'value',
  );
  return {
    rounds: group.length,
    median: summary,
    stability: summarizeRoundStability(group, label),
  };
}

function compare(fiber, netHTTP) {
  return {
    throughputFiberToNetHTTP: ratio(fiber.throughputRps, netHTTP.throughputRps),
    p50FiberToNetHTTP: ratio(fiber.p50Nanos, netHTTP.p50Nanos),
    p95FiberToNetHTTP: ratio(fiber.p95Nanos, netHTTP.p95Nanos),
    p99FiberToNetHTTP: ratio(fiber.p99Nanos, netHTTP.p99Nanos),
  };
}

function comparePair(numerator, denominator) {
  return {
    throughputRatio: ratio(numerator.throughputRps, denominator.throughputRps),
    p50Ratio: ratio(numerator.p50Nanos, denominator.p50Nanos),
    p95Ratio: ratio(numerator.p95Nanos, denominator.p95Nanos),
    p99Ratio: ratio(numerator.p99Nanos, denominator.p99Nanos),
  };
}

function compareFrameworkAdapter(results) {
  return {
    frameworkNetHTTPToFiber: comparePair(
      results['framework-net-http'].median,
      results.fiber.median,
    ),
    frameworkNetHTTPToNetHTTP: comparePair(
      results['framework-net-http'].median,
      results['net-http'].median,
    ),
  };
}

function summarizeCapacityKnee(workloadSummaries) {
  const byName = new Map(workloadSummaries.map((workload) => [workload.name, workload]));
  const steps = steadyWorkloads.map((workload) => workload.concurrency);
  const results = Object.fromEntries(capacityTransports.map((transport) => {
    const points = steadyWorkloads.map((workload) => {
      const summary = byName.get(workload.name)?.results?.[transport]?.median;
      if (!summary) {
        fail(`capacity knee is missing ${workload.name}/${transport}`);
      }
      return {
        concurrency: workload.concurrency,
        throughputRps: summary.throughputRps,
        p95Nanos: summary.p95Nanos,
      };
    });
    const baseline = points[0];
    const peak = points.reduce((best, point) => (
      point.throughputRps > best.throughputRps ? point : best
    ));
    const threshold = peak.throughputRps * capacityKneePeakFraction;
    const knee = points.find((point) => point.throughputRps >= threshold);
    if (!knee) {
      fail(`capacity knee could not be derived for ${transport}`);
    }
    const terminal = points.at(-1);
    return [transport, {
      concurrency: knee.concurrency,
      throughputRps: knee.throughputRps,
      p95Nanos: knee.p95Nanos,
      observedPeakConcurrency: peak.concurrency,
      observedPeakThroughputRps: peak.throughputRps,
      throughputGainFromC1: ratio(knee.throughputRps, baseline.throughputRps),
      p95AmplificationFromC1: ratio(knee.p95Nanos, baseline.p95Nanos),
      terminalThroughputToPeak: ratio(terminal.throughputRps, peak.throughputRps),
    }];
  }));
  return {
    definition: 'first measured steady concurrency reaching at least 90% of observed peak median throughput',
    peakThroughputFraction: capacityKneePeakFraction,
    steps,
    results,
  };
}

function summarizeCapacity(measurements) {
  for (const measurement of measurements) {
    validateCommon(measurement);
    const workload = workloads.find((candidate) => candidate.name === measurement.workload);
    if (!workload) {
      fail(`unexpected workload: ${measurement.workload}`);
    }
    if (
      measurement.requests !== workload.requests ||
      measurement.concurrency !== workload.concurrency ||
      measurement.keepAlive !== workload.keepAlive
    ) {
      fail(`workload contract mismatch for ${measurement.workload}`);
    }
    for (const field of [
      'connectionWaitP95Nanos',
      'errorCount',
      'connectionDials',
      'maxInFlight',
      'totalAllocBytes',
      'mallocs',
      'gcCycles',
      'gcPauseNanos',
      'goroutinesBefore',
      'goroutinesAfter',
      'openFileDescriptorsBefore',
      'openFileDescriptorsAfter',
    ]) {
      requireFiniteNumber(measurement, field, { integer: true });
    }
    if (measurement.errorCount !== 0) {
      fail('all capacity error counts must be zero');
    }
    if (measurement.maxInFlight < 1) {
      fail('capacity measurements must observe an in-flight request');
    }
    if (measurement.maxInFlight > measurement.concurrency) {
      fail('maxInFlight cannot exceed workload concurrency');
    }
  }
  const expectedKeys = workloads.flatMap((workload) =>
    capacityTransports.map((transport) => `${workload.name}/${transport}`),
  );
  const groups = groupExactRounds(
    measurements,
    (measurement) => `${measurement.workload}/${measurement.transport}`,
    expectedKeys,
    'capacity',
  );
  const workloadSummaries = workloads.map((workload) => {
    const results = Object.fromEntries(
      capacityTransports.map((transport) => [
        transport,
        summarizeCapacityMeasurement(
          groups.get(`${workload.name}/${transport}`),
          `capacity ${workload.name}/${transport}`,
        ),
      ]),
    );
    return {
      ...workload,
      results,
      directionalRatios: {
        ...compare(results.fiber.median, results['net-http'].median),
        connectionWaitP95FiberToNetHTTP: ratio(
          results.fiber.median.connectionWaitP95Nanos,
          results['net-http'].median.connectionWaitP95Nanos,
        ),
        totalAllocBytesFiberToNetHTTP: ratio(
          results.fiber.median.totalAllocBytes,
          results['net-http'].median.totalAllocBytes,
        ),
        mallocsFiberToNetHTTP: ratio(
          results.fiber.median.mallocs,
          results['net-http'].median.mallocs,
        ),
      },
      frameworkAdapterRatios: compareFrameworkAdapter(results),
    };
  });
  return {
    payloadBytes: assertStablePayload(measurements, 'capacity'),
    workloads: workloadSummaries,
    capacityKnee: summarizeCapacityKnee(workloadSummaries),
  };
}

function summarizeScenarios(measurements) {
  for (const measurement of measurements) {
    validateCommon(measurement);
    const scenario = scenarioWorkloads.find((candidate) => candidate.name === measurement.scenario);
    if (!scenario) {
      fail(`unexpected transport scenario: ${measurement.scenario}`);
    }
    if (
      measurement.requests !== scenario.requests
      || measurement.concurrency !== scenario.concurrency
      || measurement.expectedStatus !== scenario.expectedStatus
      || measurement.dependencyDelayNanos !== scenario.dependencyDelayNanos
    ) {
      fail(`transport scenario contract mismatch for ${measurement.scenario}`);
    }
    requireFiniteNumber(measurement, 'errorCount', { integer: true });
    requireFiniteNumber(measurement, 'expectedStatus', { integer: true, minimum: 100 });
    requireFiniteNumber(measurement, 'dependencyDelayNanos', { integer: true });
    if (measurement.errorCount !== 0) {
      fail('all transport scenario error counts must be zero');
    }
    if (measurement.payloadBytes < scenario.minimumPayloadBytes) {
      fail(`${measurement.scenario} payloadBytes must be >= ${scenario.minimumPayloadBytes}`);
    }
  }

  const expectedKeys = scenarioWorkloads.flatMap((scenario) =>
    scenarioTransports.map((transport) => `${scenario.name}/${transport}`),
  );
  const groups = groupExactRounds(
    measurements,
    (measurement) => `${measurement.scenario}/${measurement.transport}`,
    expectedKeys,
    'scenario',
  );
  return {
    workloads: scenarioWorkloads.map((scenario) => {
      const scenarioMeasurements = scenarioTransports.flatMap(
        (transport) => groups.get(`${scenario.name}/${transport}`),
      );
      const results = Object.fromEntries(scenarioTransports.map((transport) => {
        const group = groups.get(`${scenario.name}/${transport}`);
        return [transport, {
          rounds: group.length,
          median: {
            throughputRps: median(group, 'throughputRps'),
            p50Nanos: median(group, 'p50Nanos'),
            p95Nanos: median(group, 'p95Nanos'),
            p99Nanos: median(group, 'p99Nanos'),
          },
          stability: summarizeRoundStability(
            group,
            `scenario ${scenario.name}/${transport}`,
          ),
        }];
      }));
      return {
        name: scenario.name,
        requests: scenario.requests,
        concurrency: scenario.concurrency,
        expectedStatus: scenario.expectedStatus,
        dependencyDelayNanos: scenario.dependencyDelayNanos,
        payloadBytes: assertStablePayload(scenarioMeasurements, `scenario ${scenario.name}`),
        results,
        directionalRatios: {
          fiberToFrameworkNetHTTP: comparePair(
            results.fiber.median,
            results['framework-net-http'].median,
          ),
        },
      };
    }),
  };
}

function requireBaselineReport(baselinePath) {
  if (!isWithin(evidenceRoot, baselinePath)) {
    fail('baseline must stay inside .temp/transport-benchmark');
  }
  if (!existsSync(baselinePath) || !lstatSync(baselinePath).isFile()) {
    fail(`baseline file was not found: ${relativePath(baselinePath)}`);
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    fail(`baseline is not valid JSON: ${error.message}`);
  }
  if (baseline.schemaVersion !== 6 || baseline.scope !== 'linux_loopback_combined_client_server_harness') {
    fail('baseline must be a schemaVersion 6 transport capacity and scenario report');
  }
  verifyRoundStabilityMetadata(baseline.roundStability, 'baseline roundStability');
  try {
    validateEnvironmentFingerprint(baseline.environmentFingerprint, { requireGitHubActions: true });
  } catch (error) {
    fail(`baseline ${error.message}`);
  }
  if (!baseline.capacity || !Array.isArray(baseline.capacity.workloads)) {
    fail('baseline capacity workloads are missing');
  }
  if (baseline.latency?.payloadBytes !== baseline.capacity.payloadBytes) {
    fail('baseline latency and capacity payloadBytes must match');
  }
  for (const transport of capacityTransports) {
    const result = baseline.latency.results?.[transport];
    verifyRoundStabilityResult(result, `baseline latency ${transport}`);
    const latencyMedian = result?.median;
    if (!latencyMedian || typeof latencyMedian !== 'object') {
      fail(`baseline is missing latency ${transport} median`);
    }
    requireFiniteNumber(latencyMedian, 'throughputRps', { minimum: Number.MIN_VALUE });
    for (const field of ['p50Nanos', 'p95Nanos', 'p99Nanos']) {
      requireFiniteNumber(latencyMedian, field, { integer: true, minimum: 1 });
    }
  }
  requireFiniteNumber(baseline.capacity, 'payloadBytes', { integer: true, minimum: 1 });
  const baselineWorkloadNames = baseline.capacity.workloads.map((workload) => workload?.name);
  if (
    baselineWorkloadNames.length !== expectedWorkloadNames.length
    || new Set(baselineWorkloadNames).size !== expectedWorkloadNames.length
    || expectedWorkloadNames.some((name) => !baselineWorkloadNames.includes(name))
  ) {
    fail('baseline capacity workloads must match the current workload matrix');
  }
  for (const workload of baseline.capacity.workloads) {
    for (const transport of capacityTransports) {
      const result = workload.results?.[transport];
      verifyRoundStabilityResult(result, `baseline capacity ${workload.name}/${transport}`);
      const median = result?.median;
      if (!median || typeof median !== 'object') {
        fail(`baseline is missing ${workload.name}/${transport} median`);
      }
      requireFiniteNumber(median, 'throughputRps', { minimum: Number.MIN_VALUE });
      for (const field of ['p95Nanos', 'p99Nanos']) {
        requireFiniteNumber(median, field, { integer: true, minimum: 1 });
      }
    }
  }
  if (!baseline.scenarios || !Array.isArray(baseline.scenarios.workloads)) {
    fail('baseline scenario workloads are missing');
  }
  const baselineScenarioNames = baseline.scenarios.workloads.map((scenario) => scenario?.name);
  if (
    baselineScenarioNames.length !== expectedScenarioNames.length
    || new Set(baselineScenarioNames).size !== expectedScenarioNames.length
    || expectedScenarioNames.some((name) => !baselineScenarioNames.includes(name))
  ) {
    fail('baseline scenario workloads must match the current scenario matrix');
  }
  for (const baselineScenario of baseline.scenarios.workloads) {
    const scenario = scenarioWorkloads.find((candidate) => candidate.name === baselineScenario.name);
    if (
      baselineScenario.requests !== scenario.requests
      || baselineScenario.concurrency !== scenario.concurrency
      || baselineScenario.expectedStatus !== scenario.expectedStatus
      || baselineScenario.dependencyDelayNanos !== scenario.dependencyDelayNanos
    ) {
      fail(`baseline scenario contract mismatch for ${baselineScenario.name}`);
    }
    requireFiniteNumber(baselineScenario, 'payloadBytes', {
      integer: true,
      minimum: scenario.minimumPayloadBytes,
    });
    for (const transport of scenarioTransports) {
      const result = baselineScenario.results?.[transport];
      verifyRoundStabilityResult(
        result,
        `baseline scenario ${baselineScenario.name}/${transport}`,
      );
      if (!result.median || typeof result.median !== 'object') {
        fail(`baseline is missing ${baselineScenario.name}/${transport} scenario median`);
      }
      requireFiniteNumber(result.median, 'throughputRps', { minimum: Number.MIN_VALUE });
      for (const field of ['p50Nanos', 'p95Nanos', 'p99Nanos']) {
        requireFiniteNumber(result.median, field, { integer: true, minimum: 1 });
      }
    }
  }
  return baseline;
}

function compareAgainstBaseline(report, baseline, baselinePath) {
  const environmentMismatches = compareEnvironmentFingerprints(
    report.environmentFingerprint,
    baseline.environmentFingerprint,
  );
  if (environmentMismatches.length > 0) {
    return {
      status: 'not_checked',
      reason: 'environment_fingerprint_mismatch',
      detail: 'fixed thresholds require identical runner, CPU, toolchain, and GOMAXPROCS fingerprints',
      baseline: relativePath(baselinePath),
      thresholds: regressionThresholds,
      environmentComparison: {
        status: 'not_comparable',
        baselineSha256: baseline.environmentFingerprint.sha256,
        currentSha256: report.environmentFingerprint.sha256,
        mismatches: environmentMismatches,
      },
    };
  }
  if (baseline.capacity.payloadBytes !== report.capacity.payloadBytes) {
    fail('baseline payloadBytes must match current report');
  }
  const baselineWorkloads = new Map(
    baseline.capacity.workloads.map((workload) => [workload.name, workload]),
  );
  const comparisons = [];
  for (const workload of report.capacity.workloads) {
    const baselineWorkload = baselineWorkloads.get(workload.name);
    if (!baselineWorkload) {
      fail(`baseline is missing workload ${workload.name}`);
    }
    for (const transport of capacityTransports) {
      const currentMedian = workload.results?.[transport]?.median;
      const baselineMedian = baselineWorkload.results?.[transport]?.median;
      if (!currentMedian || !baselineMedian) {
        fail(`baseline is missing ${workload.name}/${transport} median`);
      }
      const throughputFloor = baselineMedian.throughputRps
        * (1 - regressionThresholds.maxThroughputRegressionFraction);
      const p95Ceiling = baselineMedian.p95Nanos
        * (1 + regressionThresholds.maxP95IncreaseFraction);
      const p99Ceiling = baselineMedian.p99Nanos
        * (1 + regressionThresholds.maxP99IncreaseFraction);
      if (currentMedian.throughputRps < throughputFloor) {
        fail(`${workload.name}/${transport} throughput regressed beyond baseline threshold`);
      }
      if (currentMedian.p95Nanos > p95Ceiling) {
        fail(`${workload.name}/${transport} p95 regressed beyond baseline threshold`);
      }
      if (currentMedian.p99Nanos > p99Ceiling) {
        fail(`${workload.name}/${transport} p99 regressed beyond baseline threshold`);
      }
      comparisons.push({
        workload: workload.name,
        transport,
        throughputRatio: ratio(currentMedian.throughputRps, baselineMedian.throughputRps),
        p95Ratio: ratio(currentMedian.p95Nanos, baselineMedian.p95Nanos),
        p99Ratio: ratio(currentMedian.p99Nanos, baselineMedian.p99Nanos),
      });
    }
  }
  const baselineScenarios = new Map(
    baseline.scenarios.workloads.map((scenario) => [scenario.name, scenario]),
  );
  const scenarioComparisons = [];
  for (const scenario of report.scenarios.workloads) {
    const baselineScenario = baselineScenarios.get(scenario.name);
    if (!baselineScenario) {
      fail(`baseline is missing scenario ${scenario.name}`);
    }
    if (baselineScenario.payloadBytes !== scenario.payloadBytes) {
      fail(`baseline scenario payloadBytes must match current report for ${scenario.name}`);
    }
    for (const transport of scenarioTransports) {
      const currentMedian = scenario.results?.[transport]?.median;
      const baselineMedian = baselineScenario.results?.[transport]?.median;
      if (!currentMedian || !baselineMedian) {
        fail(`baseline is missing ${scenario.name}/${transport} scenario median`);
      }
      const throughputFloor = baselineMedian.throughputRps
        * (1 - regressionThresholds.maxThroughputRegressionFraction);
      const p95Ceiling = baselineMedian.p95Nanos
        * (1 + regressionThresholds.maxP95IncreaseFraction);
      const p99Ceiling = baselineMedian.p99Nanos
        * (1 + regressionThresholds.maxP99IncreaseFraction);
      if (currentMedian.throughputRps < throughputFloor) {
        fail(`${scenario.name}/${transport} scenario throughput regressed beyond baseline threshold`);
      }
      if (currentMedian.p95Nanos > p95Ceiling) {
        fail(`${scenario.name}/${transport} scenario p95 regressed beyond baseline threshold`);
      }
      if (currentMedian.p99Nanos > p99Ceiling) {
        fail(`${scenario.name}/${transport} scenario p99 regressed beyond baseline threshold`);
      }
      scenarioComparisons.push({
        scenario: scenario.name,
        transport,
        throughputRatio: ratio(currentMedian.throughputRps, baselineMedian.throughputRps),
        p95Ratio: ratio(currentMedian.p95Nanos, baselineMedian.p95Nanos),
        p99Ratio: ratio(currentMedian.p99Nanos, baselineMedian.p99Nanos),
      });
    }
  }
  return {
    status: 'passed',
    baseline: relativePath(baselinePath),
    thresholds: regressionThresholds,
    environmentComparison: {
      status: 'comparable',
      fingerprintSha256: report.environmentFingerprint.sha256,
    },
    comparisons,
    scenarioComparisons,
  };
}

const options = parseArguments();
if (!isWithin(evidenceRoot, options.input) || !isWithin(evidenceRoot, options.output)) {
  fail('input and output must stay inside .temp/transport-benchmark');
}
if (!options.output.toLowerCase().endsWith('.json')) {
  fail('output must be a JSON file');
}
if (!existsSync(options.input) || !lstatSync(options.input).isFile()) {
  fail(`input file was not found: ${relativePath(options.input)}`);
}

const raw = readFileSync(options.input, 'utf8');
const latencyMeasurements = parseMeasurements(raw, 'TRANSPORT_LATENCY');
const capacityMeasurements = parseMeasurements(raw, 'TRANSPORT_CAPACITY');
const scenarioMeasurements = parseMeasurements(raw, 'TRANSPORT_SCENARIO');
let environmentFingerprint;
try {
  environmentFingerprint = captureEnvironmentFingerprint();
} catch (error) {
  fail(`environment fingerprint could not be captured: ${error.message}`);
}
const report = {
  schemaVersion: 6,
  generatedAt: new Date().toISOString(),
  scope: 'linux_loopback_combined_client_server_harness',
  source: { input: relativePath(options.input), expectedRounds },
  environmentFingerprint,
  roundStability: createTransportBenchmarkRoundStabilityMetadata(),
  latency: summarizeLatency(latencyMeasurements),
  capacity: summarizeCapacity(capacityMeasurements),
  scenarios: summarizeScenarios(scenarioMeasurements),
  regression: options.baseline
    ? null
    : {
      status: 'not_checked',
      reason: 'no prior report was supplied; pass --baseline with a successful prior report to enable fixed thresholds',
      thresholds: regressionThresholds,
    },
  limitations: [
    'allocation, malloc, GC, goroutine, and file-descriptor values are combined client/server harness-process deltas',
    'loopback measurements do not establish target-edge, database, broker, production-capacity, or long-running behavior',
    'the capacity knee is an empirical saturation point within the fixed concurrency sweep, not a production capacity limit',
    'scenario workloads are fixed loopback synthetic contracts, not target payload, target identity provider, target dependency, or TLS edge evidence',
    'directional ratios are descriptive medians and require a successful remote artifact before a transport decision',
    'net-http is a minimal native migration baseline; framework-net-http measures the production Framework adapter and middleware path',
    'the fixed 2.0 per-group max/min gate rejects extreme five-round dispersion but is not a confidence interval or production SLO',
  ],
};

if (options.baseline) {
  report.regression = compareAgainstBaseline(
    report,
    requireBaselineReport(options.baseline),
    options.baseline,
  );
}

mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Transport benchmark report written to ${relativePath(options.output)}`);
