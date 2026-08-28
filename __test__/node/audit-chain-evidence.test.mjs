import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditChainTests,
  buildAuditChainEvidenceReport,
  verifyAuditChainEvidence,
  writeAuditChainEvidenceChecksums,
} from '../../scripts/lib/audit-chain-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function successfulOutput() {
  return [
    ...auditChainTests.flatMap((name) => [
      `=== RUN   ${name}`,
      `--- PASS: ${name} (0.00s)`,
    ]),
    'PASS',
    'ok  \tgithub.com/zbxing/Framework/httpapi\t0.010s',
    '',
  ].join('\n');
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'audit-chain');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed ? successfulOutput() : '=== RUN   TestHashChainAuditSinkWritesAndVerifiesLinkedRecords\n--- FAIL: TestHashChainAuditSinkWritesAndVerifiesLinkedRecords (0.00s)\nFAIL\n';
  const stderr = passed ? '' : 'audit contract failed\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'go-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildAuditChainEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeAuditChainEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeAuditChainEvidenceChecksums(evidenceRoot);
}

test('audit chain evidence verifies the exact successful local contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-audit-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifyAuditChainEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.contract.tests.length, 6);
  assert.equal(verified.artifactPaths.length, 5);
});

test('audit chain evidence retains a bounded failed run without declaring success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-audit-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifyAuditChainEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('audit chain evidence rejects source, contract, scope, and semantic output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-audit-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceRoot = path.join(root, 'source');
  const sourceEvidence = await createEvidence(sourceRoot);
  await rewriteReport(sourceEvidence, (report) => {
    report.source.auditChain.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.auditChain\.sha256/,
  );

  const contractRoot = path.join(root, 'contract');
  const contractEvidence = await createEvidence(contractRoot);
  await rewriteReport(contractEvidence, (report) => {
    report.contract.tests.pop();
  });
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: contractEvidence }),
    /fixed audit test matrix/,
  );

  const scopeRoot = path.join(root, 'scope');
  const scopeEvidence = await createEvidence(scopeRoot);
  await rewriteReport(scopeEvidence, (report) => {
    report.scope = 'production_audit_complete';
  });
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: scopeEvidence }),
    /fixed local audit chain contract/,
  );

  const outputRoot = path.join(root, 'output');
  const outputEvidence = await createEvidence(outputRoot);
  const outputPath = path.join(outputEvidence, 'go-output.txt');
  const content = (await readFile(outputPath, 'utf8')).replace(
    `--- PASS: ${auditChainTests[0]} (0.00s)\n`,
    '',
  );
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /missing the passed marker/,
  );
});

test('audit chain evidence rejects checksum drift and extra artifacts', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-audit-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const checksumRoot = path.join(root, 'checksum');
  const checksumEvidence = await createEvidence(checksumRoot);
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered audit evidence artifact set/,
  );

  const extraRoot = path.join(root, 'extra');
  const extraEvidence = await createEvidence(extraRoot);
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifyAuditChainEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
