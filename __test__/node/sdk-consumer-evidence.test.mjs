import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSDKConsumerEvidenceReport,
  expectedSDKConsumerGoOutput,
  sdkConsumerBillingOperations,
  verifySDKConsumerEvidence,
  writeSDKConsumerEvidenceChecksums,
} from '../../scripts/lib/sdk-consumer-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'sdk-consumer-migration');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed ? expectedSDKConsumerGoOutput() : '';
  const stderr = passed ? '' : 'SDK consumer migration: selected test failed\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'go-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildSDKConsumerEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKConsumerEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKConsumerEvidenceChecksums(evidenceRoot);
}

test('SDK consumer evidence verifies the exact local migration and operation contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.contract.consumers.length, 2);
  assert.equal(verified.report.contract.consumers[0].canonicalPath, '/readyz');
  assert.equal(verified.report.contract.consumers[1].operationCount, sdkConsumerBillingOperations.length);
  assert.equal(verified.artifactPaths.length, 5);
});

test('SDK consumer evidence retains a bounded failed run without declaring success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('SDK consumer evidence rejects source, command, matrix, and output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceEvidence = await createEvidence(path.join(root, 'source'));
  await rewriteReport(sourceEvidence, (report) => {
    report.source.healthProbeReadme.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.healthProbeReadme\.sha256/,
  );

  const commandEvidence = await createEvidence(path.join(root, 'command'));
  await rewriteReport(commandEvidence, (report) => {
    report.command[2] = '-count=2';
  });
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: commandEvidence }),
    /fixed SDK consumer migration command/,
  );

  const matrixEvidence = await createEvidence(path.join(root, 'matrix'));
  await rewriteReport(matrixEvidence, (report) => {
    report.contract.consumers[1].operationCount = sdkConsumerBillingOperations.length - 1;
  });
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: matrixEvidence }),
    /fixed SDK consumer project matrix/,
  );

  const outputEvidence = await createEvidence(path.join(root, 'output'));
  const outputPath = path.join(outputEvidence, 'go-output.txt');
  const content = (await readFile(outputPath, 'utf8')).replace(
    `    --- PASS: ${'TestGeneratedBillingSDKInvokesEveryPublicOperationThroughFrameworkHandler'}/getMetrics (0.00s)\n`,
    '',
  );
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /passed Billing operation marker for getMetrics/,
  );
});

test('SDK consumer evidence rejects limitations, checksum, and extra-artifact tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const limitationEvidence = await createEvidence(path.join(root, 'limitation'));
  await rewriteReport(limitationEvidence, (report) => {
    report.limitations.pop();
  });
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: limitationEvidence }),
    /repository-only boundary/,
  );

  const checksumEvidence = await createEvidence(path.join(root, 'checksum'));
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered SDK consumer evidence artifact set/,
  );

  const extraEvidence = await createEvidence(path.join(root, 'extra'));
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifySDKConsumerEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
