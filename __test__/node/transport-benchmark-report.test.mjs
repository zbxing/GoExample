import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const benchmarkEnvironment = {
  ...process.env,
  GITHUB_ACTIONS: 'true',
  GOMAXPROCS: '2',
  RUNNER_OS: 'Linux',
  RUNNER_ARCH: 'X64',
  ImageOS: 'ubuntu24',
  ImageVersion: '20260817.1',
  TRANSPORT_BENCHMARK_GO_VERSION: 'go1.25.0',
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
const capacityTransports = ['fiber', 'net-http', 'framework-net-http'];
const scenarioTransports = ['fiber', 'framework-net-http'];
const scenarios = [
  {
    name: 'response-32k-c16',
    requests: 800,
    concurrency: 16,
    expectedStatus: 200,
    dependencyDelayNanos: 0,
    payloadBytes: 32 * 1024 + 32,
    fiberThroughput: 780,
    frameworkNetHTTPThroughput: 700,
  },
  {
    name: 'auth-reject-c16',
    requests: 1200,
    concurrency: 16,
    expectedStatus: 401,
    dependencyDelayNanos: 0,
    payloadBytes: 67,
    fiberThroughput: 1400,
    frameworkNetHTTPThroughput: 1200,
  },
  {
    name: 'dependency-delay-5ms-c32',
    requests: 800,
    concurrency: 32,
    expectedStatus: 200,
    dependencyDelayNanos: 5_000_000,
    payloadBytes: 52,
    fiberThroughput: 5100,
    frameworkNetHTTPThroughput: 4800,
  },
];
const steadyThroughput = new Map([
  [1, 100],
  [2, 190],
  [4, 350],
  [8, 600],
  [16, 850],
  [32, 980],
  [64, 1000],
  [128, 960],
]);

function run(input, output) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--input', path.relative(repositoryRoot, input),
    '--output', path.relative(repositoryRoot, output),
  ], { cwd: repositoryRoot, encoding: 'utf8', env: benchmarkEnvironment });
}

function runWithBaseline(input, output, baseline) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--input', path.relative(repositoryRoot, input),
    '--output', path.relative(repositoryRoot, output),
    '--baseline', path.relative(repositoryRoot, baseline),
  ], { cwd: repositoryRoot, encoding: 'utf8', env: benchmarkEnvironment });
}

function resealEnvironmentFingerprint(fingerprint) {
  const payload = {
    schemaVersion: fingerprint.schemaVersion,
    runner: {
      provider: fingerprint.runner.provider,
      os: fingerprint.runner.os,
      arch: fingerprint.runner.arch,
      imageOS: fingerprint.runner.imageOS,
      imageVersion: fingerprint.runner.imageVersion,
    },
    cpu: {
      model: fingerprint.cpu.model,
      logicalCpus: fingerprint.cpu.logicalCpus,
    },
    toolchain: { goVersion: fingerprint.toolchain.goVersion },
    execution: { gomaxprocs: fingerprint.execution.gomaxprocs },
  };
  fingerprint.sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function fixture({
  rounds = 5,
  errorCount = 0,
  driftPayload = false,
  omitScenario = '',
  driftScenarioContract = false,
  scenarioErrorCount = 0,
  driftScenarioPayload = false,
  omitCapacityTransport = '',
  omitScenarioTransport = '',
  tamperFrameworkTransport = false,
} = {}) {
  const lines = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const transport of capacityTransports) {
      const fiber = transport === 'fiber';
      const framework = transport === 'framework-net-http';
      const measurementTransport = tamperFrameworkTransport && framework && round === rounds
        ? 'framework-net-http-tampered'
        : transport;
      lines.push(`TRANSPORT_LATENCY ${JSON.stringify({
        schemaVersion: 1,
        transport: measurementTransport,
        requests: 2000,
        concurrency: 16,
        payloadBytes: 88,
        throughputRps: (fiber ? 1200 : framework ? 800 : 1000) + round,
        p50Nanos: (fiber ? 1000 : framework ? 1400 : 1200) + round,
        p95Nanos: (fiber ? 1500 : framework ? 2100 : 1800) + round,
        p99Nanos: (fiber ? 1900 : framework ? 2800 : 2400) + round,
        errorRate: 0,
      })}`);
      if (transport === omitCapacityTransport) {
        continue;
      }
      for (const workload of workloads) {
        const currentErrorCount = errorCount && round === 1 && fiber && workload.name === 'steady-c1'
          ? errorCount
          : 0;
        const throughputBase = workload.keepAlive
          ? steadyThroughput.get(workload.concurrency)
          : 700;
        const throughputFactor = fiber ? 1.2 : framework ? 0.8 : 1;
        lines.push(`transport_benchmark_test.go:391: TRANSPORT_CAPACITY ${JSON.stringify({
          schemaVersion: 1,
          transport,
          workload: workload.name,
          requests: workload.requests,
          concurrency: workload.concurrency,
          keepAlive: workload.keepAlive,
          payloadBytes: driftPayload && round === 5 && fiber && workload.name === 'steady-c64' ? 89 : 88,
          throughputRps: throughputBase * throughputFactor + round,
          p50Nanos: (fiber ? 900 : framework ? 1350 : 1100) + round,
          p95Nanos: (fiber ? 1400 : framework ? 2200 : 1750) + round,
          p99Nanos: (fiber ? 1800 : framework ? 2900 : 2300) + round,
          connectionWaitP95Nanos: (fiber ? 300 : framework ? 500 : 400) + round,
          errorCount: currentErrorCount,
          errorRate: currentErrorCount / workload.requests,
          connectionDials: workload.keepAlive ? workload.concurrency : workload.requests,
          maxInFlight: workload.concurrency,
          totalAllocBytes: (fiber ? 100000 : framework ? 175000 : 125000) + round,
          mallocs: (fiber ? 1000 : framework ? 1800 : 1300) + round,
          gcCycles: 1,
          gcPauseNanos: (fiber ? 10000 : framework ? 15000 : 12000) + round,
          goroutinesBefore: 8,
          goroutinesAfter: 8,
          openFileDescriptorsBefore: 10,
          openFileDescriptorsAfter: 10,
        })}`);
      }
    }
    for (const transport of scenarioTransports) {
      if (transport === omitScenarioTransport) {
        continue;
      }
      const fiber = transport === 'fiber';
      for (const scenario of scenarios) {
        if (scenario.name === omitScenario) {
          continue;
        }
        const currentErrorCount = scenarioErrorCount
          && round === 1
          && fiber
          && scenario.name === 'auth-reject-c16'
          ? scenarioErrorCount
          : 0;
        lines.push(`transport_benchmark_test.go:620: TRANSPORT_SCENARIO ${JSON.stringify({
          schemaVersion: 1,
          transport,
          scenario: scenario.name,
          requests: scenario.requests,
          concurrency: driftScenarioContract && scenario.name === 'dependency-delay-5ms-c32'
            ? scenario.concurrency - 1
            : scenario.concurrency,
          expectedStatus: scenario.expectedStatus,
          dependencyDelayNanos: scenario.dependencyDelayNanos,
          payloadBytes: driftScenarioPayload
            && round === 5
            && fiber
            && scenario.name === 'response-32k-c16'
            ? scenario.payloadBytes + 1
            : scenario.payloadBytes,
          throughputRps: (
            fiber ? scenario.fiberThroughput : scenario.frameworkNetHTTPThroughput
          ) + round,
          p50Nanos: (fiber ? 1000 : 1100) + round,
          p95Nanos: (fiber ? 1500 : 1700) + round,
          p99Nanos: (fiber ? 1900 : 2200) + round,
          errorCount: currentErrorCount,
          errorRate: currentErrorCount / scenario.requests,
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
  assert.equal(report.schemaVersion, 5);
  assert.equal(report.scope, 'linux_loopback_combined_client_server_harness');
  assert.equal(report.environmentFingerprint.runner.provider, 'github-actions');
  assert.equal(report.environmentFingerprint.runner.os, 'Linux');
  assert.equal(report.environmentFingerprint.runner.arch, 'X64');
  assert.equal(report.environmentFingerprint.toolchain.goVersion, 'go1.25.0');
  assert.equal(report.environmentFingerprint.execution.gomaxprocs, 2);
  assert.match(report.environmentFingerprint.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.latency.results.fiber.rounds, 5);
  assert.equal(report.latency.results.fiber.median.throughputRps, 1203);
  assert.equal(report.capacity.workloads.length, 9);
  assert.equal(report.capacity.workloads[0].results['net-http'].median.totalAllocBytes, 125003);
  assert.equal(
    report.capacity.workloads[0].results['framework-net-http'].median.totalAllocBytes,
    175003,
  );
  assert.equal(report.capacity.workloads[0].directionalRatios.throughputFiberToNetHTTP, 1.194175);
  assert.equal(
    report.capacity.workloads[0].frameworkAdapterRatios.frameworkNetHTTPToFiber.throughputRatio,
    0.674797,
  );
  assert.equal(
    report.capacity.workloads[0].frameworkAdapterRatios.frameworkNetHTTPToNetHTTP.throughputRatio,
    0.805825,
  );
  assert.deepEqual(report.capacity.capacityKnee.steps, [1, 2, 4, 8, 16, 32, 64, 128]);
  assert.equal(report.capacity.capacityKnee.results.fiber.concurrency, 32);
  assert.equal(report.capacity.capacityKnee.results.fiber.observedPeakConcurrency, 64);
  assert.equal(report.capacity.capacityKnee.results['net-http'].concurrency, 32);
  assert.equal(report.capacity.capacityKnee.results['net-http'].observedPeakConcurrency, 64);
  assert.equal(report.capacity.capacityKnee.results['framework-net-http'].concurrency, 32);
  assert.equal(report.capacity.capacityKnee.results['framework-net-http'].observedPeakConcurrency, 64);
  assert.match(report.capacity.capacityKnee.definition, /90% of observed peak/);
  assert.equal(report.scenarios.workloads.length, 3);
  assert.deepEqual(report.scenarios.workloads.map((scenario) => scenario.name), scenarios.map((scenario) => scenario.name));
  assert.ok(report.scenarios.workloads.every((scenario) => (
    scenario.results.fiber.rounds === 5 && scenario.results['framework-net-http'].rounds === 5
  )));
  assert.equal(report.scenarios.workloads[0].payloadBytes, 32 * 1024 + 32);
  assert.equal(report.scenarios.workloads[2].dependencyDelayNanos, 5_000_000);
  assert.equal(
    report.scenarios.workloads[0].directionalRatios
      .fiberToFrameworkNetHTTP.throughputRatio,
    1.113798,
  );
  assert.match(report.limitations[0], /combined client\/server harness-process deltas/);
  assert.match(report.limitations[2], /not a production capacity limit/);
  assert.match(report.limitations[3], /fixed loopback synthetic contracts/);
  assert.equal(report.regression.status, 'not_checked');
});

test('transport benchmark report applies fixed cross-run regression thresholds', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-baseline-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const input = path.join(testRoot, 'raw.txt');
  const baseline = path.join(testRoot, 'baseline.json');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, fixture(), 'utf8');
  const first = run(input, path.join(testRoot, 'baseline-report.json'));
  assert.equal(first.status, 0, first.stderr);
  await writeFile(baseline, await readFile(path.join(testRoot, 'baseline-report.json'), 'utf8'), 'utf8');

  const passing = runWithBaseline(input, output, baseline);
  assert.equal(passing.status, 0, passing.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.regression.status, 'passed');
  assert.equal(report.regression.comparisons.length, 27);
  assert.equal(report.regression.scenarioComparisons.length, 6);
  assert.equal(report.regression.thresholds.maxThroughputRegressionFraction, 0.1);
  assert.equal(report.regression.environmentComparison.status, 'comparable');

  const baselineReport = JSON.parse(await readFile(baseline, 'utf8'));
  const payloadDrifted = structuredClone(baselineReport);
  payloadDrifted.capacity.payloadBytes += 1;
  payloadDrifted.latency.payloadBytes += 1;
  await writeFile(baseline, `${JSON.stringify(payloadDrifted)}\n`, 'utf8');
  const payloadFailure = runWithBaseline(input, output, baseline);
  assert.equal(payloadFailure.status, 1);
  assert.match(payloadFailure.stderr, /baseline payloadBytes must match current report/);

  const regressed = structuredClone(baselineReport);
  regressed.capacity.workloads[0].results.fiber.median.throughputRps *= 1.5;
  await writeFile(baseline, `${JSON.stringify(regressed)}\n`, 'utf8');
  const failing = runWithBaseline(input, output, baseline);
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /throughput regressed beyond baseline threshold/);

  const scenarioRegressed = structuredClone(baselineReport);
  scenarioRegressed.scenarios.workloads[0].results.fiber.median.throughputRps *= 1.5;
  await writeFile(baseline, `${JSON.stringify(scenarioRegressed)}\n`, 'utf8');
  const scenarioFailure = runWithBaseline(input, output, baseline);
  assert.equal(scenarioFailure.status, 1);
  assert.match(scenarioFailure.stderr, /response-32k-c16\/fiber scenario throughput regressed/);
});

test('transport benchmark report skips thresholds for a different environment fingerprint', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-environment-mismatch-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const input = path.join(testRoot, 'raw.txt');
  const baseline = path.join(testRoot, 'baseline.json');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, fixture(), 'utf8');
  const first = run(input, baseline);
  assert.equal(first.status, 0, first.stderr);
  const baselineReport = JSON.parse(await readFile(baseline, 'utf8'));
  baselineReport.environmentFingerprint.runner.imageVersion = '20260824.1';
  resealEnvironmentFingerprint(baselineReport.environmentFingerprint);
  baselineReport.scenarios.workloads[0].payloadBytes += 1;
  await writeFile(baseline, `${JSON.stringify(baselineReport)}\n`, 'utf8');

  const result = runWithBaseline(input, output, baseline);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.regression.status, 'not_checked');
  assert.equal(report.regression.reason, 'environment_fingerprint_mismatch');
  assert.equal(report.regression.environmentComparison.status, 'not_comparable');
  assert.deepEqual(report.regression.environmentComparison.mismatches, [{
    field: 'runner.imageVersion',
    baseline: '20260824.1',
    current: '20260817.1',
  }]);
  assert.equal(report.regression.comparisons, undefined);
});

test('transport benchmark report rejects a tampered environment fingerprint', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-environment-tamper-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const input = path.join(testRoot, 'raw.txt');
  const baseline = path.join(testRoot, 'baseline.json');
  const output = path.join(testRoot, 'report.json');
  await writeFile(input, fixture(), 'utf8');
  const first = run(input, baseline);
  assert.equal(first.status, 0, first.stderr);
  const baselineReport = JSON.parse(await readFile(baseline, 'utf8'));
  baselineReport.environmentFingerprint.cpu.logicalCpus += 1;
  await writeFile(baseline, `${JSON.stringify(baselineReport)}\n`, 'utf8');

  const result = runWithBaseline(input, output, baseline);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /environmentFingerprint sha256 does not match/);
});

test('transport benchmark report rejects incomplete, failed, and payload-drifted evidence', async (t) => {
  await mkdir(testFixtureRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(testFixtureRoot, 'report-fail-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const cases = [
    { name: 'incomplete', raw: fixture({ rounds: 4 }), message: /has 4 rounds; expected 5/ },
    { name: 'errors', raw: fixture({ errorCount: 1 }), message: /error rates must be zero/ },
    { name: 'payload-drift', raw: fixture({ driftPayload: true }), message: /payloadBytes must remain stable/ },
    {
      name: 'framework-capacity-missing',
      raw: fixture({ omitCapacityTransport: 'framework-net-http' }),
      message: /capacity steady-c1\/framework-net-http has 0 rounds; expected 5/,
    },
    {
      name: 'framework-transport-tamper',
      raw: fixture({ tamperFrameworkTransport: true }),
      message: /unexpected transport: framework-net-http-tampered/,
    },
    {
      name: 'framework-scenario-missing',
      raw: fixture({ omitScenarioTransport: 'framework-net-http' }),
      message: /scenario response-32k-c16\/framework-net-http has 0 rounds; expected 5/,
    },
    {
      name: 'scenario-missing',
      raw: fixture({ omitScenario: 'auth-reject-c16' }),
      message: /scenario auth-reject-c16\/fiber has 0 rounds; expected 5/,
    },
    {
      name: 'scenario-contract-drift',
      raw: fixture({ driftScenarioContract: true }),
      message: /transport scenario contract mismatch for dependency-delay-5ms-c32/,
    },
    {
      name: 'scenario-errors',
      raw: fixture({ scenarioErrorCount: 1 }),
      message: /error rates must be zero/,
    },
    {
      name: 'scenario-payload-drift',
      raw: fixture({ driftScenarioPayload: true }),
      message: /scenario response-32k-c16 payloadBytes must remain stable/,
    },
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
