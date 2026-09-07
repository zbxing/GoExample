import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildOIDCBrowserEvidenceReport,
  oidcBrowserTests,
  verifyOIDCBrowserEvidence,
  writeOIDCBrowserEvidenceChecksums,
} from '../../scripts/lib/oidc-browser-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function successfulOutput() {
  return [
    ...oidcBrowserTests.flatMap((name) => [
      `=== RUN   ${name}`,
      `--- PASS: ${name} (0.00s)`,
    ]),
		'PASS',
		'ok  \tgithub.com/zbxing/goexample/Framework/auth\t0.010s',
		'ok  \tgithub.com/zbxing/goexample/Framework/httpapi\t0.010s',
    '',
  ].join('\n');
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createEvidence(root, { passed = true } = {}) {
  const evidenceRoot = path.join(root, 'oidc-browser');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(evidenceRoot, { recursive: true });
  const stdout = passed
    ? successfulOutput()
    : `=== RUN   ${oidcBrowserTests[0]}\n--- FAIL: ${oidcBrowserTests[0]} (0.00s)\nFAIL\n`;
  const stderr = passed ? '' : 'OIDC browser contract failed\n';
  const exitCode = passed ? 0 : 1;
  const status = `exit_code=${exitCode}\nsignal=\nspawn_error=\n`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'go-output.txt'), stdout, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-error.txt'), stderr, 'utf8'),
    writeFile(path.join(evidenceRoot, 'go-status.txt'), status, 'utf8'),
  ]);
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const report = buildOIDCBrowserEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: { startedAt, completedAt, exitCode, signal: null, spawnErrorCode: null },
  });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeOIDCBrowserEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

async function rewriteReport(evidenceRoot, mutate) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  mutate(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeOIDCBrowserEvidenceChecksums(evidenceRoot);
}

test('OIDC browser evidence verifies the exact successful local contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-oidc-browser-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root);
  const verified = verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
	assert.equal(verified.report.contract.tests.length, 12);
	assert.equal(verified.report.contract.assertions.accessTokenHashBound, true);
	assert.equal(verified.report.contract.assertions.tokenEndpointAuthenticationNegotiated, true);
	assert.equal(verified.report.contract.assertions.tokenRequestCredentialsBound, true);
	assert.ok(verified.report.source.jwksVerifier);
	assert.ok(verified.report.source.jwksVerifierTests);
	assert.ok(verified.report.source.oidcClientTests);
  assert.equal(verified.artifactPaths.length, 5);
});

test('OIDC browser evidence retains a bounded failed run without declaring success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-oidc-browser-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = await createEvidence(root, { passed: false });
  const verified = verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.report.execution.exitCode, 1);
});

test('OIDC browser evidence rejects source, contract, scope, and semantic output tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-oidc-browser-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceEvidence = await createEvidence(path.join(root, 'source'));
  await rewriteReport(sourceEvidence, (report) => {
    report.source.oidcBrowser.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: sourceEvidence }),
    /source\.oidcBrowser\.sha256/,
  );

  const schemaEvidence = await createEvidence(path.join(root, 'schema'));
  await rewriteReport(schemaEvidence, (report) => {
    report.schemaVersion = 1;
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: schemaEvidence }),
		/schemaVersion must equal 3/,
  );

	const assertionEvidence = await createEvidence(path.join(root, 'assertion'));
  await rewriteReport(assertionEvidence, (report) => {
    report.contract.assertions.accessTokenHashBound = false;
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: assertionEvidence }),
		/assertions must all be true/,
	);

	const authenticationSourceEvidence = await createEvidence(path.join(root, 'authentication-source'));
	await rewriteReport(authenticationSourceEvidence, (report) => {
		report.source.oidcClientTests.sha256 = '0'.repeat(64);
	});
	assert.throws(
		() => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: authenticationSourceEvidence }),
		/source\.oidcClientTests\.sha256/,
	);

  const contractEvidence = await createEvidence(path.join(root, 'contract'));
  await rewriteReport(contractEvidence, (report) => {
    report.contract.tests.pop();
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: contractEvidence }),
    /fixed OIDC browser test matrix/,
  );

  const scopeEvidence = await createEvidence(path.join(root, 'scope'));
  await rewriteReport(scopeEvidence, (report) => {
    report.scope = 'production_oidc_complete';
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: scopeEvidence }),
    /fixed local OIDC browser contract/,
  );

  const outputEvidence = await createEvidence(path.join(root, 'output'));
  const outputPath = path.join(outputEvidence, 'go-output.txt');
  const content = (await readFile(outputPath, 'utf8')).replace(
    `--- PASS: ${oidcBrowserTests[0]} (0.00s)\n`,
    '',
  );
  await writeFile(outputPath, content, 'utf8');
  await rewriteReport(outputEvidence, (report) => {
    report.artifacts.stdout.bytes = Buffer.byteLength(content);
    report.artifacts.stdout.sha256 = hash(content);
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: outputEvidence }),
    /missing the passed marker/,
  );
});

test('OIDC browser evidence rejects limitation, checksum, and extra-artifact tampering', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goexample-oidc-browser-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const limitationEvidence = await createEvidence(path.join(root, 'limitation'));
  await rewriteReport(limitationEvidence, (report) => {
    report.limitations.pop();
  });
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: limitationEvidence }),
    /fixed local-only boundary/,
  );

  const checksumEvidence = await createEvidence(path.join(root, 'checksum'));
  await writeFile(path.join(checksumEvidence, 'SHA256SUMS'), '0'.repeat(64), 'utf8');
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: checksumEvidence }),
    /exact ordered OIDC browser evidence artifact set/,
  );

  const extraEvidence = await createEvidence(path.join(root, 'extra'));
  await writeFile(path.join(extraEvidence, 'unbound.txt'), 'not checksummed\n', 'utf8');
  assert.throws(
    () => verifyOIDCBrowserEvidence({ repositoryRoot, evidenceRoot: extraEvidence }),
    /evidence directory files must be exactly/,
  );
});
