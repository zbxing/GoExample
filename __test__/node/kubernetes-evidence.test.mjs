import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildKubernetesEvidenceReport,
  kubernetesEvidenceSchemaVersion,
  kubernetesValidationFixture,
  verifyKubernetesEvidence,
} from '../../scripts/lib/kubernetes-evidence.mjs';
import { renderManifest } from '../../scripts/kubernetes-manifest.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'kubernetes-evidence-tests');
const templatePath = path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json');

function fileRecord(content) {
  return {
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const renderedManifestPath = path.join(evidenceRoot, 'goexample-api.json');
  const checkOutputPath = path.join(evidenceRoot, 'check-output.txt');
  const renderOutputPath = path.join(evidenceRoot, 'render-output.txt');
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const rendered = `${JSON.stringify(renderManifest(template, kubernetesValidationFixture), null, 2)}\n`;
  await writeFile(renderedManifestPath, rendered, 'utf8');
  await writeFile(checkOutputPath, 'stdout:\nKubernetes template passed: support/deploy/kubernetes/goexample-api.template.json\n\nstderr:\n', 'utf8');
  await writeFile(renderOutputPath, 'stdout:\nKubernetes manifest written to .temp/workflow-artifacts/kubernetes-manifest/goexample-api.json\n\nstderr:\n', 'utf8');
  const report = buildKubernetesEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    renderedManifestPath,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:01.000Z',
    checkExitCode: 0,
    renderExitCode: 0,
    checkOutputPath,
    renderOutputPath,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { evidenceRoot, reportPath, renderedManifestPath, rendered, report };
}

test('Kubernetes evidence binds deterministic rendering and repository-only limitations', async (t) => {
  const { evidenceRoot } = await createEvidence(t);
  const verified = verifyKubernetesEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.schemaVersion, kubernetesEvidenceSchemaVersion);
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.report.fixture.image, kubernetesValidationFixture.image);
  assert.equal(verified.artifactPaths.length, 4);
  assert.match(verified.report.limitations.join('\n'), /kubernetesDrill remains not_recorded/);
});

test('Kubernetes evidence rejects scope, command, status, hash, and semantic tampering', async (t) => {
  const { evidenceRoot, reportPath, renderedManifestPath, rendered, report } = await createEvidence(t);

  const scopeTamper = structuredClone(report);
  scopeTamper.scope.template.sha256 = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }),
    /scope no longer matches/,
  );

  const commandTamper = structuredClone(report);
  commandTamper.commands.render[0] = 'forged-node';
  await writeFile(reportPath, `${JSON.stringify(commandTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }),
    /commands must match/,
  );

  const statusTamper = structuredClone(report);
  statusTamper.execution.renderExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }),
    /execution\.renderExitCode must be zero/,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(renderedManifestPath, 'tampered output', 'utf8');
  assert.throws(
    () => verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.manifest (?:size|hash) mismatch/,
  );

  const semanticTamper = JSON.parse(rendered);
  semanticTamper.items.find((item) => item.kind === 'Deployment').spec.replicas = 2;
  const forgedRendered = `${JSON.stringify(semanticTamper, null, 2)}\n`;
  const forgedRecord = fileRecord(forgedRendered);
  const semanticReport = structuredClone(report);
  semanticReport.outputs.manifest.bytes = forgedRecord.bytes;
  semanticReport.outputs.manifest.sha256 = forgedRecord.sha256;
  await writeFile(renderedManifestPath, forgedRendered, 'utf8');
  await writeFile(reportPath, `${JSON.stringify(semanticReport, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }),
    /Deployment replicas|does not exactly match/,
  );
});
