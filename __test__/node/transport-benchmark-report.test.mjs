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
const scriptPath = path.join(repositoryRoot, 'scripts', 'transport-benchmark-report.mjs');
const workloads = [
  { name: 'steady-c1', requests: 600, concurrency: 1, keepAlive: true },
  { name: 'steady-c16', requests: 2000, concurrency: 16, keepAlive: true },
  { name: 'steady-c64', requests: 4000, concurrency: 64, keepAlive: true },
  { name: 'connection-churn-c16', requests: 800, concurrency: 16, keepAlive: false },
];

function run(input, output) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--input', path.relative(repositoryRoot, input),
    '--output', path.relative(repositoryRoot, output),
  ], { cwd: repositoryRoot, encoding: 'utf8' });
}

function fixture({ rounds = 5, errorCount = 0, driftPayload = false } = {}) {
  const lines = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const transport of ['fiber', 'net-http']) {
      const fiber = transport === 'fiber';
      lines.push(`TRANSPORT_LATENCY ${JSON.stringify({
        schemaVersion: 1,
        transport,
        requests: 2000,
        concurrency: 16,
        payloadBytes: 88,
        throughputRps: (fiber ? 1200 : 1000) + round,
        p50Nanos: (fiber ? 1000 : 1200) + round,
        p95Nanos: (fiber ? 1500 : 1800) + round,
        p99Nanos: (fiber ? 1900 : 2400) + round,
        errorRate: 0,
      })}`);
      for (const workload of workloads) {
        const currentErrorCount = errorCount && round === 1 && fiber && workload.name === 'steady-c1'
          ? errorCount
          : 0;
        lines.push(`transport_benchmark_test.go:391: TRANSPORT_CAPACITY ${JSON.stringify({
          schemaVersion: 1,
          transport,
          workload: workload.name,
          requests: workload.requests,
          concurrency: workload.concurrency,
          keepAlive: workload.keepAlive,
          payloadBytes: driftPayload && round === 5 && fiber && workload.name === 'steady-c64' ? 89 : 88,
          throughputRps: (fiber ? 2200 : 1800) + round,
          p50Nanos: (fiber ? 900 : 1100) + round,
          p95Nanos: (fiber ? 1400 : 1750) + round,
          p99Nanos: (fiber ? 1800 : 2300) + round,
          connectionWaitP95Nanos: (fiber ? 300 : 400) + round,
          errorCount: currentErrorCount,
          errorRate: currentErrorCount / workload.requests,
          connectionDials: workload.keepAlive ? workload.concurrency : workload.requests,
          maxInFlight: workload.concurrency,
          totalAllocBytes: (fiber ? 100000 : 125000) + round,
          mallocs: (fiber ? 1000 : 1300) + round,
          gcCycles: 1,
          gcPauseNanos: (fiber ? 10000 : 12000) + round,
          goroutinesBefore: 8,
          goroutinesAfter: 8,
          openFileDescriptorsBefore: 10,
          openFileDescriptorsAfter: 10,
        })}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

test('transport benchmark report validates the matrix and emits medians and ratios', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-pass-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const input = path.join(testRoot, 'raw.txt');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, fixture(), 'utf8');

  const result = run(input, output);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.scope, 'linux_loopback_combined_client_server_harness');
  assert.equal(report.latency.results.fiber.rounds, 5);
  assert.equal(report.latency.results.fiber.median.throughputRps, 1203);
  assert.equal(report.capacity.workloads.length, 4);
  assert.equal(report.capacity.workloads[0].results['net-http'].median.totalAllocBytes, 125003);
  assert.equal(report.capacity.workloads[0].directionalRatios.throughputFiberToNetHTTP, 1.221852);
  assert.match(report.limitations[0], /combined client\/server harness-process deltas/);
});

test('transport benchmark report rejects incomplete, failed, and payload-drifted evidence', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-fail-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const cases = [
    { name: 'incomplete', raw: fixture({ rounds: 4 }), message: /has 4 rounds; expected 5/ },
    { name: 'errors', raw: fixture({ errorCount: 1 }), message: /error rates must be zero/ },
    { name: 'payload-drift', raw: fixture({ driftPayload: true }), message: /payloadBytes must remain stable/ },
  ];
  for (const scenario of cases) {
    const input = path.join(testRoot, `${scenario.name}.txt`);
    const output = path.join(testRoot, `${scenario.name}.json`);
    await writeFile(input, scenario.raw, 'utf8');
    const result = run(input, output);
    assert.equal(result.status, 1, scenario.name);
    assert.match(result.stderr, scenario.message);
  }
});
