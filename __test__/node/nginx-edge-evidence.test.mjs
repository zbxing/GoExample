import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildNginxEdgeChecksums,
  buildNginxEdgeEvidenceReport,
  nginxEdgeEvidenceSchemaVersion,
  verifyNginxEdgeEvidence,
} from '../../scripts/lib/nginx-edge-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'nginx-edge-evidence-tests');
const image = 'nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';
const events = [
  { name: 'tls_http2_trace', status: 200, alpn: 'h2', tls: 'TLSv1.3' },
  { name: 'header_limit', status: 431 },
  { name: 'upstream_503_passthrough', status: 503 },
  { name: 'upstream_502', status: 502 },
  { name: 'upstream_504', status: 504 },
  { name: 'upload_interruption_propagated' },
  { name: 'sigquit_drain', status: 200 },
];

async function writeReportAndChecksums(evidenceRoot, currentEvents = events, exitCode = 0) {
  const report = buildNginxEdgeEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    nodeVersion: process.version,
    platform: 'linux',
    architecture: 'x64',
    runnerOS: 'Linux',
    runnerArch: 'X64',
    gitCommit: 'a'.repeat(40),
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:20.000Z',
    exitCode,
    events: currentEvents,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNginxEdgeChecksums(evidenceRoot), 'utf8');
  return { report, reportPath };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const environment = [
    'runner_os=Linux',
    'runner_arch=X64',
    `git_commit=${'a'.repeat(40)}`,
    `node=${process.version}`,
    `nginx_image=${image}`,
    'contract=support/deploy/edge/goexample-nginx.contract.json',
    '',
  ].join('\n');
  await writeFile(path.join(evidenceRoot, 'environment.txt'), environment, 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-output.json'), `${JSON.stringify({
    localContractOnly: true,
    status: 'passed',
    events,
    error: null,
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'nginx.log'), 'bounded loopback Nginx log\n', 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=0\n', 'utf8');
  const { report, reportPath } = await writeReportAndChecksums(evidenceRoot);
  return { evidenceRoot, report, reportPath };
}

test('Nginx edge evidence binds all loopback scenarios and local-only limitations', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const verified = verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.schemaVersion, nginxEdgeEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.events.length, 7);
  assert.equal(verified.artifactPaths.length, 6);
  assert.match(verified.report.limitations.join('\n'), /targetEdge remains not_recorded/);
});

test('failed Nginx edge evidence accepts only an ordered scenario prefix and bounded error', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const failedEvents = events.slice(0, 3);
  await writeFile(path.join(evidenceRoot, 'test-output.json'), `${JSON.stringify({
    localContractOnly: true,
    status: 'failed',
    events: failedEvents,
    error: 'bounded contract failure',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'test-status.txt'), 'exit_code=1\n', 'utf8');
  await writeReportAndChecksums(evidenceRoot, failedEvents, 1);

  const verified = verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.events.length, 3);

  const outOfOrderEvents = [{
    name: 'header_limit',
    status: 431,
    alpn: 'h2',
    tls: 'TLSv1.3',
  }];
  await writeFile(path.join(evidenceRoot, 'test-output.json'), `${JSON.stringify({
    localContractOnly: true,
    status: 'failed',
    events: outOfOrderEvents,
    error: 'bounded contract failure',
  }, null, 2)}\n`, 'utf8');
  await writeReportAndChecksums(evidenceRoot, outOfOrderEvents, 1);
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /events\[0\]\.name must equal tls_http2_trace/,
  );
});

test('Nginx edge evidence rejects scope, status, hash, checksum, and semantic tampering', async (t) => {
  const { evidenceRoot, report, reportPath } = await createEvidence(t);

  const scopeTamper = structuredClone(report);
  scopeTamper.scope.contract.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const statusTamper = structuredClone(report);
  statusTamper.execution.exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /status must match/,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'nginx.log'), 'tampered log\n', 'utf8');
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.nginxLog (?:size|hash) mismatch/,
  );

  await writeFile(path.join(evidenceRoot, 'nginx.log'), 'bounded loopback Nginx log\n', 'utf8');
  const semanticEvents = structuredClone(events);
  semanticEvents[1].status = 200;
  const testOutput = `${JSON.stringify({
    localContractOnly: true,
    status: 'passed',
    events: semanticEvents,
    error: null,
  }, null, 2)}\n`;
  await writeFile(path.join(evidenceRoot, 'test-output.json'), testOutput, 'utf8');
  await writeReportAndChecksums(evidenceRoot, semanticEvents);
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /events\[1\]\.status must equal 431/,
  );

  await writeFile(path.join(evidenceRoot, 'test-output.json'), `${JSON.stringify({
    localContractOnly: true,
    status: 'passed',
    events,
    error: null,
  }, null, 2)}\n`, 'utf8');
  await writeReportAndChecksums(evidenceRoot);
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot }),
    /SHA256SUMS must contain the exact ordered/,
  );
});
