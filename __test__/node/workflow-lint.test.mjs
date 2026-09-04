import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  actionlintModule,
  actionlintVersion,
  buildWorkflowLintReport,
  collectWorkflowLintScope,
  excludedWorkflowPaths,
  verifyWorkflowLintEvidence,
} from '../../scripts/lib/workflow-lint.mjs';
import {
  isolatedGoToolchainEnvironment,
  selectRepositoryToolCommand,
} from '../../scripts/lib/go-toolchain-environment.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp', 'workflow-lint-tests');

test('isolated Go toolchain environments remove every GOROOT spelling without mutating inputs', () => {
  const environment = {
    GOROOT: 'inherited-root',
    GoRoOt: 'alternate-inherited-root',
    GO_BINARY: 'pinned-go',
    KEEP: 'inherited-value',
  };
  const overrides = {
    gOrOoT: 'override-root',
    KEEP: 'override-value',
    GOCACHE: 'bounded-cache',
  };

  const isolated = isolatedGoToolchainEnvironment(environment, overrides);

  assert.deepEqual(
    Object.keys(isolated).filter((name) => name.toLowerCase() === 'goroot'),
    [],
  );
  assert.deepEqual(isolated, {
    GO_BINARY: 'pinned-go',
    KEEP: 'override-value',
    GOCACHE: 'bounded-cache',
  });
  assert.equal(environment.GOROOT, 'inherited-root');
  assert.equal(environment.GoRoOt, 'alternate-inherited-root');
  assert.equal(environment.KEEP, 'inherited-value');
  assert.equal(overrides.gOrOoT, 'override-root');
});

test('repository tool selection preserves an explicit command without probing repository candidates', () => {
  const repositoryCandidates = Object.freeze(['missing-repository-go']);
  const selection = selectRepositoryToolCommand({
    configuredCommand: '  caller-go  ',
    repositoryCandidates,
    fallbackCommand: 'go',
  });

  assert.deepEqual(selection, { command: 'caller-go', repositoryManaged: false });
  assert.deepEqual(repositoryCandidates, ['missing-repository-go']);
});

test('repository tool selection uses existing repository candidates before the PATH fallback', async (t) => {
  await mkdir(tempRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(tempRoot, 'go-selection-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const missingCandidate = path.join(fixtureRoot, 'missing-go');
  const repositoryCandidate = path.join(fixtureRoot, 'repository-go');
  await writeFile(repositoryCandidate, 'tool fixture', 'utf8');
  const repositoryCandidates = [missingCandidate, repositoryCandidate];

  assert.deepEqual(
    selectRepositoryToolCommand({
      configuredCommand: '',
      repositoryCandidates,
      fallbackCommand: 'go',
    }),
    { command: repositoryCandidate, repositoryManaged: true },
  );
  assert.deepEqual(
    selectRepositoryToolCommand({
      configuredCommand: '   ',
      repositoryCandidates: [missingCandidate],
      fallbackCommand: 'go',
    }),
    { command: 'go', repositoryManaged: false },
  );
  assert.deepEqual(repositoryCandidates, [missingCandidate, repositoryCandidate]);
});

async function createEvidence(t) {
  await mkdir(tempRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(tempRoot, 'evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const binaryPath = path.join(evidenceRoot, process.platform === 'win32' ? 'actionlint.exe' : 'actionlint');
  const buildOutputPath = path.join(evidenceRoot, 'build-output.txt');
  const versionOutputPath = path.join(evidenceRoot, 'version-output.txt');
  const lintOutputPath = path.join(evidenceRoot, 'lint-output.txt');
  await writeFile(binaryPath, 'bounded actionlint fixture', 'utf8');
  await writeFile(buildOutputPath, 'stdout:\n\nstderr:\n', 'utf8');
  await writeFile(
    versionOutputPath,
    `stdout:\n${actionlintVersion}\nbuilt from source\nbuilt with go1.25.13 compiler for ${process.platform}/${process.arch}\n\nstderr:\n`,
    'utf8',
  );
  await writeFile(lintOutputPath, 'stdout:\n\nstderr:\n', 'utf8');
  const report = buildWorkflowLintReport({
    repositoryRoot,
    evidenceRoot,
    binaryPath,
    goVersion: 'go1.25.13',
    platform: `${process.platform}/${process.arch}`,
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:01.000Z',
    buildExitCode: 0,
    versionExitCode: 0,
    lintExitCode: 0,
    buildOutputPath,
    versionOutputPath,
    lintOutputPath,
  });
  const reportPath = path.join(evidenceRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { evidenceRoot, reportPath, lintOutputPath };
}

test('workflow lint scope covers every non-MSFront workflow with a pinned tool module', async () => {
  const included = collectWorkflowLintScope(repositoryRoot).map((entry) => entry.path);
  assert.deepEqual(included, [
    '.github/workflows/dependency-review.yml',
    '.github/workflows/go-quality.yml',
    '.github/workflows/go-transport-benchmark.yml',
    '.github/workflows/node-tools-quality.yml',
    '.github/workflows/security-analysis.yml',
    '.github/workflows/supply-chain.yml',
  ]);
  assert.deepEqual(excludedWorkflowPaths, [
    '.github/workflows/msfront-browser.yml',
    '.github/workflows/msfront-quality.yml',
  ]);
  const goMod = await readFile(path.join(repositoryRoot, 'tools', 'actionlint', 'go.mod'), 'utf8');
  assert.match(goMod, /^\s*github\.com\/rhysd\/actionlint v1\.7\.12$/m);
  assert.equal(actionlintModule, 'github.com/rhysd/actionlint/cmd/actionlint');
});

test('workflow lint evidence verifier rejects scope, status, and output tampering', async (t) => {
  const { evidenceRoot, reportPath, lintOutputPath } = await createEvidence(t);
  assert.equal(verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot }).report.execution.lintExitCode, 0);

  const originalReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const scopeTamper = structuredClone(originalReport);
  scopeTamper.scope.included.pop();
  await writeFile(reportPath, `${JSON.stringify(scopeTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot }),
    /scope\.included no longer matches/,
  );

  const statusTamper = structuredClone(originalReport);
  statusTamper.execution.lintExitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(statusTamper, null, 2)}\n`, 'utf8');
  assert.throws(
    () => verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot }),
    /execution\.lintExitCode must be zero/,
  );

  await writeFile(reportPath, `${JSON.stringify(originalReport, null, 2)}\n`, 'utf8');
  await writeFile(lintOutputPath, 'tampered output', 'utf8');
  assert.throws(
    () => verifyWorkflowLintEvidence({ repositoryRoot, evidenceRoot }),
    /outputs\.lint (?:size|hash) mismatch/,
  );
});
