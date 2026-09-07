import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const candidateFixtureRoot = path.join(
  repositoryRoot,
  '.temp',
  'transport-baseline-artifact',
  '.test-fixtures',
);
const outputFixtureRoot = path.join(
  repositoryRoot,
  '.temp',
  'transport-benchmark',
  '.baseline-test-fixtures',
);
const scriptPath = path.join(repositoryRoot, 'scripts', 'transport-benchmark-baseline.mjs');
const workloads = [
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
const scenarios = [
  {
    name: 'response-32k-c16',
    requests: 800,
    concurrency: 16,
    expectedStatus: 200,
    dependencyDelayNanos: 0,
    payloadBytes: 32 * 1024 + 32,
  },
  {
    name: 'auth-reject-c16',
    requests: 1200,
    concurrency: 16,
    expectedStatus: 401,
    dependencyDelayNanos: 0,
    payloadBytes: 67,
  },
  {
    name: 'dependency-delay-5ms-c32',
    requests: 800,
    concurrency: 32,
    expectedStatus: 200,
    dependencyDelayNanos: 5_000_000,
    payloadBytes: 52,
  },
];

function environmentFingerprint() {
  const payload = {
    schemaVersion: 1,
    runner: {
      provider: 'github-actions',
      os: 'Linux',
      arch: 'X64',
      imageOS: 'ubuntu24',
      imageVersion: '20260817.1',
    },
    cpu: { model: 'AMD EPYC 7763 64-Core Processor', logicalCpus: 4 },
    toolchain: { goVersion: 'go1.25.0' },
    execution: { gomaxprocs: 2 },
  };
  return {
    ...payload,
    sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

const stabilityFields = ['throughputRps', 'p50Nanos', 'p95Nanos', 'p99Nanos'];

function stableResult(median) {
  return {
    rounds: 5,
    median,
    stability: {
      status: 'passed',
      metrics: Object.fromEntries(stabilityFields.map((field) => [field, {
        minimum: median[field],
        maximum: median[field],
        maxToMinRatio: 1,
      }])),
    },
  };
}

function candidate() {
  return {
    schemaVersion: 6,
    generatedAt: '2026-08-25T00:00:00.000Z',
    scope: 'linux_loopback_combined_client_server_harness',
    environmentFingerprint: environmentFingerprint(),
    roundStability: {
      status: 'passed',
      method: 'per_group_max_to_min_ratio',
      expectedRounds: 5,
      maxMetricSpreadRatio: 2,
      metricFields: stabilityFields,
    },
    latency: {
      payloadBytes: 88,
      results: {
        fiber: stableResult({
          throughputRps: 1200,
          p50Nanos: 1000,
          p95Nanos: 1400,
          p99Nanos: 1800,
        }),
        'net-http': stableResult({
          throughputRps: 1000,
          p50Nanos: 1200,
          p95Nanos: 1750,
          p99Nanos: 2300,
        }),
        'framework-net-http': stableResult({
          throughputRps: 800,
          p50Nanos: 1400,
          p95Nanos: 2200,
          p99Nanos: 2900,
        }),
      },
    },
    capacity: {
      payloadBytes: 88,
      workloads: workloads.map((name) => ({
        name,
        results: {
          fiber: stableResult({
            throughputRps: 1200,
            p50Nanos: 1000,
            p95Nanos: 1400,
            p99Nanos: 1800,
          }),
          'net-http': stableResult({
            throughputRps: 1000,
            p50Nanos: 1200,
            p95Nanos: 1750,
            p99Nanos: 2300,
          }),
          'framework-net-http': stableResult({
            throughputRps: 800,
            p50Nanos: 1400,
            p95Nanos: 2200,
            p99Nanos: 2900,
          }),
        },
      })),
    },
    scenarios: {
      workloads: scenarios.map((scenario) => ({
        ...scenario,
        results: {
          fiber: stableResult({
            throughputRps: 1200,
            p50Nanos: 1000,
            p95Nanos: 1400,
            p99Nanos: 1800,
          }),
          'framework-net-http': stableResult({
            throughputRps: 1000,
            p50Nanos: 1100,
            p95Nanos: 1750,
            p99Nanos: 2300,
          }),
        },
      })),
    },
    regression: { status: 'not_checked' },
  };
}

function runPrepare(candidatePath, outputPath, provenancePath, overrides = {}) {
  const values = {
    repository: 'example/goexample',
    runId: '12345',
    headSha: 'a'.repeat(40),
    headBranch: 'main',
    event: 'push',
    artifactName: 'go-transport-benchmark-12345-2',
    ...overrides,
  };
  return spawnSync(process.execPath, [
    scriptPath,
    'prepare',
    '--candidate', path.relative(repositoryRoot, candidatePath),
    '--output', path.relative(repositoryRoot, outputPath),
    '--provenance', path.relative(repositoryRoot, provenancePath),
    '--repository', values.repository,
    '--run-id', values.runId,
    '--head-sha', values.headSha,
    '--head-branch', values.headBranch,
    '--event', values.event,
    '--artifact-name', values.artifactName,
  ], { cwd: repositoryRoot, encoding: 'utf8' });
}

function runVerify(outputPath, provenancePath) {
  return spawnSync(process.execPath, [
    scriptPath,
    'verify',
    '--output', path.relative(repositoryRoot, outputPath),
    '--provenance', path.relative(repositoryRoot, provenancePath),
  ], { cwd: repositoryRoot, encoding: 'utf8' });
}

test('transport benchmark baseline prepares a compatible trusted-run candidate', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'prepare-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'prepare-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const candidatePath = path.join(candidateRoot, 'baseline-candidate.json');
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  const encoded = `${JSON.stringify(candidate(), null, 2)}\n`;
  await writeFile(candidatePath, encoded, 'utf8');

  const result = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(outputPath, 'utf8'), encoded);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'selected');
  assert.equal(provenance.source.runId, 12345);
  assert.equal(provenance.source.event, 'push');
  assert.equal(provenance.source.headBranch, 'main');
  assert.match(provenance.candidate.sha256, /^[a-f0-9]{64}$/);
  assert.equal(provenance.candidate.reportSchemaVersion, 6);
  assert.equal(
    provenance.candidate.environmentFingerprintSha256,
    candidate().environmentFingerprint.sha256,
  );
  const verified = runVerify(outputPath, provenancePath);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /selection verified for workflow run 12345/);
});

test('transport benchmark baseline preserves the prior selection when candidate validation fails', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'preserve-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'preserve-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const candidatePath = path.join(candidateRoot, 'baseline-candidate.json');
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  const previousBaseline = '{"schemaVersion":6,"scope":"trusted-prior"}\n';
  const previousProvenance = '{"schemaVersion":1,"status":"selected","source":{"runId":7}}\n';
  const incompatible = candidate();
  incompatible.capacity.workloads.pop();
  const tampered = candidate();
  tampered.environmentFingerprint.cpu.logicalCpus += 1;
  const missingStabilityMetadata = candidate();
  delete missingStabilityMetadata.roundStability;
  const missingStabilitySummary = candidate();
  delete missingStabilitySummary.latency.results.fiber.stability;
  const forgedStabilityRatio = candidate();
  forgedStabilityRatio.capacity.workloads[0]
    .results.fiber.stability.metrics.throughputRps.maxToMinRatio = 1.5;
  const outOfRangeMedian = candidate();
  outOfRangeMedian.scenarios.workloads[0].results.fiber.median.p99Nanos = 1801;
  const cases = [
    {
      name: 'invalid-json',
      source: '{invalid\n',
      message: /candidate is not valid JSON/,
    },
    {
      name: 'invalid-scope',
      source: '{"schemaVersion":6,"scope":"broken"}\n',
      message: /candidate must be a schemaVersion 6 transport capacity and scenario report/,
    },
    {
      name: 'incompatible-matrix',
      source: `${JSON.stringify(incompatible)}\n`,
      message: /candidate workload matrix is incompatible/,
    },
    {
      name: 'tampered-fingerprint',
      source: `${JSON.stringify(tampered)}\n`,
      message: /environmentFingerprint sha256 does not match/,
    },
    {
      name: 'missing-stability-metadata',
      source: `${JSON.stringify(missingStabilityMetadata)}\n`,
      message: /candidate roundStability must be an object/,
    },
    {
      name: 'missing-stability-summary',
      source: `${JSON.stringify(missingStabilitySummary)}\n`,
      message: /candidate latency fiber stability must be an object/,
    },
    {
      name: 'forged-stability-ratio',
      source: `${JSON.stringify(forgedStabilityRatio)}\n`,
      message: /candidate capacity steady-c1\/fiber throughputRps maxToMinRatio does not match/,
    },
    {
      name: 'out-of-range-median',
      source: `${JSON.stringify(outOfRangeMedian)}\n`,
      message: /candidate scenario response-32k-c16\/fiber p99Nanos median must stay between/,
    },
  ];

  for (const scenario of cases) {
    await writeFile(candidatePath, scenario.source, 'utf8');
    await writeFile(outputPath, previousBaseline, 'utf8');
    await writeFile(provenancePath, previousProvenance, 'utf8');
    const result = runPrepare(candidatePath, outputPath, provenancePath);
    assert.equal(result.status, 1, scenario.name);
    assert.match(result.stderr, scenario.message, scenario.name);
    assert.equal(await readFile(outputPath, 'utf8'), previousBaseline, scenario.name);
    assert.equal(await readFile(provenancePath, 'utf8'), previousProvenance, scenario.name);
  }
});

test('transport benchmark baseline records a missing candidate without inventing history', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'missing-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'missing-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  await writeFile(outputPath, 'stale baseline\n', 'utf8');

  const result = runPrepare(
    path.join(candidateRoot, 'baseline-candidate.json'),
    outputPath,
    provenancePath,
  );
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'not_available');
  assert.equal(provenance.reason, 'compatible_candidate_missing');
  await assert.rejects(readFile(outputPath, 'utf8'), /ENOENT/);
  assert.equal(runVerify(outputPath, provenancePath).status, 0);
});

test('transport benchmark baseline treats the prior schema as a one-run migration gap', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'schema-migration-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'schema-migration-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const candidatePath = path.join(candidateRoot, 'baseline-candidate.json');
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  const legacy = candidate();
  legacy.schemaVersion = 5;
  await writeFile(candidatePath, `${JSON.stringify(legacy)}\n`, 'utf8');

  const result = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(outputPath, 'utf8'), /ENOENT/);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'not_available');
  assert.equal(provenance.reason, 'report_schema_migration');
  assert.equal(runVerify(outputPath, provenancePath).status, 0);
});

test('transport benchmark baseline unavailable command clears stale output', async (t) => {
  await mkdir(outputFixtureRoot, { recursive: true });
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'unavailable-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  await writeFile(outputPath, 'stale baseline\n', 'utf8');

  const result = spawnSync(process.execPath, [
    scriptPath,
    'unavailable',
    '--output', path.relative(repositoryRoot, outputPath),
    '--provenance', path.relative(repositoryRoot, provenancePath),
    '--reason', 'artifact_download_failed',
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(outputPath, 'utf8'), /ENOENT/);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'not_available');
  assert.equal(provenance.reason, 'artifact_download_failed');
  assert.equal(runVerify(outputPath, provenancePath).status, 0);

  await writeFile(outputPath, 'stale baseline\n', 'utf8');
  const stale = runVerify(outputPath, provenancePath);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /not_available provenance must not have a baseline output/);
});

test('transport benchmark baseline verifier rejects baseline and provenance drift', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'verify-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'verify-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const candidatePath = path.join(candidateRoot, 'baseline-candidate.json');
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  const encoded = `${JSON.stringify(candidate(), null, 2)}\n`;
  await writeFile(candidatePath, encoded, 'utf8');
  assert.equal(runPrepare(candidatePath, outputPath, provenancePath).status, 0);

  await writeFile(outputPath, encoded.replace('2026-08-25', '2026-08-24'), 'utf8');
  const baselineDrift = runVerify(outputPath, provenancePath);
  assert.equal(baselineDrift.status, 1);
  assert.match(baselineDrift.stderr, /candidate sha256 does not match the baseline/);

  assert.equal(runPrepare(candidatePath, outputPath, provenancePath).status, 0);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  provenance.candidate.sha256 = '0'.repeat(64);
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const provenanceDrift = runVerify(outputPath, provenancePath);
  assert.equal(provenanceDrift.status, 1);
  assert.match(provenanceDrift.stderr, /candidate sha256 does not match the baseline/);

  provenance.status = 'unknown';
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const statusDrift = runVerify(outputPath, provenancePath);
  assert.equal(statusDrift.status, 1);
  assert.match(statusDrift.stderr, /status must be selected or not_available/);
});

test('transport benchmark baseline rejects untrusted events and incompatible reports', async (t) => {
  await mkdir(candidateFixtureRoot, { recursive: true });
  await mkdir(outputFixtureRoot, { recursive: true });
  const candidateRoot = await mkdtemp(path.join(candidateFixtureRoot, 'reject-'));
  const outputRoot = await mkdtemp(path.join(outputFixtureRoot, 'reject-'));
  t.after(() => Promise.all([
    rm(candidateRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]));
  const candidatePath = path.join(candidateRoot, 'baseline-candidate.json');
  const outputPath = path.join(outputRoot, 'baseline.json');
  const provenancePath = path.join(outputRoot, 'baseline-source.json');
  await writeFile(candidatePath, `${JSON.stringify(candidate())}\n`, 'utf8');

  const untrusted = runPrepare(candidatePath, outputPath, provenancePath, { event: 'pull_request' });
  assert.equal(untrusted.status, 1);
  assert.match(untrusted.stderr, /event must be push or workflow_dispatch/);

  const incompatible = candidate();
  incompatible.capacity.workloads.pop();
  await writeFile(candidatePath, `${JSON.stringify(incompatible)}\n`, 'utf8');
  const invalidReport = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidReport.status, 1);
  assert.match(invalidReport.stderr, /candidate workload matrix is incompatible/);

  const missingFrameworkCapacity = candidate();
  delete missingFrameworkCapacity.capacity.workloads[0].results['framework-net-http'];
  await writeFile(candidatePath, `${JSON.stringify(missingFrameworkCapacity)}\n`, 'utf8');
  const invalidFrameworkCapacity = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidFrameworkCapacity.status, 1);
  assert.match(
    invalidFrameworkCapacity.stderr,
    /candidate capacity steady-c1\/framework-net-http must be an object/,
  );

  const missingScenario = candidate();
  missingScenario.scenarios.workloads.pop();
  await writeFile(candidatePath, `${JSON.stringify(missingScenario)}\n`, 'utf8');
  const invalidScenarioMatrix = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidScenarioMatrix.status, 1);
  assert.match(invalidScenarioMatrix.stderr, /candidate scenario matrix is incompatible/);

  const missingFrameworkScenario = candidate();
  delete missingFrameworkScenario.scenarios.workloads[0].results['framework-net-http'];
  await writeFile(candidatePath, `${JSON.stringify(missingFrameworkScenario)}\n`, 'utf8');
  const invalidFrameworkScenario = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidFrameworkScenario.status, 1);
  assert.match(
    invalidFrameworkScenario.stderr,
    /candidate scenario response-32k-c16\/framework-net-http must be an object/,
  );

  const incompatibleScenario = candidate();
  incompatibleScenario.scenarios.workloads[0].concurrency += 1;
  await writeFile(candidatePath, `${JSON.stringify(incompatibleScenario)}\n`, 'utf8');
  const invalidScenarioContract = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidScenarioContract.status, 1);
  assert.match(invalidScenarioContract.stderr, /candidate scenario contract is incompatible/);

  const tampered = candidate();
  tampered.environmentFingerprint.cpu.logicalCpus += 1;
  await writeFile(candidatePath, `${JSON.stringify(tampered)}\n`, 'utf8');
  const invalidFingerprint = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidFingerprint.status, 1);
  assert.match(invalidFingerprint.stderr, /environmentFingerprint sha256 does not match/);
});
