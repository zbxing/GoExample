import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSDKConsumerMatrixEvidenceReport,
  expectedSDKConsumerMatrixEvidenceOutput,
  verifySDKConsumerMatrixEvidence,
  writeSDKConsumerMatrixEvidenceChecksums,
} from '../../scripts/lib/sdk-consumer-matrix-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'sdk-consumer-matrix');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed ? expectedSDKConsumerMatrixEvidenceOutput() : '';
  const stderr = passed ? '' : 'SDK consumer matrix: check failed\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'verification-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'verification-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'verification-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildSDKConsumerMatrixEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKConsumerMatrixEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKConsumerMatrixEvidenceChecksums(evidenceRoot);
}

test('SDK consumer matrix evidence verifies the exact repository-only contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-matrix-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.contract.matrix.consumers.length, 2);
  assert.equal(verified.report.contract.matrix.sunset.minimumWindowDays, 184);
  assert.equal(verified.artifactPaths.length, 5);
});

test('SDK consumer matrix evidence retains a bounded failed check without claiming success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-matrix-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('SDK consumer matrix evidence rejects contract, source, and output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-matrix-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const contractEvidence = await createEvidence(path.join(root, 'contract'));
  await rewriteReport(contractEvidence, (report) => {
    report.contract.matrix.sunset.minimumWindowDays = 1;
  });
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: contractEvidence }),
    /fixed SDK consumer matrix contract/,
  );

  const sourceEvidence = await createEvidence(path.join(root, 'source'));
  await rewriteReport(sourceEvidence, (report) => {
    report.source.matrixContract.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.matrixContract\.sha256/,
  );

  const outputEvidence = await createEvidence(path.join(root, 'output'));
  const outputPath = path.join(outputEvidence, 'verification-output.txt');
  const content = 'SDK consumer matrix verified: 1 repository-local consumers\n';
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /exact SDK consumer matrix marker/,
  );
});

test('SDK consumer matrix evidence rejects limitation, checksum, and extra-artifact tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-consumer-matrix-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const limitationEvidence = await createEvidence(path.join(root, 'limitation'));
  await rewriteReport(limitationEvidence, (report) => {
    report.limitations.pop();
  });
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: limitationEvidence }),
    /repository-only boundary/,
  );

  const checksumEvidence = await createEvidence(path.join(root, 'checksum'));
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered SDK consumer matrix evidence artifact set/,
  );

  const extraEvidence = await createEvidence(path.join(root, 'extra'));
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
