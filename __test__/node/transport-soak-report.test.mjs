import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const benchmarkRoot = path.join(repositoryRoot, '.temp', 'transport-benchmark');
const testFixtureRoot = path.join(benchmarkRoot, '.test-fixtures');
const scriptPath = path.join(repositoryRoot, 'scripts', 'transport-soak-report.mjs');

function run(input, output) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--input', path.relative(repositoryRoot, input),
    '--output', path.relative(repositoryRoot, output),
  ], { cwd: repositoryRoot, encoding: 'utf8' });
}

function measurement(transport, options = {}) {
  const transportValues = {
    fiber: { throughputRps: 2100, p95Nanos: 1500, p99Nanos: 2100 },
    'net-http': { throughputRps: 1900, p95Nanos: 1800, p99Nanos: 2500 },
    'framework-net-http': { throughputRps: 1700, p95Nanos: 2200, p99Nanos: 3000 },
  };
  const values = transportValues[transport];
  const windows = Array.from({ length: 6 }, (_, index) => ({
    index,
    durationNanos: 5_000_000_000,
    requests: index === 3 && options.throughputCollapse
      ? 2500
      : index === 4 && options.throughputCollapse
        ? 17500
        : index === 5 && options.windowRequestDrift
          ? 9999
          : 10000,
    errorCount: 0,
    throughputRps: index === 3 && options.throughputCollapse
      ? 500
      : index === 4 && options.throughputCollapse
        ? 3500
        : 2000,
  }));
  return {
    schemaVersion: 1,
    transport,
    targetDurationNanos: 30_000_000_000,
    elapsedNanos: 30_050_000_000,
    requests: 60000,
    concurrency: 32,
    payloadBytes: 84,
    throughputRps: values.throughputRps,
    p95Nanos: values.p95Nanos,
    p99Nanos: values.p99Nanos,
    errorCount: options.errorCount ?? 0,
    errorRate: (options.errorCount ?? 0) / 60000,
    connectionDials: 31,
    gcCycles: 4,
    gcPauseNanos: 100000,
    goroutinesBefore: 10,
    goroutinesAfter: 43,
    goroutinesSettled: 11,
    heapInUseBytesBefore: 2_000_000,
    heapInUseBytesAfter: 20_000_000,
    heapInUseBytesSettled: options.heapLeak ? 40_000_000 : 3_000_000,
    openFileDescriptorsBefore: 12,
    openFileDescriptorsAfter: 44,
    openFileDescriptorsSettled: 12,
    windows,
  };
}

function fixture(options = {}) {
  const transports = options.duplicateFramework
    ? ['fiber', 'framework-net-http', 'framework-net-http']
    : options.missingTransport
      ? ['fiber', 'net-http']
      : ['fiber', 'net-http', 'framework-net-http'];
  return `${transports.map((transport) =>
    `transport_benchmark_test.go:1: TRANSPORT_SOAK ${JSON.stringify(measurement(transport, options))}`
  ).join('\n')}\n`;
}

test('transport soak report validates stability and settled resources', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'soak-report-pass-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const input = path.join(testRoot, 'raw.txt');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, fixture(), 'utf8');

  const result = run(input, output);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.scope, 'linux_loopback_combined_client_server_soak');
  assert.equal(report.results.fiber.requests, 60000);
  assert.equal(report.results['framework-net-http'].requests, 60000);
  assert.equal(report.results.fiber.resourceDeltas.goroutinesSettled, 1);
  assert.equal(report.results.fiber.windowStability.minimumToMedianRatio, 1);
  assert.equal(report.directionalRatios.throughputFiberToNetHTTP, 1.105263);
  assert.deepEqual(report.frameworkAdapterRatios, {
    frameworkNetHTTPToFiber: {
      throughputRatio: 0.809524,
      p95Ratio: 1.466667,
      p99Ratio: 1.428571,
    },
    frameworkNetHTTPToNetHTTP: {
      throughputRatio: 0.894737,
      p95Ratio: 1.222222,
      p99Ratio: 1.2,
    },
  });
  assert.match(report.limitations[2], /RPO, or RTO/);
  assert.match(report.limitations[3], /target payload/);
});

test('transport soak report rejects incomplete, failed, unstable, and unbounded evidence', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'soak-report-fail-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const cases = [
    { name: 'missing', options: { missingTransport: true }, message: /exactly 3 transport measurements/ },
    { name: 'duplicate-framework', options: { duplicateFramework: true }, message: /duplicate soak transport/ },
    { name: 'errors', options: { errorCount: 1 }, message: /without errors/ },
    { name: 'window-total', options: { windowRequestDrift: true }, message: /window totals/ },
    { name: 'throughput-collapse', options: { throughputCollapse: true }, message: /collapsed/ },
    { name: 'heap-leak', options: { heapLeak: true }, message: /heap growth exceeds/ },
  ];
  for (const scenario of cases) {
    const input = path.join(testRoot, `${scenario.name}.txt`);
    const output = path.join(testRoot, `${scenario.name}.json`);
    await writeFile(input, fixture(scenario.options), 'utf8');
    const result = run(input, output);
    assert.equal(result.status, 1, scenario.name);
    assert.match(result.stderr, scenario.message);
  }
});
