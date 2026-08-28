import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authorizationTests,
  buildAuthorizationEvidenceReport,
  verifyAuthorizationEvidence,
  writeAuthorizationEvidenceChecksums,
} from '../../scripts/lib/authorization-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function successfulOutput() {
  return [
    ...authorizationTests.flatMap((name) => [
      `=== RUN   ${name}`,
      `--- PASS: ${name} (0.00s)`,
    ]),
    'PASS',
    'ok  \tgithub.com/zbxing/goexample/Framework/httpapi\t0.010s',
    '',
  ].join('\n');
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'authorization-policy');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed
    ? successfulOutput()
    : `=== RUN   ${authorizationTests[0]}\n--- FAIL: ${authorizationTests[0]} (0.00s)\nFAIL\n`;
  const stderr = passed ? '' : 'Authorization contract failed\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'go-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildAuthorizationEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeAuthorizationEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeAuthorizationEvidenceChecksums(evidenceRoot);
}

test('authorization evidence verifies the exact successful local contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-authorization-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.contract.tests.length, 7);
  assert.equal(verified.artifactPaths.length, 5);
});

test('authorization evidence retains a bounded failed run without declaring success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-authorization-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('authorization evidence rejects source, command, test matrix, scope, and output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-authorization-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceEvidence = await createEvidence(path.join(root, 'source'));
  await rewriteReport(sourceEvidence, (report) => {
    report.source.authorizationPolicy.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.authorizationPolicy\.sha256/,
  );

  const commandEvidence = await createEvidence(path.join(root, 'command'));
  await rewriteReport(commandEvidence, (report) => {
    report.command[1] = '-run=.*';
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: commandEvidence }),
    /fixed resource authorization contract/,
  );

  const contractEvidence = await createEvidence(path.join(root, 'contract'));
  await rewriteReport(contractEvidence, (report) => {
    report.contract.tests.pop();
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: contractEvidence }),
    /fixed resource authorization test matrix/,
  );

  const scopeEvidence = await createEvidence(path.join(root, 'scope'));
  await rewriteReport(scopeEvidence, (report) => {
    report.scope = 'production_policy_complete';
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: scopeEvidence }),
    /fixed local resource authorization contract/,
  );

  const outputEvidence = await createEvidence(path.join(root, 'output'));
  const outputPath = path.join(outputEvidence, 'go-output.txt');
  const content = (await readFile(outputPath, 'utf8')).replace(
    `--- PASS: ${authorizationTests[0]} (0.00s)\n`,
    '',
  );
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /missing the passed marker/,
  );
});

test('authorization evidence rejects limitation, checksum, and extra-artifact tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-authorization-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const limitationEvidence = await createEvidence(path.join(root, 'limitation'));
  await rewriteReport(limitationEvidence, (report) => {
    report.limitations.pop();
  });
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: limitationEvidence }),
    /fixed local-only boundary/,
  );

  const checksumEvidence = await createEvidence(path.join(root, 'checksum'));
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered authorization evidence artifact set/,
  );

  const extraEvidence = await createEvidence(path.join(root, 'extra'));
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifyAuthorizationEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
