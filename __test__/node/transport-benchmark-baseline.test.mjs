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

function candidate() {
  return {
    schemaVersion: 4,
    generatedAt: '2026-08-25T00:00:00.000Z',
    scope: 'linux_loopback_combined_client_server_harness',
    environmentFingerprint: environmentFingerprint(),
    latency: { payloadBytes: 88 },
    capacity: {
      payloadBytes: 88,
      workloads: workloads.map((name) => ({
        name,
        results: {
          fiber: { median: { throughputRps: 1200, p95Nanos: 1400, p99Nanos: 1800 } },
          'net-http': { median: { throughputRps: 1000, p95Nanos: 1750, p99Nanos: 2300 } },
        },
      })),
    },
    scenarios: {
      workloads: scenarios.map((scenario) => ({
        ...scenario,
        results: {
          fiber: {
            rounds: 5,
            median: {
              throughputRps: 1200,
              p50Nanos: 1000,
              p95Nanos: 1400,
              p99Nanos: 1800,
            },
          },
          'net-http': {
            rounds: 5,
            median: {
              throughputRps: 1000,
              p50Nanos: 1100,
              p95Nanos: 1750,
              p99Nanos: 2300,
            },
          },
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
  assert.equal(provenance.candidate.reportSchemaVersion, 4);
  assert.equal(
    provenance.candidate.environmentFingerprintSha256,
    candidate().environmentFingerprint.sha256,
  );
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

  const missingScenario = candidate();
  missingScenario.scenarios.workloads.pop();
  await writeFile(candidatePath, `${JSON.stringify(missingScenario)}\n`, 'utf8');
  const invalidScenarioMatrix = runPrepare(candidatePath, outputPath, provenancePath);
  assert.equal(invalidScenarioMatrix.status, 1);
  assert.match(invalidScenarioMatrix.stderr, /candidate scenario matrix is incompatible/);

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
