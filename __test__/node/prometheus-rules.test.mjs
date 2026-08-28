import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildPrometheusRuleReport,
  prometheusConfigPaths,
  prometheusRulePaths,
  prometheusRuleTestPaths,
  prometheusModuleSum,
  prometheusModuleVersion,
  prometheusGoModSum,
  promtoolRevision,
  promtoolModule,
  promtoolVersion,
  verifyPrometheusRuleEvidence,
} from '../../scripts/lib/prometheus-rules.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'prometheus-rule-tests');

function successfulConfigOutput() {
  return `stdout:\nChecking ${prometheusConfigPaths[0]}\n  SUCCESS: 1 rule files found\n SUCCESS: ${prometheusConfigPaths[0]} is valid prometheus config file syntax\n\nstderr:\n`;
}

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binaryPath = path.join(evidenceRoot, process.platform === 'win32' ? 'promtool.exe' : 'promtool');
  const buildOutputPath = path.join(evidenceRoot, 'build-output.txt');
  const versionOutputPath = path.join(evidenceRoot, 'version-output.txt');
  const checkConfigOutputPath = path.join(evidenceRoot, 'check-config-output.txt');
  const checkRulesOutputPath = path.join(evidenceRoot, 'check-rules-output.txt');
  const testRulesOutputPath = path.join(evidenceRoot, 'test-rules-output.txt');
  await writeFile(binaryPath, 'bounded promtool fixture', 'utf8');
  await writeFile(buildOutputPath, 'stdout:\n\nstderr:\n', 'utf8');
  await writeFile(
    versionOutputPath,
    `stdout:\npromtool, version ${promtoolVersion} (branch: HEAD, revision: ${promtoolRevision})\n  go version:       go1.25.13\n\nstderr:\n`,
    'utf8',
  );
  await writeFile(checkConfigOutputPath, successfulConfigOutput(), 'utf8');
  await writeFile(
    checkRulesOutputPath,
    `stdout:\nChecking ${prometheusRulePaths[0]}\n  SUCCESS: 48 rules found\n\nstderr:\n`,
    'utf8',
  );
  await writeFile(testRulesOutputPath, 'stdout:\n  SUCCESS\n\n\nstderr:\n', 'utf8');
  const report = buildPrometheusRuleReport({
    repositoryRoot,
    evidenceRoot,
    binaryPath,
    goVersion: 'go1.25.13',
    platform: `${process.platform}/${process.arch}`,
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:01.000Z',
    buildExitCode: 0,
    versionExitCode: 0,
    checkConfigExitCode: 0,
    checkRulesExitCode: 0,
    testRulesExitCode: 0,
    buildOutputPath,
    versionOutputPath,
    checkConfigOutputPath,
    checkRulesOutputPath,
    testRulesOutputPath,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { evidenceRoot, reportPath, checkConfigOutputPath, checkRulesOutputPath, testRulesOutputPath };
}

test('Prometheus rule validation pins the complete promtool module closure and executable server rule scope', () => {
  assert.equal(promtoolVersion, '3.5.0');
  assert.equal(promtoolModule, 'github.com/prometheus/prometheus/cmd/promtool');
  assert.equal(prometheusModuleVersion, 'v0.305.0');
  assert.match(prometheusModuleSum, /^h1:/);
  assert.match(prometheusGoModSum, /^h1:/);
  assert.deepEqual(prometheusConfigPaths, ['support/deploy/prometheus/prometheus.yml']);
  assert.deepEqual(prometheusRulePaths, ['support/deploy/prometheus/rules/goexample-slo.yml']);
  assert.deepEqual(prometheusRuleTestPaths, ['support/deploy/prometheus/tests/goexample-slo.test.yml']);
});

test('Prometheus rule evidence verifier rejects module, scope, status, and output tampering', async (t) => {
  const { evidenceRoot, reportPath, checkConfigOutputPath, checkRulesOutputPath, testRulesOutputPath } = await createEvidence(t);
  assert.equal(verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }).report.execution.checkConfigExitCode, 0);
  assert.equal(verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }).report.execution.checkRulesExitCode, 0);
  assert.equal(verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }).report.execution.testRulesExitCode, 0);

  const originalReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const moduleTamper = structuredClone(originalReport);
  moduleTamper.tool.moduleSum = 'h1:tampered';
  await writeFile(reportPath, `${JSON.stringify(moduleTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /tool identity does not match the pinned Prometheus module/,
  );

  const scopeTamper = structuredClone(originalReport);
  scopeTamper.scope.included = [];
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /scope\.included no longer matches/,
  );

  const configScopeTamper = structuredClone(originalReport);
  configScopeTamper.scope.configs = [];
  await writeFile(reportPath, `${JSON.stringify(configScopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /scope\.configs no longer matches/,
  );

  const testScopeTamper = structuredClone(originalReport);
  testScopeTamper.scope.tests = [];
  await writeFile(reportPath, `${JSON.stringify(testScopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /scope\.tests no longer matches/,
  );

  const statusTamper = structuredClone(originalReport);
  statusTamper.execution.checkRulesExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /execution\.checkRulesExitCode must be zero/,
  );

  const configStatusTamper = structuredClone(originalReport);
  configStatusTamper.execution.checkConfigExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(configStatusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /execution\.checkConfigExitCode must be zero/,
  );

  const testStatusTamper = structuredClone(originalReport);
  testStatusTamper.execution.testRulesExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(testStatusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /execution\.testRulesExitCode must be zero/,
  );

  await writeFile(reportPath, `${JSON.stringify(originalReport, null, 2)}\n`, 'utf8');
  await writeFile(checkConfigOutputPath, 'tampered output', 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.checkConfig (?:size|hash) mismatch/,
  );

  const forgedConfigOutput = `stdout:\nChecking ${prometheusConfigPaths[0]}\n  SUCCESS: 1 rule files found\n\nstderr:\n`;
  const configOutputTamper = structuredClone(originalReport);
  configOutputTamper.outputs.checkConfig.bytes = Buffer.byteLength(forgedConfigOutput);
  configOutputTamper.outputs.checkConfig.sha256 = createHash('sha256').update(forgedConfigOutput).digest('hex');
  await writeFile(checkConfigOutputPath, forgedConfigOutput, 'utf8');
  await writeFile(reportPath, `${JSON.stringify(configOutputTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /check-config output does not contain the scoped successful config and rule result/,
  );

  await writeFile(reportPath, `${JSON.stringify(originalReport, null, 2)}\n`, 'utf8');
  await writeFile(checkConfigOutputPath, successfulConfigOutput(), 'utf8');
  await writeFile(checkRulesOutputPath, 'tampered output', 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.checkRules (?:size|hash) mismatch/,
  );

  await writeFile(
    checkRulesOutputPath,
    `stdout:\nChecking ${prometheusRulePaths[0]}\n  SUCCESS: 48 rules found\n\nstderr:\n`,
    'utf8',
  );
  await writeFile(testRulesOutputPath, 'tampered output', 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.testRules (?:size|hash) mismatch/,
  );

  const forgedOutput = 'stdout:\n  FAILED\n\nstderr:\n';
  const semanticOutputTamper = structuredClone(originalReport);
  semanticOutputTamper.outputs.testRules.bytes = Buffer.byteLength(forgedOutput);
  semanticOutputTamper.outputs.testRules.sha256 = createHash('sha256').update(forgedOutput).digest('hex');
  await writeFile(testRulesOutputPath, forgedOutput, 'utf8');
  await writeFile(reportPath, `${JSON.stringify(semanticOutputTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyPrometheusRuleEvidence({ repositoryRoot, evidenceRoot }),
    /test-rules output does not contain a successful rule test result/,
  );
});
