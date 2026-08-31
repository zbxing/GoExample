import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'transport-benchmark');
const transports = ['fiber', 'net-http', 'framework-net-http'];
const concurrency = 32;
const windowDurationNanos = 5_000_000_000;
const minimumDurationNanos = 30_000_000_000;
const maximumDurationNanos = 600_000_000_000;
const thresholds = {
  minimumWindowToMedianThroughputRatio: 0.5,
  maximumSettledGoroutineDelta: 8,
  maximumSettledHeapInUseBytesDelta: 32 * 1024 * 1024,
  maximumSettledOpenFileDescriptorDelta: 4,
};

function fail(message) {
  console.error(`Transport soak report: ${message}`);
  process.exit(1);
}

function parseArguments() {
  const options = {
    input: path.join(evidenceRoot, 'transport-soak.txt'),
    output: path.join(evidenceRoot, 'transport-soak-report.json'),
  };
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!['--input', '--output'].includes(option)) {
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

function requireNumber(object, field, { integer = false, minimum = 0 } = {}) {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(`${field} must be a finite number >= ${minimum}`);
  }
  if (integer && !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  return value;
}

function parseMeasurements(raw) {
  const measurements = [];
  for (const line of raw.split(/\r?\n/)) {
    const markerIndex = line.indexOf('TRANSPORT_SOAK');
    if (markerIndex < 0) {
      continue;
    }
    try {
      measurements.push(JSON.parse(line.slice(markerIndex + 'TRANSPORT_SOAK'.length).trim()));
    } catch (error) {
      fail(`TRANSPORT_SOAK contains invalid JSON: ${error.message}`);
    }
  }
  return measurements;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function ratio(numerator, denominator) {
  if (!(denominator > 0)) {
    fail('directional ratio denominator must be positive');
  }
  return Number((numerator / denominator).toFixed(6));
}

function comparePair(numerator, denominator) {
  return {
    throughputRatio: ratio(numerator.throughputRps, denominator.throughputRps),
    p95Ratio: ratio(numerator.p95Nanos, denominator.p95Nanos),
    p99Ratio: ratio(numerator.p99Nanos, denominator.p99Nanos),
  };
}

function validateMeasurement(measurement) {
  if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement)) {
    fail('each soak measurement must be a JSON object');
  }
  if (measurement.schemaVersion !== 1) {
    fail('each soak measurement must use schemaVersion 1');
  }
  if (!transports.includes(measurement.transport)) {
    fail(`unexpected soak transport: ${measurement.transport}`);
  }
  const targetDuration = requireNumber(measurement, 'targetDurationNanos', {
    integer: true,
    minimum: minimumDurationNanos,
  });
  if (targetDuration > maximumDurationNanos) {
    fail('targetDurationNanos exceeds the bounded 10 minute contract');
  }
  const elapsed = requireNumber(measurement, 'elapsedNanos', { integer: true, minimum: targetDuration });
  if (elapsed > targetDuration + 10_000_000_000) {
    fail('elapsedNanos exceeds the target duration by more than 10 seconds');
  }
  if (measurement.concurrency !== concurrency) {
    fail(`soak concurrency must equal ${concurrency}`);
  }
  requireNumber(measurement, 'requests', { integer: true, minimum: 1000 });
  requireNumber(measurement, 'payloadBytes', { integer: true, minimum: 1 });
  requireNumber(measurement, 'throughputRps', { minimum: Number.MIN_VALUE });
  const p95 = requireNumber(measurement, 'p95Nanos', { integer: true, minimum: 1 });
  const p99 = requireNumber(measurement, 'p99Nanos', { integer: true, minimum: 1 });
  if (p99 < p95) {
    fail('p99Nanos must be greater than or equal to p95Nanos');
  }
  requireNumber(measurement, 'errorCount', { integer: true });
  requireNumber(measurement, 'errorRate');
  if (measurement.errorCount !== 0 || measurement.errorRate !== 0) {
    fail('all soak requests must complete without errors');
  }
  for (const field of [
    'connectionDials',
    'gcCycles',
    'gcPauseNanos',
    'goroutinesBefore',
    'goroutinesAfter',
    'goroutinesSettled',
    'heapInUseBytesBefore',
    'heapInUseBytesAfter',
    'heapInUseBytesSettled',
    'openFileDescriptorsBefore',
    'openFileDescriptorsAfter',
    'openFileDescriptorsSettled',
  ]) {
    requireNumber(measurement, field, { integer: true });
  }

  const expectedWindows = Math.ceil(targetDuration / windowDurationNanos);
  if (!Array.isArray(measurement.windows) || measurement.windows.length !== expectedWindows) {
    fail(`soak windows must contain exactly ${expectedWindows} entries`);
  }
  let windowRequests = 0;
  let windowDuration = 0;
  const windowThroughputs = [];
  for (let index = 0; index < measurement.windows.length; index += 1) {
    const window = measurement.windows[index];
    if (window.index !== index) {
      fail('soak window indexes must be contiguous and zero-based');
    }
    const expectedDuration = Math.min(windowDurationNanos, targetDuration - index * windowDurationNanos);
    if (window.durationNanos !== expectedDuration) {
      fail(`soak window ${index} duration does not match the fixed 5 second contract`);
    }
    const requests = requireNumber(window, 'requests', { integer: true, minimum: 1 });
    requireNumber(window, 'errorCount', { integer: true });
    if (window.errorCount !== 0) {
      fail('all soak windows must complete without errors');
    }
    const throughput = requireNumber(window, 'throughputRps', { minimum: Number.MIN_VALUE });
    const expectedThroughput = requests / (window.durationNanos / 1_000_000_000);
    if (Math.abs(throughput - expectedThroughput) / expectedThroughput > 0.001) {
      fail(`soak window ${index} throughput does not match its request and duration totals`);
    }
    windowThroughputs.push(throughput);
    windowRequests += requests;
    windowDuration += window.durationNanos;
  }
  if (windowRequests !== measurement.requests || windowDuration !== targetDuration) {
    fail('soak window totals must match the top-level request and duration totals');
  }
  const medianWindowThroughput = median(windowThroughputs);
  const minimumWindowThroughput = Math.min(...windowThroughputs);
  const minimumWindowToMedianThroughputRatio = minimumWindowThroughput / medianWindowThroughput;
  if (minimumWindowToMedianThroughputRatio < thresholds.minimumWindowToMedianThroughputRatio) {
    fail('soak window throughput collapsed below the stability threshold');
  }

  const resourceDeltas = {
    goroutinesSettled: measurement.goroutinesSettled - measurement.goroutinesBefore,
    heapInUseBytesSettled: measurement.heapInUseBytesSettled - measurement.heapInUseBytesBefore,
    openFileDescriptorsSettled:
      measurement.openFileDescriptorsSettled - measurement.openFileDescriptorsBefore,
  };
  if (resourceDeltas.goroutinesSettled > thresholds.maximumSettledGoroutineDelta) {
    fail('settled goroutine growth exceeds the soak threshold');
  }
  if (resourceDeltas.heapInUseBytesSettled > thresholds.maximumSettledHeapInUseBytesDelta) {
    fail('settled heap growth exceeds the soak threshold');
  }
  if (resourceDeltas.openFileDescriptorsSettled > thresholds.maximumSettledOpenFileDescriptorDelta) {
    fail('settled file-descriptor growth exceeds the soak threshold');
  }
  return {
    measurement,
    resourceDeltas,
    windowStability: {
      medianThroughputRps: medianWindowThroughput,
      minimumThroughputRps: minimumWindowThroughput,
      minimumToMedianRatio: Number(minimumWindowToMedianThroughputRatio.toFixed(6)),
    },
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

const measurements = parseMeasurements(readFileSync(options.input, 'utf8'));
if (measurements.length !== transports.length) {
  fail(`soak evidence must contain exactly ${transports.length} transport measurements`);
}
const validated = new Map();
for (const measurement of measurements) {
  if (validated.has(measurement.transport)) {
    fail(`duplicate soak transport: ${measurement.transport}`);
  }
  validated.set(measurement.transport, validateMeasurement(measurement));
}
for (const transport of transports) {
  if (!validated.has(transport)) {
    fail(`missing soak transport: ${transport}`);
  }
}
const payloads = new Set(measurements.map((measurement) => measurement.payloadBytes));
const durations = new Set(measurements.map((measurement) => measurement.targetDurationNanos));
if (payloads.size !== 1 || durations.size !== 1) {
  fail('soak payload and target duration must remain stable across transports');
}

const results = Object.fromEntries(
  transports.map((transport) => {
    const { measurement, resourceDeltas, windowStability } = validated.get(transport);
    return [transport, {
      targetDurationNanos: measurement.targetDurationNanos,
      elapsedNanos: measurement.elapsedNanos,
      requests: measurement.requests,
      throughputRps: measurement.throughputRps,
      p95Nanos: measurement.p95Nanos,
      p99Nanos: measurement.p99Nanos,
      connectionDials: measurement.connectionDials,
      gcCycles: measurement.gcCycles,
      gcPauseNanos: measurement.gcPauseNanos,
      resourceDeltas,
      windowStability,
    }];
  }),
);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  scope: 'linux_loopback_combined_client_server_soak',
  source: { input: relativePath(options.input) },
  concurrency,
  payloadBytes: measurements[0].payloadBytes,
  thresholds,
  results,
  directionalRatios: {
    throughputFiberToNetHTTP: ratio(results.fiber.throughputRps, results['net-http'].throughputRps),
    p95FiberToNetHTTP: ratio(results.fiber.p95Nanos, results['net-http'].p95Nanos),
    p99FiberToNetHTTP: ratio(results.fiber.p99Nanos, results['net-http'].p99Nanos),
  },
  frameworkAdapterRatios: {
    frameworkNetHTTPToFiber: comparePair(results['framework-net-http'], results.fiber),
    frameworkNetHTTPToNetHTTP: comparePair(results['framework-net-http'], results['net-http']),
  },
  limitations: [
    'the soak uses loopback TCP and a combined client/server harness process, not isolated production services',
    'settled heap, goroutine, and file-descriptor thresholds detect coarse regressions but do not prove absence of leaks',
    'the run does not establish target dependency recovery, alert delivery, operator response, RPO, or RTO',
    'the fixed project payload does not represent a target payload, identity provider, dependency, TLS edge, or production capacity',
  ],
};

mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Transport soak report written to ${relativePath(options.output)}`);
