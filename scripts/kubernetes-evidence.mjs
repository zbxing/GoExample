import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildKubernetesEvidenceReport,
  kubernetesValidationFixture,
  verifyKubernetesEvidence,
} from './lib/kubernetes-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'kubernetes-manifest');
const rendererPath = path.join(repositoryRoot, 'scripts', 'kubernetes-manifest.mjs');
const maximumCommandOutput = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(`Kubernetes evidence: ${message}`);
}

function capturedOutput(result) {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function commandResult(args) {
  const result = spawnSync(process.execPath, [rendererPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: maximumCommandOutput,
  });
  return {
    status: Number.isSafeInteger(result.status) ? result.status : 1,
    stdout: `${result.stdout ?? ''}`,
    stderr: `${result.stderr ?? result.error?.message ?? ''}`,
  };
}

function run() {
  rmSync(evidenceRoot, { recursive: true, force: true });
  mkdirSync(evidenceRoot, { recursive: true });
  const renderedManifestPath = path.join(evidenceRoot, 'goexample-api.json');
  const checkOutputPath = path.join(evidenceRoot, 'check-output.txt');
  const renderOutputPath = path.join(evidenceRoot, 'render-output.txt');
  const reportPath = path.join(evidenceRoot, 'report.json');
  const startedAt = new Date().toISOString();

  const check = commandResult(['check']);
  writeFileSync(checkOutputPath, capturedOutput(check), 'utf8');
  const render = check.status === 0
    ? commandResult([
        'render',
        '--namespace',
        kubernetesValidationFixture.namespace,
        '--image',
        kubernetesValidationFixture.image,
        '--allowed-origin',
        kubernetesValidationFixture.allowedOrigin,
        '--oidc-issuer',
        kubernetesValidationFixture.oidcIssuer,
        '--oidc-audience',
        kubernetesValidationFixture.oidcAudience,
        '--oidc-jwks-url',
        kubernetesValidationFixture.oidcJWKSURL,
        '--secret-revision',
        kubernetesValidationFixture.secretRevision,
        '--output',
        path.relative(repositoryRoot, renderedManifestPath),
      ])
    : { status: 1, stdout: '', stderr: 'render skipped because template validation failed\n' };
  writeFileSync(renderOutputPath, capturedOutput(render), 'utf8');

  const report = buildKubernetesEvidenceReport({
    repositoryRoot,
    evidenceRoot,
    renderedManifestPath,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt,
    endedAt: new Date().toISOString(),
    checkExitCode: check.status,
    renderExitCode: render.status,
    checkOutputPath,
    renderOutputPath,
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (check.status !== 0 || render.status !== 0 || !existsSync(renderedManifestPath)) {
    process.stderr.write(readFileSync(checkOutputPath, 'utf8'));
    process.stderr.write(readFileSync(renderOutputPath, 'utf8'));
    fail(`validation failed; evidence is available at ${path.relative(repositoryRoot, evidenceRoot)}`);
  }
  const verified = verifyKubernetesEvidence({ repositoryRoot, evidenceRoot });
  console.log(`Kubernetes evidence passed: ${verified.report.outputs.manifest.path}`);
  console.log(`Kubernetes evidence report: ${path.relative(repositoryRoot, reportPath)}`);
}

function main() {
  const args = process.argv.slice(2);
  const task = args.shift() ?? 'run';
  if (args.length > 0 || !['run', 'verify'].includes(task)) {
    fail('task must be run or verify with no additional arguments');
  }
  if (task === 'verify') {
    const verified = verifyKubernetesEvidence({ repositoryRoot, evidenceRoot });
    console.log(`Kubernetes evidence verified: ${verified.report.outputs.manifest.path}`);
    return;
  }
  run();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
