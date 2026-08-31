import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSDKReleaseEvidenceReport,
  expectedSDKReleaseEvidenceOutput,
  sdkReleaseEvidenceProjects,
  verifySDKReleaseEvidence,
  writeSDKReleaseEvidenceChecksums,
} from '../../scripts/lib/sdk-release-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'sdk-release-readiness');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed ? expectedSDKReleaseEvidenceOutput() : '';
  const stderr = passed ? '' : 'SDK release readiness: generated SDK check failed for Example\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'verification-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'verification-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'verification-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildSDKReleaseEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKReleaseEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKReleaseEvidenceChecksums(evidenceRoot);
}

test('SDK release evidence verifies the exact successful local readiness contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.contract.projects.length, 2);
  assert.equal(
    verified.report.contract.projects.reduce((total, project) => total + project.operationCount, 0),
    40,
  );
  assert.equal(verified.artifactPaths.length, 5);
});

test('SDK release evidence retains a bounded failed run without declaring success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('SDK release evidence rejects source, command, project matrix, scope, and output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceEvidence = await createEvidence(path.join(root, 'source'));
  await rewriteReport(sourceEvidence, (report) => {
    report.source.exampleReleaseManifest.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.exampleReleaseManifest\.sha256/,
  );

  const commandEvidence = await createEvidence(path.join(root, 'command'));
  await rewriteReport(commandEvidence, (report) => {
    report.command[2] = 'prepare';
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: commandEvidence }),
    /fixed SDK release readiness command/,
  );

  const contractEvidence = await createEvidence(path.join(root, 'contract'));
  await rewriteReport(contractEvidence, (report) => {
    report.contract.projects[0].operationCount = sdkReleaseEvidenceProjects[0].operationCount - 1;
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: contractEvidence }),
    /fixed SDK release project matrix/,
  );

  const scopeEvidence = await createEvidence(path.join(root, 'scope'));
  await rewriteReport(scopeEvidence, (report) => {
    report.scope = 'published_sdk_release';
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: scopeEvidence }),
    /fixed local SDK release readiness contract/,
  );

  const outputEvidence = await createEvidence(path.join(root, 'output'));
  const outputPath = path.join(outputEvidence, 'verification-output.txt');
  const content = (await readFile(outputPath, 'utf8')).replace(
    `Verified ${sdkReleaseEvidenceProjects[1].sdkPath}/release-manifest.json for expected tag ${sdkReleaseEvidenceProjects[1].expectedTag} (publication not checked).\n`,
    '',
  );
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /exact ordered SDK release readiness markers/,
  );
});

test('SDK release evidence rejects assertion, limitation, checksum, and extra-artifact tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-sdk-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const assertionEvidence = await createEvidence(path.join(root, 'assertion'));
  await rewriteReport(assertionEvidence, (report) => {
    report.contract.assertions.publicationNotChecked = false;
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: assertionEvidence }),
    /fixed SDK release readiness assertions/,
  );

  const limitationEvidence = await createEvidence(path.join(root, 'limitation'));
  await rewriteReport(limitationEvidence, (report) => {
    report.limitations.pop();
  });
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: limitationEvidence }),
    /fixed repository-only boundary/,
  );

  const checksumEvidence = await createEvidence(path.join(root, 'checksum'));
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered SDK release evidence artifact set/,
  );

  const extraEvidence = await createEvidence(path.join(root, 'extra'));
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifySDKReleaseEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
