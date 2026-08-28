import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildServerRecoveryEvidenceReport,
  serverRecoveryLimitations,
  serverRecoveryScenarios,
  verifyServerRecoveryEvidence,
  writeServerRecoveryEvidenceChecksums,
} from '../../scripts/lib/server-recovery-evidence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const fixtureParent = path.join(repositoryRoot, '.temp', 'recovery', '.test-fixtures');
const fixtureRoots = [];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function describeRepositoryFile(filePath) {
  const content = readFileSync(filePath);
  return { path: relativePath(filePath), bytes: content.length, sha256: sha256(content) };
}

function describeArtifact(filePath, evidenceRoot) {
  const content = readFileSync(filePath);
  return {
    path: path.relative(evidenceRoot, filePath).split(path.sep).join('/'),
    bytes: content.length,
    sha256: sha256(content),
  };
}

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function goPlatform() {
  return process.platform === 'win32' ? 'windows' : process.platform;
}

function goArchitecture() {
  return ({ x64: 'amd64', ia32: '386' })[process.arch] ?? process.arch;
}

function passedOutput(scenario) {
  return [
    ...scenario.tests.flatMap((name) => [`=== RUN   ${name}`, `--- PASS: ${name} (0.00s)`]),
    'PASS',
    '',
  ].join('\n');
}

function failedOutput(scenario) {
  return `=== RUN   ${scenario.tests[0]}\n--- FAIL: ${scenario.tests[0]} (0.00s)\nFAIL\n`;
}

function createEvidence({ failedScenario = -1 } = {}) {
  mkdirSync(fixtureParent, { recursive: true });
  const evidenceRoot = mkdtempSync(path.join(fixtureParent, 'server-recovery-'));
  fixtureRoots.push(evidenceRoot);
  const scenarios = serverRecoveryScenarios.map((scenario, index) => {
    const failed = index === failedScenario;
    const stdout = failed ? failedOutput(scenario) : passedOutput(scenario);
    const stderr = '';
    const stdoutPath = path.join(evidenceRoot, `${scenario.id}.stdout.txt`);
    const stderrPath = path.join(evidenceRoot, `${scenario.id}.stderr.txt`);
    writeFileSync(stdoutPath, stdout, 'utf8');
    writeFileSync(stderrPath, stderr, 'utf8');
    return {
      id: scenario.id,
      scope: 'local_contract',
      package: scenario.package,
      tests: [...scenario.tests],
      startedAt: `2026-08-28T00:00:0${index + 1}.000Z`,
      durationMs: 10,
      status: failed ? 'failed' : 'passed',
      exitCode: failed ? 1 : 0,
      signal: null,
      spawnErrorCode: null,
      stdout: describeRepositoryFile(stdoutPath),
      stderr: describeRepositoryFile(stderrPath),
    };
  });
  const failed = failedScenario >= 0;
  const summary = {
    schemaVersion: 1,
    generatedAt: '2026-08-28T00:00:10.000Z',
    scope: 'local_contract_only',
    status: failed ? 'failed' : 'passed',
    repository: { gitCommit: gitCommit() },
    toolchain: { go: `go version go1.25.13 ${goPlatform()}/${goArchitecture()}` },
    scenarios,
    limitations: [...serverRecoveryLimitations],
  };
  writeFileSync(path.join(evidenceRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const report = buildServerRecoveryEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    execution: {
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:11.000Z',
      exitCode: failed ? 1 : 0,
      signal: null,
      spawnErrorCode: null,
    },
  });
  writeFileSync(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeServerRecoveryEvidenceChecksums(evidenceRoot);
  return evidenceRoot;
}

function readJSON(evidenceRoot, name) {
  return JSON.parse(readFileSync(path.join(evidenceRoot, name), 'utf8'));
}

function writeJSON(evidenceRoot, name, value) {
  writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function refreshSummaryReference(evidenceRoot, report) {
  report.summary = describeArtifact(path.join(evidenceRoot, 'summary.json'), evidenceRoot);
}

function refreshRawReference(evidenceRoot, summary, report, scenarioIndex, stream) {
  const scenario = serverRecoveryScenarios[scenarioIndex];
  const filePath = path.join(evidenceRoot, `${scenario.id}.${stream}.txt`);
  summary.scenarios[scenarioIndex][stream] = describeRepositoryFile(filePath);
  report.rawOutputs[scenarioIndex][stream] = describeArtifact(filePath, evidenceRoot);
}

test.after(() => {
  for (const fixtureRoot of fixtureRoots) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('server recovery evidence verifies the complete successful four-scenario bundle', () => {
  const evidenceRoot = createEvidence();
  const verified = verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'passed');
  assert.equal(verified.summary.scenarios.length, 4);
  assert.equal(verified.artifactPaths.length, 11);
});

test('server recovery evidence preserves and verifies a complete failed matrix', () => {
  const evidenceRoot = createEvidence({ failedScenario: 1 });
  const verified = verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot });
  assert.equal(verified.report.status, 'failed');
  assert.equal(verified.summary.scenarios[1].status, 'failed');
  assert.equal(verified.artifactPaths.length, 11);
});

test('server recovery evidence rejects schema, scope, command, status, and source tampering', async (t) => {
  const cases = [
    ['schema', (report) => { report.schemaVersion = 2; }, /schemaVersion must equal 1/],
    ['scope', (report) => { report.scope = 'target_recovery'; }, /scope must equal local_server_recovery_evidence/],
    ['command', (report) => { report.command = ['yarn', 'test:server']; }, /command must match the fixed contract/],
    ['status', (report) => { report.status = 'failed'; }, /status must equal summary.status/],
    ['contract', (report) => { report.contract.scenarios[0].tests.pop(); }, /fixed four-scenario matrix/],
    ['source', (report) => { report.source.evidenceVerifier.sha256 = '0'.repeat(64); }, /source does not match/],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const evidenceRoot = createEvidence();
      const report = readJSON(evidenceRoot, 'report.json');
      mutate(report);
      writeJSON(evidenceRoot, 'report.json', report);
      writeServerRecoveryEvidenceChecksums(evidenceRoot);
      assert.throws(() => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }), expected);
    });
  }
});

test('server recovery evidence rejects summary and execution semantic tampering', async (t) => {
  await t.test('summary scope', () => {
    const evidenceRoot = createEvidence();
    const summary = readJSON(evidenceRoot, 'summary.json');
    const report = readJSON(evidenceRoot, 'report.json');
    summary.scope = 'target_contract';
    writeJSON(evidenceRoot, 'summary.json', summary);
    refreshSummaryReference(evidenceRoot, report);
    writeJSON(evidenceRoot, 'report.json', report);
    writeServerRecoveryEvidenceChecksums(evidenceRoot);
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /summary.scope must equal local_contract_only/,
    );
  });

  await t.test('selected tests', () => {
    const evidenceRoot = createEvidence();
    const summary = readJSON(evidenceRoot, 'summary.json');
    const report = readJSON(evidenceRoot, 'report.json');
    summary.scenarios[0].tests.pop();
    writeJSON(evidenceRoot, 'summary.json', summary);
    refreshSummaryReference(evidenceRoot, report);
    writeJSON(evidenceRoot, 'report.json', report);
    writeServerRecoveryEvidenceChecksums(evidenceRoot);
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /summary.scenarios\[0\]\.tests must match the fixed contract/,
    );
  });

  await t.test('outer execution window', () => {
    const evidenceRoot = createEvidence();
    const report = readJSON(evidenceRoot, 'report.json');
    report.execution.startedAt = '2026-08-28T00:00:09.000Z';
    writeJSON(evidenceRoot, 'report.json', report);
    writeServerRecoveryEvidenceChecksums(evidenceRoot);
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /must stay inside the outer execution window/,
    );
  });

  await t.test('unsafe raw path', () => {
    const evidenceRoot = createEvidence();
    const summary = readJSON(evidenceRoot, 'summary.json');
    const report = readJSON(evidenceRoot, 'report.json');
    summary.scenarios[0].stdout.path = '../outside.txt';
    writeJSON(evidenceRoot, 'summary.json', summary);
    refreshSummaryReference(evidenceRoot, report);
    writeJSON(evidenceRoot, 'report.json', report);
    writeServerRecoveryEvidenceChecksums(evidenceRoot);
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /stdout.path must equal/,
    );
  });
});

test('server recovery evidence rejects raw-output, checksum, and artifact tampering', async (t) => {
  await t.test('raw Go semantics with recomputed hashes', () => {
    const evidenceRoot = createEvidence();
    const scenario = serverRecoveryScenarios[0];
    const outputPath = path.join(evidenceRoot, `${scenario.id}.stdout.txt`);
    writeFileSync(outputPath, 'PASS\n', 'utf8');
    const summary = readJSON(evidenceRoot, 'summary.json');
    const report = readJSON(evidenceRoot, 'report.json');
    refreshRawReference(evidenceRoot, summary, report, 0, 'stdout');
    writeJSON(evidenceRoot, 'summary.json', summary);
    refreshSummaryReference(evidenceRoot, report);
    writeJSON(evidenceRoot, 'report.json', report);
    writeServerRecoveryEvidenceChecksums(evidenceRoot);
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /missing the passed marker/,
    );
  });

  await t.test('checksum', () => {
    const evidenceRoot = createEvidence();
    writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  report.json\n`, 'utf8');
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /exact ordered artifact set/,
    );
  });

  await t.test('missing raw artifact', () => {
    const evidenceRoot = createEvidence();
    unlinkSync(path.join(evidenceRoot, `${serverRecoveryScenarios[3].id}.stderr.txt`));
    assert.throws(
      () => verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot }),
      /stderr is missing/,
    );
  });
});
