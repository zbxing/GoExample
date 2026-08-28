import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildRedisSentinelChecksums,
  buildRedisSentinelEvidenceReport,
  redisSentinelCheckpointNames,
  redisSentinelEvidenceSchemaVersion,
  verifyRedisSentinelEvidence,
} from '../../scripts/lib/redis-sentinel-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'redis-sentinel-evidence-tests');
const image = 'redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232';
const containerNames = ['master', 'replica', 'sentinel-1', 'sentinel-2', 'sentinel-3'];
const ports = [31001, 31002, 31003, 31004, 31005];

function contractOutput(error = null) {
  return [
    'docker server: 28.3.2',
    `started master: ${'a'.repeat(64)}`,
    `started replica: ${'b'.repeat(64)}`,
    'master: ready after 1 attempt(s)',
    'replica link: ready after 2 attempt(s)',
    `started sentinel-1: ${'c'.repeat(64)}`,
    `started sentinel-2: ${'d'.repeat(64)}`,
    `started sentinel-3: ${'e'.repeat(64)}`,
    'sentinel 1 quorum: ready after 1 attempt(s)',
    'sentinel 2 quorum: ready after 1 attempt(s)',
    'sentinel 3 quorum: ready after 1 attempt(s)',
    ...(error ? [`failure: ${error}`] : []),
    '',
  ].join('\n');
}

function testOutput(checkpoints = redisSentinelCheckpointNames, status = 'passed') {
  return [
    '=== RUN   TestRedisSentinelFailoverReconnectsSharedStateClients',
    ...checkpoints.map((checkpoint) => `    redis_sentinel_integration_test.go:1: sentinel-checkpoint=${checkpoint}`),
    `--- ${status === 'passed' ? 'PASS' : 'FAIL'}: TestRedisSentinelFailoverReconnectsSharedStateClients (1.00s)`,
    status === 'passed' ? 'PASS' : 'FAIL',
    status === 'passed'
      ? 'ok  github.com/zbxing/goexample/Framework/sharedstate  1.000s'
      : 'FAIL github.com/zbxing/goexample/Framework/sharedstate  1.000s',
    '',
  ].join('\n');
}

function environment() {
  return [
    'contract=redis-sentinel-failover',
    'platform=linux',
    'architecture=x64',
    `node=${process.version}`,
    'go=go version go1.25.13 linux/amd64',
    'docker=28.3.2',
    `git_commit=${'a'.repeat(40)}`,
    `image=${image}`,
    'topology=1-master,1-replica,3-sentinels',
    `ports=${ports.join(',')}`,
    'tls_enabled=false',
    'local_contract_only=true',
    'target_redis_ha=not_recorded',
    '',
  ].join('\n');
}

async function writeReportAndChecksums(
  evidenceRoot,
  { exitCode = 0, error = null, currentContainerNames = containerNames, currentPorts = ports } = {},
) {
  const report = buildRedisSentinelEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    nodeVersion: process.version,
    platform: 'linux',
    architecture: 'x64',
    goVersion: 'go version go1.25.13 linux/amd64',
    dockerVersion: '28.3.2',
    gitCommit: 'a'.repeat(40),
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:20.000Z',
    exitCode,
    error,
    containerNames: currentContainerNames,
    ports: currentPorts,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(evidenceRoot, 'SHA256SUMS'),
    buildRedisSentinelChecksums(evidenceRoot, currentContainerNames),
    'utf8',
  );
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  await mkdir(path.join(evidenceRoot, 'container-logs'));
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'contract-output.txt'), contractOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), testOutput(), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  for (const name of containerNames) {
    await writeFile(path.join(evidenceRoot, 'container-logs', `${name}.log`), `${name} bounded log\n`, 'utf8');
  }
  const { report, reportPath } = await writeReportAndChecksums(evidenceRoot);
  return { evidenceRoot, report, reportPath };
}

test('Redis Sentinel evidence binds the ACL failover checkpoints and local-only limitations', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const verified = verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.schemaVersion, redisSentinelEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.deepEqual(verified.report.checkpoints, redisSentinelCheckpointNames);
  assert.equal(verified.report.outputs.containerLogs.length, 5);
  assert.equal(verified.artifactPaths.length, 11);
  assert.match(verified.report.limitations.join('\n'), /productionSharedStore remains not_recorded/);
});

test('failed Redis Sentinel evidence accepts only ordered checkpoint prefixes and bounded errors', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const error = 'bounded Go contract failure';
  const checkpoints = redisSentinelCheckpointNames.slice(0, 3);
  await writeFile(path.join(evidenceRoot, 'contract-output.txt'), contractOutput(error), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), testOutput(checkpoints, 'failed'), 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  await writeReportAndChecksums(evidenceRoot, { exitCode: 1, error });
  const verified = verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.deepEqual(verified.report.checkpoints, checkpoints);

  const outOfOrder = ['replication_before_failover'];
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), testOutput(outOfOrder, 'failed'), 'utf8');
  await writeReportAndChecksums(evidenceRoot, { exitCode: 1, error });
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /checkpoints\[0\] must equal discovery/,
  );
});

test('Redis Sentinel evidence rejects scope, status, log, semantic, and checksum tampering', async (t) => {
  const { evidenceRoot, report, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(report);
  scopeTamper.scope.integrationTest.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(report);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /status must match/,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'container-logs', 'master.log'), 'tampered log\n', 'utf8');
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.containerLogs\[0\] (?:size|hash) mismatch/,
  );

  await writeFile(path.join(evidenceRoot, 'container-logs', 'master.log'), 'master bounded log\n', 'utf8');
  const semanticCheckpoints = [...redisSentinelCheckpointNames];
  semanticCheckpoints[1] = 'master_changed';
  await writeFile(path.join(evidenceRoot, 'test-output.txt'), testOutput(semanticCheckpoints), 'utf8');
  await writeReportAndChecksums(evidenceRoot);
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /checkpoints\[1\] must equal replication_before_failover/,
  );

  await writeFile(path.join(evidenceRoot, 'test-output.txt'), testOutput(), 'utf8');
  await writeReportAndChecksums(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
