import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'transport-benchmark');
const expectedRounds = 5;
const transports = ['fiber', 'net-http'];
const workloads = [
  { name: 'steady-c1', requests: 600, concurrency: 1, keepAlive: true },
  { name: 'steady-c16', requests: 2000, concurrency: 16, keepAlive: true },
  { name: 'steady-c64', requests: 4000, concurrency: 64, keepAlive: true },
  { name: 'connection-churn-c16', requests: 800, concurrency: 16, keepAlive: false },
];

function fail(message) {
  console.error(`Transport benchmark report: ${message}`);
  process.exit(1);
}

function parseArguments() {
  const options = {
    input: path.join(evidenceRoot, 'transport-benchmark.txt'),
    output: path.join(evidenceRoot, 'transport-capacity-report.json'),
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
  if (!transports.includes(measurement.transport)) {
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
  const groups = groupExactRounds(measurements, (measurement) => measurement.transport, transports, 'latency');
  const results = Object.fromEntries(
    transports.map((transport) => {
      const group = groups.get(transport);
      return [transport, {
        rounds: group.length,
        median: {
          throughputRps: median(group, 'throughputRps'),
          p50Nanos: median(group, 'p50Nanos'),
          p95Nanos: median(group, 'p95Nanos'),
          p99Nanos: median(group, 'p99Nanos'),
        },
      }];
    }),
  );
  return {
    payloadBytes: assertStablePayload(measurements, 'latency'),
    results,
    directionalRatios: compare(results.fiber.median, results['net-http'].median),
  };
}

function summarizeCapacityMeasurement(group) {
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
  return { rounds: group.length, median: summary };
}

function compare(fiber, netHTTP) {
  return {
    throughputFiberToNetHTTP: ratio(fiber.throughputRps, netHTTP.throughputRps),
    p50FiberToNetHTTP: ratio(fiber.p50Nanos, netHTTP.p50Nanos),
    p95FiberToNetHTTP: ratio(fiber.p95Nanos, netHTTP.p95Nanos),
    p99FiberToNetHTTP: ratio(fiber.p99Nanos, netHTTP.p99Nanos),
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
    transports.map((transport) => `${workload.name}/${transport}`),
  );
  const groups = groupExactRounds(
    measurements,
    (measurement) => `${measurement.workload}/${measurement.transport}`,
    expectedKeys,
    'capacity',
  );
  return {
    payloadBytes: assertStablePayload(measurements, 'capacity'),
    workloads: workloads.map((workload) => {
      const results = Object.fromEntries(
        transports.map((transport) => [
          transport,
          summarizeCapacityMeasurement(groups.get(`${workload.name}/${transport}`)),
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
      };
    }),
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
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'linux_loopback_combined_client_server_harness',
  source: { input: relativePath(options.input), expectedRounds },
  latency: summarizeLatency(latencyMeasurements),
  capacity: summarizeCapacity(capacityMeasurements),
  limitations: [
    'allocation, malloc, GC, goroutine, and file-descriptor values are combined client/server harness-process deltas',
    'loopback measurements do not establish target-edge, database, broker, production-capacity, or long-running behavior',
    'directional ratios are descriptive medians and require a successful remote artifact before a transport decision',
  ],
};

mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Transport benchmark report written to ${relativePath(options.output)}`);
