import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  evidenceInputPaths,
  optionalEvidenceInputPaths,
} from '../../scripts/lib/evidence-manifest-contract.mjs';
import {
  maximumCommandDurationMs,
  maximumCommandOutputBytes,
  readBoundedGitCommit,
  readBoundedGoVersion,
  runBoundedCommand,
  summarizeGitStatus,
} from '../../scripts/lib/bounded-command.mjs';
import {
  writeFileAtomicallySync,
  writeFilesWithRollbackSync,
} from '../../scripts/lib/atomic-output.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function runScript(relativePath, args = [], environment = {}) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, relativePath), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function assertEvidenceInput(relativePath) {
  assert.ok(evidenceInputPaths.includes(relativePath), `missing evidence input contract path: ${relativePath}`);
}

test('Go project runner rejects unsafe project selectors', () => {
  const result = runScript('scripts/go-project.mjs', ['test'], { GO_PROJECT: '../Framework' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GO_PROJECT must contain only/);
});

test('repository-managed Go entrypoints isolate inherited GOROOT through the shared contract', async () => {
  const entrypoints = [
    'scripts/audit-chain-evidence.mjs',
    'scripts/authorization-evidence.mjs',
    'scripts/oidc-browser-evidence.mjs',
    'scripts/sdk-consumer-evidence.mjs',
    'scripts/server-recovery-drill.mjs',
  ];
  const [projectRunner, environmentRunner, ...strictRunners] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'environment.mjs'), 'utf8'),
    ...entrypoints.map((relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8')),
  ]);

  assert.match(projectRunner, /selectRepositoryToolCommand\(\{/);
  assert.match(projectRunner, /goSelection\.repositoryManaged\s*\? isolatedGoToolchainEnvironment\(process\.env, goEnvironmentOverrides\)/);
  assert.match(environmentRunner, /repositoryManaged: true/);
  assert.match(environmentRunner, /go\.repositoryManaged\s*\? isolatedGoToolchainEnvironment\(process\.env, \{ GOWORK: 'off' \}\)/);
  assert.match(environmentRunner, /environmentYarnInstallTimeoutMs = 10 \* 60_000/);
  assert.match(environmentRunner, /environmentGoDependencyTimeoutMs = 3 \* 60_000/);
  assert.match(environmentRunner, /environmentArchiveExtractTimeoutMs = 2 \* 60_000/);
  assert.match(environmentRunner, /environmentGoDownloadTimeoutMs = 2 \* 60_000/);
  assert.match(environmentRunner, /import \{ runEnvironmentFetch \} from '\.\/lib\/environment-fetch\.mjs'/);
  assert.equal((environmentRunner.match(/await runEnvironmentFetch\(/g) ?? []).length, 2);
  assert.match(environmentRunner, /'https:\/\/go\.dev\/dl\/\?mode=json&include=all'/);
  assert.match(environmentRunner, /archive\.url/);
  assert.match(environmentRunner, /timeout: timeoutMs/);
  assert.match(environmentRunner, /killSignal: 'SIGTERM'/);
  assert.match(environmentRunner, /windowsHide: options\.windowsHide/);
  assert.match(environmentRunner, /runYarn\(\['install', '--frozen-lockfile', '--non-interactive'\], repositoryRoot, \{[\s\S]*timeoutMs: environmentYarnInstallTimeoutMs/);
  assert.match(environmentRunner, /timeoutMs: environmentGoDependencyTimeoutMs/);
  assert.match(environmentRunner, /timeoutMs: environmentArchiveExtractTimeoutMs/);
  assert.match(environmentRunner, /yarnTreeIsCurrent\(frontRoot\)/);
  for (const [index, runner] of strictRunners.entries()) {
    assert.match(runner, /isolatedGoToolchainEnvironment/);
    assert.match(runner, /from '\.\/lib\/go-toolchain-environment\.mjs'/);
    assert.match(runner, /isolatedGoToolchainEnvironment\(process\.env, \{/);
    assertEvidenceInput(entrypoints[index]);
  }
  assertEvidenceInput('scripts/environment.mjs');
  assertEvidenceInput('docs/待优化/待优化V45.md');
  assertEvidenceInput('docs/待优化/待优化V46.md');
  assertEvidenceInput('docs/待优化/待优化V47.md');
  assertEvidenceInput('docs/待优化/待优化V48.md');
  assertEvidenceInput('docs/待优化/待优化V49.md');
  assertEvidenceInput('docs/待优化/待优化V50.md');
  assertEvidenceInput('docs/待优化/待优化V51.md');
  assertEvidenceInput('docs/待优化/待优化V52.md');
  assertEvidenceInput('docs/待优化/待优化V53.md');
  assertEvidenceInput('docs/待优化/待优化V54.md');
  assertEvidenceInput('docs/待优化/待优化V55.md');
  assertEvidenceInput('docs/待优化/待优化V56.md');
  assertEvidenceInput('docs/待优化/待优化V57.md');
  assertEvidenceInput('docs/待优化/待优化V58.md');
  assertEvidenceInput('docs/待优化/待优化V59.md');
  assertEvidenceInput('docs/待优化/待优化V60.md');
  assertEvidenceInput('docs/待优化/待优化V61.md');
  assertEvidenceInput('docs/待优化/待优化V62.md');
  assertEvidenceInput('docs/待优化/待优化V63.md');
  assertEvidenceInput('docs/待优化/待优化V64.md');
  assertEvidenceInput('docs/待优化/待优化V65.md');
  assertEvidenceInput('docs/待优化/待优化V66.md');
  assertEvidenceInput('docs/待优化/待优化V67.md');
  assertEvidenceInput('docs/待优化/待优化V68.md');
  assertEvidenceInput('docs/待优化/待优化V76.md');
  assertEvidenceInput('docs/待优化/待优化V77.md');
  assertEvidenceInput('docs/待优化/待优化V78.md');
  assertEvidenceInput('docs/待优化/待优化V79.md');
  assertEvidenceInput('docs/待优化/待优化V80.md');
  assertEvidenceInput('docs/待优化/待优化V81.md');
  assertEvidenceInput('docs/待优化/待优化V82.md');
  assertEvidenceInput('docs/待优化/待优化V83.md');
  assertEvidenceInput('scripts/lib/transport-benchmark-stability.mjs');
  assertEvidenceInput('scripts/lib/environment-fetch.mjs');
  assertEvidenceInput('__test__/node/environment-fetch.test.mjs');
});

test('Go tool entrypoints share explicit, repository, and PATH command selection', async () => {
  const entrypoints = [
    'scripts/go-project.mjs',
    'scripts/server-release.mjs',
    'scripts/server-recovery-drill.mjs',
    'scripts/lib/audit-chain-evidence.mjs',
    'scripts/lib/authorization-evidence.mjs',
    'scripts/lib/oidc-browser-evidence.mjs',
    'scripts/lib/sdk-consumer-evidence.mjs',
    'scripts/lib/sdk-release-evidence.mjs',
  ];
  const sources = await Promise.all(
    entrypoints.map((relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8')),
  );

  for (const [index, source] of sources.entries()) {
    assert.match(source, /selectRepositoryToolCommand\(\{/);
    assertEvidenceInput(entrypoints[index]);
  }
  assertEvidenceInput('docs/待优化/待优化V23.md');
});

test('MSFront runner rejects unknown tasks before spawning Yarn', () => {
  const result = runScript('scripts/msfront.mjs', ['unknown-task']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown MSFront task: unknown-task/);
});

test('GitHub workflows pin actions and service images to immutable digests', async () => {
  const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
  const workflowFiles = (await readdir(workflowsDirectory)).filter((fileName) =>
    /\.ya?ml$/i.test(fileName),
  );

  for (const fileName of workflowFiles) {
    const content = await readFile(path.join(workflowsDirectory, fileName), 'utf8');
    const actionReferences = [...content.matchAll(/^\s*uses:\s*[^\s@]+@([^\s#]+)/gm)];
    for (const match of actionReferences) {
      assert.match(match[1], /^[a-f0-9]{40}$/, `${fileName} contains an unpinned action`);
    }

    const serviceImages = [...content.matchAll(/^\s*image:\s*([^\s#]+)/gm)];
    for (const match of serviceImages) {
      assert.match(
        match[1],
        /@sha256:[a-f0-9]{64}$/,
        `${fileName} contains an unpinned service image`,
      );
    }
  }
});

test('non-MSFront workflows use pinned actionlint and archive independently checked evidence', async () => {
  const [workflow, workspacePackage, toolModule, toolSums, runner, verifier, evidenceManifest, evidenceVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'tools', 'actionlint', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, 'tools', 'actionlint', 'go.sum'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'workflow-lint.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'workflow-lint.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  assert.match(workflow, /"\.github\/workflows\/\*\*"/);
  assert.match(workflow, /"!\.github\/workflows\/msfront-\*\.yml"/);
  assert.match(workflow, /yarn workflow:lint/);
  assert.match(workflow, /yarn workflow:lint:verify/);
  assert.match(workflow, /cache-dependency-path:[\s\S]*tools\/actionlint\/go\.sum/);
  assert.match(workflow, /workflow-lint-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workspacePackage, /"workflow:lint": "node scripts\/workflow-lint\.mjs run"/);
  assert.match(workspacePackage, /"workflow:lint:verify": "node scripts\/workflow-lint\.mjs verify"/);
  assert.match(toolModule, /github\.com\/rhysd\/actionlint v1\.7\.12/);
  assert.match(toolModule, /toolchain go1\.25\.13/);
  assert.match(toolSums, /github\.com\/rhysd\/actionlint v1\.7\.12 h1:vQ4GeJN86C0QH\+gTUQcs8McmK62OLT3kmakPMtEWYnY=/);
  assert.match(runner, /'-mod=readonly'/);
  assert.match(runner, /collectWorkflowLintScope/);
  assert.match(runner, /isolatedGoToolchainEnvironment\(process\.env/);
  assert.match(runner, /findGo\(version, goEnvironment\)/);
  assert.match(runner, /\['version'\], \{ cwd: repositoryRoot, env: environment \}/);
  assert.match(verifier, /expectedToolRequirements/);
  assert.match(verifier, /scope\.included no longer matches every non-MSFront workflow/);
  assert.match(evidenceManifest, /verifyWorkflowLintEvidence/);
  assert.match(evidenceVerifier, /workflow lint evidence artifact is missing from the manifest/);
});

test('Prometheus config and rules use pinned promtool with independently checked evidence', async () => {
  const [workflow, workspacePackage, toolModule, toolSums, runner, verifier, prometheusConfig, prometheusIgnore, prometheusRunbook, ruleTests, evidenceManifest, evidenceVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'tools', 'promtool', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, 'tools', 'promtool', 'go.sum'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'prometheus-rules.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'prometheus-rules.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'prometheus.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', '.gitignore'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'tests', 'goexample-slo.test.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  assert.match(workflow, /"support\/deploy\/prometheus\/\*\*"/);
  assert.match(workflow, /yarn prometheus:rules/);
  assert.match(workflow, /yarn prometheus:rules:verify/);
  assert.match(workflow, /prometheus-rules-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workspacePackage, /"prometheus:rules": "node scripts\/prometheus-rules\.mjs run"/);
  assert.match(workspacePackage, /"prometheus:rules:verify": "node scripts\/prometheus-rules\.mjs verify"/);
  assert.match(runner, /\['check', 'config', '--lint=all', '--lint-fatal', \.\.\.prometheusConfigPaths\]/);
  assert.match(runner, /\['check', 'rules', '--lint=all', '--lint-fatal'/);
  assert.match(runner, /\['test', 'rules', \.\.\.prometheusRuleTestPaths\]/);
  assert.match(runner, /promtool-validation-fixture-not-a-production-secret/);
  assert.match(runner, /rmSync\(validationCredentialPath, \{ force: true \}\)/);
  assert.match(runner, /'-mod=readonly', '-trimpath', '-ldflags'/);
  assert.match(runner, /isolatedGoToolchainEnvironment\(process\.env/);
  assert.match(runner, /findGo\(version, goEnvironment\)/);
  assert.match(runner, /\['version'\], \{ cwd: repositoryRoot, env: environment \}/);
  assert.match(verifier, /promtoolVersion = '3\.5\.0'/);
  assert.match(verifier, /prometheusRuleSchemaVersion = 3/);
  assert.match(verifier, /prometheusModuleVersion = 'v0\.305\.0'/);
  assert.match(verifier, /Buffer\.allocUnsafe\(1024 \* 1024\)/);
  assert.match(verifier, /readSync\(descriptor, buffer, 0, buffer\.length, null\)/);
  assert.doesNotMatch(verifier, /hash\.update\(readFileSync\(filePath\)\)/);
  for (const manifestScript of [evidenceManifest, evidenceVerifier]) {
    assert.match(manifestScript, /Buffer\.allocUnsafe\(1024 \* 1024\)/);
    assert.match(manifestScript, /readSync\(descriptor, buffer, 0, buffer\.length, null\)/);
    assert.doesNotMatch(manifestScript, /hash\.update\(readFileSync\(filePath\)\)/);
  }
  assert.match(verifier, /\['buildExitCode', 'checkConfigExitCode', 'checkRulesExitCode', 'endedAt', 'startedAt', 'testRulesExitCode', 'versionExitCode'\]/);
  assert.match(verifier, /\['build', 'checkConfig', 'checkRules', 'testRules', 'version'\]/);
  assert.match(toolModule, /tool github\.com\/prometheus\/prometheus\/cmd\/promtool/);
  assert.match(toolModule, /github\.com\/prometheus\/prometheus v0\.305\.0/);
  assert.match(toolSums, /github\.com\/prometheus\/prometheus v0\.305\.0 h1:UO\/LsM32\/E9yBDtvQj8tN\+WwhbyWKR10lO35vmFLx0U=/);
  assert.match(prometheusConfig, /scrape_interval: 30s/);
  assert.match(prometheusConfig, /scrape_timeout: 10s/);
  assert.match(prometheusConfig, /evaluation_interval: 30s/);
  assert.match(prometheusConfig, /rules\/goexample-slo\.yml/);
  assert.match(prometheusConfig, /metrics_path: \/metrics/);
  assert.match(prometheusConfig, /credentials_file: secrets\/goexample_metrics_token/);
  assert.match(prometheusConfig, /goexample-api:80/);
  assert.doesNotMatch(prometheusConfig, /^\s+credentials:\s+\S+/m);
  assert.equal(prometheusIgnore.trim(), '/secrets/');
  assert.match(prometheusRunbook, /creates a non-secret validation fixture only for the duration of `promtool check config`/);
  assert.match(prometheusRunbook, /full config and referenced-file validation with fatal linting/);
  assert.match(prometheusRunbook, /does not prove that Prometheus or Alertmanager is deployed/);
  assert.match(ruleTests, /group_eval_order:\r?\n\s+- goexample\.sli\r?\n\s+- goexample\.slo\.alerts/);
  assert.match(ruleTests, /GoExampleAvailabilityBurnRateCritical/);
  assert.match(ruleTests, /GoExampleHTTPConnectionSaturation/);
  assert.match(ruleTests, /GoExampleSecurityAuditSinkFailures/);
  assert.match(ruleTests, /GoExampleTraceQueueDrops/);
  for (const alertName of [
    'GoExampleAvailabilityBurnRateWarning',
    'GoExampleLatencySLOViolation',
    'GoExampleTraceExportFailures',
    'GoExampleTraceExportAttemptFailures',
    'GoExampleTraceProcessorSaturation',
    'GoExampleQueueDeliveryDeadLetters',
    'GoExampleQueueSettlementFailures',
    'GoExampleQueueLeaseExtensionFailures',
    'GoExampleAuthenticationRateLimited',
  ]) {
    assert.match(ruleTests, new RegExp(`alertname: ${alertName}`));
  }
  assert.equal(ruleTests.match(/^  - name:/gm)?.length, 10);
  assert.match(evidenceManifest, /verifyPrometheusRuleEvidence/);
  assert.match(evidenceVerifier, /Prometheus rule evidence artifact is missing from the manifest/);
});

test('Kubernetes rendering produces deterministic tamper-checked repository evidence', async () => {
  const [workflow, workspacePackage, runner, verifier, behaviorTest, manifestBehaviorTest, manifestScript, template, runbook, evidenceManifest, evidenceVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'kubernetes-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'kubernetes-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'kubernetes-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'kubernetes-manifest.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'kubernetes-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  assert.match(workflow, /yarn kubernetes:evidence/);
  assert.match(workflow, /yarn kubernetes:evidence:verify/);
  assert.match(workflow, /kubernetes-manifest-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/kubernetes-manifest/);
  assert.match(workspacePackage, /"kubernetes:evidence": "node scripts\/kubernetes-evidence\.mjs run"/);
  assert.match(workspacePackage, /"kubernetes:evidence:verify": "node scripts\/kubernetes-evidence\.mjs verify"/);
  assert.match(workspacePackage, /kubernetes-evidence\.test\.mjs/);
  assert.match(runner, /kubernetesValidationFixture/);
  assert.match(runner, /verifyKubernetesEvidence/);
  assert.match(verifier, /kubernetesEvidenceSchemaVersion = 15/);
  assert.match(verifier, /'0'\.repeat\(64\)/);
  assert.match(verifier, /namespace: 'goexample-validation'/);
  assert.match(verifier, /https:\/\/console\.validation\.invalid/);
  assert.match(verifier, /validation-secret-revision-00000001/);
  assert.match(verifier, /does not prove target ConfigMap or Secret existence, target dynamic values, Secret key inventory/);
  assert.match(verifier, /exact PodSpec object rejects init containers, volumes, DNS or scheduler drift, registry credentials/);
  assert.match(verifier, /exact PodTemplateSpec object rejects unreviewed annotations, finalizers, owner references/);
  assert.match(verifier, /kubernetesDrill remains not_recorded/);
  assert.match(verifier, /rendered manifest does not exactly match the deterministic validated fixture/);
  assert.match(behaviorTest, /semanticTamper/);
  assert.match(behaviorTest, /Deployment replicas|does not exactly match/);
  assert.match(manifestBehaviorTest, /unhealthy pod eviction/);
  assert.match(manifestBehaviorTest, /zone spreading/);
  assert.match(manifestBehaviorTest, /host namespace isolation/);
  assert.match(manifestBehaviorTest, /service link isolation/);
  assert.match(manifestBehaviorTest, /missing config checksum annotation/);
  assert.match(manifestBehaviorTest, /forged config checksum annotation/);
  assert.match(manifestBehaviorTest, /missing secret revision annotation/);
  assert.match(manifestBehaviorTest, /concrete secret revision in template/);
  assert.match(manifestBehaviorTest, /resource namespace drift/);
  assert.match(manifestBehaviorTest, /concrete namespace in template/);
  assert.match(manifestBehaviorTest, /pod identity/);
  assert.match(manifestBehaviorTest, /pod security sysctl/);
  assert.match(manifestBehaviorTest, /startup probe timing/);
  assert.match(manifestBehaviorTest, /readiness probe timing/);
  assert.match(manifestBehaviorTest, /liveness probe timing/);
  assert.match(manifestBehaviorTest, /ephemeral storage request/);
  assert.match(manifestBehaviorTest, /privileged container/);
  assert.match(manifestBehaviorTest, /non-default proc mount/);
  assert.match(manifestBehaviorTest, /container capability re-add/);
  assert.match(manifestBehaviorTest, /container identity override/);
  assert.match(manifestBehaviorTest, /container image pull policy drift/);
  assert.match(manifestBehaviorTest, /container command override/);
  assert.match(manifestBehaviorTest, /container lifecycle hook/);
  assert.match(manifestBehaviorTest, /interactive container standard input/);
  assert.match(manifestBehaviorTest, /pod init container injection/);
  assert.match(manifestBehaviorTest, /pod host path volume injection/);
  assert.match(manifestBehaviorTest, /pod DNS policy drift/);
  assert.match(manifestBehaviorTest, /pod registry credential injection/);
  assert.match(manifestBehaviorTest, /pod template sidecar injection annotation/);
  assert.match(manifestBehaviorTest, /pod template finalizer injection/);
  assert.match(manifestBehaviorTest, /pod template owner reference injection/);
  assert.match(manifestBehaviorTest, /missing egress policy/);
  assert.match(manifestBehaviorTest, /extra permissive network policy/);
  assert.match(manifestBehaviorTest, /ingress source broadening/);
  assert.match(manifestBehaviorTest, /dns namespace broadening/);
  assert.match(manifestBehaviorTest, /egress port broadening/);
  assert.match(manifestBehaviorTest, /rollout guardrails/);
  assert.match(manifestBehaviorTest, /autoscaler replica bounds/);
  assert.match(manifestBehaviorTest, /autoscaler utilization targets/);
  assert.match(manifestBehaviorTest, /autoscaler scale-up rate/);
  assert.match(manifestBehaviorTest, /autoscaler scale-down rate/);
  assert.match(manifestBehaviorTest, /optional runtime secret/);
  assert.match(manifestBehaviorTest, /extra environment source/);
  assert.match(manifestBehaviorTest, /environment source precedence/);
  assert.match(manifestBehaviorTest, /inline environment override/);
  assert.match(manifestBehaviorTest, /extra config environment key/);
  assert.match(manifestBehaviorTest, /missing config environment key/);
  assert.match(manifestBehaviorTest, /fixed config environment value drift/);
  assert.match(manifestBehaviorTest, /extra namespaced role/);
  assert.match(manifestBehaviorTest, /extra deployment selector label/);
  assert.match(manifestBehaviorTest, /deployment selector match expression/);
  assert.match(manifestBehaviorTest, /mismatched pod template label/);
  assert.match(manifestBehaviorTest, /extra service selector label/);
  assert.match(manifestBehaviorTest, /extra container port/);
  assert.match(manifestBehaviorTest, /container port protocol drift/);
  assert.match(manifestBehaviorTest, /service external IP exposure/);
  assert.match(manifestBehaviorTest, /service port protocol drift/);
  assert.match(manifestBehaviorTest, /extra disruption selector label/);
  assert.match(manifestBehaviorTest, /disruption selector match expression/);
  assert.match(manifestBehaviorTest, /extra topology selector label/);
  assert.match(manifestBehaviorTest, /topology selector match expression/);
  assert.match(manifestScript, /pod\?\.enableServiceLinks !== false/);
  assert.match(manifestScript, /pod\?\.hostNetwork !== false/);
  assert.match(manifestScript, /pod\?\.hostPID !== false/);
  assert.match(manifestScript, /pod\?\.hostIPC !== false/);
  assert.match(manifestScript, /pod\?\.shareProcessNamespace !== false/);
  assert.match(manifestScript, /const podSecurityContext = Object\.freeze\(\{/);
  assert.match(manifestScript, /const containerSecurityContext = Object\.freeze\(\{/);
  assert.match(manifestScript, /capabilities: Object\.freeze\(\{ drop: Object\.freeze\(\['ALL'\]\) \}\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(pod\?\.securityContext, podSecurityContext\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(container\.securityContext, containerSecurityContext\)/);
  assert.match(manifestScript, /const containerPorts = Object\.freeze\(\[/);
  assert.match(manifestScript, /const serviceSpec = Object\.freeze\(\{/);
  assert.match(manifestScript, /isDeepStrictEqual\(container\.ports, containerPorts\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(service\.spec, serviceSpec\)/);
  assert.match(manifestScript, /const probeDefinitions = Object\.freeze\(\{/);
  assert.match(manifestScript, /httpGet: Object\.freeze\(\{ path: '\/startupz', port: 'http', scheme: 'HTTP' \}\)/);
  assert.match(manifestScript, /httpGet: Object\.freeze\(\{ path: '\/readyz', port: 'http', scheme: 'HTTP' \}\)/);
  assert.match(manifestScript, /httpGet: Object\.freeze\(\{ path: '\/livez', port: 'http', scheme: 'HTTP' \}\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(container\[name\], expected\)/);
  assert.match(manifestScript, /function containerDefinition\(image\)/);
  assert.match(manifestScript, /imagePullPolicy: 'IfNotPresent'/);
  assert.match(manifestScript, /isDeepStrictEqual\(container, containerDefinition\(container\.image\)\)/);
  assert.match(manifestScript, /const topologySpreadConstraints = Object\.freeze\(\[/);
  assert.match(manifestScript, /function podSpecDefinition\(image\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(pod, podSpecDefinition\(container\.image\)\)/);
  assert.match(manifestScript, /function podTemplateDefinition\(image, configChecksum, secretRevision\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(deployment\.spec\?\.template, podTemplateDefinition\(container\.image, configChecksum, secretRevision\)\)/);
  assert.match(manifestScript, /'ephemeral-storage': '64Mi'/);
  assert.match(manifestScript, /'ephemeral-storage': '256Mi'/);
  assert.match(manifestScript, /const environmentSources = Object\.freeze\(\[/);
  assert.match(manifestScript, /const environmentConfigKeys = Object\.freeze\(\[/);
  assert.match(manifestScript, /const fixedEnvironmentConfigValues = Object\.freeze\(\{/);
  assert.match(manifestScript, /const resourceIdentities = Object\.freeze\(\[/);
  assert.match(manifestScript, /const workloadLabels = Object\.freeze\(\{/);
  assert.match(manifestScript, /const workloadSelector = Object\.freeze\(\{ matchLabels: workloadLabels \}\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(actual, workloadLabels\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(actual, workloadSelector\)/);
  assert.match(manifestScript, /configMapRef: Object\.freeze\(\{ name: 'goexample-api-config', optional: false \}\)/);
  assert.match(manifestScript, /secretRef: Object\.freeze\(\{ name: 'goexample-api-runtime', optional: false \}\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(container\.envFrom, environmentSources\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(Object\.keys\(config\.data \?\? \{\}\)\.sort\(\), environmentConfigKeys\)/);
  assert.match(manifestScript, /Object\.entries\(fixedEnvironmentConfigValues\)\.some\(\(\[key, value\]\) => config\.data\[key\] !== value\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(\[\.\.\.identities\]\.sort\(\), resourceIdentities\)/);
  assert.match(manifestScript, /container\.env !== undefined/);
  assert.match(manifestScript, /networkPolicies\.length !== 2/);
  assert.match(manifestScript, /isDeepStrictEqual\(ingressNetworkPolicy\.spec, ingressNetworkPolicySpec\)/);
  assert.match(manifestScript, /isDeepStrictEqual\(egressNetworkPolicy\.spec, egressNetworkPolicySpec\)/);
  assert.match(manifestScript, /'kubernetes\.io\/metadata\.name': 'kube-system'/);
  assert.match(manifestScript, /\{ protocol: 'TCP', port: 6380 \}/);
  assert.match(manifestScript, /topologySpreadConstraints\?\.length !== 2/);
  assert.match(manifestScript, /topologyKey === 'kubernetes\.io\/hostname'/);
  assert.match(manifestScript, /topologyKey === 'topology\.kubernetes\.io\/zone'/);
  assert.match(manifestScript, /unhealthyPodEvictionPolicy !== 'AlwaysAllow'/);
  assert.match(manifestScript, /revisionHistoryLimit !== 5/);
  assert.match(manifestScript, /progressDeadlineSeconds !== 600/);
  assert.match(manifestScript, /autoscaler\.spec\?\.minReplicas !== 3/);
  assert.match(manifestScript, /isUtilizationMetric\(metric, 'cpu', 70\)/);
  assert.match(manifestScript, /isUtilizationMetric\(metric, 'memory', 75\)/);
  assert.match(manifestScript, /scaleUp\?\.selectPolicy !== 'Max'/);
  assert.match(manifestScript, /scaleDown\?\.selectPolicy !== 'Min'/);
  assert.match(manifestScript, /createHash\('sha256'\)/);
  assert.match(manifestScript, /configDataChecksum\(renderedConfig\.data\)/);
  assert.match(manifestScript, /configChecksum !== configDataChecksum\(config\.data\)/);
  assert.match(manifestScript, /validateSecretRevision\(secretRevision, false\)/);
  assert.match(manifestScript, /'--secret-revision', 'secretRevision'/);
  assert.match(manifestScript, /validateNamespace\(namespace, false\)/);
  assert.match(manifestScript, /'--namespace', 'namespace'/);
  assert.match(manifestScript, /all resources must use exactly one explicit namespace/);
  assert.match(template, /"enableServiceLinks": false/);
  assert.match(template, /"hostNetwork": false/);
  assert.match(template, /"hostPID": false/);
  assert.match(template, /"hostIPC": false/);
  assert.match(template, /"shareProcessNamespace": false/);
  assert.match(template, /"ephemeral-storage": "64Mi"/);
  assert.match(template, /"ephemeral-storage": "256Mi"/);
  assert.match(template, /"privileged": false/);
  assert.match(template, /"procMount": "Default"/);
  assert.equal((template.match(/"optional": false/g) ?? []).length, 2);
  assert.match(runbook, /precisely contain the following 41 reviewed non-sensitive environment keys|精确包含以下 41 个已复核的非敏感环境键/);
  assert.match(runbook, /缺少或增加任何键都会使检查失败/);
  assert.match(runbook, /其余 37 项必须精确保持模板中的生产基线值/);
  assert.match(runbook, /`HTTP_REQUEST_TIMEOUT=8s`/);
  assert.match(runbook, /清单资源身份也必须精确等于已复核的 8 项集合/);
  assert.match(runbook, /额外 namespaced 资源都会使检查失败/);
  assert.match(runbook, /Deployment selector、Pod template labels、Service selector、PDB selector/);
  assert.match(runbook, /selector 对象只能包含这两个 `matchLabels`，不得增加 `matchExpressions`/);
  assert.match(template, /"name": "goexample-api-egress"/);
  assert.match(template, /"kubernetes\.io\/metadata\.name": "kube-system"/);
  assert.match(template, /"protocol": "UDP",\s*"port": 53/);
  assert.match(template, /"protocol": "TCP",\s*"port": 6380/);
  assert.match(template, /"unhealthyPodEvictionPolicy": "AlwaysAllow"/);
  assert.match(template, /"revisionHistoryLimit": 5/);
  assert.match(template, /"progressDeadlineSeconds": 600/);
  assert.match(template, /"goexample\.io\/config-sha256": "__GOEXAMPLE_CONFIG_SHA256__"/);
  assert.match(template, /"goexample\.io\/secret-revision": "__GOEXAMPLE_SECRET_REVISION__"/);
  assert.match(template, /"namespace": "__GOEXAMPLE_NAMESPACE__"/);
  assert.match(template, /"scaleDown":\s*\{[\s\S]*?"selectPolicy": "Min"[\s\S]*?"type": "Pods"[\s\S]*?"value": 1/);
  assert.match(runbook, /yarn kubernetes:evidence/);
  assert.match(runbook, /yarn kubernetes:evidence:verify/);
  assert.match(runbook, /ephemeral-storage/);
  assert.match(runbook, /UID\/GID\/fsGroup/);
  assert.match(runbook, /完整 `securityContext` 对象执行结构化深比较/);
  assert.match(runbook, /拒绝额外 sysctl、容器身份覆盖、capability re-add/);
  assert.match(runbook, /三个探针的完整对象执行结构化深比较/);
  assert.match(runbook, /不允许额外 `host`、`httpHeaders`、`initialDelaySeconds`、单探针 `terminationGracePeriodSeconds`/);
  assert.match(runbook, /Pod template 的完整 `spec` 也必须精确匹配受检基线/);
  assert.match(runbook, /拒绝额外 init\/ephemeral container、volume\/hostPath、`imagePullSecrets`/);
  assert.match(runbook, /完整 `PodTemplateSpec` 同样必须精确匹配受检基线/);
  assert.match(runbook, /拒绝 sidecar\/agent 注入 annotation、finalizer、owner reference/);
  assert.match(runbook, /schema v15 报告/);
  assert.match(runbook, /API 容器端口列表必须精确且只包含具名 `http` 的 TCP 3001/);
  assert.match(runbook, /拒绝额外容器端口、TCP\/UDP 协议漂移、`externalIPs`/);
  assert.match(runbook, /固定顺序通过 `envFrom` 加载 `goexample-api-config` ConfigMap，再加载 `goexample-api-runtime` Secret/);
  assert.match(runbook, /不得设置 prefix、追加其他来源或定义 inline `env` 覆盖/);
  assert.match(runbook, /Secret 会覆盖 ConfigMap 的同名 key/);
  assert.match(runbook, /goexample-api-egress/);
  assert.match(runbook, /TCP 443\/6380/);
  assert.match(runbook, /NetworkPolicy 是可加和的/);
  assert.match(runbook, /ConfigMap `data`，将其规范 SHA-256/);
  assert.match(runbook, /--secret-revision/);
  assert.match(runbook, /--namespace/);
  assert.match(runbook, /拒绝 `default`、`kube-system`/);
  assert.match(runbook, /不读取、散列或归档 Secret 内容/);
  assert.match(runbook, /不代表目标 Kubernetes API admission/);
  assert.match(evidenceManifest, /verifyKubernetesEvidence/);
  assert.match(evidenceVerifier, /Kubernetes evidence artifact is missing from the manifest/);
});

test('OpenAPI compatibility gate compares pull requests with their base commit', async () => {
  const [workflow, script, compatibilityLibrary, policy, migration, routes, app, routeTests, openapiContract, openapiDocument, packageDocument] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'openapi-compat.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'openapi-compat.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'compatibility-policy.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'health-endpoint-migration.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_health.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'openapi_contract_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /yarn openapi:compat --base-ref/);
  assert.match(script, /createProjectContractGitRunner/);
  assert.match(script, /projectGitRunner\(\['show'/);
  assert.doesNotMatch(script, /spawnSync/);
  assert.match(compatibilityLibrary, /parameter serialization changed/);
  assert.match(compatibilityLibrary, /nullable changed from/);
  assert.match(compatibilityLibrary, /discriminator changed and requires explicit versioning review/);
  assert.match(compatibilityLibrary, /added response media type/);
  assert.match(compatibilityLibrary, /removed its schema/);
  assert.match(policy, /90 天兼容窗口/);
  assert.match(policy, /参数序列化/);
  assert.match(policy, /nullable/);
  assert.match(policy, /discriminator/);
  assert.match(policy, /响应新增 media type/);
  assert.match(policy, /184 天迁移窗口/);
  assert.match(migration, /184-day migration window/);
  assert.match(routes, /healthDeprecation\s*=\s*"@1787184000"/);
  assert.match(routes, /healthSunset\s*=\s*"Sat, 20 Feb 2027 00:00:00 GMT"/);
  assert.match(routes, /rel=\\"successor-version\\"/);
  assert.match(app, /deprecationHeader[\s\S]*sunsetHeader[\s\S]*linkHeader/);
  assert.match(routeTests, /TestCompatibilityHealthRoutesAdvertiseDeprecation/);
  assert.match(routeTests, /TestCompatibilityReadinessKeepsDeprecationHeadersWhenUnavailable/);
  assert.match(openapiContract, /assertDeprecatedResponses/);
  const openapi = JSON.parse(openapiDocument);
  for (const pathName of ['/api/health', '/api/health/ready', '/api/health/startup']) {
    const operation = openapi.paths[pathName].get;
    assert.equal(operation.deprecated, true, `${pathName} must be deprecated`);
    for (const response of Object.values(operation.responses)) {
      const componentName = response.$ref.split('/').at(-1);
      const headers = openapi.components.responses[componentName].headers;
      assert.deepEqual(Object.keys(headers).sort(), ['Deprecation', 'Link', 'Sunset']);
    }
  }
  assert.equal(JSON.parse(packageDocument).scripts['openapi:compat'], 'node scripts/openapi-compat.mjs');
});

test('generated Go SDK and independent consumer stay aligned with OpenAPI', async () => {
  const [
    openapiDocument,
    sdkVersion,
    generatedClient,
    generator,
    consumerMain,
    consumerTests,
    consumerMatrix,
    workspace,
    goRunner,
    environment,
    goWorkflow,
    nodeWorkflow,
    packageDocument,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'SDK', 'GoExample', 'VERSION'), 'utf8'),
    readFile(path.join(repositoryRoot, 'SDK', 'GoExample', 'client.gen.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-sdk.mjs'), 'utf8'),
    readFile(
      path.join(repositoryRoot, 'support', 'consumer', 'HealthProbe', 'cmd', 'healthprobe', 'main.go'),
      'utf8',
    ),
    readFile(
      path.join(repositoryRoot, 'support', 'consumer', 'HealthProbe', 'cmd', 'healthprobe', 'main_test.go'),
      'utf8',
    ),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'consumer-matrix.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'go.work'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'environment.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);

  const openapi = JSON.parse(openapiDocument);
  const operationCount = Object.values(openapi.paths).reduce(
    (count, pathItem) =>
      count +
      ['get', 'post', 'put', 'patch', 'delete'].filter((method) => pathItem[method]).length,
    0,
  );
  assert.equal(sdkVersion.trim(), openapi.info.version);
	assert.equal(operationCount, 26);
  assert.match(generatedClient, new RegExp(`const APIVersion = "${openapi.info.version}"`));
  assert.equal((generatedClient.match(/OperationID:/g) ?? []).length, operationCount);
  assert.match(generatedClient, /func PublishedOperations\(\) \[\]Operation/);
  assert.match(generatedClient, /DefaultMaxResponseBytes int64 = 1 << 20/);
  assert.match(generatedClient, /Deprecated: GET \/api\/health\/ready/);
  assert.match(generator, /Only local component parameter references are supported/);
  assert.match(generator, /Generated Go SDK is stale/);

  assert.match(consumerMain, /client\.GetReadiness\(ctx\)/);
  assert.doesNotMatch(consumerMain, /GetApiReadiness|\/api\/health\/ready/);
  assert.match(consumerTests, /client\.GetApiReadiness/);
  assert.match(consumerTests, /Deprecation/);
  assert.match(consumerTests, /successor-version/);
  assert.match(consumerTests, /requestedPaths\[0\] != "\/readyz"/);
	assert.match(consumerMatrix, /Go `1\.4\.0`/);
  assert.match(consumerMatrix, /repository-local consumer only/);

  assert.match(workspace, /\.\/SDK\/GoExample/);
  assert.match(workspace, /\.\/support\/consumer\/HealthProbe/);
  assert.match(goRunner, /workspacePatterns/);
  assert.match(goRunner, /\.\.\.workspacePatterns/);
  assert.match(environment, /go\.work must declare workspace modules in a use block/);
  assert.match(goWorkflow, /Verify generated Go SDK/);
  assert.match(goWorkflow, /"SDK\/\*\*"/);
  assert.match(nodeWorkflow, /yarn sdk:check/);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['sdk:generate'], 'node scripts/go-sdk.mjs generate');
  assert.equal(packageScripts['sdk:check'], 'node scripts/go-sdk.mjs check');

  const check = runScript('scripts/go-sdk.mjs', ['check']);
  assert.equal(check.status, 0, check.stderr);
	assert.match(check.stdout, /Go SDK matches OpenAPI 1\.4\.0 \(26 operations\)/);
});

test('MSFront browser workflow keeps production E2E and diagnostics enabled', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'msfront-browser.yml'),
    'utf8',
  );
  const playwrightConfig = await readFile(
    path.join(repositoryRoot, 'playwright.config.ts'),
    'utf8',
  );
  const nextConfig = await readFile(path.join(repositoryRoot, 'MSFront', 'next.config.ts'), 'utf8');

  assert.match(workflow, /yarn build:front/);
  assert.match(workflow, /yarn playwright install --with-deps chromium/);
  assert.match(workflow, /yarn test:e2e/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(playwrightConfig, /reuseExistingServer:\s*false/);
  assert.match(playwrightConfig, /trace:\s*'retain-on-failure'/);
  assert.match(playwrightConfig, /name:\s*'desktop-chromium'/);
  assert.match(playwrightConfig, /name:\s*'mobile-chromium'/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /Cross-Origin-Opener-Policy/);
  assert.match(nextConfig, /Cross-Origin-Resource-Policy/);
  assert.match(nextConfig, /Permissions-Policy/);
  assert.match(nextConfig, /Strict-Transport-Security/);
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /PHASE_PRODUCTION_SERVER/);
  assert.match(nextConfig, /validateAuthTokenConfiguration/);
  assert.match(nextConfig, /validateTrustedMutationOrigins/);
});

test('Go transport benchmark workflow preserves repeatable Linux evidence', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'go-transport-benchmark.yml'),
    'utf8',
  );
  const goProjectRunner = await readFile(
    path.join(repositoryRoot, 'scripts', 'go-project.mjs'),
    'utf8',
  );
  const transportBenchmark = await readFile(
    path.join(
      repositoryRoot,
      'Solutions',
      'Example',
      'internal',
      'projectapi',
      'transport_benchmark_test.go',
    ),
    'utf8',
  );
  const transportReport = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-benchmark-report.mjs'),
    'utf8',
  );
  const transportBaseline = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-benchmark-baseline.mjs'),
    'utf8',
  );
  const transportEnvironment = await readFile(
    path.join(repositoryRoot, 'scripts', 'lib', 'transport-benchmark-environment.mjs'),
    'utf8',
  );
  const transportStability = await readFile(
    path.join(repositoryRoot, 'scripts', 'lib', 'transport-benchmark-stability.mjs'),
    'utf8',
  );
  const transportReportTests = await readFile(
    path.join(repositoryRoot, '__test__', 'node', 'transport-benchmark-report.test.mjs'),
    'utf8',
  );
  const transportBaselineTests = await readFile(
    path.join(repositoryRoot, '__test__', 'node', 'transport-benchmark-baseline.test.mjs'),
    'utf8',
  );
  const transportSoakReport = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-soak-report.mjs'),
    'utf8',
  );
  const lifecycleContract = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'lifecycle_contract_test.go'),
    'utf8',
  );
  const httpApp = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'),
    'utf8',
  );
  const httpMiddleware = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'),
    'utf8',
  );
  const httpMiddlewareETagTest = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware_etag_test.go'),
    'utf8',
  );
  const exampleRoutes = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_example.go'),
    'utf8',
  );
  const httpAppTest = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'),
    'utf8',
  );
  const httpBenchmark = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'benchmark_test.go'),
    'utf8',
  );
  const requestLogger = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'logger.go'),
    'utf8',
  );
  const requestLoggerTest = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'logger_test.go'),
    'utf8',
  );
  const tracing = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'tracing.go'),
    'utf8',
  );
  const tracingTest = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'tracing_test.go'),
    'utf8',
  );

  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /trusted-baseline:[\s\S]*github\.event_name != 'pull_request'/);
  assert.match(workflow, /transport-benchmark:[\s\S]*needs:\s*trusted-baseline/);
  assert.match(workflow, /pull_request_not_eligible/);
  assert.match(workflow, /actions\/github-script@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /default_branch/);
  assert.match(workflow, /\['push', 'workflow_dispatch'\]/);
  assert.match(workflow, /head_repository\?\.full_name/);
  assert.match(workflow, /transport-benchmark-baseline\.mjs prepare/);
  assert.match(workflow, /transport-benchmark-baseline\.mjs unavailable/);
  assert.match(workflow, /transport-benchmark-baseline\.mjs verify/);
  assert.ok(
    workflow.indexOf('transport-benchmark-baseline.mjs verify')
      < workflow.indexOf('Generate capacity report'),
    'baseline selection must be verified before the report can consume it',
  );
  assert.match(workflow, /__test__\/node\/transport-benchmark-report\.test\.mjs/);
  assert.match(workflow, /__test__\/node\/transport-soak-report\.test\.mjs/);
  assert.match(workflow, /scripts\/lib\/transport-benchmark-stability\.mjs/);
  assert.match(workflow, /baseline-source\.json/);
  assert.match(workflow, /yarn bench:transports/);
  assert.match(workflow, /lscpu/);
  assert.match(workflow, /GOMAXPROCS=2 \/usr\/bin\/time -v/);
  assert.match(workflow, /GOMAXPROCS:\s*"2"/);
  assert.match(workflow, /TRANSPORT_BENCHMARK_GO_VERSION/);
  assert.match(workflow, /transport-benchmark\.txt/);
  assert.match(workflow, /PIPESTATUS\[0\]/);
  assert.match(workflow, /benchmark-status\.txt/);
  assert.match(workflow, /TRANSPORT_SOAK_DURATION=30s GOMAXPROCS=2/);
  assert.match(workflow, /yarn soak:transports/);
  assert.match(workflow, /transport-soak\.txt/);
  assert.match(workflow, /soak-status\.txt/);
  assert.match(workflow, /system-before\.txt/);
  assert.match(workflow, /system-after\.txt/);
  assert.match(workflow, /ss -s/);
  assert.match(workflow, /\/proc\/net\/dev/);
  assert.match(workflow, /\/proc\/meminfo/);
  assert.match(workflow, /benchmark-trend\.txt/);
  assert.match(workflow, /scripts\/transport-benchmark-report\.mjs/);
  assert.match(workflow, /transport-capacity-report\.json/);
  assert.match(workflow, /baseline_args=\(\)/);
  assert.match(workflow, /--baseline \.temp\/transport-benchmark\/baseline\.json/);
  assert.match(workflow, /baseline-candidate\.json/);
  assert.match(workflow, /scripts\/transport-soak-report\.mjs/);
  assert.match(workflow, /transport-soak-report\.json/);
  assert.match(workflow, /go tool pprof -top -nodecount=30/);
  assert.match(workflow, /cpu-profile-top\.txt/);
  assert.match(workflow, /heap-profile-top\.txt/);
  assert.match(workflow, /scripts\/evidence-manifest\.mjs/);
  assert.match(workflow, /scripts\/evidence-verify\.mjs/);
  assert.match(workflow, /yarn evidence:manifest/);
  assert.match(workflow, /yarn evidence:verify --manifest \.temp\/transport-benchmark\/manifest\.json/);
  assert.match(workflow, /manifest\.json/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(transportBaseline, /compatible_candidate_missing/);
  assert.match(transportBaseline, /candidate workload matrix is incompatible/);
  assert.match(transportBaseline, /candidate scenario matrix is incompatible/);
  assert.match(transportBaseline, /candidate must be a schemaVersion 6/);
  assert.match(transportBaseline, /report_schema_migration/);
  assert.match(transportBaseline, /candidate\.schemaVersion === 5/);
  assert.match(transportBaseline, /verifyTransportBenchmarkRoundStabilityMetadata/);
  assert.match(transportBaseline, /verifyTransportBenchmarkRoundStabilityResult/);
  assert.match(transportBaseline, /event must be push or workflow_dispatch/);
  assert.match(transportBaseline, /createHash\('sha256'\)/);
  assert.match(transportBaseline, /validateEnvironmentFingerprint/);
  assert.match(transportBaseline, /environmentFingerprintSha256/);
  assert.match(transportBaseline, /writeFileAtomicallySync/);
  assert.match(transportBaseline, /writeFilesWithRollbackSync/);
  assert.match(transportBaseline, /requireRegularOutput\(outputPath, 'baseline output'\)/);
  assert.match(transportBaseline, /validateCandidate\(candidate\);[\s\S]*writeFilesWithRollbackSync\(\[/);
  assert.match(transportBaseline, /function verifySelection\(/);
  assert.match(transportBaseline, /candidate sha256 does not match the baseline/);
  assert.match(transportBaseline, /function unavailable\([\s\S]*removeBaseline\(outputPath\)/);
  assert.match(goProjectRunner, /'bench-transports'[\s\S]*'-count=5'/);
  assert.match(goProjectRunner, /-run=\^TestProjectTransport/);
  assert.match(goProjectRunner, /-cpuprofile=transport\.cpu\.pprof/);
  assert.match(goProjectRunner, /-memprofile=transport\.heap\.pprof/);
  assert.match(goProjectRunner, /'soak-transports'[\s\S]*TestProjectTransportSoakTCP/);
  assert.match(transportBenchmark, /TestProjectTransportsReturnTheSameEnvelopeOverTCP/);
  assert.match(transportBenchmark, /TestNetHTTPTransportSupportsHTTP2/);
  assert.match(transportBenchmark, /EnableHTTP2 = true/);
  assert.match(transportBenchmark, /response\.ProtoMajor != 2/);
  assert.match(transportBenchmark, /TestHTTP2EdgeToFiberHTTP1Contract/);
  assert.match(transportBenchmark, /NewSingleHostReverseProxy/);
  assert.match(transportBenchmark, /TestProjectTransportLatencyTCP/);
  assert.match(transportBenchmark, /measuredProjectTransports/);
  assert.match(transportBenchmark, /framework-net-http/);
  assert.match(transportBenchmark, /startFrameworkNetHTTPProjectTransport/);
  assert.match(transportBenchmark, /httpapi\.NewHTTPHandler/);
  assert.match(transportBenchmark, /TRANSPORT_LATENCY/);
  assert.match(transportBenchmark, /TestProjectTransportCapacityMatrixTCP/);
  assert.match(transportBenchmark, /connection-churn-c16/);
  assert.match(transportBenchmark, /TRANSPORT_CAPACITY/);
  assert.match(transportBenchmark, /TestProjectTransportScenarioMatrixTCP/);
  assert.match(transportBenchmark, /TRANSPORT_SCENARIO/);
  assert.match(transportBenchmark, /response-32k-c16/);
  assert.match(transportBenchmark, /auth-reject-c16/);
  assert.match(transportBenchmark, /dependency-delay-5ms-c32/);
  assert.match(transportBenchmark, /httptrace\.ClientTrace/);
  assert.match(transportBenchmark, /\/proc\/self\/fd/);
  assert.match(transportBenchmark, /TestProjectTransportSoakTCP/);
  assert.match(transportBenchmark, /TRANSPORT_SOAK_DURATION/);
  assert.match(transportBenchmark, /TRANSPORT_SOAK/);
  assert.match(transportBenchmark, /TestProjectTransportSoakTCP[\s\S]*for _, candidate := range measuredProjectTransports\(\)/);
  assert.match(transportReport, /const expectedRounds = transportBenchmarkExpectedRounds/);
  assert.match(transportReport, /steady-c1/);
  assert.match(transportReport, /steady-c2/);
  assert.match(transportReport, /steady-c4/);
  assert.match(transportReport, /steady-c8/);
  assert.match(transportReport, /steady-c16/);
  assert.match(transportReport, /steady-c32/);
  assert.match(transportReport, /steady-c64/);
  assert.match(transportReport, /steady-c128/);
  assert.match(transportReport, /connection-churn-c16/);
  assert.match(transportReport, /capacityKnee/);
  assert.match(transportReport, /peakThroughputFraction/);
  assert.match(transportReport, /--baseline/);
  assert.match(transportReport, /maxThroughputRegressionFraction/);
  assert.match(transportReport, /maxP95IncreaseFraction/);
  assert.match(transportReport, /maxP99IncreaseFraction/);
  assert.match(transportReport, /captureEnvironmentFingerprint/);
  assert.match(transportReport, /environment_fingerprint_mismatch/);
  assert.match(transportReport, /environmentComparison/);
  assert.match(transportReport, /parseMeasurements\(raw, 'TRANSPORT_SCENARIO'\)/);
  assert.match(transportReport, /schemaVersion: 6/);
  assert.match(transportReport, /roundStability: createTransportBenchmarkRoundStabilityMetadata\(\)/);
  assert.match(transportReport, /summarizeTransportBenchmarkRoundStability/);
  assert.match(transportReport, /verifyTransportBenchmarkRoundStabilityResult/);
  assert.match(transportReport, /capacityTransports = \['fiber', 'net-http', 'framework-net-http'\]/);
  assert.match(transportReport, /scenarioTransports = \['fiber', 'framework-net-http'\]/);
  assert.match(transportReport, /frameworkAdapterRatios/);
  assert.match(transportReport, /scenarioComparisons/);
  assert.match(transportEnvironment, /runner\.imageVersion/);
  assert.match(transportEnvironment, /toolchain\.goVersion/);
  assert.match(transportEnvironment, /execution\.gomaxprocs/);
  assert.match(transportEnvironment, /sha256 does not match its canonical fields/);
  assert.match(transportStability, /transportBenchmarkExpectedRounds = 5/);
  assert.match(transportStability, /transportBenchmarkMaximumMetricSpreadRatio = 2/);
  for (const field of ['throughputRps', 'p50Nanos', 'p95Nanos', 'p99Nanos']) {
    assert.match(transportStability, new RegExp(`'${field}'`));
  }
  assert.match(transportStability, /Number\(\(maximum \/ minimum\)\.toFixed\(6\)\)/);
  assert.match(transportStability, /maximum must be >= minimum/);
  assert.match(transportStability, /median must stay between minimum and maximum/);
  assert.match(transportStability, /maxToMinRatio does not match minimum and maximum/);
  assert.match(transportStability, /max\/min ratio .* exceeds/);
  for (const scenario of ['unstable-latency', 'unstable-capacity', 'unstable-scenario']) {
    assert.match(transportReportTests, new RegExp(`name: '${scenario}'`));
  }
  for (const scenario of [
    'missing-stability-metadata',
    'missing-stability-summary',
    'forged-stability-ratio',
    'out-of-range-median',
  ]) {
    assert.match(transportBaselineTests, new RegExp(`name: '${scenario}'`));
  }
  assert.match(transportReport, /all measurement error rates must be zero/);
  assert.match(transportReport, /payloadBytes must remain stable/);
  assert.match(transportReport, /directionalRatios/);
  assert.match(transportReport, /combined client\/server harness-process deltas/);
  assert.match(transportSoakReport, /minimumDurationNanos = 30_000_000_000/);
  assert.match(transportSoakReport, /const transports = \['fiber', 'net-http', 'framework-net-http'\]/);
  assert.match(transportSoakReport, /schemaVersion: 2/);
  assert.match(transportSoakReport, /frameworkAdapterRatios/);
  assert.match(transportSoakReport, /frameworkNetHTTPToFiber/);
  assert.match(transportSoakReport, /frameworkNetHTTPToNetHTTP/);
  assert.match(transportSoakReport, /minimumWindowToMedianThroughputRatio: 0\.5/);
  assert.match(transportSoakReport, /maximumSettledHeapInUseBytesDelta: 32 \* 1024 \* 1024/);
  assert.match(transportSoakReport, /all soak requests must complete without errors/);
  assert.match(transportSoakReport, /combined client\/server harness process/);
  assert.match(lifecycleContract, /TestTLSContractOverTCP/);
  assert.match(lifecycleContract, /TestStreamingResponseOverTCP/);
  assert.match(lifecycleContract, /SendStreamWriter/);
  assert.match(lifecycleContract, /response\.ContentLength != -1/);
  assert.match(lifecycleContract, /TestWriteTimeoutStopsSlowReaderOverTCP/);
  assert.match(lifecycleContract, /options\.WriteTimeout = 75 \* time\.Millisecond/);
  assert.match(lifecycleContract, /writeFailure/);
  assert.match(lifecycleContract, /timeoutError\.Timeout\(\)/);
  assert.match(lifecycleContract, /TestKeepAliveReuseAndIdleTimeoutOverTCP/);
  assert.match(lifecycleContract, /TestTCPHalfCloseStillReceivesCompleteResponse/);
  assert.match(lifecycleContract, /CloseWrite\(\)/);
  assert.match(lifecycleContract, /TestShutdownClosesIdleKeepAliveConnectionsOverTCP/);
  assert.match(lifecycleContract, /active connections after shutdown = %d, want 0/);
  assert.match(lifecycleContract, /tls\.Listen/);
  assert.match(lifecycleContract, /response\.ProtoMajor != 1/);
  assert.match(httpApp, /app\.Use\("\/api\/v1", streamSafeETag\(\)\)/);
  assert.match(httpMiddleware, /response\.IsBodyStream\(\)/);
  assert.match(httpMiddleware, /func generateWeakETag/);
  assert.match(httpMiddleware, /crc32\.Checksum\(body, weakETagCRC32Q\)/);
  assert.match(httpMiddleware, /var tagStorage \[maxWeakETagLength\]byte/);
  assert.match(httpMiddlewareETagTest, /TestGenerateWeakETagMatchesFiberWithoutAllocations/);
  assertEvidenceInput('Framework/httpapi/middleware_etag_test.go');
  assert.match(httpMiddleware, /response\.Header\.Del\(fiber\.HeaderETag\)/);
  assert.match(httpApp, /restrictedCORS := middleware\.cors && corsRequiresOriginVary\(options\.AllowedOrigins\)/);
  assert.match(httpApp, /Next:\s+corsNext/);
  assert.match(httpApp, /app\.Use\("\/api\/v1", seedAPIOriginVary\(\)\)/);
  assert.match(httpApp, /app\.Use\("\/api\/v1", coalesceCompressionVary\(\)\)/);
  assert.match(httpMiddleware, /func skipPreseededAPICORS\(c fiber\.Ctx\) bool/);
  assert.match(httpMiddleware, /len\(c\.Request\(\)\.Header\.Peek\(fiber\.HeaderOrigin\)\) != 0/);
  assert.match(httpMiddleware, /header\.SetBytesV\(fiber\.HeaderVary, varyOriginAcceptEncodingBytes\)/);
  assert.match(httpAppTest, /TestAPIVaryHeadersPreserveCORSAndCompressionContracts/);
  for (const contract of ['restricted origin success', 'handler error', 'preflight', 'wildcard origin', 'non API response']) {
    assert.match(httpAppTest, new RegExp(contract));
  }
  assertEvidenceInput('Framework/httpapi/app.go');
  assertEvidenceInput('Framework/httpapi/middleware.go');
  assert.match(exampleRoutes, /defaultHelloEnvelope\s+=/);
  assert.match(exampleRoutes, /func helloMessage\(name \[\]byte\) string/);
  assert.match(exampleRoutes, /func sendHello\(c fiber\.Ctx, rawName \[\]byte\) error/);
  assert.match(exampleRoutes, /name := bytes\.TrimSpace\(rawName\)/);
  assert.match(exampleRoutes, /response\.Header\.SetContentType\(fiber\.MIMEApplicationJSONCharsetUTF8\)/);
  assert.match(exampleRoutes, /response\.SetBodyString\(defaultHelloEnvelope\)/);
  assert.match(exampleRoutes, /return success\(c, helloResponse\{Message: helloMessage\(name\)\}\)/);
  assert.match(exampleRoutes, /c\.RequestCtx\(\)\.QueryArgs\(\)\.Peek\("name"\)/);
  assert.match(exampleRoutes, /message\.Grow\(len\("Hello, "\) \+ len\(name\) \+ 1\)/);
  assert.doesNotMatch(exampleRoutes, /c\.Query\("name"/);
  assert.match(httpAppTest, /TestExampleRouteResponseContracts/);
  assert.match(httpAppTest, /TestDefaultHelloFastPathMatchesJSONContract/);
  assert.match(httpAppTest, /fiber\.MIMEApplicationJSONCharsetUTF8/);
  for (const contract of ['hello explicit default', 'hello plus decoding', 'hello percent decoding', 'hello unicode whitespace', 'hello repeated name', 'hello JSON escaping']) {
    assert.match(httpAppTest, new RegExp(contract));
  }
  assertEvidenceInput('Framework/httpapi/app_test.go');
  assert.match(requestLogger, /func responseBytes/);
  assert.match(requestLogger, /c\.Response\(\)\.IsBodyStream\(\)/);
  assert.match(requestLogger, /logger\.Enabled\(logContext, level\)/);
  assert.match(requestLogger, /\[\.\.\.\]slog\.Attr/);
  assert.match(requestLogger, /logger\.LogAttrs\(logContext, level, "http_request"/);
  assert.match(requestLoggerTest, /TestResponseBytesDoesNotMaterializeStream/);
  assert.match(requestLoggerTest, /TestRequestLoggerSkipsAttributeExtractionWhenLevelIsDisabled/);
  assert.match(requestLoggerTest, /disabled request log extracted the client address/);
  assert.match(tracing, /func \(trace TraceContext\) traceparentBytes\(\) \[55\]byte/);
  assert.match(tracing, /type traceRequestContext struct/);
  assert.match(tracing, /func \(ctx \*traceRequestContext\) traceContext\(\) TraceContext/);
  assert.match(tracing, /ctx\.once\.Do/);
  assert.match(tracing, /traceparentBytesFromSpanContext\(spanContext\)/);
  assert.match(tracing, /SetBytesV\(TraceparentHeader, traceparent\[:\]\)/);
  assert.match(tracing, /func remoteSpanContextFromHeaders\(traceparent, tracestate string\)/);
  assert.match(tracing, /trace\.ContextWithRemoteSpanContext\(base, remoteParent\)/);
  assert.match(tracing, /var flagBytes \[1\]byte/);
  assert.doesNotMatch(tracing, /propagation\.MapCarrier/);
  assert.match(tracing, /newStandardServerSpanStartConfigurations/);
  assert.match(tracing, /serverSpanStartConfigurationForMethod/);
  assert.match(tracing, /type serverSpanEndConfigurationCache struct/);
	assert.match(tracing, /configurationForMethod/);
	assert.match(tracing, /configuration\(method, route string, status int\)/);
	assert.match(tracing, /status < 100 \|\| status >= 600/);
	assert.doesNotMatch(tracing, /attributesForStatus\(status int\)/);
  assert.doesNotMatch(tracing, /fmt\.Sprintf/);
  assert.match(tracingTest, /TestTraceContextFormatsTraceparentWithOneAllocation/);
  assert.match(tracingTest, /TestTraceRequestContextLazilyPreservesTheServerSpan/);
  assert.match(tracingTest, /cached request trace lookup allocations/);
  assert.match(tracingTest, /TestStandardServerSpanStartConfigurationIsReusable/);
  assert.match(tracingTest, /TestServerSpanEndConfigurationCachesBoundedStandardMetadata/);
  assert.match(tracingTest, /TestRemoteSpanContextFromHeadersPreservesStrictW3CContract/);
  assert.match(tracingTest, /remote span context parsing allocations/);
  assert.match(tracingTest, /cached span end metadata allocations/);
	assert.match(tracingTest, /"PURGE request"/);
	assertEvidenceInput('Framework/httpapi/routes.go');
	assertEvidenceInput('Framework/observability/tracing.go');
  assert.match(tracingTest, /testing\.AllocsPerRun\(1000/);
  assert.match(httpBenchmark, /BenchmarkHelloEndpointWithTraceparent/);
  assertEvidenceInput('Framework/httpapi/benchmark_test.go');
});

test('server admission control remains bounded and probe-safe', async () => {
  const [app, middleware, metrics, config, environment, lifecycle, authRoutes, authTests, serverHTTP, serverHTTPTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'lifecycle_contract_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http_test.go'), 'utf8'),
  ]);

  assert.match(app, /MaxInFlight/);
  assert.match(app, /MaxConnections/);
  assert.match(app, /Concurrency:\s*options\.MaxConnections/);
  assert.match(app, /ReadBufferSize/);
  assert.match(app, /app\.Use\(requestIDBoundary\(options\.Metrics\)\)/);
  assert.match(app, /ExposeHeaders:[\s\S]*HeaderRetryAfter/);
  assert.match(middleware, /maxRequestIDLength\s*=\s*128/);
  assert.match(middleware, /func requestIDBoundary/);
  assert.match(middleware, /RecordRequestIDReplaced/);
  assert.match(middleware, /boundedConcurrency/);
  assert.match(middleware, /rejectWhenDraining/);
  assert.match(middleware, /StatusServiceUnavailable/);
  assert.match(middleware, /HeaderRetryAfter/);
  assert.match(metrics, /goexample_http_admission_rejections_total/);
  assert.match(metrics, /goexample_http_draining_rejections_total/);
  assert.match(metrics, /goexample_http_request_id_replacements_total/);
  assert.match(metrics, /RecordAdmissionRejected/);
  assert.match(metrics, /RecordDrainingRejected/);
  assert.match(config, /HTTP_MAX_IN_FLIGHT/);
  assert.match(config, /HTTP_MAX_CONNECTIONS/);
  assert.match(config, /HTTP_READ_BUFFER_SIZE/);
  assert.match(config, /HTTP_READ_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT/);
  assert.match(config, /HTTP_WRITE_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT/);
  assert.match(config, /SHUTDOWN_DRAIN_DELAY plus HTTP_READ_TIMEOUT/);
  assert.match(config, /SHUTDOWN_DRAIN_DELAY plus HTTP_WRITE_TIMEOUT/);
  assert.match(config, /cfg\.DemoAuthEnabled && cfg\.MetricsToken == cfg\.JWTSecret/);
  assert.match(config, /PPROF_TOKEN must differ from active production authentication and metrics secrets/);
  assert.match(config, /JWTAudience/);
  assert.match(config, /TRUSTED_PROXIES must not contain catch-all CIDR/);
  assert.match(environment, /HTTP_MAX_IN_FLIGHT=256/);
  assert.match(environment, /HTTP_MAX_CONNECTIONS=4096/);
  assert.match(environment, /HTTP_READ_BUFFER_SIZE=16384/);
  assert.match(environment, /JWT_AUDIENCE=goexample-api/);
  assert.match(lifecycle, /TestAPIAdmissionRejectsExcessRequestsAndKeepsReadinessAvailable/);
  assert.match(lifecycle, /TestConnectionConcurrencyRejectsExcessConnectionsOverTCP/);
  assert.match(lifecycle, /options\.MaxConnections\s*=\s*1/);
  assert.match(lifecycle, /TestDrainingRejectsNewAPIRequestsButKeepsExistingWorkAndProbeContract/);
  assert.match(lifecycle, /TestReadBufferRejectsOversizedHeaderOverTCP/);
  assert.match(lifecycle, /TestReadTimeoutRejectsIncompleteHeadersOverTCP/);
  assert.match(lifecycle, /TestReadTimeoutRejectsIncompleteBodyOverTCP/);
  assert.match(lifecycle, /TestTrustedProxyBoundaryOverTCP/);
  assert.match(lifecycle, /untrusted peer cannot spoof client IP/);
  assert.match(lifecycle, /Content-Length: 32/);
  assert.match(lifecycle, /options\.ReadTimeout\s*=\s*50 \* time\.Millisecond/);
  assert.match(lifecycle, /" 408 "/);
  assert.match(lifecycle, /StatusServiceUnavailable/);
  assert.match(serverHTTP, /trackedHTTPListener/);
  assert.match(serverHTTP, /state != http\.StateHijacked/);
  assert.match(serverHTTP, /connectionTracker\.closeHijacked\(\)/);
  assert.match(serverHTTPTests, /TestRunHTTPClosesHijackedConnectionsDuringShutdown/);
  assert.match(serverHTTPTests, /hijacked connection remained open after shutdown/);
  assert.match(authTests, /TestRequestIDBoundaryPreservesValidAndReplacesUntrustedValues/);
  assert.match(lifecycle, /\/readyz/);
  assert.match(authRoutes, /authGroup\.Use/);
  assert.match(authRoutes, /setNoStoreHeaders/);
  assert.match(authTests, /assertNoStoreResponse\(t, unauthorized\)/);
  assert.match(authTests, /assertNoStoreResponse\(t, login\)/);
  assert.match(authTests, /assertNoStoreResponse\(t, me\)/);
  assert.match(authTests, /TestErrorResponsesAreNotCacheable/);
});

test('bounded command execution preserves large output and reports command failure', () => {
  const outputBytes = 1024 * 1024 + 8192;
  const output = runBoundedCommand(
    process.execPath,
    ['--eval', `process.stdout.write('x'.repeat(${outputBytes}))`],
    { cwd: repositoryRoot, raw: true },
  );

  assert.equal(maximumCommandDurationMs, 30_000);
  assert.equal(maximumCommandOutputBytes, 64 * 1024 * 1024);
  assert.equal(output?.length, outputBytes);
  assert.equal(
    runBoundedCommand(process.execPath, ['--eval', 'process.exit(23)'], { cwd: repositoryRoot }),
    null,
  );
});

test('bounded command execution applies duration limits and rejects unsafe overrides', () => {
  const startedAt = Date.now();
  assert.equal(
    runBoundedCommand(
      process.execPath,
      ['--eval', 'setTimeout(() => {}, 5_000)'],
      { cwd: repositoryRoot, timeoutMs: 100 },
    ),
    null,
  );
  assert.ok(Date.now() - startedAt < 4_000, 'the child process was not terminated by its command timeout');

  for (const timeoutMs of [0, -1, 1.5, Number.NaN, '100', maximumCommandDurationMs + 1]) {
    assert.throws(
      () => runBoundedCommand(process.execPath, ['--version'], { timeoutMs }),
      RangeError,
    );
  }
});

test('bounded command execution only retries Windows launch failures', () => {
  const calls = [];
  const environment = Object.freeze({ PATH: 'repository-tools' });
  const output = runBoundedCommand('tool', ['argument'], {
    commandShell: 'cmd.exe',
    env: environment,
    now: () => 0,
    platform: 'win32',
    timeoutMs: 1_234,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length === 1) {
        return { status: null, error: { code: 'ENOENT' } };
      }
      if (calls.length === 2) {
        return { status: null, error: { code: 'EINVAL' } };
      }
      if (calls.length === 3) {
        return { status: null, error: { code: 'ENOENT' } };
      }
      return { status: 0, stdout: ' shell result \n' };
    },
  });

  assert.equal(output, 'shell result');
  assert.deepEqual(calls.map(({ command }) => command), ['tool', 'tool.cmd', 'tool.exe', 'cmd.exe']);
  assert.deepEqual(calls.at(-1).args, ['/d', '/s', '/v:off', '/c', 'tool argument']);
  for (const { options } of calls) {
    assert.strictEqual(options.env, environment);
    assert.equal(options.timeout, 1_234);
    assert.equal(options.killSignal, 'SIGTERM');
    assert.equal(options.maxBuffer, maximumCommandOutputBytes);
  }

  for (const failure of [
    { status: 7 },
    { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } },
  ]) {
    let callCount = 0;
    assert.equal(
      runBoundedCommand('tool', [], {
        platform: 'win32',
        spawn() {
          callCount += 1;
          return failure;
        },
      }),
      null,
    );
    assert.equal(callCount, 1);
  }
});

test('bounded command execution shares one duration budget across Windows retries', () => {
  const clockReadings = [1_000, 1_000, 1_250, 1_800, 1_950];
  const calls = [];
  const output = runBoundedCommand('tool', ['argument'], {
    commandShell: 'cmd.exe',
    now() {
      assert.ok(clockReadings.length > 0, 'unexpected command clock read');
      return clockReadings.shift();
    },
    platform: 'win32',
    timeoutMs: 1_000,
    spawn(command, args, options) {
      calls.push({ command, args, timeout: options.timeout });
      return command === 'cmd.exe'
        ? { status: 0, stdout: ' bounded shell result\n' }
        : { status: null, error: { code: 'ENOENT' } };
    },
  });

  assert.equal(output, 'bounded shell result');
  assert.deepEqual(calls.map(({ command }) => command), ['tool', 'tool.cmd', 'tool.exe', 'cmd.exe']);
  assert.deepEqual(calls.map(({ timeout }) => timeout), [1_000, 750, 200, 50]);
  assert.deepEqual(clockReadings, []);

  const exhaustedClockReadings = [5_000, 5_000, 6_000];
  const exhaustedCalls = [];
  assert.equal(
    runBoundedCommand('tool', [], {
      now: () => exhaustedClockReadings.shift(),
      platform: 'win32',
      timeoutMs: 1_000,
      spawn(command) {
        exhaustedCalls.push(command);
        return { status: null, error: { code: 'ENOENT' } };
      },
    }),
    null,
  );
  assert.deepEqual(exhaustedCalls, ['tool']);

  for (const now of [() => Number.NaN, () => Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => runBoundedCommand('tool', [], { now }),
      /Command clock must return a finite number/,
    );
  }
});

test('bounded command execution preserves explicit Windows command identity', () => {
  const nativeCalls = [];
  const nativeOutput = runBoundedCommand('go.exe', ['version'], {
    platform: 'win32',
    spawn(command) {
      nativeCalls.push(command);
      return command === 'go.exe.cmd'
        ? { status: 0, stdout: 'go version go1.25.13 windows/amd64\n' }
        : { status: null, error: { code: 'ENOENT' } };
    },
  });

  assert.equal(nativeOutput, null);
  assert.deepEqual(nativeCalls, ['go.exe']);

  const absoluteBatch = 'C:\\repository\\tool.cmd';
  const absoluteExecutable = 'C:\\repository\\tool.exe';
  for (const [command, expectedCalls, expectedOutput] of [
    ['tool.exe', ['tool.exe'], null],
    ['tool.com', ['tool.com'], null],
    ['tool.ps1', ['tool.ps1'], null],
    [absoluteExecutable, [absoluteExecutable], null],
    ['tool.cmd', ['tool.cmd', 'cmd.exe'], 'batch result'],
    ['tool.CMD', ['tool.CMD', 'cmd.exe'], 'batch result'],
    ['tool.bat', ['tool.bat', 'cmd.exe'], 'batch result'],
    [absoluteBatch, [absoluteBatch, 'cmd.exe'], 'batch result'],
  ]) {
    const calls = [];
    const output = runBoundedCommand(command, ['argument'], {
      commandShell: 'cmd.exe',
      platform: 'win32',
      spawn(candidate) {
        calls.push(candidate);
        return candidate === 'cmd.exe'
          ? { status: 0, stdout: ' batch result\n' }
          : { status: null, error: { code: 'ENOENT' } };
      },
    });

    assert.equal(output, expectedOutput, command);
    assert.deepEqual(calls, expectedCalls, command);
  }

  const unsafeBatchCalls = [];
  assert.equal(
    runBoundedCommand('tool.cmd', ['two words'], {
      platform: 'win32',
      spawn(command) {
        unsafeBatchCalls.push(command);
        return { status: null, error: { code: 'ENOENT' } };
      },
    }),
    null,
  );
  assert.deepEqual(unsafeBatchCalls, ['tool.cmd']);
});

test('bounded command rejects unsafe Windows shell fallback tokens', () => {
  const unsafeTokens = [
    '',
    'two words',
    '"quoted"',
    '%PATH%',
    '!DELAYED!',
    'left&right',
    'left|right',
    'left<right',
    'left>right',
    'left^right',
    '(group',
    'group)',
  ];

  for (const unsafeToken of unsafeTokens) {
    for (const [command, args] of [
      [unsafeToken, ['argument']],
      ['tool', [unsafeToken]],
    ]) {
      const calls = [];
      assert.equal(
        runBoundedCommand(command, args, {
          commandShell: 'cmd.exe',
          platform: 'win32',
          spawn(candidate, candidateArgs) {
            calls.push({ command: candidate, args: candidateArgs });
            return { status: null, error: { code: 'ENOENT' } };
          },
        }),
        null,
        JSON.stringify({ command, args }),
      );
      assert.equal(calls.length, 3, JSON.stringify({ command, args, calls }));
      assert.ok(calls.every(({ command: candidate }) => candidate !== 'cmd.exe'));
      assert.ok(calls.every(({ args: candidateArgs }) => candidateArgs === args));
    }
  }
});

test('bounded command preserves simple Windows shell fallback tokens', () => {
  const calls = [];
  const args = ['--flag=value', 'refs/tags/v1.2.3:artifact', 'C:\\tools\\cache'];
  const output = runBoundedCommand('repository-tool', args, {
    commandShell: 'cmd.exe',
    platform: 'win32',
    spawn(command, candidateArgs) {
      calls.push({ command, args: candidateArgs });
      return command === 'cmd.exe'
        ? { status: 0, stdout: ' safe fallback\n' }
        : { status: null, error: { code: 'ENOENT' } };
    },
  });

  assert.equal(output, 'safe fallback');
  assert.deepEqual(calls.at(-1), {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      'repository-tool --flag=value refs/tags/v1.2.3:artifact C:\\tools\\cache',
    ],
  });
});

test('bounded identity readers use fixed commands and reject malformed output', () => {
  const calls = [];
  const environment = Object.freeze({ GOROOT: 'repository-go-root' });
  const goVersion = readBoundedGoVersion('repository-go', {
    cwd: 'repository-root',
    env: environment,
    run(command, args, options) {
      calls.push({ command, args, options });
      return '  go version go1.25.13 windows/amd64\n';
    },
  });
  const gitCommit = readBoundedGitCommit({
    cwd: 'repository-root',
    env: environment,
    run(command, args, options) {
      calls.push({ command, args, options });
      return ` ${'a'.repeat(40)}\n`;
    },
  });

  assert.equal(goVersion, 'go version go1.25.13 windows/amd64');
  assert.equal(gitCommit, 'a'.repeat(40));
  assert.deepEqual(calls, [
    {
      command: 'repository-go',
      args: ['version'],
      options: { cwd: 'repository-root', env: environment },
    },
    {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      options: { cwd: 'repository-root', env: environment },
    },
  ]);

  for (const value of [
    null,
    '',
    'go version go1.25 windows/amd64',
    'go version go1.25.13 Windows/amd64',
    'go version go1.25.13 windows/amd64 trailing',
  ]) {
    assert.equal(readBoundedGoVersion('go', { run: () => value }), null);
  }
  for (const value of [null, '', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40)]) {
    assert.equal(readBoundedGitCommit({ run: () => value }), null);
  }
});

test('domain evidence identity probes use the shared bounded command boundary', async () => {
  const goIdentityLibraries = new Set([
    'audit-chain-evidence.mjs',
    'authorization-evidence.mjs',
    'oidc-browser-evidence.mjs',
    'sdk-consumer-evidence.mjs',
    'sdk-release-evidence.mjs',
  ]);
  const libraryNames = [
    ...goIdentityLibraries,
    'sdk-consumer-matrix-evidence.mjs',
    'server-recovery-evidence.mjs',
  ];
  const libraries = await Promise.all(
    libraryNames.map((name) => readFile(path.join(repositoryRoot, 'scripts', 'lib', name), 'utf8')),
  );

  assert.equal(libraries.length, 7);
  for (const [index, source] of libraries.entries()) {
    const name = libraryNames[index];
    assert.doesNotMatch(source, /node:child_process|spawnSync\(/, name);
    assert.match(source, /readBoundedGitCommit/, name);
    assert.match(source, /boundedCommand: 'scripts\/lib\/bounded-command\.mjs'/, name);
    if (goIdentityLibraries.has(name)) {
      assert.match(source, /readBoundedGoVersion/, name);
    }
  }
});

test('short repository metadata probes use the shared bounded command boundary', async () => {
  const expectedDirectTaskCalls = new Map([
    ['scripts/environment.mjs', 1],
    ['scripts/go-project.mjs', 0],
    ['scripts/sdk-release.mjs', 0],
    ['scripts/server-recovery-drill.mjs', 1],
    ['scripts/lib/transport-benchmark-environment.mjs', 0],
    ['scripts/v13-evidence.mjs', 0],
    ['scripts/openapi-compat.mjs', 0],
    ['scripts/lib/project-contracts.mjs', 0],
  ]);
  const sources = await Promise.all(
    [...expectedDirectTaskCalls].map(async ([relativePath, expectedCalls]) => ({
      expectedCalls,
      relativePath,
      source: await readFile(path.join(repositoryRoot, relativePath), 'utf8'),
    })),
  );

  for (const { expectedCalls, relativePath, source } of sources) {
    assert.match(source, /runBoundedCommand|readBoundedGitCommit|readBoundedGoVersion|createProjectContractGitRunner/, relativePath);
    assert.equal(source.match(/spawnSync\(/g)?.length ?? 0, expectedCalls, relativePath);
  }
  assert.match(sources[1].source, /runBoundedCommand\('git', \['rev-parse', '--short=12', 'HEAD'\]/);
  assert.match(sources[1].source, /runBoundedCommand\(command, \['--version'\],[\s\S]*env: goEnvironmentWithPath,[\s\S]*raw: true/);
  assert.match(sources[3].source, /readBoundedGoVersion\(goCommand, \{[\s\S]*env: environment/);
  assert.match(sources[4].source, /runBoundedCommand\(command, \['env', 'GOVERSION'\],[\s\S]*env: environment/);
  assert.match(sources[6].source, /createProjectContractGitRunner\(repositoryRoot\)/);
  assert.doesNotMatch(sources[6].source, /spawnSync/);
  assert.match(sources[7].source, /timeoutMs: remainingTimeoutMs/);
  assert.match(sources[7].source, /raw: true/);
  assert.match(sources[7].source, /GIT_TERMINAL_PROMPT: '0'/);
  assert.match(sources[7].source, /writeOutput = writeFileAtomicallySync/);
  assert.match(sources[7].source, /writeOutput\(target, result/);
  assert.doesNotMatch(sources[7].source, /writeFileSync\(target, result/);
  assert.doesNotMatch(sources[7].source, /spawnSync/);
});

test('synchronous evidence entrypoints use the shared bounded command boundary', async () => {
  const names = [
    'scripts/kubernetes-evidence.mjs',
    'scripts/prometheus-rules.mjs',
    'scripts/workflow-lint.mjs',
  ];
  const [evidenceCommand, ...sources] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'evidence-command.mjs'), 'utf8'),
    ...names.map((name) => readFile(path.join(repositoryRoot, name), 'utf8')),
  ]);

  assert.match(evidenceCommand, /evidenceCommandMaximumDurationMs = 180_000/);
  assert.match(evidenceCommand, /evidenceCommandMaximumOutputBytes = 2 \* 1024 \* 1024/);
  assert.match(evidenceCommand, /shell: false/);
  assert.match(evidenceCommand, /windowsHide: true/);
  assert.match(evidenceCommand, /timeout: timeoutMs/);
  assert.match(evidenceCommand, /killSignal: 'SIGTERM'/);
  assert.match(evidenceCommand, /maxBuffer: evidenceCommandMaximumOutputBytes/);
  for (const [index, source] of sources.entries()) {
    assert.match(source, /runEvidenceCommand/, names[index]);
    assert.doesNotMatch(source, /node:child_process|\bspawnSync\(/, names[index]);
  }
  assert.match(sources[0], /kubernetesEvidenceCommandTimeoutMs = 30_000/);
  assert.match(sources[0], /timeoutMs: kubernetesEvidenceCommandTimeoutMs/);
  assert.match(sources[1], /runEvidenceCommand\(command, args, options\)/);
  assert.match(sources[2], /runEvidenceCommand\(command, args, options\)/);
});

test('direct synchronous evidence runners pin the complete process termination contract', async () => {
  const names = [
    'scripts/authorization-evidence.mjs',
    'scripts/audit-chain-evidence.mjs',
    'scripts/oidc-browser-evidence.mjs',
    'scripts/sdk-consumer-evidence.mjs',
    'scripts/sdk-release-evidence.mjs',
    'scripts/sdk-consumer-matrix-evidence.mjs',
    'scripts/server-recovery-drill.mjs',
  ];
  const sources = await Promise.all(
    names.map((name) => readFile(path.join(repositoryRoot, name), 'utf8')),
  );

  for (const [index, source] of sources.entries()) {
    assert.equal(source.match(/spawnSync\(/g)?.length ?? 0, 1, names[index]);
    assert.match(source, /shell:\s*false/, names[index]);
    assert.match(source, /windowsHide:\s*true/, names[index]);
    assert.match(source, /timeout:\s*[^,]+/, names[index]);
    assert.match(source, /killSignal:\s*'SIGTERM'/, names[index]);
    assert.match(source, /maxBuffer:\s*4 \* 1024 \* 1024/, names[index]);
  }
});

test('Git status summaries keep dirty counts and hashes deterministic', () => {
  const status = ' M scripts/evidence-manifest.mjs\n?? .temp/cache/item-000001\n';
  const summary = summarizeGitStatus(status);

  assert.deepEqual(summary, {
    dirty: true,
    changedFileCount: 2,
    statusSha256: createHash('sha256').update(status).digest('hex'),
  });
  assert.deepEqual(summarizeGitStatus(''), {
    dirty: false,
    changedFileCount: 0,
    statusSha256: createHash('sha256').update('').digest('hex'),
  });
});

test('evidence manifest archives hashes and keeps unverified boundaries explicit', async () => {
  const scriptPath = path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs');
  const [script, verifier, atomicOutput, boundedCommand, contract, packageDocument, natsClusterEvidenceHelper] = await Promise.all([
    readFile(scriptPath, 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'atomic-output.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'bounded-command.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'evidence-manifest-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-cluster-evidence.mjs'), 'utf8'),
  ]);
  assert.match(script, /createHash\(['"]sha256['"]\)/);
  assert.match(script, /--untracked-files=all/);
  assert.match(script, /runBoundedCommand/);
  assert.match(script, /summarizeGitStatus/);
  assert.match(script, /writeFileAtomicallySync\(outputPath/);
  assert.doesNotMatch(script, /writeFileSync\(outputPath/);
  assert.match(atomicOutput, /openSync\(temporaryPath, 'wx', mode\)/);
  assert.match(atomicOutput, /fsyncSync\(descriptor\)/);
  assert.match(atomicOutput, /renameSync\(temporaryPath, outputPath\)/);
  assert.match(boundedCommand, /maximumCommandDurationMs = 30_000/);
  assert.match(boundedCommand, /maximumCommandOutputBytes = 64 \* 1024 \* 1024/);
  assert.match(boundedCommand, /maxBuffer: maximumCommandOutputBytes/);
  assert.match(boundedCommand, /timeout: timeoutMs/);
  assert.match(boundedCommand, /const deadline = readCommandClock\(now\) \+ timeoutMs/);
  assert.match(boundedCommand, /timeout: remainingTimeoutMs/);
  assert.match(boundedCommand, /killSignal: 'SIGTERM'/);
  assert.match(boundedCommand, /changedFileCount/);
  assert.match(boundedCommand, /statusSha256/);
  assert.match(script, /productionSharedStore/);
  assert.match(script, /not_recorded/);
  assert.match(script, /output must be a \.json file inside the repository \.temp directory/);
  assert.match(verifier, /Evidence manifest verified/);
  assert.match(verifier, /hash mismatch/);
  assert.match(verifier, /contains an unsafe path/);
  assert.match(verifier, /function requireExactKeys\(value, name, keys\)/);
  assert.match(verifier, /must contain exactly these keys/);
  assert.match(verifier, /repository Git commit must match the current repository commit/);
  assert.match(verifier, /repository Git status hash no longer matches the manifest/);
  assert.match(verifier, /current repository Git commit is unavailable/);
  assert.match(verifier, /runBoundedCommand/);
  assert.match(verifier, /summarizeGitStatus/);
  assert.match(verifier, /generatedAt must not be in the future/);
  assert.match(verifier, /inputs must exactly match the evidence input contract/);
  assert.match(verifier, /is a required evidence input and must be present/);
  assert.match(script, /evidence inventory must not contain symbolic links/);
  assert.match(verifier, /evidence inventory must not contain symbolic links/);
  assert.match(script, /manifest output parent directory/);
  assert.match(verifier, /manifest parent directory/);
  assert.match(script, /must be a regular file with exactly one hard link/);
  assert.match(verifier, /must be a regular file with exactly one hard link/);
  assert.match(script, /evidence inventory must not contain hard-linked files/);
  assert.match(verifier, /evidence inventory must not contain hard-linked files/);
  assert.match(verifier, /must exactly match the current artifact inventory/);
  assert.match(script, /evidenceInputPaths\.map\(describeInput\)/);
  assert.match(contract, /Object\.freeze\(\[/);
  assert.match(verifier, /recorded localNatsRestart is missing required artifact/);
  assert.match(verifier, /single-node restart contract/);
  assert.match(verifier, /recorded localNatsClusterFailover is missing required artifact/);
  assert.match(verifier, /verifyNatsClusterContractArtifacts/);
  assert.match(verifier, /NATS cluster evidence artifact is missing from the manifest/);
  assert.match(natsClusterEvidenceHelper, /schemaVersion !== 6/);
  assert.match(natsClusterEvidenceHelper, /requiredLeaseNanos !== 8_515_000_000/);
  assert.match(natsClusterEvidenceHelper, /workerAckWaitNanos !== expectedContract\.workerAckWaitNanos/);
  assert.match(natsClusterEvidenceHelper, /persistedAfterQuorumRecovery !== 8/);
  assert.match(natsClusterEvidenceHelper, /persistedAfterConcurrentRecovery !== 10/);
  assert.match(natsClusterEvidenceHelper, /persistedAfterPartitionRecovery !== 12/);
  assert.match(natsClusterEvidenceHelper, /totalServerStarts !== 8/);
  assert.equal(
    JSON.parse(packageDocument).scripts['evidence:verify'],
    'node scripts/evidence-verify.mjs',
  );

    await mkdir(path.join(repositoryRoot, '.temp'), { recursive: true });
    const recoveryRoot = path.join(repositoryRoot, '.temp', 'recovery');
    await mkdir(recoveryRoot, { recursive: true });
    const workflowArtifactsRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts');
    await mkdir(workflowArtifactsRoot, { recursive: true });
    const temporaryDirectory = await mkdtemp(path.join(repositoryRoot, '.temp', 'manifest-test-'));
    const artifactDirectory = await mkdtemp(path.join(recoveryRoot, 'manifest-verify-'));
    const workflowArtifactDirectory = await mkdtemp(path.join(workflowArtifactsRoot, 'manifest-verify-'));
    const outputPath = path.join(temporaryDirectory, 'manifest.json');
    const artifactPath = path.join(artifactDirectory, 'recovery-result.txt');
    await writeFile(path.join(workflowArtifactDirectory, 'inventory-sentinel.txt'), 'manifest inventory sentinel\n', 'utf8');
  try {
    const result = runScript('scripts/evidence-manifest.mjs', ['--output', outputPath]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(manifest.repository.gitCommit, /^[a-f0-9]{40}$/);
    assert.match(manifest.repository.statusSha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(manifest.inputs));
    assert.deepEqual(manifest.inputs.map((input) => input.path), evidenceInputPaths);
    assert.deepEqual(optionalEvidenceInputPaths, ['go.work.sum']);
    assert.ok(
      manifest.inputs.filter((input) => !input.present).every((input) => optionalEvidenceInputPaths.includes(input.path)),
    );
    assert.ok(manifest.inputs.some((input) => input.path === 'package.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/observability/metrics.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/auth/jwks.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/auth/jwks_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/application_query.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/auth_middleware.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/app_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/middleware_rate_limit_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/standard_handler.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/standard_handler_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_chain.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_chain_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_sink.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_sink_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/token_verifier_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/observability/tracing_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/.gitignore' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/README.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/prometheus.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/rules/goexample-slo.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/tests/goexample-slo.test.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/edge/goexample-nginx.contract.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/edge/README.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/kubernetes/goexample-api.template.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/kubernetes/README.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/security/server-threat-model.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/security/server-audit-events.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V13.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V14.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V15.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V16.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V17.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V18.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V19.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V20.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V42.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V43.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V44.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V46.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V47.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V48.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V49.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V50.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V51.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V52.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V53.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V54.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V55.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V56.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'SDK/GoExample/release-manifest.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'SDK/Billing/release-manifest.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/evidence-manifest.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/evidence-verify.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/bounded-command.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/evidence-command.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/environment-fetch.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/evidence-manifest-contract.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/audit-chain-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/audit-chain-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/authorization-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/authorization-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/oidc-browser-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/oidc-browser-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/release-provenance.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/sdk-release.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/sdk-release-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/sdk-release-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/server-recovery-drill.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/server-recovery-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/server-recovery-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/server-recovery-command.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/server-release.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/transport-benchmark-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/transport-benchmark-environment.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/transport-benchmark-stability.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/transport-soak-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/kubernetes-manifest.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/kubernetes-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/kubernetes-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nginx-edge.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nginx-edge-contract.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/nginx-edge-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nginx-edge-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/nats-cluster-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nats-cluster-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/nats-delivery-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nats-delivery-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/nats-restart-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nats-restart-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/nats-snapshot-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nats-snapshot-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/redis-sentinel-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/redis-sentinel-evidence.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/postgres-recovery-contract.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/postgres-recovery-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/kubernetes-manifest.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/audit-chain-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/authorization-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/oidc-browser-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/kubernetes-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/evidence-command.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/environment-fetch.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/sdk-release-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nginx-edge.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nginx-edge-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nats-cluster-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nats-delivery-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nats-restart-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nats-snapshot-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/redis-sentinel-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/postgres-recovery-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/release-provenance.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/server-release.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/server-recovery-evidence.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/server-recovery-command.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/transport-benchmark-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/transport-soak-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '.github/workflows/go-transport-benchmark.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '.github/workflows/node-tools-quality.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/recovery/server-failure-matrix.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/routes_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/openapi_contract_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/transport_benchmark_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapp/service_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/queueclient/natsjetstream/cluster_integration_test.go' && input.sha256));
    assert.ok(manifest.boundaries.productionSharedStore.status === 'not_recorded');
    assert.ok(manifest.boundaries.otelCollector.status === 'not_recorded');
    assert.ok(manifest.boundaries.postgresRecovery.status === 'not_recorded');
    assert.ok(manifest.boundaries.natsBroker.status === 'not_recorded');
    assert.ok(['recorded', 'failed', 'not_recorded'].includes(manifest.boundaries.localNatsRestart.status));
    assert.ok(['recorded', 'failed', 'not_recorded'].includes(manifest.boundaries.localNatsClusterFailover.status));
    assert.ok(manifest.boundaries.oidcProvider.status === 'not_recorded');
    assert.ok(manifest.boundaries.signedRelease.status === 'not_recorded');
    assert.ok(manifest.boundaries.targetEdge.status === 'not_recorded');
    assert.ok(manifest.boundaries.kubernetesDrill.status === 'not_recorded');

    const verified = runScript('scripts/evidence-verify.mjs', ['--manifest', outputPath]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Evidence manifest verified/);

    await mkdir(path.join(repositoryRoot, 'node_modules'), { recursive: true });
    const outsideOutputDirectory = await mkdtemp(
      path.join(repositoryRoot, 'node_modules', '.manifest-junction-test-'),
    );
    const linkedOutputParent = path.join(
      repositoryRoot,
      '.temp',
      `manifest-output-junction-${process.pid}-${Date.now()}`,
    );
    await symlink(
      outsideOutputDirectory,
      linkedOutputParent,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    try {
      const linkedManifestPath = path.join(linkedOutputParent, 'manifest.json');
      const linkedGeneration = runScript(
        'scripts/evidence-manifest.mjs',
        ['--output', linkedManifestPath],
      );
      assert.equal(linkedGeneration.status, 1);
      assert.match(linkedGeneration.stderr, /manifest output parent directory must not contain symbolic links/);

      await writeFile(
        path.join(outsideOutputDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
      const linkedVerification = runScript(
        'scripts/evidence-verify.mjs',
        ['--manifest', linkedManifestPath],
      );
      assert.equal(linkedVerification.status, 1);
      assert.match(linkedVerification.stderr, /manifest parent directory must not contain symbolic links/);
    } finally {
      await unlink(linkedOutputParent).catch(() => {});
      await rm(outsideOutputDirectory, { recursive: true, force: true });
    }

    const hardlinkOutputDirectory = await mkdtemp(path.join(repositoryRoot, '.temp', 'manifest-hardlink-test-'));
    try {
      const peerPath = path.join(hardlinkOutputDirectory, 'peer.txt');
      const hardlinkManifestPath = path.join(hardlinkOutputDirectory, 'manifest.json');
      await writeFile(peerPath, 'hardlink peer sentinel\n', 'utf8');
      await link(peerPath, hardlinkManifestPath);
      const hardlinkGeneration = runScript(
        'scripts/evidence-manifest.mjs',
        ['--output', hardlinkManifestPath],
      );
      assert.equal(hardlinkGeneration.status, 1);
      assert.match(hardlinkGeneration.stderr, /manifest output must be a regular file with exactly one hard link/);
      assert.equal(await readFile(peerPath, 'utf8'), 'hardlink peer sentinel\n');

      await writeFile(peerPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const hardlinkVerification = runScript(
        'scripts/evidence-verify.mjs',
        ['--manifest', hardlinkManifestPath],
      );
      assert.equal(hardlinkVerification.status, 1);
      assert.match(hardlinkVerification.stderr, /manifest must be a regular file with exactly one hard link/);
    } finally {
      await rm(hardlinkOutputDirectory, { recursive: true, force: true });
    }

    const hardlinkArtifactPath = path.join(artifactDirectory, 'hardlink-source.txt');
    const hardlinkArtifactAlias = path.join(artifactDirectory, 'hardlink-alias.txt');
    await writeFile(hardlinkArtifactPath, 'hard-linked artifact\n', 'utf8');
    await link(hardlinkArtifactPath, hardlinkArtifactAlias);
    try {
      const hardlinkArtifactGeneration = runScript(
        'scripts/evidence-manifest.mjs',
        ['--output', outputPath],
      );
      assert.equal(hardlinkArtifactGeneration.status, 1);
      assert.match(hardlinkArtifactGeneration.stderr, /evidence inventory must not contain hard-linked files/);

      const hardlinkArtifactVerification = runScript(
        'scripts/evidence-verify.mjs',
        ['--manifest', outputPath],
      );
      assert.equal(hardlinkArtifactVerification.status, 1);
      assert.match(hardlinkArtifactVerification.stderr, /evidence inventory must not contain hard-linked files/);
    } finally {
      await rm(hardlinkArtifactAlias, { force: true });
      await rm(hardlinkArtifactPath, { force: true });
    }

    const linkedArtifactPath = path.join(recoveryRoot, 'manifest-symlink-test');
    await symlink(
      temporaryDirectory,
      linkedArtifactPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    try {
      const linkedArtifactGeneration = runScript(
        'scripts/evidence-manifest.mjs',
        ['--output', outputPath],
      );
      assert.equal(linkedArtifactGeneration.status, 1);
      assert.match(
        linkedArtifactGeneration.stderr,
        /evidence inventory must not contain symbolic links/,
      );

      const linkedArtifactVerification = runScript(
        'scripts/evidence-verify.mjs',
        ['--manifest', outputPath],
      );
      assert.equal(linkedArtifactVerification.status, 1);
      assert.match(
        linkedArtifactVerification.stderr,
        /evidence inventory must not contain symbolic links/,
      );
    } finally {
      await rm(linkedArtifactPath, { force: true });
    }

    const downgradedCommitManifest = JSON.parse(JSON.stringify(manifest));
    downgradedCommitManifest.repository.gitCommit = 'unknown';
    const downgradedCommitPath = path.join(temporaryDirectory, 'unknown-git-commit.json');
    await writeFile(downgradedCommitPath, `${JSON.stringify(downgradedCommitManifest, null, 2)}\n`, 'utf8');
    const downgradedCommit = runScript('scripts/evidence-verify.mjs', ['--manifest', downgradedCommitPath]);
    assert.equal(downgradedCommit.status, 1);
    assert.match(downgradedCommit.stderr, /repository\.gitCommit must be a full lowercase Git commit/);

    const unavailableGit = runScript('scripts/evidence-verify.mjs', ['--manifest', outputPath], { PATH: '' });
    assert.equal(unavailableGit.status, 1);
    assert.match(unavailableGit.stderr, /current repository Git commit is unavailable/);

    const repositoryTamperCases = [
      [
        'status-hash',
        (copy) => { copy.repository.statusSha256 = `${copy.repository.statusSha256[0] === '0' ? '1' : '0'}${copy.repository.statusSha256.slice(1)}`; },
        /repository Git status hash no longer matches the manifest/,
      ],
      [
        'dirty',
        (copy) => { copy.repository.dirty = !copy.repository.dirty; },
        /repository dirty state/,
      ],
      [
        'changed-file-count',
        (copy) => { copy.repository.changedFileCount += 1; },
        /repository dirty state/,
      ],
    ];
    for (const [name, mutate, expectedError] of repositoryTamperCases) {
      const tamperedManifest = JSON.parse(JSON.stringify(manifest));
      mutate(tamperedManifest);
      const tamperedPath = path.join(temporaryDirectory, `tampered-repository-${name}.json`);
      await writeFile(tamperedPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8');
      const tampered = runScript('scripts/evidence-verify.mjs', ['--manifest', tamperedPath]);
      assert.equal(tampered.status, 1, name);
      assert.match(tampered.stderr, expectedError);
    }

    const futureManifest = JSON.parse(JSON.stringify(manifest));
    futureManifest.generatedAt = new Date(Date.now() + 60_000).toISOString();
    const futureManifestPath = path.join(temporaryDirectory, 'future-generated-at.json');
    await writeFile(futureManifestPath, `${JSON.stringify(futureManifest, null, 2)}\n`, 'utf8');
    const futureResult = runScript('scripts/evidence-verify.mjs', ['--manifest', futureManifestPath]);
    assert.equal(futureResult.status, 1);
    assert.match(futureResult.stderr, /generatedAt must not be in the future/);

    const omittedArtifactManifest = JSON.parse(JSON.stringify(manifest));
    assert.ok(omittedArtifactManifest.evidence.workflowArtifacts.length > 0);
    omittedArtifactManifest.evidence.workflowArtifacts.pop();
    const omittedArtifactPath = path.join(temporaryDirectory, 'omitted-artifact.json');
    await writeFile(omittedArtifactPath, `${JSON.stringify(omittedArtifactManifest, null, 2)}\n`, 'utf8');
    const omittedArtifact = runScript('scripts/evidence-verify.mjs', ['--manifest', omittedArtifactPath]);
    assert.equal(omittedArtifact.status, 1);
    assert.match(omittedArtifact.stderr, /evidence\.workflowArtifacts must exactly match the current artifact inventory/);

    const omittedInputManifest = JSON.parse(JSON.stringify(manifest));
    omittedInputManifest.inputs.pop();
    const omittedInputPath = path.join(temporaryDirectory, 'omitted-input.json');
    await writeFile(omittedInputPath, `${JSON.stringify(omittedInputManifest, null, 2)}\n`, 'utf8');
    const omittedInput = runScript('scripts/evidence-verify.mjs', ['--manifest', omittedInputPath]);
    assert.equal(omittedInput.status, 1);
    assert.match(omittedInput.stderr, /inputs must exactly match the evidence input contract/);

    const absentRequiredInputManifest = JSON.parse(JSON.stringify(manifest));
    absentRequiredInputManifest.inputs[0] = {
      path: evidenceInputPaths[0],
      present: false,
    };
    const absentRequiredInputPath = path.join(temporaryDirectory, 'absent-required-input.json');
    await writeFile(
      absentRequiredInputPath,
      `${JSON.stringify(absentRequiredInputManifest, null, 2)}\n`,
      'utf8',
    );
    const absentRequiredInput = runScript(
      'scripts/evidence-verify.mjs',
      ['--manifest', absentRequiredInputPath],
    );
    assert.equal(absentRequiredInput.status, 1);
    assert.match(absentRequiredInput.stderr, /is a required evidence input and must be present/);

    const replacementContents = await readFile(path.join(repositoryRoot, 'README.md'));
    const replacedInputManifest = JSON.parse(JSON.stringify(manifest));
    replacedInputManifest.inputs[0] = {
      path: 'README.md',
      present: true,
      bytes: replacementContents.length,
      sha256: createHash('sha256').update(replacementContents).digest('hex'),
    };
    const replacedInputPath = path.join(temporaryDirectory, 'replaced-input.json');
    await writeFile(replacedInputPath, `${JSON.stringify(replacedInputManifest, null, 2)}\n`, 'utf8');
    const replacedInput = runScript('scripts/evidence-verify.mjs', ['--manifest', replacedInputPath]);
    assert.equal(replacedInput.status, 1);
    assert.match(replacedInput.stderr, /inputs\[0\]\.path must exactly match the evidence input contract/);

    const exactKeyCases = [
      ['manifest', (copy) => { copy.unexpected = true; }],
      ['repository', (copy) => { copy.repository.unexpected = true; }],
      ['toolchain', (copy) => { copy.toolchain.unexpected = true; }],
    ];
    for (const [name, mutate] of exactKeyCases) {
      const tamperedManifest = JSON.parse(JSON.stringify(manifest));
      mutate(tamperedManifest);
      const tamperedPath = path.join(temporaryDirectory, `extra-${name}.json`);
      await writeFile(tamperedPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8');
      const tampered = runScript('scripts/evidence-verify.mjs', ['--manifest', tamperedPath]);
      assert.equal(tampered.status, 1, name);
      assert.match(tampered.stderr, new RegExp(`${name} must contain exactly these keys`));
    }

    for (const name of ['node', 'yarn', 'go', 'goToolchain']) {
      const tamperedManifest = JSON.parse(JSON.stringify(manifest));
      tamperedManifest.toolchain[name] = `${tamperedManifest.toolchain[name]}-tampered`;
      const tamperedPath = path.join(temporaryDirectory, `tampered-toolchain-${name}.json`);
      await writeFile(tamperedPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8');
      const tampered = runScript('scripts/evidence-verify.mjs', ['--manifest', tamperedPath]);
      assert.equal(tampered.status, 1, name);
      assert.match(
        tampered.stderr,
        new RegExp(`toolchain\\.${name} does not match|repository Git status hash no longer matches the manifest`),
      );
    }

    const extraInputManifest = JSON.parse(JSON.stringify(manifest));
    extraInputManifest.inputs[0].unexpected = true;
    const extraInputPath = path.join(temporaryDirectory, 'extra-input.json');
    await writeFile(extraInputPath, `${JSON.stringify(extraInputManifest, null, 2)}\n`, 'utf8');
    const extraInput = runScript('scripts/evidence-verify.mjs', ['--manifest', extraInputPath]);
    assert.equal(extraInput.status, 1);
    assert.match(extraInput.stderr, /inputs\[0\] must contain exactly these keys/);

    const falseRecoveryManifest = JSON.parse(JSON.stringify(manifest));
    falseRecoveryManifest.boundaries.postgresRecovery.status = 'recorded';
    falseRecoveryManifest.boundaries.postgresRecovery.reason = 'forged recorded state';
    const falseRecoveryPath = path.join(temporaryDirectory, 'false-postgres-recovery.json');
    await writeFile(falseRecoveryPath, `${JSON.stringify(falseRecoveryManifest, null, 2)}\n`, 'utf8');
    const falseRecovery = runScript('scripts/evidence-verify.mjs', ['--manifest', falseRecoveryPath]);
    assert.equal(falseRecovery.status, 1);
    assert.match(falseRecovery.stderr, /recorded postgresRecovery is missing required artifact/);

    const falseNatsRestartManifest = JSON.parse(JSON.stringify(manifest));
    falseNatsRestartManifest.evidence.natsRestart = [];
    falseNatsRestartManifest.boundaries.localNatsRestart.status = 'recorded';
    falseNatsRestartManifest.boundaries.localNatsRestart.reason = 'forged recorded state';
    const falseNatsRestartPath = path.join(temporaryDirectory, 'false-nats-restart.json');
    await writeFile(falseNatsRestartPath, `${JSON.stringify(falseNatsRestartManifest, null, 2)}\n`, 'utf8');
    const falseNatsRestart = runScript('scripts/evidence-verify.mjs', ['--manifest', falseNatsRestartPath]);
    assert.equal(falseNatsRestart.status, 1);
    assert.match(
      falseNatsRestart.stderr,
      /evidence\.natsRestart must exactly match the current artifact inventory|recorded localNatsRestart is missing required artifact/,
    );

    const falseNatsClusterManifest = JSON.parse(JSON.stringify(manifest));
    falseNatsClusterManifest.evidence.natsCluster = [];
    falseNatsClusterManifest.boundaries.localNatsClusterFailover.status = 'recorded';
    falseNatsClusterManifest.boundaries.localNatsClusterFailover.reason = 'forged recorded state';
    const falseNatsClusterPath = path.join(temporaryDirectory, 'false-nats-cluster.json');
    await writeFile(falseNatsClusterPath, `${JSON.stringify(falseNatsClusterManifest, null, 2)}\n`, 'utf8');
    const falseNatsCluster = runScript('scripts/evidence-verify.mjs', ['--manifest', falseNatsClusterPath]);
    assert.equal(falseNatsCluster.status, 1);
    assert.match(
      falseNatsCluster.stderr,
      /evidence\.natsCluster must exactly match the current artifact inventory|recorded localNatsClusterFailover is missing required artifact/,
    );

    await writeFile(artifactPath, 'verified recovery artifact\n', 'utf8');
    const artifactManifest = JSON.parse(JSON.stringify(manifest));
    const artifactContents = await readFile(artifactPath);
    const artifactRelativePath = path.relative(repositoryRoot, artifactPath).split(path.sep).join('/');
    artifactManifest.evidence.recovery.push({
      path: artifactRelativePath,
      bytes: artifactContents.length,
      sha256: createHash('sha256').update(artifactContents).digest('hex'),
    });
    artifactManifest.evidence.recovery.sort((left, right) => left.path.localeCompare(right.path));
    const artifactManifestPath = path.join(temporaryDirectory, 'artifact.json');
    await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');
    const artifactVerified = runScript('scripts/evidence-verify.mjs', ['--manifest', artifactManifestPath]);
    assert.equal(artifactVerified.status, 0, artifactVerified.stderr);

    const artifactRecord = artifactManifest.evidence.recovery.find((artifact) => artifact.path === artifactRelativePath);
    assert.ok(artifactRecord);
    artifactRecord.unexpected = true;
    await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');
    const extraArtifact = runScript('scripts/evidence-verify.mjs', ['--manifest', artifactManifestPath]);
    assert.equal(extraArtifact.status, 1);
    assert.match(extraArtifact.stderr, /evidence\.recovery\[\d+\] must contain exactly these keys/);
    delete artifactRecord.unexpected;
    await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');

    const extraBoundaryManifest = JSON.parse(JSON.stringify(artifactManifest));
    extraBoundaryManifest.boundaries.targetEdge.unexpected = true;
    const extraBoundaryPath = path.join(temporaryDirectory, 'extra-boundary.json');
    await writeFile(extraBoundaryPath, `${JSON.stringify(extraBoundaryManifest, null, 2)}\n`, 'utf8');
    const extraBoundary = runScript('scripts/evidence-verify.mjs', ['--manifest', extraBoundaryPath]);
    assert.equal(extraBoundary.status, 1);
    assert.match(extraBoundary.stderr, /boundaries\.targetEdge must contain exactly these keys/);

    await writeFile(artifactPath, 'tampered recovery artifact\n', 'utf8');
    const tampered = runScript('scripts/evidence-verify.mjs', ['--manifest', artifactManifestPath]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /hash mismatch/);

    const unsafeManifest = JSON.parse(JSON.stringify(manifest));
    unsafeManifest.inputs[0].path = '../go.work';
    const unsafeManifestPath = path.join(temporaryDirectory, 'unsafe.json');
    await writeFile(unsafeManifestPath, `${JSON.stringify(unsafeManifest, null, 2)}\n`, 'utf8');
    const unsafe = runScript('scripts/evidence-verify.mjs', ['--manifest', unsafeManifestPath]);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /contains an unsafe path/);

    const outsidePath = path.join(repositoryRoot, 'manifest-outside-temp.json');
    const rejected = runScript('scripts/evidence-manifest.mjs', ['--output', outsidePath]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /inside the repository \.temp directory/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(artifactDirectory, { recursive: true, force: true });
    await rm(workflowArtifactDirectory, { recursive: true, force: true });
  }
});

test('atomic output publishes complete files and preserves the prior target on failure', async () => {
  const destination = path.join(repositoryRoot, '.temp', 'atomic-output-contract', 'manifest.json');
  const successEvents = [];
  let successTemporaryPath = null;
  writeFileAtomicallySync(destination, 'new manifest\n', {
    operations: {
      openSync(filePath, flags, mode) {
        successTemporaryPath = filePath;
        successEvents.push(['open', flags, mode]);
        return 17;
      },
      writeFileSync(descriptor, data, options) {
        successEvents.push(['write', descriptor, data, options.encoding]);
      },
      fsyncSync(descriptor) {
        successEvents.push(['fsync', descriptor]);
      },
      closeSync(descriptor) {
        successEvents.push(['close', descriptor]);
      },
      renameSync(source, target) {
        successEvents.push(['rename', source, target]);
      },
      rmSync() {
        assert.fail('successful publication must not clean up the committed temporary path');
      },
    },
  });
  assert.equal(path.dirname(successTemporaryPath), path.dirname(destination));
  assert.notEqual(successTemporaryPath, destination);
  assert.match(path.basename(successTemporaryPath), /^\.manifest\.json\.\d+-[a-f0-9]{32}\.tmp$/);
  assert.deepEqual(successEvents, [
    ['open', 'wx', 0o666],
    ['write', 17, 'new manifest\n', 'utf8'],
    ['fsync', 17],
    ['close', 17],
    ['rename', successTemporaryPath, destination],
  ]);

  const writeFailure = new Error('injected write failure');
  const closeFailure = new Error('injected cleanup close failure');
  const removeFailure = new Error('injected cleanup remove failure');
  const failureEvents = [];
  assert.throws(
    () => writeFileAtomicallySync(destination, 'invalid', {
      operations: {
        openSync(filePath, flags) {
          failureEvents.push(['open', filePath, flags]);
          return 23;
        },
        writeFileSync() {
          failureEvents.push(['write']);
          throw writeFailure;
        },
        fsyncSync() {
          assert.fail('failed writes must not be synchronized');
        },
        closeSync(descriptor) {
          failureEvents.push(['close', descriptor]);
          throw closeFailure;
        },
        renameSync() {
          assert.fail('failed writes must not replace the canonical output');
        },
        rmSync(filePath, options) {
          failureEvents.push(['remove', filePath, options.force]);
          throw removeFailure;
        },
      },
    }),
    (error) => error === writeFailure,
  );
  assert.deepEqual(failureEvents.map(([event]) => event), ['open', 'write', 'close', 'remove']);
  assert.equal(failureEvents[0][2], 'wx');
  assert.equal(failureEvents[2][1], 23);
  assert.equal(failureEvents[3][1], failureEvents[0][1]);
  assert.equal(failureEvents[3][2], true);

  const renameFailure = new Error('injected rename failure');
  const renameEvents = [];
  assert.throws(
    () => writeFileAtomicallySync(destination, 'complete but unpublished', {
      operations: {
        openSync(filePath) {
          renameEvents.push(['open', filePath]);
          return 29;
        },
        writeFileSync() {
          renameEvents.push(['write']);
        },
        fsyncSync() {
          renameEvents.push(['fsync']);
        },
        closeSync() {
          renameEvents.push(['close']);
        },
        renameSync() {
          renameEvents.push(['rename']);
          throw renameFailure;
        },
        rmSync(filePath, options) {
          renameEvents.push(['remove', filePath, options.force]);
        },
      },
    }),
    (error) => error === renameFailure,
  );
  assert.deepEqual(renameEvents.map(([event]) => event), ['open', 'write', 'fsync', 'close', 'rename', 'remove']);
  assert.equal(renameEvents.at(-1)[1], renameEvents[0][1]);
  assert.equal(renameEvents.at(-1)[2], true);

  const realDirectory = await mkdtemp(path.join(repositoryRoot, '.temp', 'atomic-output-'));
  const realDestination = path.join(realDirectory, 'manifest.json');
  try {
    await writeFile(realDestination, 'old manifest\n', 'utf8');
    writeFileAtomicallySync(realDestination, 'complete new manifest\n');
    assert.equal(await readFile(realDestination, 'utf8'), 'complete new manifest\n');
    assert.deepEqual(await readdir(realDirectory), ['manifest.json']);

    const baselinePath = path.join(realDirectory, 'baseline.json');
    const provenancePath = path.join(realDirectory, 'baseline-source.json');
    await writeFile(baselinePath, 'old baseline\n', 'utf8');
    await writeFile(provenancePath, 'old provenance\n', 'utf8');
    const secondWriteFailure = new Error('injected second write failure');
    let writeCount = 0;
    assert.throws(
      () => writeFilesWithRollbackSync([
        { outputPath: baselinePath, data: 'new baseline\n' },
        { outputPath: provenancePath, data: 'new provenance\n' },
      ], {
        writeOutput(outputPath, data, options) {
          writeCount += 1;
          if (writeCount === 2) {
            throw secondWriteFailure;
          }
          writeFileAtomicallySync(outputPath, data, options);
        },
      }),
      (error) => error === secondWriteFailure,
    );
    assert.equal(await readFile(baselinePath, 'utf8'), 'old baseline\n');
    assert.equal(await readFile(provenancePath, 'utf8'), 'old provenance\n');

    await rm(baselinePath, { force: true });
    writeCount = 0;
    assert.throws(
      () => writeFilesWithRollbackSync([
        { outputPath: baselinePath, data: 'new baseline\n' },
        { outputPath: provenancePath, data: 'new provenance\n' },
      ], {
        writeOutput(outputPath, data, options) {
          writeCount += 1;
          if (writeCount === 2) {
            throw secondWriteFailure;
          }
          writeFileAtomicallySync(outputPath, data, options);
        },
      }),
      (error) => error === secondWriteFailure,
    );
    await assert.rejects(readFile(baselinePath, 'utf8'), /ENOENT/);
    assert.equal(await readFile(provenancePath, 'utf8'), 'old provenance\n');

    const rollbackFailure = new Error('injected rollback failure');
    await writeFile(baselinePath, 'old baseline\n', 'utf8');
    writeCount = 0;
    assert.throws(
      () => writeFilesWithRollbackSync([
        { outputPath: baselinePath, data: 'new baseline\n' },
        { outputPath: provenancePath, data: 'new provenance\n' },
      ], {
        writeOutput(outputPath, data, options) {
          writeCount += 1;
          if (writeCount === 2) {
            throw secondWriteFailure;
          }
          if (writeCount === 3) {
            throw rollbackFailure;
          }
          writeFileAtomicallySync(outputPath, data, options);
        },
      }),
      (error) => (
        error instanceof AggregateError
        && error.cause === secondWriteFailure
        && error.errors.includes(rollbackFailure)
      ),
    );
  } finally {
    await rm(realDirectory, { recursive: true, force: true });
  }
});

test('Go server release is checksum-bound, tamper-tested, and remotely attested', async () => {
  const [releaseScript, releaseCommand, releaseTests, provenanceHelper, provenanceTests, environment, workflow, nodeWorkflow, packageDocument, evidenceManifest, evidenceVerify] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'server-release.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'server-release-command.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'server-release.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'release-provenance.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'release-provenance.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'environment.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;

  assert.match(scripts['test:node'], /--test-concurrency=1/);
  assert.match(scripts['test:node'], /release-provenance\.test\.mjs/);
  assert.match(scripts['test:node'], /workflow-lint\.test\.mjs __test__\/node\/contract-command\.test\.mjs __test__\/node\/go-project-command\.test\.mjs __test__\/node\/evidence-command\.test\.mjs __test__\/node\/environment-fetch\.test\.mjs && node --test --test-concurrency=1 __test__\/node\/server-release\.test\.mjs$/);
  assert.equal(scripts['release:server:build'], 'node scripts/server-release.mjs build');
  assert.equal(scripts['release:server:verify'], 'node scripts/server-release.mjs verify');
  assert.match(releaseScript, /CGO_ENABLED: '0'/);
  assert.match(releaseScript, /GOOS: 'linux'/);
  assert.match(releaseScript, /GOARCH: 'amd64'/);
  assert.match(releaseScript, /GOTOOLCHAIN: 'local'/);
  assert.match(releaseScript, /isolatedGoToolchainEnvironment\(process\.env/);
  assert.match(releaseScript, /'-trimpath', '-buildvcs=false'/);
  assert.match(releaseScript, /little-endian ELF64 amd64 binary/);
  assert.match(releaseScript, /SHA256SUMS must contain exactly the expected attested release subjects/);
  assert.match(releaseScript, /SERVER_RELEASE_REQUIRE_CLEAN/);
  assert.match(releaseScript, /--untracked-files=all/);
  assert.match(releaseScript, /go-build-cache/);
  assert.match(releaseScript, /goBuildCacheEmptyBeforeBuild/);
  assert.match(releaseScript, /moduleCache: 'shared'/);
  assert.match(releaseScript, /goexample_server_release_sources/);
  assert.match(releaseScript, /'list', '-deps'/);
  assert.match(releaseScript, /source manifest does not exactly match the current server release input closure/);
  assert.match(releaseScript, /createServerReleaseCommandRunner\(\{ cwd: repositoryRoot \}\)/);
  assert.match(releaseScript, /scripts\/lib\/server-release-command\.mjs/);
  assert.match(releaseScript, /timeoutMs: serverReleaseMetadataCommandTimeoutMs/);
  assert.match(releaseScript, /timeoutMs: serverReleaseDependencyCommandTimeoutMs/);
  assert.match(releaseScript, /timeoutMs: serverReleaseBuildCommandTimeoutMs/);
  assert.match(releaseScript, /timeoutMs: serverReleaseTaskCommandTimeoutMs/);
  assert.doesNotMatch(releaseScript, /node:child_process|\bspawnSync\b/);
  assert.match(releaseCommand, /serverReleaseCommandMaximumDurationMs = 600_000/);
  assert.match(releaseCommand, /serverReleaseMetadataCommandTimeoutMs = 30_000/);
  assert.match(releaseCommand, /serverReleaseDependencyCommandTimeoutMs = 120_000/);
  assert.match(releaseCommand, /serverReleaseBuildCommandTimeoutMs = 180_000/);
  assert.match(releaseCommand, /serverReleaseTaskCommandTimeoutMs = 600_000/);
  assert.match(releaseCommand, /serverReleaseCommandMaximumOutputBytes = 8 \* 1024 \* 1024/);
  assert.match(releaseCommand, /serverReleaseCommandDiagnosticCharacterLimit = 4_096/);
  assert.match(releaseCommand, /maxBuffer: serverReleaseCommandMaximumOutputBytes/);
  assert.match(releaseCommand, /timeout: timeoutMs/);
  assert.match(releaseCommand, /killSignal: 'SIGTERM'/);
  assert.match(releaseCommand, /shell: false/);
  assert.match(releaseTests, /rejects artifact or metadata tampering/);
  for (const testName of [
    'applies bounded non-shell options',
    'rejects invalid inputs without spawning',
    'classifies timeout, signal, overflow, spawn, exit, and missing-status failures',
    'bounds stderr diagnostics and never reports stdout',
  ]) {
    assert.match(releaseTests, new RegExp(testName));
  }
  assert.match(releaseTests, /isolationTampered/);
  assert.match(releaseTests, /sourceOmissionRejected/);
  assert.match(releaseTests, /sourcePathRejected/);
  assert.match(releaseTests, /sourceReportRejected/);
  assert.match(releaseTests, /reproducibleRerun/);
  assert.match(releaseTests, /poisonedGoRoot/);
  assert.match(releaseTests, /checksumSubjectRemoved/);
  assert.match(releaseTests, /checksumSubjectAdded/);
  assert.match(releaseTests, /appendFile\(artifactPath, 'tampered'\)/);
  assert.match(releaseTests, /manifest\.subject\.name = '\.\.\/outside'/);
  assert.match(provenanceHelper, /application\/vnd\.dev\.sigstore\.bundle\.v0\.3\+json/);
  assert.match(provenanceHelper, /https:\/\/in-toto\.io\/Statement\/v1/);
  assert.match(provenanceHelper, /https:\/\/slsa\.dev\/provenance\/v1/);
  assert.match(provenanceHelper, /https:\/\/actions\.github\.io\/buildtypes\/workflow\/v1/);
  assert.match(provenanceHelper, /verifyReleaseProvenanceBundleSubjects/);
  assert.match(provenanceHelper, /verifyGitHubWorkflowPredicate/);
  assert.match(provenanceHelper, /SLSA resolved dependencies must contain exactly the source repository/);
  assert.match(provenanceHelper, /verifyReleaseAttestationVerification/);
  assert.match(provenanceTests, /digestDrift/);
  assert.match(provenanceTests, /repositoryDrift/);
  assert.match(provenanceTests, /commitDrift/);
  assert.match(provenanceTests, /malformedBase64/);
  assert.match(provenanceTests, /noVerificationMaterial/);
  assert.match(environment, /version === requiredGoVersion/);
  assert.match(environment, /GOEXAMPLE_GO_ARCHIVE/);
  assert.match(environment, /Reusing verified Go archive/);

  assert.match(workflow, /server-release-provenance:/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /go-version: 1\.25\.13/);
  assert.match(workflow, /SERVER_RELEASE_REQUIRE_CLEAN: "true"/);
  assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3\.0\.0/);
  assert.match(workflow, /subject-checksums: \.temp\/server-release\/SHA256SUMS/);
  assert.match(
    workflow,
    /subjects=\([\s\S]*"\$\{artifact\}"[\s\S]*"release-manifest\.json"[\s\S]*"source-manifest\.json"[\s\S]*"reproducibility-report\.json"[\s\S]*\)/,
  );
  assert.match(workflow, /for subject in "\$\{subjects\[@\]\}"/);
  assert.match(workflow, /gh attestation verify "\$\{release_root\}\/\$\{subject\}"/);
  assert.match(workflow, /subject_exit_code=%s/);
  assert.match(workflow, /provenance\.bundle\.json/);
  assert.match(workflow, /attestation-status\.txt/);
  assert.match(workflow, /goexample-server-release-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(
    nodeWorkflow,
    /Set up Go[\s\S]*actions\/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7[\s\S]*go-version: 1\.25\.13[\s\S]*Test root Node tools/,
  );

  assert.match(evidenceManifest, /\['release', path\.join\(tempRoot, 'server-release'\)\]/);
  assert.match(evidenceManifest, /const signedReleaseStatus/);
  assert.match(evidenceManifest, /source-manifest\.json/);
  assert.match(evidenceManifest, /releaseChecksumsPassed/);
  assert.match(evidenceManifest, /releaseProvenancePassed/);
  assert.match(evidenceManifest, /verifyReleaseProvenanceBundleSubjects/);
  assert.match(evidenceManifest, /verifyReleaseAttestationVerification/);
  assert.match(evidenceManifest, /gh attestation verify/);
  assert.match(evidenceVerify, /document\.signedRelease\.status === 'recorded'/);
  assert.match(evidenceVerify, /verifyReleaseProvenanceBundleSubjects/);
  assert.match(evidenceVerify, /verifyReleaseAttestationVerification/);
  assert.match(evidenceVerify, /provenance payload is invalid/);
  assert.match(evidenceVerify, /recorded signedRelease source manifest is invalid/);
  assert.match(evidenceVerify, /does not contain exactly its four attested subjects/);
  assert.match(evidenceVerify, /attestation-status\.txt/);
});

test('server recovery drill stays bounded, archived, and explicit about local-only evidence', async () => {
  const [
    packageDocument,
    workflow,
    runbook,
    evidenceRunner,
    evidenceHelper,
    commandRunner,
    evidenceTests,
    evidenceManifest,
    evidenceVerify,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'server-recovery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'server-recovery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'server-recovery-command.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'server-recovery-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(
    packageScripts['drill:server'],
    'node scripts/server-recovery-drill.mjs',
  );
  assert.equal(packageScripts['drill:server:evidence'], 'node scripts/server-recovery-evidence.mjs run');
  assert.equal(packageScripts['drill:server:verify'], 'node scripts/server-recovery-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /server-recovery-evidence\.test\.mjs/);
  assert.match(packageScripts['test:node'], /server-recovery-command\.test\.mjs/);

  const listed = runScript('scripts/server-recovery-drill.mjs', ['--list']);
  assert.equal(listed.status, 0, listed.stderr);
  const scenarioDocument = JSON.parse(listed.stdout);
  assert.equal(scenarioDocument.schemaVersion, 1);
  assert.deepEqual(
    scenarioDocument.scenarios.map((scenario) => scenario.id),
    [
      'redis_outage_and_lock_safety',
      'otel_outage_and_recovery',
      'http_deadline_drain_and_shutdown',
      'outbound_timeout_and_cancellation',
    ],
  );
  for (const scenario of scenarioDocument.scenarios) {
    assert.ok(scenario.package.startsWith('./Framework/'));
    assert.ok(scenario.tests.length > 0);
  }

  const rejected = runScript('scripts/server-recovery-drill.mjs', ['--unknown']);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /unknown argument: --unknown/);

  assert.match(workflow, /docs\/recovery\/\*\*/);
  assert.match(workflow, /local-recovery-drill:/);
  assert.match(workflow, /run: yarn drill:server:evidence/);
  assert.match(workflow, /if: always\(\)\s+run: yarn drill:server:verify/);
  assert.match(workflow, /if: always\(\)\s+run: yarn evidence:manifest --output \.temp\/recovery\/server-local\/manifest\.json/);
  assert.match(workflow, /if: always\(\)\s+run: yarn evidence:verify --manifest \.temp\/recovery\/server-local\/manifest\.json/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /path: \.temp\/recovery\/server-local/);

  assert.match(runbook, /This is local contract evidence/);
  assert.match(runbook, /do not prove target Redis HA/);
  assert.match(runbook, /does not prove provenance/);
  assert.match(runbook, /Remote status remains unverified/);
  assert.match(runbook, /RPO, or RTO/);
  assert.match(evidenceRunner, /buildServerRecoveryEvidenceReport/);
  assert.match(evidenceRunner, /writeServerRecoveryEvidenceChecksums/);
  assert.match(evidenceRunner, /runServerRecoveryDrill/);
  assert.doesNotMatch(evidenceRunner, /node:child_process|\bspawnSync\(/);
  assert.match(commandRunner, /serverRecoveryEvidenceProcessTimeoutMs = 300_000/);
  assert.match(commandRunner, /stdio: 'inherit'/);
  assert.match(commandRunner, /shell: false/);
  assert.match(commandRunner, /windowsHide: true/);
  assert.match(commandRunner, /timeout: timeoutMs/);
  assert.match(commandRunner, /killSignal: 'SIGTERM'/);
  assert.match(evidenceHelper, /local_server_recovery_evidence/);
  assert.match(evidenceHelper, /serverRecoveryScenarios/);
  assert.match(evidenceHelper, /checksumArtifactNames/);
  assert.match(evidenceTests, /raw Go semantics with recomputed hashes/);
  assert.match(evidenceManifest, /verifyServerRecoveryEvidence/);
  assert.match(evidenceManifest, /serverRecoveryEvidenceRoot/);
  assert.match(evidenceVerify, /verifyServerRecoveryEvidence/);
  assert.match(evidenceVerify, /server recovery evidence artifact is missing from the manifest/);
});

test('server threat model maps STRIDE risks to evidence and residual boundaries', async () => {
  const threatModel = await readFile(
    path.join(repositoryRoot, 'docs', 'security', 'server-threat-model.md'),
    'utf8',
  );
  assert.match(threatModel, /Out of scope: `MSFront`/);
  assert.match(threatModel, /## 2\. Assets And Data Classification/);
  assert.match(threatModel, /## 3\. Trust Boundaries And Data Flow/);
  assert.match(threatModel, /## 4\. STRIDE Threat Register/);
  assert.match(threatModel, /## 5\. Security Invariants/);
  assert.match(threatModel, /## 6\. Open Production Risks/);
  assert.match(threatModel, /## 7\. Review Triggers And Ownership/);
  for (const classification of ['Restricted', 'Confidential', 'Internal', 'Public']) {
    assert.match(threatModel, new RegExp(`\\| ${classification} \\|`));
  }
  const threats = [...threatModel.matchAll(/^\| TM-(\d{2}) \| ([^|]+) \|/gm)];
  assert.equal(threats.length, 16, 'server threat register must retain all reviewed threats');
	assert.match(threatModel, /TM-16[\s\S]*state[\s\S]*SameSite/);
  const categories = new Set(threats.flatMap((threat) => threat[2].split('/').map((item) => item.trim())));
  for (const category of ['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege']) {
    assert.ok(categories.has(category), `server threat model is missing STRIDE category ${category}`);
  }
  assert.match(threatModel, /Framework\/httpapi\/lifecycle_contract_test\.go/);
  assert.match(threatModel, /Framework\/observability/);
  assert.match(threatModel, /scripts\/openapi-compat\.mjs/);
  assert.match(threatModel, /deploy\/edge\/goexample-nginx\.contract\.json/);
  assert.match(threatModel, /Nginx/);
  assert.match(threatModel, /OWASP Threat Modeling Cheat Sheet/);
  assert.match(threatModel, /does not prove a production control/);
	assert.match(threatModel, /cannot enumerate or revoke another subject's session/);
});

test('server security audit events stay correlated, bounded, and credential-safe', async () => {
  const [auditSource, sinkSource, chainSource, chainTests, authRoutes, authMiddleware, diagnostics, metrics, appTests, sinkTests, metricsTests, contract, rules] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_sink.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_chain.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_chain_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'diagnostics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_sink_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'security', 'server-audit-events.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
  ]);
  assert.match(auditSource, /"security_audit"/);
  for (const field of ['request_id', 'trace_id', 'span_id']) {
    assert.match(auditSource, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(auditSource, /c\.Get\(fiber\.HeaderAuthorization\)|c\.Body\(|c\.OriginalURL\(|c\.IP\(/);
  assert.match(authRoutes, /invalid_credentials/);
  assert.match(authRoutes, /rate_limited/);
  assert.match(authMiddleware, /token_missing/);
  assert.match(authMiddleware, /token_invalid/);
  assert.match(diagnostics, /securityEventDiagnostics/);
  assert.match(auditSource, /securityEventAuthorization\s+=\s+"authorization"/);
  assert.match(metrics, /goexample_security_events_total/);
  assert.match(metrics, /securityLabelIndex/);
  assert.match(sinkSource, /type SecurityAuditRecord struct/);
  assert.match(sinkSource, /type SecurityAuditSink interface/);
  assert.match(sinkSource, /WriteSecurityAudit\(context\.Context, SecurityAuditRecord\) error/);
  assert.match(auditSource, /context\.WithTimeout\(parent, options\.SecurityAuditTimeout\)/);
  assert.match(auditSource, /recover\(\)/);
  assert.doesNotMatch(auditSource, /sink.*(?:err|error)|(?:err|error).*sink/i);
  assert.match(metrics, /goexample_security_audit_sink_writes_total/);
  assert.match(metrics, /RecordSecurityAuditSinkWrite/);
  assert.match(appTests, /TestSecurityAuditEventsAreCorrelatedBoundedAndCredentialSafe/);
  assert.match(appTests, /role_required/);
  assert.match(appTests, /target: "application_command"/);
  assert.match(metricsTests, /TestMetricsRenderSecurityEventsWithFixedLabels/);
  assert.match(metricsTests, /TestMetricsRenderSecurityAuditSinkOutcomesWithFixedLabels/);
  assert.match(sinkTests, /TestSecurityAuditSinkReceivesBoundedLowSensitivityRecord/);
  assert.match(sinkTests, /TestSecurityAuditSinkFailuresAreIsolatedAndCredentialSafe/);
  assert.match(sinkTests, /TestSecurityAuditSinkHonorsConfiguredTimeoutWithoutChangingResponse/);
  assert.match(chainSource, /func NewHashChainAuditSink/);
  assert.match(chainSource, /func VerifyHashChain/);
  assert.match(chainSource, /func NewEncryptedAuditWriter/);
  assert.match(chainSource, /func VerifyEncryptedHashChain/);
  assert.match(chainSource, /cipher\.NewGCM/);
  assert.match(chainSource, /rand\.Reader/);
  assert.match(chainSource, /RotateKey/);
  assert.match(chainSource, /seenNonces/);
  assert.match(chainSource, /defaultAuditChainRecordBytes\s*=\s*16 << 10/);
  assert.match(chainSource, /maxAuditChainRecordBytes\s*=\s*1 << 20/);
  assert.match(chainSource, /json\.NewDecoder/);
  assert.match(chainSource, /DisallowUnknownFields/);
	assert.match(chainSource, /oidc_callback_valid/);
	assert.match(chainSource, /oidc_browser/);
  assert.match(chainTests, /TestHashChainAuditSinkWritesAndVerifiesLinkedRecords/);
  assert.match(chainTests, /TestHashChainAuditSinkRejectsTamperingAndInvalidRecords/);
  assert.match(chainTests, /TestHashChainAuditSinkSerializesConcurrentWriters/);
  assert.match(chainTests, /TestEncryptedAuditWriterEncryptsAndSupportsKeyRotation/);
  assert.match(chainTests, /TestEncryptedAuditWriterRejectsTamperingUnknownKeysAndInvalidConfig/);
  assert.match(contract, /must not contain a submitted username, password, authorization header, token/);
  assert.match(contract, /NewHashChainAuditSink/);
  assert.match(contract, /does not make an arbitrary `io\.Writer` durable, encrypted, access-controlled, immutable/);
  assert.match(contract, /authenticated principal lacked every role/);
  assert.match(contract, /does not provide or deploy an immutable audit sink/);
  assert.match(rules, /goexample:security:login_rate_limited_rate5m/);
  assert.match(rules, /GoExampleAuthenticationRateLimited/);
  assert.match(rules, /goexample:security:audit_sink_failure_rate5m/);
  assert.match(rules, /GoExampleSecurityAuditSinkFailures/);
});

test('encrypted audit chain evidence stays checksum-bound and explicitly local-only', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'audit-chain-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'audit-chain-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'audit-chain-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['audit:chain:evidence'], 'node scripts/audit-chain-evidence.mjs run');
  assert.equal(packageScripts['audit:chain:verify'], 'node scripts/audit-chain-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /audit-chain-evidence\.test\.mjs/);
  assert.match(runner, /auditChainGoArguments/);
  assert.match(runner, /GOCACHE/);
  assert.match(runner, /GOTMPDIR/);
  assert.match(verifier, /local_audit_chain_contract/);
  assert.match(verifier, /aes256GCMEncryption/);
  assert.match(verifier, /httpSinkCorrelation/);
  assert.match(verifier, /httpSinkFailureIsolation/);
  assert.match(verifier, /httpSinkTimeoutBounded/);
  assert.match(verifier, /duplicateNonceRejected/);
  assert.match(verifier, /evidence directory files must be exactly/);
  assert.match(verifier, /does not establish target SIEM ingestion, paging delivery/);
  assert.match(behaviorTests, /rejects source, contract, scope, and semantic output tampering/);
  assert.match(behaviorTests, /rejects checksum drift and extra artifacts/);
  assert.match(workflow, /audit-chain-contract:/);
  assert.match(workflow, /yarn audit:chain:evidence/);
  assert.match(workflow, /yarn audit:chain:verify/);
  assert.match(workflow, /\.temp\/evidence\/audit-chain-manifest\.json/);
  assert.match(manifest, /verifyAuditChainEvidence/);
  assert.match(manifest, /workflow-artifacts', 'audit-chain/);
  assert.match(independentVerifier, /verifyAuditChainEvidence/);
  assert.match(independentVerifier, /audit chain evidence artifact is missing from the manifest/);
});

test('OIDC browser evidence stays checksum-bound and explicitly local-only', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'oidc-browser-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'oidc-browser-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'oidc-browser-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['oidc:browser:evidence'], 'node scripts/oidc-browser-evidence.mjs run');
  assert.equal(packageScripts['oidc:browser:verify'], 'node scripts/oidc-browser-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /oidc-browser-evidence\.test\.mjs/);
  assert.match(runner, /oidcBrowserGoArguments/);
  assert.match(runner, /GOCACHE/);
  assert.match(runner, /GOTMPDIR/);
  assert.match(verifier, /local_oidc_browser_contract/);
	assert.match(verifier, /oidcBrowserEvidenceSchemaVersion = 3/);
	assert.match(verifier, /'\.\/auth',\s*'\.\/httpapi'/);
	assert.match(verifier, /accessTokenHashBound/);
	assert.match(verifier, /tokenEndpointAuthenticationNegotiated/);
	assert.match(verifier, /tokenRequestCredentialsBound/);
	assert.match(verifier, /callerContextAuthoritative/);
	assert.match(verifier, /refreshWaitCancelable/);
	assert.match(verifier, /lateJWKSCacheRejected/);
	assert.match(verifier, /authContext: 'Framework\/auth\/context\.go'/);
	assert.match(verifier, /authContextTests: 'Framework\/auth\/context_boundary_test\.go'/);
	assert.match(verifier, /oidcClientTests: 'Framework\/auth\/oidc_client_test\.go'/);
  assert.match(verifier, /stateCookieBoundCallback/);
  assert.match(verifier, /conditionalRoutesReserved/);
  assert.match(verifier, /evidence directory files must be exactly/);
  assert.match(verifier, /does not establish target IdP discovery, MFA enrollment/);
  assert.match(verifier, /does not establish production Redis HA, KMS or Vault custody/);
  assert.match(behaviorTests, /retains a bounded failed run without declaring success/);
  assert.match(behaviorTests, /rejects source, contract, scope, and semantic output tampering/);
  assert.match(behaviorTests, /rejects limitation, checksum, and extra-artifact tampering/);
	assert.match(behaviorTests, /contract\.tests\.length, 18/);
	assert.match(behaviorTests, /source\.authContextTests\.sha256/);
  assert.match(workflow, /oidc-browser-contract:/);
  assert.match(workflow, /yarn oidc:browser:evidence/);
  assert.match(workflow, /yarn oidc:browser:verify/);
  assert.match(workflow, /\.temp\/evidence\/oidc-browser-manifest\.json/);
  assert.match(manifest, /verifyOIDCBrowserEvidence/);
  assert.match(manifest, /workflow-artifacts', 'oidc-browser/);
  assert.match(manifest, /oidcProvider:\s*\{\s*status: 'not_recorded'/s);
  assert.match(independentVerifier, /verifyOIDCBrowserEvidence/);
  assert.match(independentVerifier, /OIDC browser evidence artifact is missing from the manifest/);
});

test('resource authorization evidence stays checksum-bound and explicitly local-only', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'authorization-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'authorization-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'authorization-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['authorization:evidence'], 'node scripts/authorization-evidence.mjs run');
  assert.equal(packageScripts['authorization:verify'], 'node scripts/authorization-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /authorization-evidence\.test\.mjs/);
  assert.match(runner, /authorizationGoArguments/);
  assert.match(runner, /GOCACHE/);
  assert.match(runner, /GOTMPDIR/);
  assert.match(verifier, /local_resource_authorization_contract/);
  assert.match(verifier, /boundedPolicyInput/);
  assert.match(verifier, /denyDoesNotPolluteIdempotency/);
  assert.match(verifier, /policyPrecedesPrecondition/);
  assert.match(verifier, /evidence directory files must be exactly/);
  assert.match(verifier, /does not establish a production policy engine/);
  assert.match(verifier, /does not establish policy versioning, distribution, cache invalidation/);
  assert.match(behaviorTests, /retains a bounded failed run without declaring success/);
  assert.match(behaviorTests, /rejects source, command, test matrix, scope, and output tampering/);
  assert.match(behaviorTests, /rejects limitation, checksum, and extra-artifact tampering/);
  assert.match(workflow, /authorization-policy-contract:/);
  assert.match(workflow, /yarn authorization:evidence/);
  assert.match(workflow, /yarn authorization:verify/);
  assert.match(workflow, /\.temp\/evidence\/authorization-policy-manifest\.json/);
  assert.match(manifest, /verifyAuthorizationEvidence/);
  assert.match(manifest, /workflow-artifacts', 'authorization-policy/);
  assert.match(manifest, /oidcProvider:\s*\{\s*status: 'not_recorded'/s);
  assert.match(independentVerifier, /verifyAuthorizationEvidence/);
  assert.match(independentVerifier, /authorization evidence artifact is missing from the manifest/);
});

test('SDK release readiness evidence stays checksum-bound and explicitly repository-only', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier, projectDocs] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'sdk-release-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'sdk-release-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'sdk-release-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'project-contracts.md'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['sdk:release:evidence'], 'node scripts/sdk-release-evidence.mjs run');
  assert.equal(packageScripts['sdk:release:evidence:verify'], 'node scripts/sdk-release-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /sdk-release-evidence\.test\.mjs/);
  assert.match(runner, /sdkReleaseEvidenceArguments/);
  assert.match(runner, /GOFMT_BINARY/);
  assert.match(runner, /writeSDKReleaseEvidenceChecksums/);
  assert.match(verifier, /local_sdk_release_readiness_contract/);
  assert.match(verifier, /operationCount: 26/);
  assert.match(verifier, /operationCount: 14/);
  assert.match(verifier, /publication: 'not_checked'/);
  assert.match(verifier, /releaseSourceCommitBound: true/);
  assert.match(verifier, /publicationNotChecked: true/);
  assert.match(verifier, /evidence directory files must be exactly/);
  assert.match(verifier, /does not query, create, verify, or publish the expected Git module tags or packages/);
  assert.match(verifier, /does not establish an external consumer cross-version matrix/);
  assert.match(behaviorTests, /retains a bounded failed run without declaring success/);
  assert.match(behaviorTests, /rejects source, command, project matrix, scope, and output tampering/);
  assert.match(behaviorTests, /rejects assertion, limitation, checksum, and extra-artifact tampering/);
  assert.match(workflow, /Generate SDK release readiness evidence/);
  assert.match(workflow, /run: yarn sdk:release:evidence/);
  assert.match(workflow, /if: always\(\)\s+run: yarn sdk:release:evidence:verify/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/sdk-release-readiness/);
  assert.match(manifest, /verifySDKReleaseEvidence/);
  assert.match(manifest, /workflow-artifacts', 'sdk-release-readiness/);
  assert.match(independentVerifier, /verifySDKReleaseEvidence/);
  assert.match(independentVerifier, /SDK release evidence artifact is missing from the manifest/);
  assert.match(projectDocs, /five checksum-bound files/);
  assert.match(projectDocs, /does not query, create, or\s+verify Git tags/);
});

test('SDK consumer migration evidence stays local, complete, and checksum-bound', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier, projectDocs] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'sdk-consumer-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'sdk-consumer-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'sdk-consumer-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'project-contracts.md'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['sdk:consumer:evidence'], 'node scripts/sdk-consumer-evidence.mjs run');
  assert.equal(packageScripts['sdk:consumer:evidence:verify'], 'node scripts/sdk-consumer-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /sdk-consumer-evidence\.test\.mjs/);
  assert.match(runner, /sdkConsumerGoArguments/);
  assert.match(runner, /sdkConsumerArtifactNames/);
  assert.match(verifier, /local_sdk_consumer_migration_contract/);
  assert.match(verifier, /sdkConsumerTests/);
  assert.match(verifier, /sdkConsumerBillingOperations/);
  assert.match(verifier, /canonicalPath: '\/readyz'/);
  assert.match(verifier, /deprecatedPath: '\/api\/health\/ready'/);
  assert.match(verifier, /operationCount: sdkConsumerBillingOperations\.length/);
  assert.match(verifier, /externalMigrationNotChecked: true/);
  assert.match(verifier, /does not establish an external consumer cross-version matrix/);
  assert.match(verifier, /does not establish deprecation-window execution/);
  assert.match(verifier, /evidence directory files must be exactly/);
  for (const artifactName of ['go-output.txt', 'go-error.txt', 'go-status.txt', 'report.json', 'SHA256SUMS']) {
    assert.match(verifier, new RegExp(artifactName.replace('.', '\\.'), 'g'));
  }
  assert.match(behaviorTests, /retains a bounded failed run without declaring success/);
  assert.match(behaviorTests, /rejects source, command, matrix, and output tampering/);
  assert.match(behaviorTests, /rejects limitations, checksum, and extra-artifact tampering/);
  assert.match(workflow, /Generate SDK consumer migration evidence/);
  assert.match(workflow, /run: yarn sdk:consumer:evidence/);
  assert.match(workflow, /if: always\(\)\s+run: yarn sdk:consumer:evidence:verify/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/sdk-consumer-migration/);
  assert.match(manifest, /verifySDKConsumerEvidence/);
  assert.match(manifest, /workflow-artifacts', 'sdk-consumer-migration/);
  assertEvidenceInput('scripts/sdk-consumer-evidence.mjs');
  assertEvidenceInput('scripts/lib/sdk-consumer-evidence.mjs');
  assertEvidenceInput('__test__/node/sdk-consumer-evidence.test.mjs');
  assertEvidenceInput('support/consumer/HealthProbe/README.md');
  assert.match(independentVerifier, /verifySDKConsumerEvidence/);
  assert.match(independentVerifier, /SDK consumer evidence artifact is missing from the manifest/);
  assert.match(projectDocs, /sdk:consumer:evidence/);
  assert.match(projectDocs, /local SDK consumer migration/);
  assert.match(projectDocs, /does not establish an external consumer\s+cross-version matrix/);
});

test('SDK consumer matrix evidence stays repository-only, complete, and checksum-bound', async () => {
  const [packageDocument, runner, verifier, behaviorTests, workflow, manifest, independentVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'sdk-consumer-matrix-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'sdk-consumer-matrix-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'sdk-consumer-matrix-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['sdk:matrix:evidence'], 'node scripts/sdk-consumer-matrix-evidence.mjs run');
  assert.equal(packageScripts['sdk:matrix:evidence:verify'], 'node scripts/sdk-consumer-matrix-evidence.mjs verify');
  assert.match(packageScripts['test:node'], /sdk-consumer-matrix-evidence\.test\.mjs/);
  assert.match(runner, /sdkConsumerMatrixEvidenceArguments/);
  assert.match(runner, /sdkConsumerMatrixEvidenceArtifactNames/);
  assert.match(verifier, /local_sdk_consumer_matrix_contract/);
  assert.match(verifier, /deprecationWindowBound: true/);
  assert.match(verifier, /publicationAndDeploymentBoundariesExplicit: true/);
  assert.match(verifier, /does not establish a formal SDK tag/);
  assert.match(verifier, /evidence directory files must be exactly/);
  for (const artifactName of ['verification-output.txt', 'verification-error.txt', 'verification-status.txt', 'report.json', 'SHA256SUMS']) {
    assert.match(verifier, new RegExp(artifactName.replace('.', '\\.'), 'g'));
  }
  assert.match(behaviorTests, /retains a bounded failed check without claiming success/);
  assert.match(behaviorTests, /rejects contract, source, and output tampering/);
  assert.match(behaviorTests, /rejects limitation, checksum, and extra-artifact tampering/);
  assert.match(workflow, /Generate SDK consumer migration matrix evidence/);
  assert.match(workflow, /run: yarn sdk:matrix:evidence/);
  assert.match(workflow, /if: always\(\)\s+run: yarn sdk:matrix:evidence:verify/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/sdk-consumer-matrix/);
  assert.match(manifest, /verifySDKConsumerMatrixEvidence/);
  assert.match(manifest, /workflow-artifacts', 'sdk-consumer-matrix/);
  assertEvidenceInput('scripts/sdk-consumer-matrix-evidence.mjs');
  assertEvidenceInput('scripts/lib/sdk-consumer-matrix-evidence.mjs');
  assertEvidenceInput('__test__/node/sdk-consumer-matrix-evidence.test.mjs');
  assert.match(independentVerifier, /verifySDKConsumerMatrixEvidence/);
  assert.match(independentVerifier, /SDK consumer matrix evidence artifact is missing from the manifest/);
});

test('V84 repository work and target-environment boundaries match the weighted evaluation', async () => {
  const [evaluation, v12Backlog, backlog, nextBacklog, currentBacklog, v16Backlog, v17Backlog, v18Backlog, v19Backlog, v20Backlog, v21Backlog, v22Backlog, lifecycleADR, publicAPIBoundaryADR, benchmark, app, appTests, fingerprint, middleware, tracing, tracingTests, httpClient, httpClientTests, responseBody, responseBodyTests, retry, retryTests, circuitBreaker, circuitBreakerTests, standardApplication, standardApplicationTests, exampleEntrypoint, billingEntrypoint, applicationEventStream, applicationEventStreamTests, applicationRoute, applicationRouteTests, sqlClient, sqlClientTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'docs', '评估', '项目架构与性能评估.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V12.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V13.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V14.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V15.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V16.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V17.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V18.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V19.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V20.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V21.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V22.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'adr', '0002-http-request-lifecycle-and-protocol-boundary.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'adr', '0003-http-public-api-boundary.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'benchmark_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'response_body.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'response_body_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'retry.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'retry_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'circuit_breaker.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'circuit_breaker_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_application.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_application_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Services', 'Billing', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_event_stream.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_event_stream_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_route.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_route_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client_test.go'), 'utf8'),
  ]);
  const v23Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V23.md'),
    'utf8',
  );
  const v24Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V24.md'),
    'utf8',
  );
  const v25Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V25.md'),
    'utf8',
  );
  const v26Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V26.md'),
    'utf8',
  );
  const v27Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V27.md'),
    'utf8',
  );
  const v28Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V28.md'),
    'utf8',
  );
  const v29Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V29.md'),
    'utf8',
  );
  const v30Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V30.md'),
    'utf8',
  );
  const v31Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V31.md'),
    'utf8',
  );
  const v32Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V32.md'),
    'utf8',
  );
  const v33Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V33.md'),
    'utf8',
  );
  const v34Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V34.md'),
    'utf8',
  );
  const v35Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V35.md'),
    'utf8',
  );
  const v36Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V36.md'),
    'utf8',
  );
  const v37Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V37.md'),
    'utf8',
  );
  const v38Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V38.md'),
    'utf8',
  );
  const v39Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V39.md'),
    'utf8',
  );
  const v40Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V40.md'),
    'utf8',
  );
  const v41Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V41.md'),
    'utf8',
  );
  const v42Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V42.md'),
    'utf8',
  );
  const v43Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V44.md'),
    'utf8',
  );
  const v45Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V46.md'),
    'utf8',
  );
  const v47Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V47.md'),
    'utf8',
  );
  const v48Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V48.md'),
    'utf8',
  );
  const v49Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V49.md'),
    'utf8',
  );
  const v50Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V50.md'),
    'utf8',
  );
  const v51Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V51.md'),
    'utf8',
  );
  const v52Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V52.md'),
    'utf8',
  );
  const v53Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V53.md'),
    'utf8',
  );
  const v54Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V54.md'),
    'utf8',
  );
  const v55Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V55.md'),
    'utf8',
  );
  const v56Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V56.md'),
    'utf8',
  );
  const v57Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V57.md'),
    'utf8',
  );
  const v58Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V58.md'),
    'utf8',
  );
  const v59Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V59.md'),
    'utf8',
  );
  const v60Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V60.md'),
    'utf8',
  );
  const v61Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V61.md'),
    'utf8',
  );
  const v62Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V62.md'),
    'utf8',
  );
  const v63Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V63.md'),
    'utf8',
  );
  const v64Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V64.md'),
    'utf8',
  );
  const v65Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V65.md'),
    'utf8',
  );
  const v66Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V66.md'),
    'utf8',
  );
  const v67Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V67.md'),
    'utf8',
  );
  const v68Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V68.md'),
    'utf8',
  );
  const v69Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V69.md'),
    'utf8',
  );
  const v70Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V70.md'),
    'utf8',
  );
  const v71Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V71.md'),
    'utf8',
  );
  const v72Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V72.md'),
    'utf8',
  );
  const v73Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V73.md'),
    'utf8',
  );
  const v74Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V74.md'),
    'utf8',
  );
  const v75Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V75.md'),
    'utf8',
  );
  const v76Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V76.md'),
    'utf8',
  );
  const v77Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V77.md'),
    'utf8',
  );
  const v78Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V78.md'),
    'utf8',
  );
  const v79Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V79.md'),
    'utf8',
  );
  const v80Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V80.md'),
    'utf8',
  );
  const v81Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V81.md'),
    'utf8',
  );
  const v82Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V82.md'),
    'utf8',
  );
  const v83Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V83.md'),
    'utf8',
  );
  const v84Backlog = await readFile(
    path.join(repositoryRoot, 'docs', '待优化', '待优化V84.md'),
    'utf8',
  );
  const [authContext, authContextTests, oidcClient, jwks] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'context.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'context_boundary_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'jwks.go'), 'utf8'),
  ]);
  const [browserSessionStore, browserSessionStoreTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store_test.go'), 'utf8'),
  ]);
  const [sessionStore, sessionStoreTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store_test.go'), 'utf8'),
  ]);
  const [authorizationRequestStore, authorizationRequestStoreTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store_test.go'), 'utf8'),
  ]);
  const [redisTracing, redisTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_tracing.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_test.go'), 'utf8'),
  ]);
  const [goProjectScript, goProjectCommand, goProjectCommandTests, packageDocument] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'go-project-command.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'go-project-command.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);
  const goSDK = await readFile(
    path.join(repositoryRoot, 'scripts', 'go-sdk.mjs'),
    'utf8',
  );
  const sdkGeneration = await readFile(
    path.join(repositoryRoot, 'scripts', 'lib', 'sdk-generation.mjs'),
    'utf8',
  );
  const sdkGenerationTests = await readFile(
    path.join(repositoryRoot, '__test__', 'node', 'sdk-generation.test.mjs'),
    'utf8',
  );
  const sdkRelease = await readFile(
    path.join(repositoryRoot, 'scripts', 'lib', 'sdk-release.mjs'),
    'utf8',
  );
  const sdkReleaseCLI = await readFile(
    path.join(repositoryRoot, 'scripts', 'sdk-release.mjs'),
    'utf8',
  );
  const sdkReleaseTests = await readFile(
    path.join(repositoryRoot, '__test__', 'node', 'sdk-release.test.mjs'),
    'utf8',
  );
  const rows = [
    ...evaluation.matchAll(/^\| (?!\*\*综合评分)([^|]+) \| (\d+)% \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|/gm),
  ];

  assert.equal(rows.length, 20, 'current score table must contain 20 non-frontend weighted dimensions');
  const weightTotal = rows.reduce((total, row) => total + Number(row[2]), 0);
  assert.equal(weightTotal, 100, 'current non-frontend score weights must total 100 percent');

  let calculatedBaseline = 0;
  let calculatedCompleted = 0;
  for (const row of rows) {
    const expectedContribution = (Number(row[2]) * Number(row[5])) / 100;
    const documentedContribution = Number(row[6]);
    assert.ok(
      Math.abs(expectedContribution - documentedContribution) <= 0.0005 + Number.EPSILON,
      `${row[1].trim()} weighted score is inconsistent`,
    );
    calculatedBaseline += (Number(row[2]) * Number(row[4])) / 100;
    calculatedCompleted += expectedContribution;
  }
  assert.equal(calculatedBaseline.toFixed(5), '9.91755');
  assert.equal(calculatedCompleted.toFixed(5), '9.91830');
  assert.match(evaluation, /评估版本：V84（已完成）/);
  assert.match(evaluation, /V83-01.*已完成并计分/s);
  assert.match(evaluation, /身份、会话与认证治理 \| 6% \| 9\.9475 \| 9\.9475 \| 9\.9600/);
  assert.match(evaluation, /当前有效评分为 \*\*9\.91830\/10（A-）\*\*/);
  assert.match(v69Backlog, /V69-01 已完成/);
  assert.match(v69Backlog, /9\.8880\/10/);
  assert.match(v70Backlog, /状态：V70-01 已完成并计分/);
  assert.match(v70Backlog, /duplicate-key JSON 校验/);
  assert.match(v70Backlog, /OIDC schema 3 evidence/);
  assert.match(v70Backlog, /9\.8888\/10/);
  assert.match(v71Backlog, /状态：V71-01 已完成并计分/);
  assert.match(v71Backlog, /listBrowserSessionsScript/);
  assert.match(v71Backlog, /9\.8896\/10/);
  assert.match(v71Backlog, /V71-02\/V71-03.*`not_recorded`/s);
  assert.match(v72Backlog, /状态：V72-01 已完成并计分/);
  assert.match(v72Backlog, /RotateSession/);
  assert.match(v72Backlog, /9\.8915\/10/);
  assert.match(v72Backlog, /V72-02\/V72-03.*`not_recorded`/s);
  assert.match(v73Backlog, /状态：V73-01 已完成并计分/);
  assert.match(v73Backlog, /deleteBrowserSessionScript|token\/ID revoke/);
  assert.match(v73Backlog, /9\.8928\/10/);
  assert.match(v73Backlog, /V73-02\/V73-03.*`not_recorded`/s);
  assert.match(v74Backlog, /状态：V74-01 已完成并计分/);
  assert.match(v74Backlog, /deleteBrowserSessionsForSubjectScript|整 subject 撤销/);
  assert.match(v74Backlog, /9\.8941\/10/);
  assert.match(v74Backlog, /V74-02\/V74-03.*`not_recorded`/s);
  assert.match(v75Backlog, /状态：V75-01 已完成并计分/);
  assert.match(v75Backlog, /revokeSessionUserScript|activeSessionFamiliesScript/);
  assert.match(v75Backlog, /9\.8953\/10/);
  assert.match(v75Backlog, /V75-02\/V75-03.*`not_recorded`/s);
  assert.match(v76Backlog, /状态：V76-01 已完成并计分/);
  assert.match(v76Backlog, /rotateSessionScript|revokeSessionFamilyScript/);
  assert.match(v76Backlog, /9\.8966\/10/);
  assert.match(v76Backlog, /V76-02\/V76-03.*`not_recorded`/s);
  assert.match(v77Backlog, /状态：V77-01 已完成并计分/);
  assert.match(v77Backlog, /createAuthorizationRequestScript|consumeAuthorizationRequestScript/);
  assert.match(v77Backlog, /9\.8973\/10/);
  assert.match(v77Backlog, /V77-02\/V77-03.*`not_recorded`/s);
  assert.match(v78Backlog, /状态：V78-01 已完成并计分/);
  assert.match(v78Backlog, /createBrowserSessionScript|readBrowserSessionScript/);
  assert.match(v78Backlog, /9\.8980\/10/);
  assert.match(v78Backlog, /V78-02\/V78-03.*`not_recorded`/s);
  assert.match(v79Backlog, /状态：V79-01 已完成并计分/);
  assert.match(v79Backlog, /listBrowserSessionsScript|readBrowserSessionForDeviceUpdateScript/);
  assert.match(v79Backlog, /9\.8988\/10/);
  assert.match(v79Backlog, /V79-02\/V79-03.*`not_recorded`/s);
  assert.match(v80Backlog, /状态：V80-01 已完成并计分/);
  assert.match(v80Backlog, /completedContextError|deliveryCallbackResult/);
  assert.match(v80Backlog, /9\.8995\/10/);
  assert.match(v80Backlog, /V80-02\/V80-03.*`not_recorded`/s);
  assert.match(v81Backlog, /状态：V81-01 已完成并计分/);
  assert.match(v81Backlog, /completedContextError/);
  assert.match(v81Backlog, /9\.9003\/10/);
  assert.match(v81Backlog, /V81-02\/V81-03.*`not_recorded`/s);
  assert.match(v82Backlog, /状态：V82-01 已完成并计分/);
  assert.match(v82Backlog, /completedRedisContextError/);
  assert.match(v82Backlog, /9\.91680\/10/);
  assert.match(v82Backlog, /V82-02\/V82-03.*`not_recorded`/s);
  assert.match(v83Backlog, /状态：V83-01 已完成并计分/);
  assert.match(v83Backlog, /completedHTTPContextError|authoritativeHTTPResult/);
  assert.match(v83Backlog, /9\.91755\/10/);
  assert.match(v83Backlog, /V83-02\/V83-03.*`not_recorded`/s);
  assert.match(v84Backlog, /状态：V84-01 已完成并计分/);
  assert.match(v84Backlog, /completedAuthContextError|refresh gate/);
  assert.match(v84Backlog, /9\.91830\/10/);
  assert.match(v84Backlog, /V84-02\/V84-03.*`not_recorded`/s);
  assert.match(authContext, /func completedAuthContextError\(ctx context\.Context\) error/);
  assert.match(authContext, /!time\.Now\(\)\.Before\(deadline\)/);
  assert.match(oidcClient, /completedAuthContextError\(requestContext\)/);
  assert.match(jwks, /refreshGate chan struct\{\}/);
  assert.match(jwks, /func \(verifier \*JWKSVerifier\) acquireRefresh\(ctx context\.Context\) bool/);
  assert.doesNotMatch(jwks, /refreshMu\s+sync\.Mutex/);
  for (const testName of [
    'TestOIDCClientRejectsLateSuccessfulHTTPResults',
    'TestAuthHTTPEntryPointsRejectPreCompletedContextWithoutTransport',
    'TestJWKSVerifierRejectsCompletedContextWithCachedKey',
    'TestJWKSRefreshRejectsLateResponseWithoutPublishingCache',
    'TestJWKSRefreshWaitHonorsCallerCancellation',
    'TestCompletedAuthContextErrorObservesCancellationAndElapsedDeadline',
  ]) {
    assert.match(authContextTests, new RegExp(`func ${testName}`));
  }
  assertEvidenceInput('Framework/auth/context.go');
  assertEvidenceInput('Framework/auth/context_boundary_test.go');
  assertEvidenceInput('docs/待优化/待优化V84.md');
  assert.match(redisTracing, /func completedRedisContextError\(ctx context\.Context\) error/);
  assert.match(redisTracing, /if connection != nil \{\s+_ = connection\.Close\(\)/);
  assert.equal((redisTracing.match(/err = completedRedisContextError\(ctx\)/g) ?? []).length, 2);
  assert.match(redisTests, /TestRedisTracingHooksRejectLateNilResults/);
  assert.match(redisTests, /TestRedisTracingHooksObserveElapsedDeadlineAndPreserveExplicitErrors/);
  assert.match(authorizationRequestStore, /redis\.call\("ZCARD", KEYS\[2\]\) > absoluteMaximum/);
  assert.match(authorizationRequestStore, /redis\.call\("ZSCORE", KEYS\[2\], ARGV\[5\]\)/);
  assert.match(authorizationRequestStore, /return \{2, payload, score\}/);
  assert.match(authorizationRequestStore, /payload\.ExpiresAtMillis != indexExpiresAtMillis/);
  assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreUsesOneAtomicScriptCommand/);
  assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreRejectsInvalidInputsBeforeRedis/);
  assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestCreateRejectsOversizedOrOrphanedIndex/);
  assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestConsumeValidatesPayloadIndexExpiry/);
  assert.match(browserSessionStore, /listBrowserSessionsScript = redis\.NewScript/);
  assert.match(browserSessionStore, /ZREMRANGEBYSCORE/);
  assert.match(browserSessionStore, /StringSlice\(\)/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryUsesOneAtomicSnapshotCommand/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryFailsClosedForMissingPayloadInSnapshot/);
  assert.match(browserSessionStore, /readBrowserSessionScript = redis\.NewScript/);
  assert.match(browserSessionStore, /redis\.call\("ZCARD", KEYS\[2\]\) > absoluteMaximum/);
  assert.match(browserSessionStore, /redis\.call\("ZCARD", KEYS\[3\]\) > absoluteMaximum/);
  assert.match(browserSessionStore, /redis\.call\("STRLEN", KEYS\[1\]\)/);
  assert.match(browserSessionStore, /redis\.call\("PTTL", idKey\) <= 0/);
  assert.match(browserSessionStore, /globalExpiresMillis != subjectExpiresMillis/);
  assert.match(browserSessionStore, /decoder\.DisallowUnknownFields\(\)/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionCreateAndReadUseOneAtomicScriptCommand/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionCreateAndReadRejectInvalidInputsBeforeRedis/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionCreateRejectsOversizedOrOrphanedIndexes/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionReadValidatesPayloadMappingsIndexesAndTTL/);
  assert.match(browserSessionStore, /readBrowserSessionForDeviceUpdateScript = redis\.NewScript/);
  assert.match(browserSessionStore, /redis\.call\("ZCARD", KEYS\[1\]\) > absoluteMaximum/);
  assert.match(browserSessionStore, /return \{payload, token, globalScore, subjectScore\}/);
  assert.match(browserSessionStore, /redis\.call\("ZSCORE", KEYS\[4\], token\) ~= ARGV\[7\]/);
  assert.match(browserSessionStore, /len\(snapshot\)%4 != 0/);
  assert.match(browserSessionStore, /decodeBrowserSessionSnapshot/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryRejectsOversizedIndexBeforeCleanup/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryValidatesMappingsIndexesTTLAndPayload/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionDeviceNameUpdateUsesTwoAtomicScriptCommands/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionDeviceNameUpdateRejectsStateChangesAfterSnapshot/);
  assert.match(browserSessionStore, /local metadata = redis\.call\("GET", KEYS\[3\]\)/);
  assert.match(browserSessionStore, /local mapping = redis\.call\("GET", KEYS\[1\]\)/);
  assert.match(browserSessionStore, /browserSubjectSessionsKeyPrefix/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevocationsUseOneAtomicScriptCommand/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevocationsFailClosedForMalformedMappings/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevocationsFailClosedForInconsistentMappings/);
  assert.match(browserSessionStore, /redis\.call\("ZCARD", KEYS\[1\]\) > maximum/);
  assert.match(browserSessionStore, /redis\.call\("GET", ARGV\[4\] \.\. sessionID\) ~= subject \.\. ":" \.\. token/);
  assert.match(browserSessionStore, /sessionIDs\[index\] = sessionID/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevokeAllUsesOneBoundedAtomicScriptCommand/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevokeAllValidatesEveryMappingBeforeDelete/);
  assert.match(browserSessionStoreTests, /TestRedisBrowserSessionRevokeAllRejectsOversizedIndexBeforeCleanup/);
  assert.match(browserSessionStoreTests, /redis\.evalsha/);
  assert.match(sessionStore, /rotateSessionScript = redis\.NewScript/);
  assert.match(sessionStore, /sessionFamilyKeyPrefix/);
  assert.match(sessionStore, /sessionUsedKeyPrefix/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionRotationUsesOneAtomicScriptCommand/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionRevokeUsesOneAtomicScriptCommand/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionRejectsMalformedFamilyMapping/);
  assert.match(sessionStore, /maxRefreshSessionFamilyInventory\s*= 10000/);
  assert.match(sessionStore, /redis\.call\("ZCARD", KEYS\[1\]\) > maximum/);
  assert.match(sessionStore, /states\[index\] = \{id = familyID/);
  assert.match(sessionStore, /owner ~= userHash/);
  assert.match(sessionStore, /not globalScore or globalScore ~= absolute/);
  assert.match(sessionStore, /validRefreshSessionFamilyID/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionUserScriptsUseOneBoundedAtomicCommand/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionCreateRejectsInvalidFamilyBoundaryBeforeRedis/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionUserScriptsValidateAllFamiliesBeforeMutation/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionUserScriptsRejectOversizedIndexBeforeCleanup/);
  assert.match(sessionStore, /maxRefreshSessionHistory\s*= 1024/);
  assert.match(sessionStore, /redis\.call\("SMEMBERS", usedKey\)/);
  assert.match(sessionStore, /expired == "1" and revoked ~= "1"/);
  assert.match(sessionStore, /redis\.call\("GET", ARGV\[8\] \.\. current\) ~= familyID/);
  assert.match(sessionStore, /historyLimit > maxRefreshSessionHistory/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionSingleFamilyRejectsInvalidInputsBeforeRedis/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionSingleFamilyValidatesStateBeforeMutation/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionSingleFamilyValidatesBidirectionalTokenMappings/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionForgedMappingCannotRevokeValidFamily/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionRotationRejectsMappedNewTokenBeforeMutation/);
  assert.match(sessionStoreTests, /TestRedisRefreshSessionSingleFamilyRejectsOversizedUsedIndexBeforeMutation/);
  assert.match(v12Backlog, /V12-01/);
  assert.match(v12Backlog, /V12-10/);
  assert.match(v12Backlog, /状态：\*\*已完成\*\*/);
  assert.match(v12Backlog, /原有“V12 本身仍未完成”均由本次收口决定取代/);
  assert.match(v12Backlog, /当前精确综合评分：\*\*9\.493\/10\*\*/);
  assert.match(backlog, /状态：\*\*已完结\*\*/);
  assert.match(backlog, /9 个工作包仍保持 `not_recorded`/);
  assert.match(backlog, /V13-01/);
  assert.match(backlog, /V13-09/);
  assert.match(backlog, /V14-07/);
  assert.match(backlog, /V14-15/);
  assert.match(v43Backlog, /V44-01/);
  assert.match(v43Backlog, /状态：V43 仓库内项目已关闭；V44-01 仓库内完成；V44-02\/V44-03 继续 `not_recorded`/);
  assert.match(v43Backlog, /V44-02\/V44-03 继续 `not_recorded`/);
  assert.match(v43Backlog, /显式加入 `killSignal: 'SIGTERM'`/);
  assert.match(v43Backlog, /9\.8676\/10/);
  assert.match(v43Backlog, /9\.8666\/10/);
  assert.match(v45Backlog, /V46-01/);
  assert.match(v45Backlog, /V45-02\/V45-03.*`not_recorded`/s);
  assert.match(v45Backlog, /根目录 Yarn 安装/);
  assert.match(v45Backlog, /Go 下载元数据/);
  assert.match(v47Backlog, /V47-01/);
  assert.match(v47Backlog, /损坏\/不兼容候选不能改变既有基线/);
  assert.match(v47Backlog, /writeFileAtomicallySync/);
  assert.match(v47Backlog, /9\.8689\/10/);
  assert.match(v48Backlog, /V48-01/);
  assert.match(v48Backlog, /writeFilesWithRollbackSync/);
  assert.match(v48Backlog, /baseline\/provenance 任一状态、摘要或语义漂移失败/);
  assert.match(v48Backlog, /9\.8692\/10/);
  assert.match(v48Backlog, /V48-01 已完成/);
  assert.match(v49Backlog, /V49-01/);
  assert.match(v49Backlog, /V49-01 已完成/);
  assert.match(v49Backlog, /maxToMinRatio/);
  assert.match(v49Backlog, /schema 5 只进入一次迁移空窗/);
  assert.match(v49Backlog, /9\.8699\/10/);
  assert.match(v50Backlog, /V50-01/);
  assert.match(v50Backlog, /V50-01 已完成/);
  assert.match(v50Backlog, /Tx\.EnqueueOutbox/);
  assert.match(v50Backlog, /ErrOutboxEnqueue/);
  assert.match(v50Backlog, /9\.8706\/10/);
  assert.match(v51Backlog, /V51-01/);
  assert.match(v51Backlog, /V51-01 已完成/);
  assert.match(v51Backlog, /Retry-After/);
  assert.match(v51Backlog, /9\.8714\/10/);
  assert.match(v52Backlog, /V52-01/);
  assert.match(v52Backlog, /V52-01 已完成/);
  assert.match(v52Backlog, /有界正向 jitter/);
  assert.match(v52Backlog, /MaxBackoff/);
  assert.match(v52Backlog, /9\.8722\/10/);
  assert.match(v53Backlog, /V53-01/);
  assert.match(v53Backlog, /V53-01 已完成/);
  assert.match(v53Backlog, /MinimumDeliveryLease/);
  assert.match(v53Backlog, /最大 jitter/);
  assert.match(v53Backlog, /9\.8730\/10/);
  assert.match(v54Backlog, /V54-01/);
  assert.match(v54Backlog, /V54-01 已完成/);
  assert.match(v54Backlog, /PublishDeduplicated/);
  assert.match(v54Backlog, /PubAck/);
  assert.match(v54Backlog, /9\.8738\/10/);
  assert.match(v55Backlog, /V55-01/);
  assert.match(v55Backlog, /V55-01 已完成/);
  assert.match(v55Backlog, /PubAck/);
  assert.match(v55Backlog, /ErrDeadLetter/);
  assert.match(v55Backlog, /9\.8746\/10/);
  assert.match(v56Backlog, /V56-01/);
  assert.match(v56Backlog, /V56-01 已完成并计分/);
  assert.match(v56Backlog, /ErrConsumerNotPersistent/);
  assert.match(v56Backlog, /ErrMaxDeliverTooLow/);
  assert.match(v56Backlog, /schema 4/);
  assert.match(v56Backlog, /9\.8762\/10/);
  assert.match(v57Backlog, /V57-01/);
  assert.match(v57Backlog, /V57-01 已完成并计分/);
  assert.match(v57Backlog, /ErrConsumerPayloadUnavailable/);
  assert.match(v57Backlog, /schema 5/);
  assert.match(v57Backlog, /9\.8778\/10/);
  assert.match(v58Backlog, /V58-01/);
  assert.match(v58Backlog, /V58-01 已完成并计分/);
  assert.match(v58Backlog, /ErrConsumerSubjectMismatch/);
  assert.match(v58Backlog, /schema 6/);
  assert.match(v58Backlog, /9\.8794\/10/);
  assert.match(v59Backlog, /V59-01/);
  assert.match(v59Backlog, /V59-01 已完成并计分/);
  assert.match(v59Backlog, /maximumRetryResponseDrainBytes/);
  assert.match(v59Backlog, /ContentLength\+1/);
  assert.match(v59Backlog, /HTTP\/1\.1/);
  assert.match(v59Backlog, /9\.8802\/10/);
  assert.match(v60Backlog, /V60-01/);
  assert.match(v60Backlog, /V60-01 已完成并计分/);
  assert.match(v60Backlog, /ErrConsumerDeliveryPolicy/);
  assert.match(v60Backlog, /DeliverAllPolicy/);
  assert.match(v60Backlog, /schema 7/);
  assert.match(v60Backlog, /9\.8810\/10/);
  assert.match(v61Backlog, /V61-01/);
  assert.match(v61Backlog, /V61-01 已完成并计分/);
  assert.match(v61Backlog, /ErrConsumerReplayPolicy/);
  assert.match(v61Backlog, /ReplayInstantPolicy/);
  assert.match(v61Backlog, /schema 8/);
  assert.match(v61Backlog, /9\.8818\/10/);
  assert.match(v62Backlog, /V62-01/);
  assert.match(v62Backlog, /V62-01 已完成并计分/);
  assert.match(v62Backlog, /ErrConsumerRequestExpires/);
  assert.match(v62Backlog, /MaxRequestExpires/);
  assert.match(v62Backlog, /schema 9/);
  assert.match(v62Backlog, /9\.8826\/10/);
  assert.match(v63Backlog, /V63-01/);
  assert.match(v63Backlog, /V63-01 已完成并计分/);
  assert.match(v63Backlog, /ErrConsumerPaused/);
  assert.match(v63Backlog, /PauseConsumer/);
  assert.match(v63Backlog, /schema 10/);
  assert.match(v63Backlog, /9\.8834\/10/);
  assert.match(v64Backlog, /V64-01/);
  assert.match(v64Backlog, /V64-01 已完成并计分/);
  assert.match(v64Backlog, /ErrConsumerNotPull/);
  assert.match(v64Backlog, /DeliverSubject/);
  assert.match(v64Backlog, /schema 11/);
  assert.match(v64Backlog, /9\.8841\/10/);
  assert.match(v65Backlog, /V65-01/);
  assert.match(v65Backlog, /V65-01 已完成并计分/);
  assert.match(v65Backlog, /ErrConsumerPriorityPolicy/);
  assert.match(v65Backlog, /PriorityPolicyNone/);
  assert.match(v65Backlog, /schema 12/);
  assert.match(v65Backlog, /9\.8849\/10/);
  assert.match(v66Backlog, /V66-01/);
  assert.match(v66Backlog, /V66-01 已完成并计分/);
  assert.match(v66Backlog, /ErrConsumerAckPolicy/);
  assert.match(v66Backlog, /AckExplicitPolicy/);
  assert.match(v66Backlog, /schema 13/);
  assert.match(v66Backlog, /9\.8857\/10/);
  assert.match(v67Backlog, /V67-01/);
  assert.match(v67Backlog, /V67-01 已完成并计分/);
  assert.match(v67Backlog, /FetchContext/);
  assert.match(v67Backlog, /schema 14/);
  assert.match(v67Backlog, /9\.8865\/10/);
  assert.match(v68Backlog, /V68-01/);
  assert.match(v68Backlog, /V68-01 已完成并计分/);
  assert.match(v68Backlog, /VerifyIDTokenWithAccessToken/);
  assert.match(v68Backlog, /schema 2/);
  assert.match(v68Backlog, /9\.8872\/10/);
  assert.match(v69Backlog, /V69-01/);
  assert.match(v69Backlog, /token_endpoint_auth_methods_supported/);
  assert.match(v69Backlog, /schema 3/);
  assert.match(v69Backlog, /9\.8880\/10/);
  assert.match(nextBacklog, /状态：\*\*已完结\*\*/);
  assert.match(nextBacklog, /当前精确综合评分：\*\*9\.831\/10\*\*/);
  assert.match(nextBacklog, /当前综合等级：\*\*A−\*\*/);
  assert.match(nextBacklog, /目标综合等级：\*\*A\*\*/);
  assert.match(nextBacklog, /37 → 36 allocs\/op/);
  assert.match(nextBacklog, /B\/op 与 ns\/op 区间均重叠/);
  assert.match(nextBacklog, /BenchmarkStandardHTTPHandler/);
  assert.match(nextBacklog, /BenchmarkStandardHTTPHandlerParallel/);
  assert.match(nextBacklog, /BenchmarkHelloFiberHandlerAtomicRateLimiter/);
  assert.match(nextBacklog, /BenchmarkHelloFiberHandlerMiddlewareMatrix/);
  assert.match(nextBacklog, /BenchmarkAuthenticationMiddlewareMatrix/);
  assert.match(nextBacklog, /BenchmarkIdempotencyMiddlewareMatrix/);
  assert.match(nextBacklog, /BenchmarkFromJetStreamMessage/);
  assert.match(nextBacklog, /2,144 B\/op、8 allocs\/op/);
  assert.match(nextBacklog, /9,376 B\/op、12 allocs\/op/);
  assert.match(nextBacklog, /16 → 14 allocs\/op/);
  assert.match(nextBacklog, /1,001 → 953 B\/op/);
  assert.match(nextBacklog, /15 allocs\/op、753 B\/op/);
  assert.match(nextBacklog, /13 allocs\/op、729 B\/op/);
  assert.match(nextBacklog, /89 allocs\/op、5,204 B\/op/);
  assert.match(nextBacklog, /39 allocs\/op、2,167–2,182 B\/op/);
  assert.match(nextBacklog, /34 allocs\/op、2,039–2,052 B\/op/);
  assert.match(nextBacklog, /framework-net-http/);
  assert.match(nextBacklog, /Node Fastify\/Express/);
  assert.match(nextBacklog, /Java Spring Boot MVC\/WebFlux/);
  assert.match(nextBacklog, /V14-01/);
  assert.match(nextBacklog, /V14-15/);
	assert.match(lifecycleADR, /SSE 必须通过 `SendServerSentEvents` 或纯新增的 `SendServerSentEventsFromSource` 使用 Framework request lifecycle/);
	assert.match(lifecycleADR, /目标 edge 下 SSE 的 buffering/);
  assert.match(nextBacklog, /environmentFingerprint/);
  assert.match(nextBacklog, /真实业务 PostgreSQL\/queue 接入/);
  assert.match(nextBacklog, /生产审计 sink/);
  assert.match(benchmark, /func BenchmarkHelloFiberHandlerMiddlewareMatrix/);
  assert.match(benchmark, /func BenchmarkAuthenticationMiddlewareMatrix/);
  assert.match(benchmark, /func BenchmarkIdempotencyMiddlewareMatrix/);
  assert.match(benchmark, /name: "enabled_replay"/);
  assert.match(app, /func defaultAppMiddlewareSet\(\) appMiddlewareSet/);
  assert.match(app, /return newApp\(options, defaultAppMiddlewareSet\(\)\)/);
  assert.match(appTests, /func TestWriteFingerprintPartReusesLengthBufferWithoutAllocating/);
  assert.match(fingerprint, /var length \[8\]byte/);
  assert.match(fingerprint, /writeFingerprintPart\(digest, &length,/);
  assert.match(middleware, /fingerprintLockKey := cacheLock\.key\(key\)/);
  assert.match(middleware, /cacheLock\.locker\.Unlock\(fingerprintLockKey\)/);
  assert.match(tracing, /if !parent\.IsValid\(\) \{\s*return ctx\s*\}/);
  assert.match(tracingTests, /func TestTraceRequestContextWithoutParentReusesSpanContext/);
  assert.match(currentBacklog, /状态：\*\*已完结\*\*/);
  assert.match(currentBacklog, /当前精确综合评分：\*\*9\.836\/10\*\*/);
  assert.match(currentBacklog, /V15-01 \| P0 \| 仓库内完成/);
  assert.match(currentBacklog, /V15-02 \| P0 \| 仓库内完成/);
  assert.match(currentBacklog, /V15-03 \| P1 \| 仓库内完成/);
  assert.match(currentBacklog, /V15-04 \| P1 \| 仓库内完成/);
  assert.match(currentBacklog, /V15-05 \| P2 \| 仓库内完成/);
  assert.match(currentBacklog, /未舍入加权值 \*\*9\.8356\/10\*\*/);
  assert.match(currentBacklog, /BenchmarkCloneRequestForPropagation/);
  assert.match(currentBacklog, /752 \| 4/);
  assert.match(currentBacklog, /2,592 \| 18/);
  assert.match(httpClient, /outbound := request\.WithContext\(ctx\)/);
  assert.match(httpClient, /outbound\.Header = request\.Header\.Clone\(\)/);
  assert.match(httpClient, /var errInvalidTransportResponse = errors\.New/);
  assert.match(httpClient, /func completedHTTPContextError\(ctx context\.Context\) error/);
  assert.match(httpClient, /func authoritativeHTTPResult\(ctx context\.Context, response \*http\.Response, err error\)/);
  assert.match(httpClient, /func closeHTTPRequestBody\(request \*http\.Request\)/);
  assert.match(httpClient, /func closeHTTPResponseBody\(response \*http\.Response\)/);
  assert.match(httpClientTests, /func TestCloneRequestForPropagationOnlyIsolatesMutableHeaders/);
  assert.match(httpClientTests, /func BenchmarkCloneRequestForPropagation/);
  assert.match(httpClientTests, /legacy-deep-clone/);
  assert.match(httpClientTests, /func TestTracingTransportRejectsCompletedContextResultsAndOwnsBodies/);
  assert.match(httpClientTests, /func TestCompletedHTTPContextErrorObservesElapsedDeadlineWithoutAllocations/);
  assert.match(responseBody, /ErrResponseBodyTooLarge/);
  assert.match(responseBody, /func LimitResponseBody\(response \*http\.Response, maxBytes int64\) error/);
  assert.match(responseBody, /response\.ContentLength > maxBytes/);
  assert.match(responseBody, /var extra \[1\]byte/);
  for (const testName of [
    'TestLimitResponseBodyRejectsKnownOversizeBeforeRead',
    'TestLimitResponseBodyBoundsChunkedStreamingResponse',
    'TestLimitResponseBodyPreservesTruncatedContentLengthError',
    'TestLimitResponseBodyAllowsCallerToCloseStreamingResponseEarly',
    'TestLimitResponseBodyPreservesCallerCancellation',
    'TestLimitResponseBodyPreservesConnectionReuseAfterCompleteRead',
  ]) {
    assert.match(responseBodyTests, new RegExp(`func ${testName}`));
  }
  assertEvidenceInput('Framework/httpclient/response_body.go');
  assertEvidenceInput('Framework/httpclient/response_body_test.go');
  assert.match(retry, /type RetryConfig struct/);
  assert.match(retry, /case "", http\.MethodGet, http\.MethodHead, http\.MethodOptions, http\.MethodTrace/);
  assert.match(retry, /config\.MaxAttempts > maximumRetryAttempts/);
  assert.match(retry, /time\.Now\(\)\.Add\(delay\)\.Before\(deadline\)/);
  assert.match(retry, /func retryDelay\(/);
  assert.match(retry, /response\.Header\.Get\("Retry-After"\)/);
  assert.match(retry, /func parseRetryAfter\(/);
  assert.match(retry, /http\.ParseTime\(value\)/);
  assert.match(retry, /"math\/rand\/v2"/);
  assert.match(retry, /randomInt64N func\(int64\) int64/);
  assert.match(retry, /delay = transport\.jitteredRetryDelay\(delay\)/);
  assert.match(retry, /func retryJitter\(/);
  assert.match(retry, /window := min\(delay\/2, maximum-delay\)/);
  assert.match(retry, /randomInt64N\(int64\(window\)\+1\)/);
  assert.match(retry, /maximumRetryResponseDrainBytes\s+int64 = 32 \* 1024/);
  assert.match(retry, /func closeRetryResponse\(response \*http\.Response\)/);
  assert.match(retry, /response\.ContentLength >= 0 && response\.ContentLength <= maximumRetryResponseDrainBytes/);
  assert.match(retry, /io\.CopyN\(io\.Discard, response\.Body, response\.ContentLength\+1\)/);
  for (const testName of [
    'TestClientRetriesReplayableSafeRequestWithinOneSpan',
    'TestClientDoesNotRetryUnsafeMethod',
    'TestClientDoesNotRetrySafeRequestWithNonReplayableBody',
    'TestRetryTransportClosesIntermediateResponseAndStopsAtMaximum',
    'TestRetryTransportDrainsSmallResponseAndReusesHTTP1Connection',
    'TestCloseRetryResponseBoundsDrainByDeclaredLength',
    'TestCloseRetryResponseClosesAfterReadFailure',
    'TestRetryTransportCancellationInterruptsBackoff',
    'TestRetryTransportRejectsLateNilResultsWithoutRetryOrJitter',
    'TestRetryTransportKeepsResponseWhenBackoffCannotFitDeadline',
    'TestRetryTransportKeepsResponseWhenRetryAfterExceedsLocalBudget',
    'TestRetryTransportKeepsResponseWhenRetryAfterCannotFitDeadline',
    'TestRetryTransportKeepsResponseWhenJitterCannotFitDeadline',
    'TestRetryTransportReturnsBoundedBodyReplayError',
    'TestRetryJitterUsesInclusivePositiveWindow',
    'TestRetryJitterTruncatesWindowAtMaximumBackoff',
    'TestRetryJitterSkipsSamplingWithoutWindow',
    'TestRetryDelayHonorsValidRetryAfterWithinLocalBudget',
    'TestRetryPolicyUsesOnlySafeMethodsAndTransientStatuses',
  ]) {
    assert.match(retryTests, new RegExp(`func ${testName}`));
  }
  assertEvidenceInput('Framework/httpclient/retry.go');
  assertEvidenceInput('Framework/httpclient/retry_test.go');
  assert.match(v16Backlog, /状态：\*\*已完结\*\*/);
  assert.match(v16Backlog, /V16-01 \| P0 \| 仓库内完成/);
  assert.match(v16Backlog, /V16-02 \| P1 \| 仓库内完成/);
  assert.match(v16Backlog, /当前综合评分：\*\*9\.844\/10\*\*/);
  assert.match(v16Backlog, /未舍入加权值 \*\*9\.8441\/10\*\*/);
  assert.match(v16Backlog, /V16-03 \\| P1 \\| 仓库内完成/);
  assert.match(v16Backlog, /V16-04 \\| P2 \\| 仓库内完成/);
  assert.match(v16Backlog, /V16-05 \\| P2 \| 仓库内复核完成/);
  for (const id of ['V16-06', 'V16-07', 'V16-08', 'V16-09', 'V16-10', 'V16-11', 'V16-12', 'V16-13', 'V16-14']) {
    assert.match(v16Backlog, new RegExp(id));
  }
  assert.match(v17Backlog, /状态：\*\*已完结\*\*/);
  assert.match(v17Backlog, /V17-01 \| P1 \| 仓库内完成/);
  assert.match(v17Backlog, /当前综合评分：\*\*9\.845\/10\*\*/);
  assert.match(v17Backlog, /未舍入加权值 \*\*9\.8450\/10\*\*/);
  assert.match(v18Backlog, /状态：\*\*已完成\*\*/);
  assert.match(v18Backlog, /V18-01 \| P1 \| 仓库内完成/);
  assert.match(v18Backlog, /当前综合评分：\*\*9\.846\/10\*\*/);
  assert.match(v18Backlog, /未舍入加权值 \*\*9\.8456\/10\*\*/);
  assert.match(v19Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v19Backlog, /V19-01 \| P0 \| 仓库内完成/);
  assert.match(v19Backlog, /9\.8456 → 9\.8456（\+0\.0000）/);
  for (const id of ['V19-02', 'V19-03', 'V19-04', 'V19-05', 'V19-06', 'V19-07', 'V19-08', 'V19-09', 'V19-10']) {
    assert.match(v19Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v20Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v20Backlog, /V20-01 [|] P0 [|] 仓库内完成/);
  assert.match(v20Backlog, /9\.8444 → 9\.8456（\+0\.0012）/);
  assert.match(v20Backlog, /poisonedGoRoot/);
  for (const id of ['V20-02', 'V20-03', 'V20-04', 'V20-05', 'V20-06', 'V20-07', 'V20-08', 'V20-09', 'V20-10']) {
    assert.match(v20Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v21Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v21Backlog, /V21-01 [|] P0 [|] 仓库内完成/);
  assert.match(v21Backlog, /9\.8432 → 9\.8464（\+0\.0032）/);
  for (const id of ['V21-02', 'V21-03', 'V21-04', 'V21-05', 'V21-06', 'V21-07', 'V21-08', 'V21-09', 'V21-10']) {
    assert.match(v21Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v22Backlog, /V22-01 [|] P0 [|] 仓库内完成/);
  assert.match(v22Backlog, /9\.8378 -> 9\.8472/);
  for (const id of ['V22-02', 'V22-03', 'V22-04', 'V22-05', 'V22-06', 'V22-07', 'V22-08', 'V22-09', 'V22-10']) {
    assert.match(v22Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v23Backlog, /V23-01 [|] P0 [|] 仓库内完成/);
  assert.match(v23Backlog, /9\.8431 -> 9\.8480/);
  for (const id of ['V23-02', 'V23-03', 'V23-04', 'V23-05', 'V23-06', 'V23-07', 'V23-08', 'V23-09', 'V23-10']) {
    assert.match(v23Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v24Backlog, /V24-01 [|] P0 [|] 仓库内完成/);
  assert.match(v24Backlog, /9\.8435 -> 9\.8484/);
  assert.match(v24Backlog, /Node 主阶段 \*\*163\/163\*\*、release 阶段 \*\*1\/1\*\*/);
  assert.match(v24Backlog, /evidence input contract 覆盖 \*\*276 个输入\*\*/);
  assert.match(v24Backlog, /总 manifest\/verify 覆盖 \*\*53 个制品\*\*/);
  for (const id of ['V24-02', 'V24-03', 'V24-04', 'V24-05', 'V24-06', 'V24-07', 'V24-08', 'V24-09', 'V24-10']) {
    assert.match(v24Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v25Backlog, /V25-01 [|] P0 [|] 仓库内完成/);
  assert.match(v25Backlog, /9\.8404 -> 9\.8488/);
  assert.match(v25Backlog, /Node 主阶段 \*\*165\/165\*\*、release 阶段 \*\*1\/1\*\*/);
  assert.match(v25Backlog, /evidence input contract 覆盖 \*\*277 个输入\*\*/);
  assert.match(v25Backlog, /总 manifest\/verify 覆盖 \*\*53 个制品\*\*/);
  for (const id of ['V25-02', 'V25-03', 'V25-04', 'V25-05', 'V25-06', 'V25-07', 'V25-08', 'V25-09', 'V25-10']) {
    assert.match(v25Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v26Backlog, /V26-01 [|] P1 [|] 仓库内完成/);
  assert.match(v26Backlog, /9\.8466 -> 9\.8492/);
  assert.match(v26Backlog, /Node 主阶段 \*\*167\/167\*\*、release 阶段 \*\*1\/1\*\*/);
  assert.match(v26Backlog, /evidence input contract 覆盖 \*\*278 个输入\*\*/);
  assert.match(v26Backlog, /总 manifest\/verify 覆盖 \*\*53 个制品\*\*/);
  for (const id of ['V26-02', 'V26-03', 'V26-04', 'V26-05', 'V26-06', 'V26-07', 'V26-08', 'V26-09', 'V26-10']) {
    assert.match(v26Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v27Backlog, /V27-01 [|] P1 [|] 仓库内完成/);
  assert.match(v27Backlog, /9\.8469 -> 9\.8496/);
  assert.match(v27Backlog, /Node 主阶段 \*\*168\/168\*\*、release 阶段 \*\*1\/1\*\*/);
  assert.match(v27Backlog, /evidence input contract 覆盖 \*\*279 个输入\*\*/);
  assert.match(v27Backlog, /总 manifest\/verify 覆盖 \*\*53 个制品\*\*/);
  for (const id of ['V27-02', 'V27-03', 'V27-04', 'V27-05', 'V27-06', 'V27-07', 'V27-08', 'V27-09', 'V27-10']) {
    assert.match(v27Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v28Backlog, /V28-01 [|] P1 [|] 仓库内完成/);
  assert.match(v28Backlog, /9\.8480 -> 9\.8500/);
  assert.match(v28Backlog, /输入目标由 279 增至 280/);
  assert.match(v28Backlog, /Node 主阶段 \*\*169\/169\*\*、release 阶段 \*\*1\/1\*\*/);
  assert.match(v28Backlog, /280 输入与 53 制品总 manifest\/verify/);
  for (const id of ['V28-02', 'V28-03', 'V28-04', 'V28-05', 'V28-06', 'V28-07', 'V28-08', 'V28-09', 'V28-10']) {
    assert.match(v28Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v29Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v29Backlog, /V29-01 [|] P1 [|] 仓库内完成/);
  assert.match(v29Backlog, /9\.8477 -> 9\.8511/);
  assert.match(v29Backlog, /输入目标由 280 增至 281/);
  assert.match(v29Backlog, /281 输入与 53 制品总 manifest\/verify/);
  assert.match(v29Backlog, /Node 主阶段 \*\*170\/170\*\*、release 阶段 \*\*1\/1\*\*/);
  for (const id of ['V29-02', 'V29-03', 'V29-04', 'V29-05', 'V29-06', 'V29-07', 'V29-08', 'V29-09', 'V29-10']) {
    assert.match(v29Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v30Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v30Backlog, /V30-01 [|] P1 [|] 仓库内完成/);
  assert.match(v30Backlog, /9\.8474 -> 9\.8523/);
  assert.match(v30Backlog, /输入由 281 增至 282/);
  assert.match(v30Backlog, /Node 主阶段 \*\*171\/171\*\* 与 release 阶段 \*\*1\/1\*\*/);
  for (const id of ['V30-02', 'V30-03', 'V30-04', 'V30-05', 'V30-06', 'V30-07', 'V30-08', 'V30-09', 'V30-10']) {
    assert.match(v30Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v31Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v31Backlog, /V31-01 [|] P1 [|] 仓库内完成/);
  assert.match(v31Backlog, /9\.8491 -> 9\.8535/);
  assert.match(v31Backlog, /输入由 282 增至 284/);
  assert.match(v31Backlog, /Node 主阶段 \*\*172\/172\*\*、release 阶段 \*\*1\/1\*\*/);
  for (const id of ['V31-02', 'V31-03', 'V31-04', 'V31-05', 'V31-06', 'V31-07', 'V31-08', 'V31-09', 'V31-10']) {
    assert.match(v31Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v32Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v32Backlog, /V32-01 [|] P1 [|] 仓库内完成/);
  assert.match(v32Backlog, /9\.8499 -> 9\.8547/);
  assert.match(v32Backlog, /输入由 284 增至 285/);
  assert.match(v32Backlog, /Node 主阶段 \*\*173\/173\*\*、release 阶段 \*\*1\/1\*\*/);
  for (const id of ['V32-02', 'V32-03', 'V32-04', 'V32-05', 'V32-06', 'V32-07', 'V32-08', 'V32-09', 'V32-10']) {
    assert.match(v32Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v33Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v33Backlog, /V33-01 [|] P1 [|] 仓库内完成/);
  assert.match(v33Backlog, /9\.8502 -> 9\.8555/);
  assert.match(v33Backlog, /输入由 285 增至 286/);
  assert.match(v33Backlog, /Node 主阶段 \*\*174\/174\*\*、release 阶段 \*\*1\/1\*\*/);
  for (const id of ['V33-02', 'V33-03', 'V33-04', 'V33-05', 'V33-06', 'V33-07', 'V33-08', 'V33-09', 'V33-10']) {
    assert.match(v33Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v34Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v34Backlog, /V34-01 [|] P1 [|] 仓库内完成/);
  assert.match(v34Backlog, /9\.8507 -> 9\.8563/);
  assert.match(v34Backlog, /输入由 286 增至 289/);
  assert.match(v34Backlog, /Node 主阶段目标由 174 增至 179/);
  for (const id of ['V34-02', 'V34-03', 'V34-04', 'V34-05', 'V34-06', 'V34-07', 'V34-08', 'V34-09', 'V34-10']) {
    assert.match(v34Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v35Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v35Backlog, /V35-01 [|] P1 [|] 仓库内完成/);
  assert.match(v35Backlog, /9\.8518 -> 9\.8574/);
  assert.match(v35Backlog, /输入由 289 增至 290/);
  assert.match(v35Backlog, /Node 主阶段目标由 179 增至 183/);
  for (const id of ['V35-02', 'V35-03', 'V35-04', 'V35-05', 'V35-06', 'V35-07', 'V35-08', 'V35-09', 'V35-10']) {
    assert.match(v35Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v36Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v36Backlog, /V36-01 [|] P1 [|] 仓库内完成/);
  assert.match(v36Backlog, /9\.8529 -> 9\.8585/);
  assert.match(v36Backlog, /输入由 290 增至 291/);
  assert.match(v36Backlog, /Node 主阶段目标由 183 增至 187/);
  for (const id of ['V36-02', 'V36-03', 'V36-04', 'V36-05', 'V36-06', 'V36-07', 'V36-08', 'V36-09', 'V36-10']) {
    assert.match(v36Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assertEvidenceInput('docs/待优化/待优化V36.md');
  assert.match(v37Backlog, /状态：\*\*仓库内可执行项已完成；目标环境证据待获取\*\*/);
  assert.match(v37Backlog, /V37-01 [|] P1 [|] 仓库内完成/);
  assert.match(v37Backlog, /9\.8535 -> 9\.8599/);
  assert.match(v37Backlog, /输入由 291 增至 293/);
  assert.match(v37Backlog, /293 输入\/58 制品/);
  assert.match(v37Backlog, /release 阶段由 1 增至 5/);
  for (const id of ['V37-02', 'V37-03', 'V37-04', 'V37-05', 'V37-06', 'V37-07', 'V37-08', 'V37-09', 'V37-10']) {
    assert.match(v37Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assertEvidenceInput('docs/待优化/待优化V37.md');
  assert.match(v38Backlog, /状态：\*\*V38-01 仓库内优化已完成；目标环境证据待获取\*\*/);
  assert.match(v38Backlog, /V38-01 [|] P1 [|] 仓库内完成/);
  assert.match(v38Backlog, /9\.8536 -> 9\.8610/);
  assert.match(v38Backlog, /296 输入\/58 制品/);
  for (const id of ['V38-02', 'V38-03', 'V38-04', 'V38-05', 'V38-06', 'V38-07', 'V38-08', 'V38-09', 'V38-10']) {
    assert.match(v38Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v39Backlog, /状态：\*\*V39-01 仓库内优化已完成；目标环境证据保持 `not_recorded`\*\*/);
  assert.match(v39Backlog, /V39-01 [|] P1 [|] 仓库内完成/);
  assert.match(v39Backlog, /9\.8548 -> 9\.8624/);
  for (const id of ['V39-02', 'V39-03', 'V39-04', 'V39-05', 'V39-06', 'V39-07', 'V39-08', 'V39-09', 'V39-10']) {
    assert.match(v39Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v40Backlog, /状态：\*\*V40-01 仓库内优化已完成；目标环境项目继续保持 `not_recorded`\*\*/);
  assert.match(v40Backlog, /V40-01 [|] P1 [|] 仓库内完成/);
  assert.match(v40Backlog, /9\.8543 -> 9\.8636/);
  for (const id of ['V40-02', 'V40-03', 'V40-04', 'V40-05', 'V40-06', 'V40-07', 'V40-08', 'V40-09', 'V40-10']) {
    assert.match(v40Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v41Backlog, /状态：\*\*V41-01 仓库内优化已完成；目标环境项目继续保持 `not_recorded`\*\*/);
  assert.match(v41Backlog, /V41-01 [|] P1 [|] 仓库内完成/);
  assert.match(v41Backlog, /9\.8528 -> 9\.8647/);
  for (const id of ['V41-02', 'V41-03', 'V41-04', 'V41-05', 'V41-06', 'V41-07', 'V41-08', 'V41-09', 'V41-10']) {
    assert.match(v41Backlog, new RegExp(`${id} [|] P[012] [|] ` + '`not_recorded`'));
  }
  assert.match(v42Backlog, /V42-01 [|] P1 [|] 仓库内完成/);
  assert.match(v42Backlog, /V42-02 [|] P0 [|] `not_recorded`/);
  assert.match(v42Backlog, /V42-03 [|] P1 [|] `not_recorded`/);
  assert.match(v42Backlog, /9\.8647\/10/);
  assert.match(v42Backlog, /9\.8660\/10/);
  assert.match(goProjectScript, /createGoProjectCommandRunner/);
  assert.match(goProjectScript, /goProjectTaskBudgetMs/);
  assert.doesNotMatch(goProjectScript, /node:child_process|\bspawn\(/);
  assert.match(goProjectScript, /budgetMs: goProjectTaskBudgetMs\[task\]/);
  assert.match(goProjectCommand, /goProjectCommandMaximumDurationMs = 20 \* 60_000/);
  assert.match(goProjectCommand, /goProjectCommandDiagnosticCharacterLimit = 4_096/);
  assert.match(goProjectCommand, /shell: false/);
  assert.match(goProjectCommand, /windowsHide: true/);
  assert.match(goProjectCommand, /killSignal: 'SIGTERM'/);
  assert.match(goProjectCommand, /budget exhausted/);
  assert.match(goProjectCommand, /missing status/);
  assert.match(goProjectCommand, /Go project command environment must be an object/);
  assert.match(goProjectCommandTests, /decreasing total budget/);
  assert.match(goProjectCommandTests, /explicitly has no timeout or kill signal/);
  assert.match(goProjectCommandTests, /timeout requests SIGTERM/);
  assert.match(goProjectCommandTests, /spawn, signal, missing-status, and nonzero failures/);
  const [contractCommand, contractCommandTests, redisContractScript, postgresContractScript] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'contract-command.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'contract-command.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'redis-sentinel-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-contract.mjs'), 'utf8'),
  ]);
  assert.match(redisContractScript, /createContractCommandRunner\(\{ cwd: repositoryRoot \}\)/);
  assert.doesNotMatch(redisContractScript, /node:child_process|\bspawn\(/);
  assert.match(redisContractScript, /timeoutMs: 120_000/);
  assert.match(redisContractScript, /timeoutMs: 150_000/);
  assert.match(redisContractScript, /timeoutMs: 5_000/);
  assert.match(postgresContractScript, /createContractCommandRunner\(\{ cwd: repositoryRoot \}\)/);
  assert.doesNotMatch(postgresContractScript, /node:child_process|\bspawn\(/);
  assert.match(postgresContractScript, /contractCommandMaximumOutputBytes/);
  assert.match(postgresContractScript, /timeoutMs: 120_000/);
  assert.match(postgresContractScript, /timeoutMs: 150_000/);
  assert.match(postgresContractScript, /timeoutMs: 5_000/);
  assert.match(contractCommand, /contractCommandMaximumOutputBytes = 8 \* 1024 \* 1024/);
  assert.match(contractCommand, /contractCommandMaximumDurationMs = 150_000/);
  assert.match(contractCommand, /shell: false/);
  assert.match(contractCommand, /windowsHide: true/);
  assert.match(contractCommand, /killSignal: 'SIGTERM'/);
  assert.match(contractCommand, /output overflow/);
  assert.match(contractCommand, /missing status/);
  assert.match(contractCommandTests, /uses bounded non-shell options/);
  assert.match(contractCommandTests, /classifies timeout/);
  assert.match(contractCommandTests, /bounds output and diagnostics/);
  assert.match(contractCommandTests, /allowFailure returns classified failures/);
  assert.match(contractCommandTests, /output limit across stdout and stderr/);
  assert.match(JSON.parse(packageDocument).scripts['test:node'], /go-project-command\.test\.mjs/);
  assert.match(JSON.parse(packageDocument).scripts['test:node'], /contract-command\.test\.mjs/);
  assertEvidenceInput('docs/待优化/待优化V38.md');
  assertEvidenceInput('docs/待优化/待优化V39.md');
  assertEvidenceInput('docs/待优化/待优化V40.md');
  assertEvidenceInput('docs/待优化/待优化V41.md');
  assertEvidenceInput('scripts/lib/go-project-command.mjs');
  assertEvidenceInput('scripts/lib/contract-command.mjs');
  assertEvidenceInput('__test__/node/go-project-command.test.mjs');
  assertEvidenceInput('__test__/node/contract-command.test.mjs');
  assert.match(goSDK, /import \{\s*formatGoFileWithCandidatesSync,\s*formatGeneratedGoSDKSourceSync,\s*publishGeneratedGoSDKSync,\s*\} from '\.\/lib\/sdk-generation\.mjs'/);
  assert.match(goSDK, /formatGoFileWithCandidatesSync\(filePath, \{\s*candidates,\s*cwd: repositoryRoot,\s*\}\)/);
  assert.match(goSDK, /formatGeneratedGoSDKSourceSync\(generated, \{\s*stagingRoot,\s*formatFile: gofmt,\s*\}\)/);
  assert.match(goSDK, /publishGeneratedGoSDKSync\(\{\s*clientPath: targetPath,\s*versionPath,\s*formattedSource: formatted,\s*version: document\.info\.version,\s*\}\)/);
  assert.doesNotMatch(goSDK, /sdk-check|gofmt\(targetPath\)|writeFileSync\(targetPath|\bspawnSync\b/);
  assert.match(sdkGeneration, /maximumCommandDurationMs,\s*maximumCommandOutputBytes/);
  assert.match(sdkGeneration, /retryableFormatterLaunchErrorCodes = new Set\(\['ENOENT', 'EINVAL'\]\)/);
  assert.match(sdkGeneration, /maxBuffer: maximumCommandOutputBytes/);
  assert.match(sdkGeneration, /timeout: maximumCommandDurationMs/);
  assert.match(sdkGeneration, /killSignal: 'SIGTERM'/);
  assert.match(sdkGeneration, /windowsHide: true/);
  assert.match(sdkGeneration, /maximumFormatterDiagnosticCharacters = 4_096/);
  assert.match(sdkGeneration, /mkdtempSync\(path\.join\(stagingRoot, 'go-sdk-'\)\)/);
  assert.match(sdkGeneration, /writeOutput = writeFileAtomicallySync/);
  assert.match(sdkGeneration, /for \(const output of published\.reverse\(\)\)/);
  assert.match(sdkGeneration, /SDK publication failed and rollback was incomplete/);
  for (const testName of [
    'formats only a staged client and removes the staging directory',
    'preserves canonical files and cleans staging when the formatter fails',
    'uses a unique staging directory for every invocation',
    'atomically replaces the generated client and version',
    'rolls back the client when version publication fails',
    'applies bounded non-shell process options',
    'only falls back for missing or invalid launch candidates',
    'does not fall back after timeout, signal, overflow, permission, or exit failure',
    'bounds stderr included in failure diagnostics',
  ]) {
    assert.match(sdkGenerationTests, new RegExp(testName));
  }
  assert.match(sdkRelease, /import \{ writeFileAtomicallySync \} from '\.\/atomic-output\.mjs'/);
  assert.match(sdkRelease, /writeOutput = writeFileAtomicallySync/);
  assert.match(sdkRelease, /writeOutput\(manifestPath\(repositoryRoot, project\), encodedManifest\(manifest\), \{ encoding: 'utf8' \}\)/);
  assert.doesNotMatch(sdkRelease, /\bwriteFileSync\b/);
  assert.match(sdkRelease, /sdkReleaseCheckTimeoutMs = 90_000/);
  assert.match(sdkRelease, /sdkReleaseCheckMaximumOutputBytes = 4 \* 1024 \* 1024/);
  assert.match(sdkRelease, /sdkReleaseCheckDiagnosticCharacterLimit = 4_096/);
  assert.match(sdkRelease, /const deadline = readSDKReleaseCheckClock\(now\) \+ timeoutMs/);
  assert.match(sdkRelease, /timeout: remainingTimeoutMs/);
  assert.match(sdkRelease, /maxBuffer: sdkReleaseCheckMaximumOutputBytes/);
  assert.match(sdkRelease, /killSignal: 'SIGTERM'/);
  assert.match(sdkRelease, /shell: false/);
  assert.match(sdkReleaseCLI, /createSDKReleaseCheckRunner\(\{/);
  assert.match(sdkReleaseCLI, /verifyGeneratedSDK\(project\.name\)/);
  assert.doesNotMatch(sdkReleaseCLI, /\bspawnSync\b/);
  assert.match(sdkReleaseTests, /atomically replaces an existing file and preserves it on publication failure/);
  assert.match(sdkReleaseTests, /injected SDK release manifest publication failure/);
  for (const testName of [
    'applies bounded options and shares one decreasing deadline',
    'rejects exhausted budgets and invalid clocks without spawning',
    'classifies timeout, signal, overflow, spawn, and exit failures',
    'bounds stderr diagnostics and never reports stdout',
  ]) {
    assert.match(sdkReleaseTests, new RegExp(testName));
  }
  assert.match(httpClient, /CircuitBreaker\s+CircuitBreakerConfig/);
  assert.match(httpClient, /base = newCircuitBreakerTransport\(base, config\.CircuitBreaker\)/);
  assert.match(httpClient, /errors\.Is\(err, ErrCircuitOpen\)/);
  assert.match(circuitBreaker, /var ErrCircuitOpen = errors\.New/);
  assert.match(circuitBreaker, /type CircuitBreakerConfig struct/);
  assert.match(circuitBreaker, /FailureThreshold int/);
  assert.match(circuitBreaker, /OpenTimeout\s+time\.Duration/);
  assert.match(circuitBreaker, /Observer\s+CircuitBreakerObserver/);
  assert.match(circuitBreaker, /type CircuitBreakerObservation struct \{\s*State string\s*Event string\s*\}/);
  assert.match(circuitBreaker, /type CircuitBreakerObserver func\(CircuitBreakerObservation\)/);
  assert.match(circuitBreaker, /defer func\(\) \{ _ = recover\(\) \}\(\)/);
  for (const value of ['closed', 'open', 'half_open', 'opened', 'rejected', 'probe_started', 'probe_succeeded', 'probe_failed', 'probe_canceled']) {
    assert.match(circuitBreaker, new RegExp(`= "${value}"`));
  }
  assert.match(circuitBreaker, /breaker\.probeInFlight/);
  assert.match(circuitBreaker, /permit\.generation != breaker\.generation/);
  assert.match(circuitBreaker, /maximumFailureThreshold\s+= 100/);
  for (const testName of [
    'TestCircuitBreakerOpensFastAndSuccessfulProbeCloses',
    'TestCircuitBreakerAllowsOnlyOneHalfOpenProbe',
    'TestCircuitBreakerIgnoresStaleInFlightSuccessAfterOpening',
    'TestCircuitBreakerObserverReportsFixedSequence',
    'TestCircuitBreakerObserverPanicIsIsolatedAndRunsOutsideStateLock',
    'TestCircuitBreakerCountsLogicalRetryResultAndIgnoresCallerCancellation',
    'TestCircuitBreakerRejectsCompletedRequestsWithoutPollutingState',
    'TestCircuitBreakerTracingUsesFixedOpenClassification',
    'TestNewValidatesAndDefaultsCircuitBreakerConfiguration',
  ]) {
    assert.match(circuitBreakerTests, new RegExp(`func ${testName}`));
  }
  assertEvidenceInput('Framework/httpclient/circuit_breaker.go');
  assertEvidenceInput('Framework/httpclient/circuit_breaker_test.go');
  assert.match(retryTests, /TestRetryBreakerCompositionHonorsCallerDeadlineAndFailureOwnership/);
  assertEvidenceInput('docs/待优化/待优化V16.md');
  assertEvidenceInput('docs/待优化/待优化V17.md');
  assertEvidenceInput('docs/待优化/待优化V18.md');
  assertEvidenceInput('docs/待优化/待优化V19.md');
  assertEvidenceInput('docs/待优化/待优化V20.md');
  assertEvidenceInput('docs/待优化/待优化V21.md');
  assertEvidenceInput('docs/待优化/待优化V22.md');
  assertEvidenceInput('docs/待优化/待优化V23.md');
  assertEvidenceInput('docs/待优化/待优化V24.md');
  assertEvidenceInput('docs/待优化/待优化V25.md');
  assertEvidenceInput('docs/待优化/待优化V26.md');
  assertEvidenceInput('docs/待优化/待优化V27.md');
  assertEvidenceInput('docs/待优化/待优化V28.md');
  assertEvidenceInput('docs/待优化/待优化V29.md');
  assertEvidenceInput('docs/待优化/待优化V30.md');
  assertEvidenceInput('docs/待优化/待优化V31.md');
  assertEvidenceInput('docs/待优化/待优化V32.md');
  assertEvidenceInput('docs/待优化/待优化V33.md');
  assertEvidenceInput('docs/待优化/待优化V34.md');
  assertEvidenceInput('docs/待优化/待优化V35.md');
  assertEvidenceInput('docs/待优化/待优化V36.md');
  assertEvidenceInput('docs/待优化/待优化V37.md');
  assertEvidenceInput('scripts/lib/atomic-output.mjs');
  assertEvidenceInput('scripts/lib/sdk-generation.mjs');
  assertEvidenceInput('__test__/node/sdk-generation.test.mjs');
  assertEvidenceInput('scripts/lib/bounded-command.mjs');
  assertEvidenceInput('scripts/lib/go-toolchain-environment.mjs');
  assertEvidenceInput('scripts/lib/server-release-command.mjs');
  assert.match(standardApplication, /type HTTPApplication struct/);
  assert.match(standardApplication, /func NewHTTPApplication\(options Options\) \(\*HTTPApplication, error\)/);
  assert.match(standardApplication, /func \(application \*HTTPApplication\) ServeHTTP\(response http\.ResponseWriter, request \*http\.Request\)/);
  assert.match(standardApplication, /func \(application \*HTTPApplication\) Shutdown\(ctx context\.Context\) error/);
  assert.doesNotMatch(standardApplication, /fiber\./);
  assert.match(standardApplicationTests, /func TestHTTPApplicationImplementsStandardServingAndShutdown/);
  assert.match(standardApplicationTests, /func TestHTTPApplicationRejectsUnavailableLifecycle/);
  assert.match(exampleEntrypoint, /httpapi\.NewHTTPApplication\(apiOptions\)/);
  assert.match(exampleEntrypoint, /Handler:\s+application/);
  assert.match(exampleEntrypoint, /ApplicationShutdown:\s+application\.Shutdown/);
  assert.match(billingEntrypoint, /httpapi\.NewHTTPApplication\(options\)/);
  assert.match(billingEntrypoint, /Handler:\s+application/);
  assert.match(billingEntrypoint, /ApplicationShutdown:\s+application\.Shutdown/);
  assert.match(publicAPIBoundaryADR, /状态：已接受/);
  assert.match(publicAPIBoundaryADR, /HTTPApplication/);
  assert.match(publicAPIBoundaryADR, /保持兼容/);
  assertEvidenceInput('Framework/httpapi/standard_application.go');
  assertEvidenceInput('Framework/httpapi/standard_application_test.go');
  assert.match(applicationEventStream, /type ApplicationEventStream struct/);
  assert.match(applicationEventStream, /func NewEventStream\(/);
  assert.match(applicationEventStream, /func NewAuthenticatedEventStream\(/);
  assert.match(applicationEventStream, /func NewAuthorizedEventStream\(/);
  assert.match(applicationEventStream, /SendServerSentEventsFromSource/);
  assert.doesNotMatch(applicationEventStream, /func New(?:Authenticated|Authorized)?EventStream\([^)]*fiber\.Ctx/);
  assert.match(applicationEventStreamTests, /TestApplicationEventStreamUsesStandardApplicationContextAndResumeID/);
  assert.match(applicationEventStreamTests, /TestApplicationEventStreamsEnforceAuthenticationAndCopiedRoles/);
  assert.match(applicationEventStreamTests, /TestApplicationEventStreamsRejectAmbiguousDefinitionsAtStartup/);
  assertEvidenceInput('Framework/httpapi/application_event_stream.go');
  assertEvidenceInput('Framework/httpapi/application_event_stream_test.go');
  assert.match(applicationRoute, /type ApplicationRoute struct/);
  assert.match(applicationRoute, /type ApplicationRouteRequest struct/);
  assert.match(applicationRoute, /type ApplicationRouteResponse struct/);
  assert.match(applicationRoute, /validateApplicationRouteResponse/);
  assert.match(applicationRouteTests, /TestApplicationRouteUsesTransportNeutralRequestAndResponse/);
  assert.match(applicationRouteTests, /TestApplicationRouteResponseValidationUsesErrorBoundary/);
  assert.match(applicationRouteTests, /TestApplicationRoutesRejectAmbiguousDefinitionsAtStartup/);
  assertEvidenceInput('Framework/httpapi/application_route.go');
  assertEvidenceInput('Framework/httpapi/application_route_test.go');
  assertEvidenceInput('docs/adr/0003-http-public-api-boundary.md');
  assertEvidenceInput('Framework/sqlclient/client.go');
  assertEvidenceInput('Framework/sqlclient/client_test.go');
  assertEvidenceInput('docs/待优化/待优化V81.md');
  assertEvidenceInput('docs/待优化/待优化V82.md');
  assertEvidenceInput('docs/待优化/待优化V83.md');
  assertEvidenceInput('docs/待优化/待优化V84.md');
  assertEvidenceInput('docs/待优化/待优化V50.md');
  assertEvidenceInput('docs/待优化/待优化V51.md');
  assertEvidenceInput('docs/待优化/待优化V52.md');
  assertEvidenceInput('docs/待优化/待优化V53.md');
  assertEvidenceInput('docs/待优化/待优化V54.md');
  assertEvidenceInput('docs/待优化/待优化V55.md');
  assertEvidenceInput('docs/待优化/待优化V56.md');
  assert.match(sqlClient, /ctx\.Err\(\)/);
  assert.match(sqlClient, /databaseTx\.Rollback\(\)/);
  assert.match(sqlClient, /callback could perform external side effects/);
  assert.match(sqlClient, /commit work after that cancellation/);
  assert.match(sqlClientTests, /func TestTransactionDoesNotEnterCallbackAfterBeginCancellation/);
  assert.match(sqlClientTests, /func TestTransactionRollsBackWhenCanceledBeforeCommit/);
  assert.match(sqlClient, /func completedContextError\(ctx context\.Context\) error/);
  assert.match(sqlClient, /!time\.Now\(\)\.Before\(deadline\)/);
  assert.match(sqlClientTests, /func TestSQLClientRejectsLateNilDriverResults/);
  assert.match(sqlClientTests, /func TestTransactionOutboxRejectsLateNilDriverResultAndRollsBack/);
  assert.match(sqlClient, /var ErrOutboxEnqueue/);
  assert.match(sqlClient, /func \(transaction \*Tx\) EnqueueOutbox/);
  assert.doesNotMatch(sqlClient, /func \(client \*Client\) EnqueueOutbox/);
  assert.match(sqlClientTests, /func TestTransactionEnqueueOutboxRejectsUncertainRowsAndRollsBack/);
  for (const id of ['V15-06', 'V15-07', 'V15-08', 'V15-09', 'V15-10', 'V15-11', 'V15-12', 'V15-13', 'V15-14']) {
    assert.match(currentBacklog, new RegExp(id));
  }
});

test('V55 JetStream DLQ settlement requires a confirmed publish before source acknowledgement', async () => {
  const [adapter, adapterTests, integrationTests, deliveryEvidence, deliveryEvidenceTests, readme, changelog] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-delivery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nats-delivery-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
  ]);

  assert.match(adapter, /func validPublishAcknowledgement\(acknowledgement \*jetstream\.PubAck\) bool/);
  assert.equal(
    (adapter.match(/!validPublishAcknowledgement\(acknowledgement\)/g) ?? []).length,
    3,
    'ordinary/deduplicated publish and both DLQ call sites must share one PubAck invariant',
  );
  assert.match(adapterTests, /func TestAdapterDeadLetterRejectsInvalidPublishAcknowledgementBeforeSourceAck/);
  assert.match(adapterTests, /func TestAdapterInvalidMessageQuarantineRejectsInvalidPublishAcknowledgementBeforeSourceAck/);
  assert.match(adapterTests, /duplicate acknowledgement/);
	assert.match(integrationTests, /SchemaVersion:\s+14/);
  assert.match(integrationTests, /DLQPublishConfirmed:\s+true/);
  assert.match(deliveryEvidence, /dlqPublishConfirmed: true/);
  assert.match(deliveryEvidenceTests, /dlqAcknowledgementTamper\.dlqPublishConfirmed = false/);
  assert.match(readme, /DLQ ack 畸形时返回固定 `ErrDeadLetter` 且不确认源消息/);
  assert.match(changelog, /Nil, empty-stream, and zero-sequence acknowledgements fail closed as `ErrDeadLetter`/);
  assertEvidenceInput('docs/待优化/待优化V55.md');
});

test('Example project queries and commands keep Fiber behind the Framework adapter', async () => {
  const [applicationAuthorization, applicationQuery, applicationCommand, applicationPrecondition, idempotencyFingerprint, middleware, eventStream, eventStreamTests, standardHandler, standardHandlerTests, standardApplication, standardApplicationTests, standardServer, standardServerTests, authMiddleware, routes, app, appTests, projectRoutes, projectService, entrypoint, billingEntrypoint, architectureTests, projectRouteTests, publicAPIBoundaryADR] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_authorization.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_query.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_command.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_precondition.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'event_stream.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'event_stream_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_handler.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_handler_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_application.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_application_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Services', 'Billing', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'architecture_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'adr', '0003-http-public-api-boundary.md'), 'utf8'),
  ]);

  assert.match(applicationQuery, /type ApplicationQuery struct/);
  assert.match(applicationQuery, /Handler\s+func\(context\.Context\) \(any, error\)/);
  assert.match(applicationQuery, /func NewQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthenticatedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthorizedQuery\[Request, Response any\]/);
	assert.match(applicationQuery, /func NewResourceAuthorizedQuery\[Request, Response any\]/);
	assert.match(applicationQuery, /func NewResourceAuthorizedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /authorizationRequired/);
  assert.match(applicationAuthorization, /type ApplicationPrincipal struct/);
  assert.match(applicationAuthorization, /validateApplicationRoleRequirements/);
  assert.match(applicationAuthorization, /func authorizeApplicationRoles/);
  assert.match(applicationQuery, /binder\.URIBinding/);
  assert.match(applicationQuery, /binder\.QueryBinding/);
  assert.match(applicationQuery, /binder\.HeaderBinding/);
  assert.match(applicationQuery, /applicationQueryRoutesOverlap/);
  assert.match(applicationQuery, /func registerApplicationQueries/);
  assert.match(applicationQuery, /func \(query ApplicationQuery\) WithMethod\(method string\)/);
  assert.match(applicationQuery, /case fiber\.MethodGet, fiber\.MethodHead/);
  assert.match(applicationQuery, /router\.Add\(\[\]string\{query\.method\}/);
  assert.match(applicationCommand, /type ApplicationCommand struct/);
  assert.match(applicationCommand, /func NewJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthenticatedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthorizedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthenticatedVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthorizedVersionedJSONCommand\[Request, Response any\]/);
	assert.match(applicationCommand, /func NewResourceAuthorizedJSONCommand\[Request, Response any\]/);
	assert.match(applicationCommand, /func NewResourceAuthorizedVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /requireApplicationPrecondition/);
  assert.match(applicationCommand, /fingerprintHeaders = \[\]string\{fiber\.HeaderIfMatch\}/);
  assert.match(applicationCommand, /func \(command ApplicationCommand\) WithMethod\(method string\)/);
  assert.match(applicationCommand, /router\.Add\(\[\]string\{command\.method\}/);
  assert.match(standardHandler, /func NewHTTPHandler\(app \*fiber\.App\) \(http\.Handler, error\)/);
  assert.match(standardApplication, /type HTTPApplication struct/);
  assert.match(standardApplication, /func NewHTTPApplication\(options Options\) \(\*HTTPApplication, error\)/);
  assert.match(standardApplication, /shutdown: app\.ShutdownWithContext/);
  assert.doesNotMatch(standardApplication, /fiber\./);
  assert.match(standardApplicationTests, /TestHTTPApplicationImplementsStandardServingAndShutdown/);
  assert.match(standardHandler, /\*bridgedRequest = \*request/);
  assert.match(standardHandler, /bridgedRequest\.Header = request\.Header\.Clone\(\)/);
  assert.doesNotMatch(standardHandler, /request\.Clone\(request\.Context\(\)\)/);
  assert.match(standardHandler, /standardRequestContexts\.LoadAndDelete/);
  assert.match(standardHandler, /Header\.Del\(standardRequestContextHeader\)/);
  assert.match(standardHandler, /type standardRequestBridge struct/);
  assert.match(standardHandler, /http\.NewResponseController\(response\)/);
  assert.match(standardHandler, /controller\.SetWriteDeadline\(deadline\)/);
  assert.match(middleware, /previous\.Value\(standardResponseWriteDeadlineContextKey\{\}\)/);
  assert.match(standardHandler, /context\.WithValue\(\s*bridge\.context,\s*standardResponseWriteDeadlineContextKey\{\}/);
  assert.match(standardHandler, /const maximumStandardResponseWriterUnwrapDepth = 32/);
  assert.match(standardHandler, /func supportsStandardResponseFlush\(response http\.ResponseWriter\) bool/);
  assert.match(standardHandler, /interface\{ FlushError\(\) error \}/);
  assert.match(standardHandler, /http\.NewResponseController\(response\.ResponseWriter\)\.Flush\(\)/);
  assert.match(standardHandler, /func \(response standardResponseFlusher\) Unwrap\(\) http\.ResponseWriter/);
  assert.match(app, /app\.Use\(standardRequestContextBridge\(\)\)/);
  assert.match(standardHandler, /app\.ShutdownWithContext/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerComposesWithStandardMiddleware/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerDoesNotMutateCallerRequest/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPropagatesRequestCancellation/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPropagatesStandardClientDisconnect/);
  assert.match(standardHandlerTests, /TestStandardStreamingResponseWriterPreservesUnsupportedWriters/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerStreamsThroughUnwrappingStandardMiddleware/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerStreamsIncrementallyOverHTTP2/);
  assert.match(standardHandlerTests, /X-GoExample-Protocol/);
  assert.match(standardHandlerTests, /response\.ProtoMajor/);
  assert.match(standardHandlerTests, /first streaming response =/);
  assert.match(standardHandlerTests, /first streaming chunk was buffered behind the second chunk/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPreservesCallerDeadlineAndContextValue/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerRemovesInternalContextHeader/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerShutdownCancelsApplicationWork/);
  assert.match(middleware, /newRequestStreamLifetime/);
  assert.match(middleware, /c\.SetContext\(lifetime\)/);
  assert.doesNotMatch(middleware, /requestStreamLifetimeLocalKey|c\.Locals\(requestStreamLifetime/);
  assert.match(eventStream, /ctx\.Value\(requestStreamLifetimeContextKey\{\}\)/);
  assert.match(middleware, /lifetime\.claimed \|\| !c\.Response\(\)\.IsBodyStream\(\)/);
  assert.match(eventStream, /func SendServerSentEvents\(c fiber\.Ctx, options ServerSentEventOptions\) error/);
  assert.match(eventStream, /func SendServerSentEventsFromSource\(/);
  assert.match(eventStream, /Events\s+<-chan ServerSentEvent/);
  assert.match(eventStream, /maximumServerSentEventLastEventIDBytes\s+= 1024/);
  assert.match(eventStream, /maximumServerSentEventStreamTimeout\s+= 24 \* time\.Hour/);
  assert.match(eventStream, /serverSentEventWriteDeadlineCleanupGrace\s+= time\.Second/);
  assert.match(eventStream, /source\(lifetime\.ctx, lastEventID\)/);
  assert.match(eventStream, /HeartbeatInterval time\.Duration/);
  assert.match(eventStream, /MaxEventBytes\s+int/);
  assert.match(eventStream, /StreamTimeout\s+time\.Duration/);
  assert.match(eventStream, /lifetime\.claim\(prepared\.StreamTimeout\)/);
  assert.match(eventStream, /streamDeadline\.Add\(serverSentEventWriteDeadlineCleanupGrace\)/);
  assert.match(eventStream, /errors\.Is\(err, errors\.ErrUnsupported\)/);
  assert.match(eventStream, /serverSentEventDataEncodedLength/);
  assert.match(eventStream, /writeServerSentEventData/);
  assert.doesNotMatch(eventStream, /splitServerSentEventData|strings\.Builder/);
  assert.match(eventStream, /no-cache, no-transform/);
  assert.match(eventStream, /case <-ctx\.Done\(\)/);
  assert.match(eventStream, /writer\.WriteString\(": heartbeat\\n\\n"\)/);
  assert.match(eventStream, /utf8\.ValidString/);
  assert.match(eventStreamTests, /TestWriteServerSentEventEncodesBoundedWireFormat/);
  assert.match(eventStreamTests, /TestWriteServerSentEventDoesNotAllocatePerDataLine/);
  assert.match(eventStreamTests, /TestSendServerSentEventsRejectsInvalidOptionsBeforeStreaming/);
  assert.match(eventStreamTests, /TestSendServerSentEventsFromSourceFailsClosedBeforeStreaming/);
  assert.match(eventStreamTests, /TestRequestStreamLifetimeUsesTheShorterCallerWriteDeadline/);
  assert.match(eventStreamTests, /TestRequestStreamLifetimePreservesTheRequestContextContract/);
	assert.match(eventStream, /type requestCancellationRegistry struct/);
	assert.match(eventStream, /func \(registry \*requestCancellationRegistry\) cancelAll\(\)/);
	assert.doesNotMatch(eventStream, /context\.AfterFunc\(lifetime\.applicationContext/);
	assert.match(eventStreamTests, /TestRequestCancellationRegistryCancelsActiveClaimedAndLateRequests/);
	assert.match(eventStreamTests, /TestRequestCancellationRegistryHandlesConcurrentStreamClaimAndShutdown/);
  assert.match(eventStreamTests, /TestRequestStreamLifetimeHandlesWriteDeadlineCapabilityErrors/);
  assert.match(eventStreamTests, /TestRequestStreamLifetimeZeroTimeoutPreservesTheServerWriteDeadline/);
  assert.match(eventStreamTests, /TestValidateServerSentEventLastEventID/);
  assert.match(eventStreamTests, /TestNewHTTPHandlerServerSentEventsResumesFromLastEventID/);
  assert.match(eventStreamTests, /TestNewHTTPHandlerServerSentEventsCanOutliveTheRequestBudgetWithABoundedStreamTimeout/);
  assert.match(eventStreamTests, /TestNewHTTPHandlerServerSentEventsStopsAtTheConfiguredStreamTimeout/);
  assert.match(eventStreamTests, /TestNewHTTPHandlerServerSentEventsFlushAndCleanUpOnDisconnect/);
  assert.match(eventStreamTests, /protocolMajor: 2/);
  assert.match(eventStreamTests, /event stream producer remained active after client disconnect/);
  assert.match(eventStreamTests, /TestRunHTTPStopsServerSentEventsDuringApplicationShutdown/);
  assert.match(eventStreamTests, /TestRunHTTPServerSentEventsUseTheBoundedStreamWriteDeadline/);
  assert.match(standardServer, /func RunHTTP\(ctx context\.Context, options HTTPOptions\) error/);
  assert.match(standardServer, /TLSConfig\s+\*tls\.Config/);
  assert.match(standardServer, /config\.Clone\(\)/);
  assert.match(standardServer, /prepared\.GetConfigForClient/);
  assert.match(standardServer, /tls\.VersionTLS12/);
  assert.match(standardServer, /httpServer\.ServeTLS\(listener, "", ""\)/);
  assert.match(standardServer, /tlsConnection\.NetConn\(\)/);
  assert.match(standardServer, /ReadHeaderTimeout:/);
  assert.match(standardServer, /netutil\.LimitListener\(listener, options\.MaxConnections\)/);
  assert.match(standardServer, /ApplicationShutdown/);
  assert.match(standardServer, /type HTTPConnectionObserver interface/);
  assert.match(standardServer, /notifyHTTPConnectionState/);
  assert.match(standardServer, /httpServer\.Shutdown\(ctx\)/);
  assert.match(standardServer, /httpServer\.Close\(\)/);
  assert.match(standardServerTests, /TestRunHTTPBoundsSlowRequestHeaders/);
  assert.match(standardServerTests, /TestRunHTTPBoundsAcceptedConnections/);
  assert.match(standardServerTests, /TestRunHTTPForcesBoundedShutdown/);
  assert.match(standardServerTests, /case <-started:[^]*clientErr <- err/);
  assert.match(standardServerTests, /TestRunHTTPServesTLS12AndHTTP2/);
  assert.match(standardServerTests, /TestRunHTTPClosesTLSHijackedConnectionsDuringShutdown/);
  assert.match(standardServerTests, /TestRunHTTPRejectsUnsafeTLSConfiguration/);
  assert.match(standardServerTests, /TestPrepareHTTPServerTLSConfigValidatesDynamicSelection/);
  assert.match(standardServerTests, /TestRunHTTPBoundsApplicationShutdownHook/);
  assert.match(standardServerTests, /TestRunHTTPIsolatesApplicationShutdownPanic/);
  assert.match(standardServerTests, /TestRunHTTPIsolatesConnectionObserverPanic/);
  assert.match(applicationCommand, /bindBody\(c, request\)/);
  assert.match(applicationCommand, /idempotencyMiddleware/);
  assert.ok(applicationCommand.indexOf('requireAuth(options)') < applicationCommand.indexOf('idempotencyMiddleware'));
	assert.ok(applicationCommand.indexOf('authorizeApplicationResource') < applicationCommand.indexOf('idempotencyMiddleware'));
  assert.match(applicationPrecondition, /type ApplicationPrecondition struct/);
  assert.match(applicationPrecondition, /fiber\.StatusPreconditionRequired/);
  assert.match(applicationPrecondition, /If-Match must contain one strong version tag/);
  assert.match(applicationPrecondition, /var ErrPreconditionFailed/);
  assert.match(applicationQuery, /func NewVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthenticatedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthorizedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /weakETagMatches\(c\.Get\(fiber\.HeaderIfNoneMatch\), entityTag\)/);
  assert.match(idempotencyFingerprint, /fingerprintHeaders \.\.\.string/);
  assert.match(middleware, /fiber\.HeaderETag/);
  assert.match(middleware, /fiber\.HeaderPragma/);
  assert.match(routes, /registerApplicationQueries/);
  assert.match(routes, /registerApplicationCommands/);
  assert.match(routes, /application route descriptors and RegisterRoutes cannot be configured together/);
  assert.match(app, /ApplicationQueries\s+\[\]ApplicationQuery/);
  assert.match(app, /ApplicationCommands\s+\[\]ApplicationCommand/);
  assert.match(appTests, /TestApplicationQueriesKeepHandlersTransportNeutral/);
  assert.match(appTests, /TestTypedApplicationQueryBindsIsolatedSourcesAndAuthenticatedPrincipal/);
  assert.match(appTests, /TestAuthorizedApplicationQueryEnforcesCopiedAnyOfRolesBeforeBinding/);
  assert.match(appTests, /TestTypedApplicationQueriesRejectUnsafeBindingsAndOverlappingRoutes/);
  assert.match(appTests, /TestApplicationQueryErrorsUseTheServerErrorBoundary/);
  assert.match(appTests, /TestVersionedApplicationQueryReturnsStrongETagAndHandlesConditionalGET/);
  assert.match(appTests, /TestApplicationQuerySupportsExplicitHEADWithoutGETRoute/);
  assert.match(appTests, /TestAuthorizedVersionedApplicationQueryChecksAccessBeforeBinding/);
  assert.match(appTests, /TestApplicationQueriesRejectAmbiguousDefinitions/);
  assert.match(appTests, /TestApplicationCommandsBindValidateTraceAndReplayWithoutFiber/);
  assert.match(appTests, /TestAuthenticatedApplicationCommandExposesMinimizedPrincipal/);
  assert.match(appTests, /TestAuthorizedApplicationCommandRejectsBeforeMediaTypeIdempotencyAndBinding/);
  assert.match(appTests, /TestApplicationCommandErrorsUseTheServerErrorBoundary/);
  assert.match(appTests, /TestApplicationCommandsRejectAmbiguousDefinitions/);
  assert.match(appTests, /TestApplicationCommandsSupportExplicitMutationMethods/);
  assert.match(appTests, /TestVersionedApplicationCommandEnforcesStrongPreconditionsAndIdempotency/);
  assert.match(appTests, /TestAuthorizedVersionedApplicationCommandChecksAccessBeforePrecondition/);
  assert.match(projectRoutes, /func Queries\(options httpapi\.Options\) \[\]httpapi\.ApplicationQuery/);
  assert.match(projectRoutes, /func Commands\(options httpapi\.Options\) \[\]httpapi\.ApplicationCommand/);
	assert.match(projectRoutes, /httpapi\.NewResourceAuthorizedJSONCommand/);
	assert.match(projectRoutes, /httpapi\.NewResourceAuthorizedQuery/);
  assert.match(projectService, /RequestedBy/);
  assert.match(projectService, /func \(s \*Service\) PreviewProject/);
  assert.match(authMiddleware, /setNoStoreHeaders\(c\)/);
  assert.match(entrypoint, /apiOptions\.ApplicationQueries = projectapi\.Queries\(apiOptions\)/);
  assert.match(entrypoint, /apiOptions\.ApplicationCommands = projectapi\.Commands\(apiOptions\)/);
  assert.match(entrypoint, /httpapi\.NewHTTPApplication\(apiOptions\)/);
  assert.match(entrypoint, /server\.RunHTTP\(ctx, server\.HTTPOptions/);
  assert.match(entrypoint, /Handler:\s+application/);
  assert.match(entrypoint, /ApplicationShutdown:\s+application\.Shutdown/);
  assert.match(entrypoint, /MaxConnections:\s+cfg\.MaxConnections/);
  assert.match(billingEntrypoint, /httpapi\.NewHTTPApplication\(options\)/);
  assert.match(billingEntrypoint, /Handler:\s+application/);
  assert.match(billingEntrypoint, /ApplicationShutdown:\s+application\.Shutdown/);
  assert.match(publicAPIBoundaryADR, /Fiber 原生兼容通道/);
  assert.match(publicAPIBoundaryADR, /标准生产通道/);
  assert.doesNotMatch(projectRoutes, /gofiber|fiber\./i);
  assert.doesNotMatch(entrypoint, /gofiber|fiber\./i);
  assert.match(architectureTests, /TestProductionProjectCompositionDoesNotImportFiber/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
  assert.match(projectRouteTests, /TestCommandsAddAuthorizedTypedProjectRoute/);
  assert.match(projectRouteTests, /TestProjectCommandCreatesChildApplicationSpan/);
  assert.match(projectRouteTests, /TestAuthenticatedPreviewBindsPathQueryHeaderAndCreatesChildSpan/);
  assert.match(projectRouteTests, /http\.StatusForbidden/);
});

test('resource authorization is bounded, fail-closed, and used by the Example project', async () => {
	const [contract, contractTests, adapter, adapterTests, projectPolicy, projectPolicyTests, projectRoutes, openapi] = await Promise.all([
		readFile(path.join(repositoryRoot, 'Framework', 'authorization', 'authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'authorization', 'authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_resource_authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
	]);
	assert.match(contract, /type Authorizer interface/);
	assert.match(contract, /type Resource struct/);
	assert.match(contract, /TenantID\s+string/);
	assert.match(contract, /Attributes map\[string\]string/);
	assert.match(contract, /func ValidateRequest\(request Request\) error/);
	assert.match(contractTests, /TestValidateRequestRejectsUnboundedOrMalformedInput/);
	assert.match(adapter, /context\.WithTimeout\(c\.Context\(\), options\.ResourceAuthorizationTimeout\)/);
	assert.match(adapter, /recover\(\) != nil/);
	assert.match(adapter, /"resource_denied"/);
	assert.match(adapterTests, /TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler/);
	assert.match(adapterTests, /TestResourceAuthorizedCommandDoesNotPolluteIdempotencyOnDeny/);
	assert.match(adapterTests, /TestResourceAuthorizedVersionedCommandChecksPolicyBeforePrecondition/);
	assert.match(adapterTests, /private-policy-backend\.example/);
	assert.match(projectPolicy, /resource\.TenantID != request\.Principal\.Subject/);
	assert.match(projectPolicyTests, /"cross tenant"/);
	assert.match(projectRoutes, /requestedTenant\(request\.TenantID, principal\.Subject\)/);
	assert.match(openapi, /"x-resource-authorization"/);
	assert.match(openapi, /"tenantSource": "header:X-Tenant-ID or principal:subject"/);
});

test('Framework public API compatibility is versioned and compared with the target branch', async () => {
  const [snapshotDocument, version, policy, changelog, apiTool, apiToolTests, goProjectRunner, workflow, packageDocument, evidenceManifest, appTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'api-snapshot.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'VERSION'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'COMPATIBILITY.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'internal', 'apisnapshot', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'internal', 'apisnapshot', 'main_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  const snapshot = JSON.parse(snapshotDocument);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.module, 'github.com/zbxing/goexample/Framework');
  assert.equal(snapshot.version, version.trim());
  assert.equal(Object.keys(snapshot.symbols).length, 373);
  assert.ok(Object.keys(snapshot.symbols).every((key) => !key.includes('/internal/')));
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/authorization::type Authorizer'], /Authorize\(context\.Context, Request\)/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/authorization::type Resource'], /TenantID[\s\S]*Attributes/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewResourceAuthorizedQuery'], /authorization\.Authorizer/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewResourceAuthorizedJSONCommand'], /ApplicationPrincipal/);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::var ErrResponseBodyTooLarge'],
		'var ErrResponseBodyTooLarge = errors.New("outbound HTTP response body exceeds the configured limit")',
	);
  assert.equal(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerPaused'],
    'var ErrConsumerPaused = errors.New("nats jetstream consumer is paused")',
  );
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerNotPull'],
		'var ErrConsumerNotPull = errors.New("nats jetstream consumer is not pull based")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerPriorityPolicy'],
		'var ErrConsumerPriorityPolicy = errors.New("nats jetstream consumer priority policy is incompatible")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerAckPolicy'],
		'var ErrConsumerAckPolicy = errors.New("nats jetstream consumer acknowledgement policy is incompatible")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::func LimitResponseBody'],
		'func LimitResponseBody(response *http.Response, maxBytes int64) error',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerSubjectMismatch'],
		'var ErrConsumerSubjectMismatch = errors.New("nats jetstream consumer subject does not match adapter")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerDeliveryPolicy'],
		'var ErrConsumerDeliveryPolicy = errors.New("nats jetstream consumer delivery policy is not reliable")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerReplayPolicy'],
		'var ErrConsumerReplayPolicy = errors.New("nats jetstream consumer replay policy is not reliable")',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerRequestExpires'],
		'var ErrConsumerRequestExpires = errors.New("nats jetstream consumer request expiration is incompatible")',
	);
	assert.match(
		snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::method *Adapter.PreflightConsumer'],
		/func \(adapter \*Adapter\) PreflightConsumer\(/,
	);
	assert.match(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::type RetryConfig'],
		/MaxAttempts[\s\S]*InitialBackoff[\s\S]*MaxBackoff/,
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::var ErrCircuitOpen'],
		'var ErrCircuitOpen = errors.New("outbound HTTP circuit breaker is open")',
	);
	assert.match(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::type CircuitBreakerConfig'],
		/FailureThreshold[\s\S]*OpenTimeout[\s\S]*Observer\s+CircuitBreakerObserver/,
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::type CircuitBreakerObservation'],
		'type CircuitBreakerObservation struct {\n\tState string\n\tEvent string\n}',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::type CircuitBreakerObserver'],
		'type CircuitBreakerObserver func(CircuitBreakerObservation)',
	);
	assert.match(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpclient::type Config'],
		/Retry\s+RetryConfig[\s\S]*CircuitBreaker\s+CircuitBreakerConfig/,
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type HTTPApplication'],
		'type HTTPApplication struct {\n}',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewHTTPApplication'],
		'func NewHTTPApplication(options Options) (*HTTPApplication, error)',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::method *HTTPApplication.ServeHTTP'],
		'func (application *HTTPApplication) ServeHTTP(response http.ResponseWriter, request *http.Request)',
	);
	assert.equal(
		snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::method *HTTPApplication.Shutdown'],
		'func (application *HTTPApplication) Shutdown(ctx context.Context) error',
	);
  assert.equal(
    snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func SendServerSentEvents'],
    'func SendServerSentEvents(c fiber.Ctx, options ServerSentEventOptions) error',
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func SendServerSentEventsFromSource'],
    /fiber\.Ctx[\s\S]*ServerSentEventSource[\s\S]*ServerSentEventOptions[\s\S]*error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type ServerSentEvent'],
    /ID\s+string[\s\S]*Event string[\s\S]*Data\s+string[\s\S]*Retry time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type ServerSentEventOptions'],
    /Events\s+<-chan ServerSentEvent[\s\S]*HeartbeatInterval time\.Duration[\s\S]*MaxEventBytes\s+int[\s\S]*StreamTimeout\s+time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type ServerSentEventSource'],
    /ctx context\.Context[\s\S]*lastEventID string[\s\S]*<-chan ServerSentEvent, error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::func NewAuthorizationRequestManager'],
    /AuthorizationRequestConfig/,
  );
  assert.equal(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::func ValidateAuthorizationNonce'],
    'func ValidateAuthorizationNonce(expected, actual string) error',
  );
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type BrowserSessionInventoryStore'], /DeleteBrowserSessionsForSubject/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::method \*BrowserSessionManager.ListForSubject'], /\[\]BrowserSessionInfo/);
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type DeliveryRetryConfig'],
    /SettlementTimeout\s+time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type DeliveryRetryConfig'],
    /LeaseExtensionInterval\s+time\.Duration[\s\S]*LeaseExtensionTimeout\s+time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type Delivery'],
    /ExtendLease func\(context\.Context\) error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::var ErrDeliverySettlement'],
    /queue delivery settlement failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::var ErrDeliveryLeaseExtension'],
    /queue delivery lease extension failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrLeaseExtension'],
    /nats jetstream lease extension failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrConsumerPayloadUnavailable'],
    /nats jetstream consumer payload is unavailable/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::type Config'],
    /DeadLetterSubject string/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::func New'],
    /\*Adapter, error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::method *Client.MinimumDeliveryLease'],
    /DeliveryRetryConfig, safetyMargin time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::func PreflightConsumer'],
    /ConsumerInspector[\s\S]*DeliveryRetryConfig[\s\S]*time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::method *JWKSVerifier.VerifyIDToken'],
    /IDTokenClaims/,
  );
  assert.doesNotMatch(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type Service'], /secret|password|username/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type TokenVerifier'], /VerifyToken\(context\.Context, string\)/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type JWKSConfig'], /RefreshInterval time\.Duration/);
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type JWKSVerifier'], 'type JWKSVerifier struct {\n}');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func AuthenticationEnabled'], 'func AuthenticationEnabled(options Options) bool');
	assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type OIDCBrowser'], 'type OIDCBrowser struct {\n}');
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewOIDCBrowser'], /\*auth\.AuthorizationRequestManager[\s\S]*\*auth\.OIDCClient[\s\S]*\*auth\.JWKSVerifier/);
	assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::method *OIDCBrowser.Enabled'], 'func (browser *OIDCBrowser) Enabled() bool');
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type Options'], /OIDCBrowser\s+\*OIDCBrowser/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func DefaultEndpointsForAuth'], /demoLoginEnabled bool/);
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewEncryptedAuditWriter'], 'func NewEncryptedAuditWriter(config EncryptedAuditWriterConfig) (*EncryptedAuditWriter, error)');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func VerifyEncryptedHashChain'], 'func VerifyEncryptedHashChain(reader io.Reader, keyring AuditEncryptionKeyring) (int, error)');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/server::func RunHTTP'], 'func RunHTTP(ctx context.Context, options HTTPOptions) error');
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/server::type HTTPConnectionObserver'], /ObserveHTTPConnectionState/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/server::type HTTPOptions'], /Handler\s+http\.Handler/);
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/server::type HTTPOptions'],
    /TLSConfig\s+\*tls\.Config/,
  );
  assert.match(policy, /Framework\/v0\.1\.0/);
  assert.match(policy, /yarn api:compat/);
  assert.match(policy, /Patch releases never permit source-incompatible API changes/);
  assert.match(policy, /natsjetstream\.PreflightConsumer/);
  assert.match(
    policy,
    /treat either a failed server-backed lease check or runtime extension failure as fail-closed/,
  );
  assert.match(changelog, /Public API snapshot and target-branch compatibility gate/);
  assert.match(apiTool, /parser\.SkipObjectResolution/);
  assert.match(apiTool, /func exactChanges/);
  assert.match(apiTool, /func compatibilityChanges/);
  assert.match(apiTool, /func allowsBreakingChange/);
  assert.match(apiTool, /fileDiffersFromGit/);
  assert.match(apiTool, /exec\.Command\("git", "show"/);
  assert.match(apiToolTests, /TestCollectSnapshotKeepsOnlyImportableExportedAPI/);
  assert.match(apiToolTests, /TestSnapshotComparisonAllowsAdditionsAndGuardsBreakingChanges/);
  assert.match(goProjectRunner, /'api-compat'/);
  assert.match(goProjectRunner, /'api-snapshot'/);
  assert.match(goProjectRunner, /GOCACHE:\s*goCacheRoot/);
  assert.match(workflow, /Check Framework public API compatibility/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /git cat-file -e/);
  assert.match(workflow, /validating the bootstrap snapshot only/);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['api:compat'], 'node scripts/go-project.mjs api-compat');
  assert.equal(packageScripts['api:snapshot'], 'node scripts/go-project.mjs api-snapshot');
  assertEvidenceInput('Framework/api-snapshot.json');
  assertEvidenceInput('Framework/auth/oidc_flow.go');
  assertEvidenceInput('Framework/auth/oidc_flow_test.go');
  assert.match(appTests, /default route collision/);
  assert.match(appTests, /enabled auth route collision/);
});

test('Go and MSFront auth responses and JWT claims remain hardened', async () => {
  const [login, logout, me, proxy, responseSecurity, authToken, authTokenTest, logoutTest, proxyTest, instrumentation, instrumentationTest, e2e, goAuth, goAuthTest, goResponse, goApp] = await Promise.all([
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'login', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'me', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'proxy.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'lib', 'server', 'response-security.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'lib', 'server', 'auth-token.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'auth-token.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'logout-route.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'proxy.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'instrumentation.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'instrumentation.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'e2e', 'msfront', 'auth-and-accessibility.spec.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'response.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
  ]);

  assert.match(logout, /isTrustedMutationOrigin/);
  for (const source of [login, logout, me, proxy]) {
    assert.match(source, /disableResponseCaching/);
  }
  assert.match(responseSecurity, /Cache-Control/);
  assert.match(responseSecurity, /no-store/);
  assert.match(responseSecurity, /no-transform/);
  assert.match(responseSecurity, /Pragma/);
  assert.match(responseSecurity, /no-cache/);
  assert.match(responseSecurity, /privateJson/);
  assert.match(authToken, /requiredClaims:\s*\['sub', 'iat', 'exp'\]/);
  assert.match(authToken, /maxTokenAge:\s*tokenTtl/);
  assert.match(authToken, /roleIds\.every/);
  assert.match(authTokenTest, /rejects a token older than the configured session lifetime/);
  assert.match(authToken, /validateAuthTokenConfiguration/);
  assert.match(instrumentation, /validateAuthTokenConfiguration/);
  assert.match(instrumentation, /validateTrustedMutationOrigins/);
  assert.match(instrumentationTest, /fails before serving when production auth configuration is unsafe/);
  assert.match(instrumentationTest, /fails before serving when a trusted origin is malformed/);
  assert.match(logoutTest, /rejects an untrusted mutation origin/);
  assert.match(proxy, /disableResponseCaching\(NextResponse\.redirect/);
  assert.match(proxyTest, /does not cache anonymous protected-page redirects/);
  assert.match(proxyTest, /does not cache authenticated login-page redirects/);
  assert.match(e2e, /anonymousMeResponse/);
  assert.match(e2e, /loginResponse\.headers\(\)\['cache-control'\]/);
  assert.match(e2e, /menusResponse\.headers\(\)\['cache-control'\]/);
  assert.match(e2e, /fnaPageTransition/);
  assert.match(e2e, /is-enter/);
  assert.match(goAuth, /jwt\.WithNotBeforeRequired\(\)/);
  assert.match(goAuth, /Audience:\s+jwt\.ClaimStrings\{s\.audience\}/);
  assert.match(goAuth, /jwt\.WithAudience\(s\.audience\)/);
  assert.match(goAuth, /validClaims/);
  assert.match(goAuth, /maxRoleCount/);
  assert.match(goAuth, /issuedAt\.Add\(ttl\+jwtClockLeeway\)/);
  assert.match(goAuthTest, /TestServiceRejectsMalformedAndOverageClaims/);
  assert.match(goAuthTest, /missing audience/);
  assert.match(goAuthTest, /wrong audience/);
  assert.match(goResponse, /setNoStoreHeaders/);
  assert.match(goResponse, /no-store, no-transform/);
  assert.match(goResponse, /HeaderPragma/);
  assert.match(goApp, /streamSafeETag/);

  const apiDirectory = path.join(repositoryRoot, 'MSFront', 'app', 'api');
  const apiRouteFiles = (await readdir(apiDirectory, { recursive: true }))
    .filter((fileName) => fileName.endsWith('route.ts'));
  for (const fileName of apiRouteFiles) {
    const route = await readFile(path.join(apiDirectory, fileName), 'utf8');
    assert.doesNotMatch(route, /NextResponse\.json/, `${fileName} bypasses privateJson`);
    assert.match(route, /privateJson|jsonOk/, `${fileName} must use a private JSON response helper`);
  }
});

test('server observability rules define executable SLO evidence', async () => {
  const [rules, runbook, metrics, metricsTests, tracingProvider, tracingTests, outboundClient, outboundTests, entrypoint, projectService, projectRouteTests, exampleEnvironment] = await Promise.all([
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_provider.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
  ]);

  assert.match(rules, /^groups:/m);
  assert.match(rules, /goexample:sli:availability_ratio5m/);
  assert.match(rules, /goexample:sli:admission_rejection_rate5m/);
  assert.match(rules, /goexample:sli:draining_rejection_rate5m/);
  assert.match(rules, /goexample:http_server_connection_utilization_ratio/);
  assert.match(rules, /GoExampleHTTPConnectionSaturation/);
  assert.match(rules, /goexample:sli:latency_p95_seconds5m/);
  assert.match(rules, /goexample:otel:trace_export_failure_rate5m/);
  assert.match(rules, /goexample:otel:trace_export_attempt_failure_rate5m/);
  assert.match(rules, /goexample:otel:trace_queue_drop_rate5m/);
  assert.match(rules, /goexample:otel:trace_processor_utilization_ratio/);
  assert.match(rules, /GoExampleTraceExportFailures/);
  assert.match(rules, /GoExampleTraceExportAttemptFailures/);
  assert.match(rules, /GoExampleTraceQueueDrops/);
  assert.match(rules, /GoExampleTraceProcessorSaturation/);
  assert.match(rules, /histogram_quantile\(0\.95/);
  assert.match(rules, /GoExampleAvailabilityBurnRateCritical/);
  assert.match(rules, /goexample:slo:availability_burn_rate1h > 14\.4/);
  assert.match(rules, /goexample:slo:availability_burn_rate5m > 14\.4/);
  assert.match(rules, /goexample:slo:availability_burn_rate6h > 6/);
  assert.match(rules, /goexample:slo:availability_burn_rate30m > 6/);
  assert.doesNotMatch(rules, /clamp_min/);
  assert.match(rules, /goexample_http_requests_total\{status!~"5\.\."\}/);
  assert.match(runbook, /99\.9%/);
  assert.match(runbook, /250ms/);
  assert.match(runbook, /goexample_http_admission_rejections_total/);
  assert.match(runbook, /goexample_http_server_connections/);
  assert.match(runbook, /source-built `promtool` 3\.5\.0 first validates the complete Prometheus configuration/);
  assert.match(runbook, /Standalone lint still validates all 48 rules/);
  assert.match(runbook, /ten behavior scenarios with fixed rule-group order cover all 13 alert rules/);
  assert.match(runbook, /Schema-v3 evidence retains[\s\S]*five outputs[\s\S]*five exit codes/);
  assert.match(runbook, /real OpenTelemetry Collector/);
  assert.match(tracingProvider, /go\.opentelemetry\.io\/otel/);
  assert.match(tracingProvider, /NewBatchSpanProcessor/);
  assert.match(tracingProvider, /WithMaxQueueSize/);
  assert.match(tracingProvider, /WithExportTimeout/);
  assert.match(tracingProvider, /traceMetricsExporter/);
  assert.match(tracingProvider, /boundedBatchSpanProcessor/);
  assert.match(tracingProvider, /traceAttemptTransport/);
  assert.match(tracingProvider, /WithRetry\(traceExporterRetryConfig/);
  assert.match(tracingTests, /TestOTLPHTTPBatchExporterDoesNotBlockRequestAndFlushesOnShutdown/);
  assert.match(tracingTests, /TestBatchSpanProcessorDropsBurstWithoutBlockingWhenExporterIsStalled/);
  assert.match(tracingTests, /TestOTLPHTTPExporterMetricsRecordCollectorFailureAndRecovery/);
  assert.match(tracingTests, /TestOTLPHTTPExporterRecordsEachAttemptAndRecoversWithinOneBatch/);
  assert.match(tracingTests, /\/tenant\/v1\/traces/);
  assert.match(metrics, /goexample_otel_trace_export_batches_total/);
  assert.match(metrics, /goexample_otel_trace_export_spans_total/);
  assert.match(metrics, /goexample_otel_trace_export_attempts_total/);
  assert.match(metrics, /goexample_otel_trace_queue_dropped_spans_total/);
  assert.match(metrics, /goexample_otel_trace_processor_pending_spans/);
  assert.match(metrics, /goexample_otel_trace_processor_capacity_spans/);
  assert.match(metrics, /goexample_otel_trace_processor_high_watermark_spans/);
  assert.match(metrics, /goexample_http_server_connection_capacity/);
  assert.match(metrics, /goexample_http_server_connection_events_total/);
  assert.match(metrics, /func \(m \*Metrics\) ObserveHTTPConnectionState/);
  assert.match(metricsTests, /TestMetricsRecordsBoundedHTTPConnectionLifecycle/);
  assert.match(metricsTests, /TestMetricsRenderTraceExporterOutcomesWithFixedLabels/);
  assert.match(entrypoint, /Metrics:\s+metrics/);
  assert.match(entrypoint, /ConnectionObserver:\s+metrics/);
  assert.match(outboundClient, /trace\.WithSpanKind\(trace\.SpanKindClient\)/);
  assert.match(outboundClient, /MaxResponseHeaderBytes/);
  assert.match(outboundClient, /propagation\.TraceContext/);
  assert.doesNotMatch(outboundClient, /url\.full|request\.URL\.String/);
  assert.match(outboundTests, /TestClientCreatesLowSensitivitySpanAndPropagatesW3CContext/);
  assert.match(outboundTests, /TestClientRecordsTimeoutWithoutLeakingTransportError/);
  assert.match(outboundTests, /TestClientRecordsCallerCancellation/);
  assert.match(outboundTests, /TestClientEnforcesResponseHeaderLimit/);
  assert.match(outboundTests, /TestClientNormalizesCustomMethodInSpan/);
  assert.match(outboundTests, /TestClientSpanEndsWhenResponseBodyCloses/);
  assert.match(projectService, /project\.get/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
  assert.match(exampleEnvironment, /OTEL_TRACES_EXPORTER=none/);
});

test('Framework SQL client keeps pool, transaction, timeout, recovery, and trace privacy contracts explicit', async () => {
  const [
    client,
    clientTests,
    postgresTests,
    goMod,
    goWorkflow,
    recoveryRunner,
    recoveryReport,
    recoveryEvidenceHelper,
    recoveryEvidenceCLI,
    recoveryEvidenceTests,
    packageDocument,
    readme,
    changelog,
    evidenceManifest,
    evidenceVerify,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'postgres_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-report.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'postgres-recovery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'postgres-recovery-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);

  assert.match(client, /type Config struct/);
  assert.match(client, /OperationTimeout\s+time\.Duration/);
  assert.match(client, /TransactionTimeout\s+time\.Duration/);
  assert.match(client, /TransactionMaxAttempts\s+int/);
  assert.match(client, /RetryInitialBackoff\s+time\.Duration/);
  assert.match(client, /RetryMaxBackoff\s+time\.Duration/);
  assert.match(client, /SetMaxOpenConns/);
  assert.match(client, /SetMaxIdleConns/);
  assert.match(client, /SetConnMaxLifetime/);
  assert.match(client, /SetConnMaxIdleTime/);
  assert.match(client, /func \(client \*Client\) Transaction/);
  assert.match(client, /func \(client \*Client\) RetryTransaction/);
  assert.match(client, /var ErrOptimisticConflict/);
  assert.match(client, /var ErrOutboxEnqueue/);
  assert.match(client, /func \(client \*Client\) ExecVersioned/);
  assert.match(client, /func \(transaction \*Tx\) ExecVersioned/);
  assert.match(client, /func \(transaction \*Tx\) EnqueueOutbox/);
  assert.doesNotMatch(client, /func \(client \*Client\) EnqueueOutbox/);
  assert.match(client, /ctx, span := startSpan\(ctx, tracer, "OUTBOX"\)/);
  assert.match(client, /affected == 0/);
  assert.match(client, /affected != 1/);
  assert.match(client, /case "40001", "40P01"/);
  assert.match(client, /jitteredBackoff/);
  assert.match(client, /waitForRetry/);
  assert.match(client, /databaseTx\.Rollback\(\)/);
  assert.match(client, /trace\.WithSpanKind\(trace\.SpanKindClient\)/);
  assert.match(client, /semconv\.DBSystemNamePostgreSQL/);
  assert.match(client, /goexample\.database\.result/);
  assert.doesNotMatch(client, /DBStatement|db\.query|server\.address|server\.port/);
  assert.match(clientTests, /TestNewValidatesAndAppliesFinitePoolConfiguration/);
  assert.match(clientTests, /TestPostgresOperationsAndTransactionCreateBoundedPrivateSpans/);
  assert.match(clientTests, /TestDatabaseFailuresTimeoutsAndNotFoundUseFixedTraceResults/);
  assert.match(clientTests, /TestQueryAlwaysClosesRowsAndPropagatesConsumerError/);
  assert.match(clientTests, /TestTransactionRollsBackOnErrorTimeoutAndPanic/);
  assert.match(clientTests, /TestRetryTransactionRetriesOnlySerializationAndDeadlockFailures/);
  assert.match(clientTests, /TestRetryTransactionRetriesCommitSerializationFailure/);
  assert.match(clientTests, /TestRetryTransactionStopsForNonRetryableLimitAndUnsafeRollback/);
  assert.match(clientTests, /TestRetryTransactionBackoffSharesTransactionDeadline/);
  assert.match(clientTests, /TestVersionedExecRequiresExactlyOneAffectedRow/);
  assert.match(clientTests, /TestTransactionEnqueueOutboxCommitsExactlyOnePrivateRow/);
  assert.match(clientTests, /TestTransactionEnqueueOutboxRejectsUncertainRowsAndRollsBack/);
  assert.match(clientTests, /TestTransactionEnqueueOutboxExecutionFailureAndTimeoutRollBack/);
  assert.match(clientTests, /TestRetryTransactionReplaysTransactionalOutboxAfterCommitConflict/);
  assert.match(clientTests, /TestTransactionEnqueueOutboxRollsBackAfterCallbackPanic/);
  assert.match(clientTests, /len\(span\.Attributes\(\)\) != 3/);
  assert.match(postgresTests, /TestRealPostgresRetryTransactionSerializationConflict/);
  assert.match(postgresTests, /TestRealPostgresRetryTransactionDeadlock/);
  assert.match(postgresTests, /TestRealPostgresVersionedUpdateAllowsOneConcurrentWriter/);
  assert.match(postgresTests, /TestRealPostgresVersionedHTTPPrecondition/);
  assert.match(postgresTests, /TestRealPostgresLockWaitHonorsDeadlineAndRecovers/);
  assert.match(postgresTests, /POSTGRES_TEST_URL/);
  assert.match(postgresTests, /sql\.LevelSerializable/);
  assert.match(postgresTests, /totalAttempts != 3 \|\| retriedWorkers != 1/);
  assert.match(postgresTests, /deadlock counter values/);
  assert.match(postgresTests, /successes != 1 \|\| conflicts != 1/);
  assert.match(postgresTests, /version != 1/);
  assert.match(postgresTests, /httpapi\.ErrPreconditionFailed/);
  assert.match(postgresTests, /http\.StatusPreconditionFailed/);
  assert.match(postgresTests, /FOR UPDATE/);
  assert.match(postgresTests, /context\.DeadlineExceeded/);
  assert.match(postgresTests, /transaction\.EnqueueOutbox/);
  assert.match(postgresTests, /ON CONFLICT DO NOTHING/);
  assert.match(postgresTests, /eventCount != 1 \|\| eventPayload != 2/);
  assert.match(postgresTests, /value != 2 \|\| eventCount != 1/);
  assert.match(postgresTests, /github\.com\/jackc\/pgx\/v5\/stdlib/);
  assert.match(goMod, /github\.com\/jackc\/pgx\/v5 v5\.7\.6/);
  assert.match(goWorkflow, /postgres-contract:/);
  assert.match(goWorkflow, /run: yarn postgres:recovery:contract/);
  assert.match(goWorkflow, /name: Verify PostgreSQL recovery contract evidence\s+if: always\(\)\s+run: yarn postgres:recovery:contract:verify/);
  assert.match(goWorkflow, /postgres-recovery-contract\/manifest\.json/);
  assert.match(goWorkflow, /postgres-recovery-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.equal(
    JSON.parse(packageDocument).scripts['postgres:recovery:contract'],
    'node scripts/postgres-recovery-contract.mjs',
  );
  assert.equal(
    JSON.parse(packageDocument).scripts['postgres:recovery:contract:verify'],
    'node scripts/postgres-recovery-evidence.mjs',
  );
  assert.match(JSON.parse(packageDocument).scripts['test:node'], /postgres-recovery-evidence\.test\.mjs/);
  assert.match(recoveryRunner, /postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5/);
  assert.match(recoveryRunner, /-run', '\^TestRealPostgres'/);
  assert.match(recoveryRunner, /pg_dump/);
  assert.match(recoveryRunner, /--format=custom/);
  assert.match(recoveryRunner, /pg_restore/);
  assert.match(recoveryRunner, /--single-transaction/);
  assert.match(recoveryRunner, /sourceAfterBackup/);
  assert.match(recoveryRunner, /SHA256SUMS/);
  assert.match(recoveryRunner, /buildPostgresRecoveryEvidenceReport/);
  assert.match(recoveryRunner, /buildPostgresRecoveryChecksums/);
  assert.match(recoveryReport, /restored data must exactly match the backup checkpoint/);
  assert.match(recoveryReport, /backup archive size or SHA-256/);
  assert.match(recoveryReport, /PITR, replication, failover/);
  assert.match(recoveryEvidenceHelper, /postgresRecoveryEvidenceSchemaVersion = 1/);
  assert.match(recoveryEvidenceHelper, /passed evidence must contain all/);
  assert.match(recoveryEvidenceHelper, /postgresRecovery remains not_recorded/);
  assert.match(recoveryEvidenceHelper, /exact ordered PostgreSQL recovery evidence artifact set/);
  assert.match(recoveryEvidenceCLI, /verifyPostgresRecoveryEvidence/);
  assert.match(recoveryEvidenceTests, /accepts only ordered successful Go-test subsets and bounded errors/);
  assert.match(recoveryEvidenceTests, /rejects scope, status, raw\/report semantics, and checksum tampering/);
  assert.match(readme, /## 关系数据库/);
  assert.match(readme, /不等于远端 job 已成功/);
  assert.match(readme, /callback 可能执行多次/);
  assert.match(readme, /不能依赖该方法提供 exactly-once/);
  assert.match(readme, /ErrOptimisticConflict/);
  assert.match(readme, /Tx\.EnqueueOutbox/);
  assert.match(readme, /不提供 broker 原子 settlement 或 exactly-once/);
  assert.match(readme, /httpapi\.ErrPreconditionFailed/);
  assert.match(readme, /`If-Match`\/412\/`ETag`/);
  assert.match(changelog, /Bounded `database\/sql` PostgreSQL pool adapter/);
  assert.match(changelog, /Transaction-only `sqlclient\.Tx\.EnqueueOutbox`/);
  assert.match(changelog, /Typed versioned JSON command adapters/);
  assertEvidenceInput('Framework/sqlclient/client.go');
  assertEvidenceInput('Framework/sqlclient/client_test.go');
  assertEvidenceInput('Framework/sqlclient/postgres_integration_test.go');
  assertEvidenceInput('Framework/httpapi/application_precondition.go');
  assertEvidenceInput('Framework/httpapi/idempotency_fingerprint.go');
  assert.match(evidenceManifest, /requiredPostgresRecoveryArtifacts/);
  assert.match(evidenceManifest, /postgresRecoveryStatus/);
  assert.match(evidenceManifest, /verifyPostgresRecoveryEvidence/);
  assert.match(evidenceVerify, /PostgreSQL recovery evidence artifact is missing from the manifest/);
  assert.match(evidenceManifest, /\.github\/workflows\/go-quality\.yml/);
});

test('Framework queue client keeps bounded W3C messaging spans broker-neutral and private', async () => {
  const [client, clientTests, worker, workerTests, natsTests, jetStreamAdapter, jetStreamAdapterTests, jetStreamIntegrationTests, jetStreamRestartTests, jetStreamSnapshotTests, jetStreamClusterTests, goMod, goWorkflow, readme, changelog, packageDocument, natsEvidenceRunner, natsEvidenceHelper, natsEvidenceTests, natsDeliveryEvidenceRunner, natsDeliveryEvidenceHelper, natsDeliveryEvidenceTests, natsRestartEvidenceRunner, natsRestartEvidenceHelper, natsRestartEvidenceTests, natsClusterEvidenceRunner, natsClusterEvidenceHelper, natsClusterEvidenceTests, evidenceManifest, evidenceVerify, rules, sloRunbook] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'nats_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'restart_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'snapshot_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'cluster_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nats-snapshot-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-snapshot-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nats-snapshot-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nats-delivery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-delivery-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nats-delivery-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nats-restart-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-restart-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nats-restart-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nats-cluster-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nats-cluster-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nats-cluster-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'), 'utf8'),
  ]);

  assert.match(client, /type System string/);
  assert.match(client, /SystemKafka\s+System = "kafka"/);
  assert.match(client, /PublishTimeout\s+time\.Duration/);
  assert.match(client, /ProcessTimeout\s+time\.Duration/);
  assert.match(client, /MaxMessageBytes\s+int/);
  assert.match(client, /MaxHeaderBytes\s+int/);
  assert.match(client, /MaxHeaders\s+int/);
  assert.match(client, /ErrMessageTooLarge = errors\.New/);
  assert.match(client, /ErrHeadersTooLarge = errors\.New/);
  assert.match(client, /ErrInvalidHeader = errors\.New/);
  assert.match(client, /propagation\.TraceContext\{\}\.Inject/);
  assert.match(client, /propagation\.TraceContext\{\}\.Extract/);
  assert.match(client, /trace\.SpanKindProducer/);
  assert.match(client, /trace\.SpanKindConsumer/);
  assert.match(client, /messaging\.system\.name/);
  assert.match(client, /messaging\.operation\.type/);
  assert.match(client, /goexample\.messaging\.result/);
  assert.match(client, /func completedContextError/);
  assert.match(client, /completedContextError\(operationContext\)/);
  assert.doesNotMatch(client, /messaging\.destination|messaging\.message\.id|span\.RecordError/);
  assert.match(clientTests, /TestPublishClonesMessageAndInjectsCurrentTraceContext/);
  assert.match(clientTests, /TestProcessExtractsRemoteTraceContextAndClonesMessage/);
  assert.match(clientTests, /TestFailuresTimeoutsAndCancellationUseFixedPrivateResults/);
  assert.match(clientTests, /TestQueueCallbacksRespectCancellationBeforeAndAfterInvocation/);
  assert.match(clientTests, /TestMessageLimitsRejectBeforeBrokerOrHandlerExecution/);
  assert.match(clientTests, /TestPublishCountsInjectedTraceHeadersAgainstConfiguredLimits/);
  assert.match(clientTests, /TestCallbackPanicEndsSpanAndIsRethrown/);
  assert.match(clientTests, /baggage\.FromContext\(handlerContext\)\.Len\(\) != 0/);
  assert.match(worker, /type ReceiveFunc func\(context\.Context\) \(Message, error\)/);
  assert.match(worker, /type WorkerConfig struct/);
  assert.match(worker, /type WorkerObserver interface/);
  assert.match(worker, /Observer\s+WorkerObserver/);
  assert.match(worker, /type Delivery struct/);
  assert.match(worker, /ExtendLease\s+func\(context\.Context\) error/);
  assert.match(worker, /Acknowledge\s+func\(context\.Context\) error/);
  assert.match(worker, /DeadLetter\s+func\(context\.Context\) error/);
  assert.match(worker, /type ReceiveDeliveryFunc func/);
  assert.match(worker, /type DeliveryRetryConfig struct/);
  assert.match(worker, /MaxAttempts\s+int/);
  assert.match(worker, /SettlementTimeout\s+time\.Duration/);
  assert.match(worker, /LeaseExtensionInterval\s+time\.Duration/);
  assert.match(worker, /LeaseExtensionTimeout\s+time\.Duration/);
  assert.match(worker, /type DeliveryObserver interface/);
  assert.match(worker, /type DeliveryLeaseObserver interface/);
  assert.match(worker, /ReceiveDelivery\s+ReceiveDeliveryFunc/);
  assert.match(worker, /DeliveryObserver\s+DeliveryObserver/);
  assert.match(worker, /LeaseObserver\s+DeliveryLeaseObserver/);
  assert.match(worker, /maximumDeliveryMaxAttempts\s+=\s+10/);
  assert.match(worker, /ErrDeliveryNotRetryable/);
  assert.match(worker, /ErrDeliverySettlement/);
  assert.match(worker, /ErrDeliveryLeaseExtension/);
  assert.match(worker, /func \(group \*WorkerGroup\) extendDeliveryLease/);
  assert.match(worker, /func callDeliveryLeaseExtension/);
  assert.match(worker, /func deliveryCallbackResult/);
  assert.match(worker, /func deliveryBackoff/);
  assert.match(worker, /"math\/rand\/v2"/);
  assert.match(worker, /randomInt64N\s+func\(int64\) int64/);
  assert.match(worker, /maximumDeliveryBackoff\(config, attempt\)/);
  assert.match(worker, /group\.jitteredDeliveryBackoff\(attempt\)/);
  assert.match(worker, /func deliveryRetryJitter\(/);
  assert.match(worker, /func maximumDeliveryBackoff\(/);
  assert.match(worker, /return min\(delay\/2, maximum-delay\)/);
  assert.match(worker, /randomInt64N\(int64\(window\)\+1\)/);
  assert.match(worker, /func \(client \*Client\) MinimumDeliveryLease/);
  assert.match(worker, /addDeliveryBudget/);
  assert.match(worker, /maxWorkerCount\s*=\s*64/);
  assert.match(worker, /func NewWorkerGroup/);
  assert.match(worker, /func \(group \*WorkerGroup\) Start/);
  assert.match(worker, /func \(group \*WorkerGroup\) Shutdown/);
  assert.match(worker, /func \(group \*WorkerGroup\) Wait/);
  assert.match(worker, /ErrWorkerPanic/);
  assert.match(worker, /ReceiveDelivery mode adds bounded in-process retry/);
  assert.match(workerTests, /TestWorkerGroupCancellationStopsAndWaits/);
  assert.match(workerTests, /TestWorkerGroupKeepsHandlerConcurrencyBounded/);
  assert.match(workerTests, /TestWorkerGroupStopsOnReceiveOrHandlerFailure/);
  assert.match(workerTests, /TestWorkerGroupConvertsCallbackPanicsToPrivateError/);
  assert.match(workerTests, /TestWorkerGroupReportsFixedLifecycleEventsAndIsolatesObserverPanic/);
  assert.match(workerTests, /TestWorkerGroupWaitIncludesStoppedObservation/);
  assert.match(workerTests, /TestWorkerGroupRetriesAndAcknowledgesReliableDelivery/);
  assert.match(workerTests, /TestWorkerGroupDeadLettersExhaustedAndPermanentDeliveries/);
  assert.match(workerTests, /TestWorkerGroupBoundsAndRedactsDeliverySettlementFailure/);
  assert.match(workerTests, /TestWorkerGroupExtendsLeaseUntilSettlement/);
  assert.match(workerTests, /TestWorkerGroupBoundsAndRedactsLeaseExtensionFailure/);
  assert.match(workerTests, /TestWorkerGroupCancellationDuringRetryDoesNotSettleDelivery/);
  assert.match(workerTests, /TestWorkerGroupCancellationDuringSettlementIsANormalStop/);
  assert.match(workerTests, /TestWorkerGroupRejectsLateSettlementResults/);
  assert.match(workerTests, /TestDeliveryCallbackResultMakesChildDeadlineAuthoritative/);
  assert.match(workerTests, /TestWorkerGroupRetriesLateNilHandlerAndDeadLetters/);
  assert.match(workerTests, /TestWorkerGroupRejectsLateLeaseExtensionResult/);
  assert.match(workerTests, /TestWorkerGroupRejectsInvalidDeliveryAndIsolatesDeliveryObserverPanic/);
  assert.match(workerTests, /TestMinimumDeliveryLeaseUsesEffectiveRetryBudget/);
  assert.match(workerTests, /TestMinimumDeliveryLeaseRejectsInvalidAndOverflowingBudgets/);
  assert.match(workerTests, /TestDeliveryRetryJitterUsesInclusivePositiveWindow/);
  assert.match(workerTests, /TestDeliveryRetryJitterTruncatesWindowAtMaximumBackoff/);
  assert.match(workerTests, /TestDeliveryRetryJitterSkipsSamplingWithoutWindow/);
  assert.match(workerTests, /TestWorkerGroupUsesInjectedDeliveryRetryJitter/);
  assert.match(natsTests, /TestRealNATSPublishProcessTracePropagation/);
  assert.match(natsTests, /NATS_TEST_URL/);
  assert.match(natsTests, /connection\.SubscribeSync/);
  assert.match(natsTests, /connection\.PublishMsg/);
  assert.match(natsTests, /connection\.FlushWithContext/);
  assert.match(natsTests, /consumerSpan\.Parent\(\)\.SpanID\(\) != producerSpan\.SpanContext\(\)\.SpanID\(\)/);
  assert.match(natsTests, /assertSpanExcludes/);
  assert.match(jetStreamAdapter, /type Publisher interface/);
  assert.match(jetStreamAdapter, /type Consumer interface/);
  assert.match(jetStreamAdapter, /type Config struct/);
  assert.match(jetStreamAdapter, /type ConsumerInspector interface/);
  assert.match(jetStreamAdapter, /func PreflightConsumer/);
  assert.match(jetStreamAdapter, /info\.Config\.BackOff/);
  assert.match(jetStreamAdapter, /ErrAckWaitTooShort = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerNotPersistent = errors\.New/);
  assert.match(jetStreamAdapter, /ErrMaxDeliverTooLow = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerPayloadUnavailable = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerDeliveryPolicy = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerReplayPolicy = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerSubjectMismatch = errors\.New/);
  assert.match(jetStreamAdapter, /ErrConsumerPaused = errors\.New/);
  assert.match(jetStreamAdapter, /if info\.Paused/);
  assert.match(jetStreamAdapter, /info\.Config\.Durable == ""/);
  assert.match(jetStreamAdapter, /info\.Config\.MemoryStorage/);
  assert.match(jetStreamAdapter, /info\.Config\.InactiveThreshold != 0/);
  assert.match(jetStreamAdapter, /info\.Config\.MaxDeliver != -1/);
  assert.match(jetStreamAdapter, /info\.Config\.HeadersOnly/);
  assert.match(jetStreamAdapter, /info\.Config\.DeliverPolicy != jetstream\.DeliverAllPolicy/);
  assert.match(jetStreamAdapter, /info\.Config\.ReplayPolicy != jetstream\.ReplayInstantPolicy/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) PreflightConsumer/);
  assert.match(jetStreamAdapter, /func consumerFiltersExactSubject/);
  assert.match(jetStreamAdapter, /config\.FilterSubject == expectedSubject/);
  assert.match(jetStreamAdapter, /len\(config\.FilterSubjects\) == 1/);
  assert.match(jetStreamAdapter, /DeadLetterSubject\s+string/);
  assert.match(jetStreamAdapter, /FetchMaxWait\s+time\.Duration/);
  assert.match(jetStreamAdapter, /func New\(publisher Publisher, consumer Consumer/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) Publish/);
  assert.match(jetStreamAdapter, /ErrInvalidMessageID = errors\.New/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) PublishDeduplicated/);
  assert.match(jetStreamAdapter, /func validPublishMessageID/);
  assert.match(jetStreamAdapter, /acknowledgement == nil/);
  assert.match(jetStreamAdapter, /acknowledgement\.Stream == ""/);
  assert.match(jetStreamAdapter, /acknowledgement\.Sequence == 0/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) ReceiveDelivery/);
  assert.match(jetStreamAdapter, /context\.WithTimeout\(ctx, maximumWait\)/);
  assert.match(jetStreamAdapter, /consumer\.Next\(jetstream\.FetchContext\(fetchContext\)\)/);
  assert.doesNotMatch(jetStreamAdapter, /consumer\.Next\(jetstream\.FetchContext\([^)]*\),\s*jetstream\.FetchMaxWait/);
  assert.match(jetStreamAdapter, /if contextErr := ctx\.Err\(\); contextErr != nil/);
  assert.match(jetStreamAdapter, /errors\.Is\(fetchContext\.Err\(\), context\.DeadlineExceeded\)/);
  assert.match(jetStreamAdapterTests, /func TestAdapterReceiveUsesContextBoundedPull/);
  assert.match(jetStreamAdapterTests, /func TestAdapterReceiveContinuesAfterInternalPullDeadline/);
  assert.match(jetStreamAdapterTests, /func BenchmarkDeliveryPullOption/);
  assert.match(jetStreamAdapter, /brokerMessage\.DoubleAck\(settlementContext\)/);
  assert.match(jetStreamAdapter, /brokerMessage\.InProgress\(\)/);
  assert.match(jetStreamAdapter, /source\.DoubleAck\(ctx\)/);
  assert.match(jetStreamAdapter, /Header\.Set\(jetstream\.MsgIDHeader, deadLetterID\(metadata\)\)/);
  assert.match(jetStreamAdapter, /jetStreamControlHeader/);
  assert.match(jetStreamAdapter, /ErrDeadLetter = errors\.New/);
  assert.match(jetStreamAdapter, /ErrLeaseExtension = errors\.New/);
  assert.doesNotMatch(jetStreamAdapter, /fmt\.Errorf|slog\.|RecordError/);
  assert.match(jetStreamAdapterTests, /TestAdapterDeadLetterIsPublishBeforeAckAndDedupeStable/);
  assert.match(jetStreamAdapterTests, /TestAdapterPublishDeduplicatedUsesOnlyBoundedTypedMessageID/);
  assert.match(jetStreamAdapterTests, /TestAdapterPublishRequiresStructuredServerAcknowledgement/);
  assert.match(jetStreamAdapterTests, /TestAdapterErrorsAreFixedAndInvalidHeadersFailClosed/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerUsesServerAckWaitAndBackoff/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRejectsInvalidOrUnavailableConfiguration/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresPersistentRedeliveryConfiguration/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresFullMessagePayload/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresCompleteDeliveryPolicy/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresInstantReplayPolicy/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRejectsPausedState/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresPullMode/);
  assert.match(jetStreamAdapter, /ErrConsumerNotPull = errors\.New/);
  assert.match(jetStreamAdapter, /info\.Config\.DeliverSubject != ""/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresDefaultPriorityPolicy/);
  assert.match(jetStreamAdapter, /ErrConsumerPriorityPolicy = errors\.New/);
  assert.match(jetStreamAdapter, /info\.Config\.PriorityPolicy != jetstream\.PriorityPolicyNone/);
  assert.match(jetStreamAdapterTests, /jetstream\.PriorityPolicyPinned/);
  assert.match(jetStreamAdapterTests, /jetstream\.PriorityPolicyOverflow/);
  assert.match(jetStreamAdapterTests, /jetstream\.PriorityPolicyPrioritized/);
  assert.match(jetStreamAdapterTests, /jetstream\.PriorityPolicy\(255\)/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRequiresExplicitAckPolicy/);
  assert.match(jetStreamAdapter, /ErrConsumerAckPolicy = errors\.New/);
  assert.match(jetStreamAdapter, /info\.Config\.AckPolicy != jetstream\.AckExplicitPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.AckAllPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.AckNonePolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.AckFlowControlPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.AckPolicy\(255\)/);
  assert.match(jetStreamAdapterTests, /jetstream\.DeliverLastPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.DeliverNewPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.DeliverByStartSequencePolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.DeliverByStartTimePolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.DeliverLastPerSubjectPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.ReplayOriginalPolicy/);
  assert.match(jetStreamAdapterTests, /jetstream\.ReplayPolicy\(255\)/);
  assert.match(jetStreamAdapterTests, /TestAdapterPreflightConsumerRequiresExactSubjectFilter/);
  assert.match(jetStreamIntegrationTests, /TestRealNATSJetStreamDurableDelivery/);
  assert.match(jetStreamIntegrationTests, /PublishDeduplicated/);
  assert.match(jetStreamIntegrationTests, /contractDeduplicatedPublishRuns\s+=\s+2/);
  assert.match(jetStreamIntegrationTests, /deduplicationInfo\.State\.Msgs != contractDeduplicatedStored/);
  assert.match(jetStreamIntegrationTests, /jetstream\.FileStorage/);
  assert.match(jetStreamIntegrationTests, /metadata\.NumDelivered < 2/);
  assert.match(jetStreamIntegrationTests, /queueclient\.NewWorkerGroup/);
  assert.match(jetStreamIntegrationTests, /contractExtendedAckWait\s+=\s+800 \* time\.Millisecond/);
  assert.match(jetStreamIntegrationTests, /contractExtendedHandling\s+=\s+1500 \* time\.Millisecond/);
  assert.match(jetStreamIntegrationTests, /extensionObserver\.extended\.Load\(\) < 5/);
  assert.match(jetStreamIntegrationTests, /NATS_DELIVERY_EVIDENCE_DIR/);
  assert.match(jetStreamIntegrationTests, /delivery-report\.json/);
  assert.match(jetStreamIntegrationTests, /DynamicRequiredLeaseNanos/);
  assert.match(jetStreamIntegrationTests, /PreflightConsumer\(MaxDeliver=1\)/);
  assert.match(jetStreamIntegrationTests, /PreflightConsumer\(DeliverNew\)/);
  assert.match(jetStreamIntegrationTests, /CreateOrUpdateConsumer\(DeliverAll\)/);
  assert.match(jetStreamIntegrationTests, /PreflightConsumer\(ReplayOriginal\)/);
  assert.match(jetStreamIntegrationTests, /CreateOrUpdateConsumer\(ReplayInstant\)/);
  assert.match(jetStreamIntegrationTests, /PauseConsumer\(testContext, sourceStream, sourceConsumerName/);
  assert.match(jetStreamIntegrationTests, /ResumeConsumer\(testContext, sourceStream, sourceConsumerName\)/);
  assert.match(jetStreamIntegrationTests, /PausedConsumerRejected/);
  assert.match(jetStreamIntegrationTests, /ResumedConsumerPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerPaused/);
  assert.match(jetStreamIntegrationTests, /PushConsumerRejected/);
  assert.match(jetStreamIntegrationTests, /RebuiltPullConsumerPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerDeliverSubject/);
  assert.match(jetStreamIntegrationTests, /AckAllConsumerRejected/);
  assert.match(jetStreamIntegrationTests, /RebuiltExplicitAckPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerAckPolicy/);
  assert.match(jetStreamIntegrationTests, /waitContractConsumerWaiting/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationWaitingObserved:\s+true/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationPropagated:\s+receiveCancellationPropagated/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationError:\s+receiveCancellationError\.Error\(\)/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationLatencyNanos:\s+receiveCancellationLatency\.Nanoseconds\(\)/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationFetchWaitNanos:\s+contractCancellationFetchWait\.Nanoseconds\(\)/);
  assert.match(jetStreamIntegrationTests, /ReceiveCancellationLimitNanos:\s+contractCancellationReturnLimit\.Nanoseconds\(\)/);
  assert.match(jetStreamIntegrationTests, /PreflightConsumer\(HeadersOnly=true\)/);
  assert.match(jetStreamIntegrationTests, /Adapter\.PreflightConsumer\(broad subject filter\)/);
  assert.match(jetStreamIntegrationTests, /Adapter\.PreflightConsumer\(exact subject filter\)/);
  assert.match(jetStreamIntegrationTests, /Publish\(testContext, foreignSubject/);
  assert.match(jetStreamIntegrationTests, /PersistentConsumerPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /DeliverNewPolicyRejected/);
  assert.match(jetStreamIntegrationTests, /DeliverAllPolicyPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerDeliverPolicy/);
  assert.match(jetStreamIntegrationTests, /ReplayOriginalPolicyRejected/);
  assert.match(jetStreamIntegrationTests, /ReplayInstantPolicyPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerReplayPolicy/);
  assert.match(jetStreamIntegrationTests, /LimitedDeliveryRejected/);
  assert.match(jetStreamIntegrationTests, /ConsumerMaxDeliver/);
  assert.match(jetStreamIntegrationTests, /HeadersOnlyRejected/);
  assert.match(jetStreamIntegrationTests, /FullPayloadPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerHeadersOnly/);
  assert.match(jetStreamIntegrationTests, /BroadSubjectFilterRejected/);
  assert.match(jetStreamIntegrationTests, /ExactSubjectPreflightPassed/);
  assert.match(jetStreamIntegrationTests, /ConsumerFilterSubject/);
  assert.match(jetStreamIntegrationTests, /ForeignSubjectExcluded/);
  assert.match(jetStreamIntegrationTests, /goexample-dlq-/);
  assert.match(jetStreamRestartTests, /TestRealNATSJetStreamRestartRecovery/);
  assert.match(jetStreamRestartTests, /NATS_SERVER_BINARY/);
  assert.match(jetStreamRestartTests, /Process\.Kill\(\)/);
  assert.match(jetStreamRestartTests, /persisted source messages/);
  assert.match(jetStreamRestartTests, /restart-report\.json/);
  assert.match(jetStreamRestartTests, /redeliveryMetadata\.Sequence\.Stream != firstMetadata\.Sequence\.Stream/);
  assert.match(jetStreamRestartTests, /DeliveryCountBeforeRestart/);
  assert.match(jetStreamRestartTests, /DeliveryCountAfterRestart/);
  assert.match(jetStreamRestartTests, /ShortLeaseRejected/);
  assert.match(jetStreamRestartTests, /RequiredLeaseNanos/);
  assert.match(jetStreamSnapshotTests, /TestRealNATSJetStreamSnapshotRestoreRecovery/);
  assert.match(jetStreamSnapshotTests, /NATS_SNAPSHOT_EVIDENCE_DIR/);
  assert.match(jetStreamSnapshotTests, /\$JS\.API\.STREAM\.SNAPSHOT/);
  assert.match(jetStreamSnapshotTests, /\$JS\.API\.STREAM\.RESTORE/);
  assert.match(jetStreamSnapshotTests, /CheckMessages:\s+true/);
  assert.match(jetStreamSnapshotTests, /tamperedSnapshotRejected/);
  assert.match(jetStreamSnapshotTests, /recoveredMetadata\.Sequence\.Stream != unacknowledgedMetadata\.Sequence\.Stream/);
  assert.match(jetStreamSnapshotTests, /restoreElapsed > snapshotRestoreBudget/);
  assert.match(jetStreamSnapshotTests, /snapshot-restore-report\.json/);
  assert.match(jetStreamClusterTests, /TestRealNATSJetStreamClusterLeaderFailover/);
  assert.match(jetStreamClusterTests, /NATS_CLUSTER_EVIDENCE_DIR/);
  assert.match(jetStreamClusterTests, /os\.Remove\(reportPath\)/);
  assert.match(jetStreamClusterTests, /Replicas:\s+3/);
  assert.match(jetStreamClusterTests, /Process\.Kill\(\)/);
  assert.match(jetStreamClusterTests, /waitClusterConnectionRecovered/);
  assert.match(jetStreamClusterTests, /openExistingClusterStream/);
  assert.match(jetStreamClusterTests, /openExistingClusterConsumer/);
  assert.match(jetStreamClusterTests, /waitClusterStreamLeaderChange/);
  assert.match(jetStreamClusterTests, /waitClusterStreamHandleAvailable/);
  assert.match(jetStreamClusterTests, /nats\.DisconnectErrHandler/);
  assert.match(jetStreamClusterTests, /nats\.ReconnectHandler/);
  assert.match(jetStreamClusterTests, /nats\.ClosedHandler/);
  assert.match(jetStreamClusterTests, /oldLeader != newLeader/);
  assert.match(jetStreamClusterTests, /redeliveryMetadata\.Sequence\.Stream != firstMetadata\.Sequence\.Stream/);
  assert.match(jetStreamClusterTests, /cluster-failover-report\.json/);
  assert.match(jetStreamClusterTests, /PublishedAfterFailover/);
  assert.match(jetStreamClusterTests, /LeasePreflightPassed/);
  assert.match(jetStreamClusterTests, /WorkerAckWaitNanos/);
  assert.match(jetStreamClusterTests, /SameConnectionSession/);
  assert.match(jetStreamClusterTests, /ConnectionServerBefore/);
  assert.match(jetStreamClusterTests, /AdapterSessionRecovered/);
  assert.match(jetStreamClusterTests, /SchemaVersion:\s+6/);
  assert.match(jetStreamClusterTests, /AbruptLeaderStops:\s+3/);
  assert.match(jetStreamClusterTests, /servers\[oldLeader\] = startClusterServer\(t, serverConfigs\[oldLeader\]\)/);
  assert.equal((jetStreamClusterTests.match(/waitClusterStreamReady\(t, testContext, (?:source|dlq), 3\)/g) ?? []).length, 15);
  assert.equal((jetStreamClusterTests.match(/waitClusterConsumerReady\(t, testContext, (?:sourceConsumer|dlqConsumer), 3\)/g) ?? []).length, 16);
  assert.match(jetStreamClusterTests, /waitClusterConnectionAvailable/);
  assert.match(jetStreamClusterTests, /SecondRecoveredSequence/);
  assert.match(jetStreamClusterTests, /SecondDeliveryBefore/);
  assert.match(jetStreamClusterTests, /SecondDeliveryAfter/);
  assert.match(jetStreamClusterTests, /SecondLeasePreflight/);
  assert.match(jetStreamClusterTests, /SameSessionAfterSecond/);
  assert.match(jetStreamClusterTests, /AdapterRecoveredSecond/);
  assert.match(jetStreamClusterTests, /waitClusterStreamQuorumRecovered/);
  assert.match(jetStreamClusterTests, /must-not-commit-without-quorum/);
  assert.match(jetStreamClusterTests, /errors\.Is\(quorumPublishError, ErrPublish\)/);
  assert.match(jetStreamClusterTests, /quorumFailureBudget = 3 \* time\.Second/);
  assert.match(jetStreamClusterTests, /servers\[quorumOldLeader\] = startClusterServer\(t, serverConfigs\[quorumOldLeader\]\)/);
  assert.match(jetStreamClusterTests, /servers\[secondOldLeader\] = startClusterServer\(t, serverConfigs\[secondOldLeader\]\)/);
  assert.match(jetStreamClusterTests, /QuorumRecoveredSequence/);
  assert.match(jetStreamClusterTests, /SameSessionAfterQuorumRecovery/);
  assert.match(jetStreamClusterTests, /FinalReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /stopClusterServersConcurrently/);
  assert.match(jetStreamClusterTests, /ready\.Wait\(\)/);
  assert.match(jetStreamClusterTests, /close\(release\)/);
  assert.match(jetStreamClusterTests, /concurrentStopSkewBudget = 250 \* time\.Millisecond/);
  assert.match(jetStreamClusterTests, /must-not-commit-during-concurrent-failure/);
  assert.match(jetStreamClusterTests, /ConcurrentRecoveredSequence/);
  assert.match(jetStreamClusterTests, /ConcurrentReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /--cluster_advertise/);
  assert.match(jetStreamClusterTests, /disableClusterRouteProxies/);
  assert.match(jetStreamClusterTests, /verifyClusterCoreServersAvailable/);
  assert.match(jetStreamClusterTests, /networkPartitionLeader == networkPartitionConnectionServer/);
  assert.match(jetStreamClusterTests, /must-not-commit-during-network-partition/);
  assert.match(jetStreamClusterTests, /partitionRecoveredInfo\.State\.Msgs != 11/);
  assert.match(jetStreamClusterTests, /PartitionRecoveredSequence/);
  assert.match(jetStreamClusterTests, /PartitionReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /UpdateConsumer\(attemptContext, streamName, config\)/);
  assert.match(jetStreamClusterTests, /PreflightConsumer\(\s+attemptContext,/);
  assert.match(goMod, /github\.com\/nats-io\/nats\.go v1\.53\.1/);
  assert.match(goWorkflow, /nats-contract:/);
  assert.equal((goWorkflow.match(/docs\/recovery\/server-failure-matrix\.md/g) ?? []).length, 2);
  assert.match(goWorkflow, /nats:2\.14\.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da/);
  assert.match(goWorkflow, /NATS_TEST_URL:/);
  assert.match(goWorkflow, /NATS_SERVER_BINARY:/);
  assert.match(goWorkflow, /NATS_DELIVERY_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /NATS_RESTART_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /NATS_SNAPSHOT_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /NATS_CLUSTER_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /-run '\^TestRealNATS'/);
  assert.match(goWorkflow, /docker run.*goexample-nats-contract.*-js.*-sd \/data/s);
  assert.match(goWorkflow, /docker cp goexample-nats-contract:\/nats-server/);
  assert.match(goWorkflow, /nats-server-binary\.sha256/);
  assert.match(goWorkflow, /yarn nats:delivery:contract:evidence/);
  assert.match(goWorkflow, /yarn nats:delivery:contract:verify/);
  assert.match(goWorkflow, /contract=nats-jetstream-delivery-lease/);
  assert.match(goWorkflow, /yarn nats:snapshot:contract:evidence/);
  assert.match(goWorkflow, /yarn nats:snapshot:contract:verify/);
  assert.match(goWorkflow, /yarn nats:restart:contract:evidence/);
  assert.match(goWorkflow, /yarn nats:restart:contract:verify/);
  assert.match(goWorkflow, /contract=nats-jetstream-restart-recovery/);
  assert.match(goWorkflow, /yarn nats:cluster:contract:evidence/);
  assert.match(goWorkflow, /yarn nats:cluster:contract:verify/);
  assert.match(goWorkflow, /contract=nats-jetstream-cluster-failover/);
  assert.match(goWorkflow, /nats-contract\/manifest\.json/);
  assert.match(goWorkflow, /node scripts\/evidence-verify\.mjs/);
  assert.match(goWorkflow, /find "\$\{artifact_dir\}" -type f/);
  assert.match(goWorkflow, /\.\/queueclient\/\.\.\./);
  assert.match(goWorkflow, /nats-server\.log/);
  assert.match(goWorkflow, /nats-server-inspect\.json/);
  assert.match(goWorkflow, /workflow-artifacts\/nats-contract/);
  assert.match(goWorkflow, /nats-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(readme, /## 消息队列/);
  assert.match(readme, /不等于远端 job 已成功/);
  assert.match(readme, /Core NATS 不提供/);
  assert.match(readme, /`queueclient\/natsjetstream`/);
  assert.match(readme, /`PublishDeduplicated`/);
  assert.match(readme, /1\.\.256 bytes/);
  assert.match(readme, /NumDelivered/);
  assert.match(changelog, /Broker-neutral queue publish\/process instrumentation/);
  assert.match(changelog, /Optional fixed-cardinality `WorkerObserver` and `DeliveryObserver` callbacks/);
  assert.match(changelog, /Typed JetStream `Adapter\.PublishDeduplicated`/);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.match(packageScripts['test:node'], /nats-cluster-evidence\.test\.mjs/);
  assert.match(packageScripts['test:node'], /nats-delivery-evidence\.test\.mjs/);
  assert.match(packageScripts['test:node'], /nats-restart-evidence\.test\.mjs/);
  assert.equal(packageScripts['nats:delivery:contract:evidence'], 'node scripts/nats-delivery-evidence.mjs run');
  assert.equal(packageScripts['nats:delivery:contract:verify'], 'node scripts/nats-delivery-evidence.mjs verify');
  assert.equal(packageScripts['nats:cluster:contract:evidence'], 'node scripts/nats-cluster-evidence.mjs run');
  assert.equal(packageScripts['nats:cluster:contract:verify'], 'node scripts/nats-cluster-evidence.mjs verify');
  assert.equal(packageScripts['nats:restart:contract:evidence'], 'node scripts/nats-restart-evidence.mjs run');
  assert.equal(packageScripts['nats:restart:contract:verify'], 'node scripts/nats-restart-evidence.mjs verify');
  assert.equal(packageScripts['nats:snapshot:contract:evidence'], 'node scripts/nats-snapshot-evidence.mjs run');
  assert.equal(packageScripts['nats:snapshot:contract:verify'], 'node scripts/nats-snapshot-evidence.mjs verify');
  assert.match(natsEvidenceRunner, /buildNatsSnapshotEvidenceReport/);
  assert.match(natsEvidenceRunner, /buildNatsSnapshotChecksums/);
  assert.match(natsEvidenceRunner, /verifyNatsSnapshotEvidence/);
  assert.match(natsEvidenceHelper, /natsSnapshotEvidenceSchemaVersion = 1/);
  assert.match(natsEvidenceHelper, /snapshotChunks < 2/);
  assert.match(natsEvidenceHelper, /postCheckpointExcluded !== true/);
  assert.match(natsEvidenceHelper, /sameSequenceRedelivered !== true/);
  assert.match(natsEvidenceHelper, /tamperedSnapshotRejected !== true/);
  assert.match(natsEvidenceHelper, /restoreElapsedNanos > inner\.restoreBudgetNanos/);
  assert.match(natsEvidenceHelper, /natsBroker remains not_recorded/);
  assert.match(natsEvidenceHelper, /exact ordered NATS snapshot evidence artifact set/);
  assert.match(natsEvidenceTests, /verified\.artifactPaths\.length, 10/);
  assert.match(natsEvidenceTests, /scope no longer matches/);
  assert.match(natsEvidenceTests, /SHA256SUMS must contain the exact ordered/);
  assert.match(natsDeliveryEvidenceRunner, /buildNatsDeliveryEvidenceReport/);
  assert.match(natsDeliveryEvidenceRunner, /buildNatsDeliveryChecksums/);
  assert.match(natsDeliveryEvidenceRunner, /verifyNatsDeliveryEvidence/);
  assert.match(natsDeliveryEvidenceHelper, /natsDeliveryEvidenceSchemaVersion = 14/);
  assert.match(natsDeliveryEvidenceHelper, /pushConsumerRejected !== expectedContract\.pushConsumerRejected/);
  assert.match(natsDeliveryEvidenceHelper, /rebuiltPullConsumerPreflightPassed !== expectedContract\.rebuiltPullConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerDeliverSubject !== expectedContract\.consumerDeliverSubject/);
  assert.match(natsDeliveryEvidenceHelper, /priorityConsumerRejected !== expectedContract\.priorityConsumerRejected/);
  assert.match(natsDeliveryEvidenceHelper, /rebuiltDefaultPriorityConsumerPreflightPassed !== expectedContract\.rebuiltDefaultPriorityConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerPriorityPolicy !== expectedContract\.consumerPriorityPolicy/);
  assert.match(natsDeliveryEvidenceHelper, /consumerPriorityGroupCount !== expectedContract\.consumerPriorityGroupCount/);
  assert.match(natsDeliveryEvidenceHelper, /ackAllConsumerRejected !== expectedContract\.ackAllConsumerRejected/);
  assert.match(natsDeliveryEvidenceHelper, /rebuiltExplicitAckConsumerPreflightPassed !== expectedContract\.rebuiltExplicitAckConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerAckPolicy !== expectedContract\.consumerAckPolicy/);
  assert.match(natsDeliveryEvidenceHelper, /receiveCancellationWaitingObserved !== expectedContract\.receiveCancellationWaitingObserved/);
  assert.match(natsDeliveryEvidenceHelper, /receiveCancellationPropagated !== expectedContract\.receiveCancellationPropagated/);
  assert.match(natsDeliveryEvidenceHelper, /receiveCancellationError !== expectedContract\.receiveCancellationError/);
  assert.match(natsDeliveryEvidenceHelper, /report\.receiveCancellationLatencyNanos < 0/);
  assert.match(natsDeliveryEvidenceHelper, /report\.receiveCancellationLatencyNanos > report\.receiveCancellationReturnLimitNanos/);
  assert.match(natsDeliveryEvidenceHelper, /report\.receiveCancellationLatencyNanos >= report\.receiveCancellationFetchMaxWaitNanos/);
  assert.match(natsDeliveryEvidenceHelper, /persistentConsumerPreflightPassed !== expectedContract\.persistentConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /deliverNewPolicyRejected !== expectedContract\.deliverNewPolicyRejected/);
  assert.match(natsDeliveryEvidenceHelper, /deliverAllPolicyPreflightPassed !== expectedContract\.deliverAllPolicyPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerDeliverPolicy !== expectedContract\.consumerDeliverPolicy/);
  assert.match(natsDeliveryEvidenceHelper, /replayOriginalPolicyRejected !== expectedContract\.replayOriginalPolicyRejected/);
  assert.match(natsDeliveryEvidenceHelper, /replayInstantPolicyPreflightPassed !== expectedContract\.replayInstantPolicyPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerReplayPolicy !== expectedContract\.consumerReplayPolicy/);
  assert.match(natsDeliveryEvidenceHelper, /brokerRequestExpiresRejected !== expectedContract\.brokerRequestExpiresRejected/);
  assert.match(natsDeliveryEvidenceHelper, /shortRequestExpiresRejected !== expectedContract\.shortRequestExpiresRejected/);
  assert.match(natsDeliveryEvidenceHelper, /compatibleRequestExpiresPreflightPassed !== expectedContract\.compatibleRequestExpiresPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /adapterFetchMaxWaitNanos !== expectedContract\.adapterFetchMaxWaitNanos/);
  assert.match(natsDeliveryEvidenceHelper, /consumerMaxRequestExpiresNanos !== expectedContract\.consumerMaxRequestExpiresNanos/);
  assert.match(natsDeliveryEvidenceHelper, /pausedConsumerRejected !== expectedContract\.pausedConsumerRejected/);
  assert.match(natsDeliveryEvidenceHelper, /resumedConsumerPreflightPassed !== expectedContract\.resumedConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerPaused !== expectedContract\.consumerPaused/);
  assert.match(natsDeliveryEvidenceHelper, /limitedDeliveryRejected !== expectedContract\.limitedDeliveryRejected/);
  assert.match(natsDeliveryEvidenceHelper, /consumerMaxDeliver !== expectedContract\.consumerMaxDeliver/);
  assert.match(natsDeliveryEvidenceHelper, /headersOnlyRejected !== expectedContract\.headersOnlyRejected/);
  assert.match(natsDeliveryEvidenceHelper, /fullPayloadPreflightPassed !== expectedContract\.fullPayloadPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerHeadersOnly !== expectedContract\.consumerHeadersOnly/);
  assert.match(natsDeliveryEvidenceHelper, /broadSubjectFilterRejected !== expectedContract\.broadSubjectFilterRejected/);
  assert.match(natsDeliveryEvidenceHelper, /exactSubjectPreflightPassed !== expectedContract\.exactSubjectPreflightPassed/);
  assert.match(natsDeliveryEvidenceHelper, /consumerFilterSubjectPattern\.test\(report\.consumerFilterSubject\)/);
  assert.match(natsDeliveryEvidenceHelper, /foreignSubjectExcluded !== expectedContract\.foreignSubjectExcluded/);
  assert.match(natsDeliveryEvidenceHelper, /deduplicatedPublishAttempts !== expectedContract\.deduplicatedPublishAttempts/);
  assert.match(natsDeliveryEvidenceHelper, /deduplicatedStoredMessages !== expectedContract\.deduplicatedStoredMessages/);
  assert.match(natsDeliveryEvidenceHelper, /duplicateWindowNanos !== expectedContract\.duplicateWindowNanos/);
  assert.match(natsDeliveryEvidenceHelper, /dlqPublishConfirmed !== expectedContract\.dlqPublishConfirmed/);
  assert.match(natsDeliveryEvidenceHelper, /redeliveryCount < 2/);
  assert.match(natsDeliveryEvidenceHelper, /dynamicRequiredLeaseNanos !== expectedContract\.dynamicRequiredLeaseNanos/);
  assert.match(natsDeliveryEvidenceHelper, /leaseExtensions < expectedContract\.minimumLeaseExtensions/);
  assert.match(natsDeliveryEvidenceHelper, /natsBroker remains not_recorded/);
  assert.match(natsDeliveryEvidenceHelper, /exact ordered NATS delivery evidence artifact set/);
  assert.match(natsDeliveryEvidenceTests, /verified\.artifactPaths\.length, 9/);
  assert.match(natsDeliveryEvidenceTests, /scope no longer matches/);
  assert.match(natsDeliveryEvidenceTests, /path traversal and production-boundary drift/);
  assert.match(natsDeliveryEvidenceTests, /persistentPreflightTamper/);
  assert.match(natsDeliveryEvidenceTests, /missingDeliveryPolicy/);
  assert.match(natsDeliveryEvidenceTests, /missingReplayPolicy/);
  assert.match(natsDeliveryEvidenceTests, /missingConsumerPause/);
  assert.match(natsDeliveryEvidenceTests, /missingConsumerMode/);
  assert.match(natsDeliveryEvidenceTests, /pushConsumerRejected/);
  assert.match(natsDeliveryEvidenceTests, /rebuiltPullConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceTests, /consumerDeliverSubject/);
  assert.match(natsDeliveryEvidenceTests, /priorityConsumerRejected/);
  assert.match(natsDeliveryEvidenceTests, /rebuiltDefaultPriorityConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceTests, /consumerPriorityPolicy/);
  assert.match(natsDeliveryEvidenceTests, /consumerPriorityGroupCount/);
  assert.match(natsDeliveryEvidenceTests, /missingPriorityPolicy/);
  assert.match(natsDeliveryEvidenceTests, /ackAllConsumerRejected/);
  assert.match(natsDeliveryEvidenceTests, /rebuiltExplicitAckConsumerPreflightPassed/);
  assert.match(natsDeliveryEvidenceTests, /consumerAckPolicy/);
  assert.match(natsDeliveryEvidenceTests, /missingAckPolicy/);
  assert.match(natsDeliveryEvidenceTests, /receiveCancellationWaitingObserved/);
  assert.match(natsDeliveryEvidenceTests, /receiveCancellationPropagated/);
  assert.match(natsDeliveryEvidenceTests, /receiveCancellationError/);
  assert.match(natsDeliveryEvidenceTests, /receiveCancellationLatencyNanos/);
  assert.match(natsDeliveryEvidenceTests, /missingReceiveCancellation/);
  assert.match(natsDeliveryEvidenceTests, /pausedConsumerRejected/);
  assert.match(natsDeliveryEvidenceTests, /deliverNewPolicyRejected/);
  assert.match(natsDeliveryEvidenceTests, /deliverAllPolicyPreflightPassed/);
  assert.match(natsDeliveryEvidenceTests, /consumerDeliverPolicy/);
  assert.match(natsDeliveryEvidenceTests, /replayOriginalPolicyRejected/);
  assert.match(natsDeliveryEvidenceTests, /replayInstantPolicyPreflightPassed/);
  assert.match(natsDeliveryEvidenceTests, /consumerReplayPolicy/);
  assert.match(natsRestartEvidenceRunner, /buildNatsRestartEvidenceReport/);
  assert.match(natsRestartEvidenceRunner, /buildNatsRestartChecksums/);
  assert.match(natsRestartEvidenceRunner, /verifyNatsRestartEvidence/);
  assert.match(natsRestartEvidenceHelper, /natsRestartEvidenceSchemaVersion = 1/);
  assert.match(natsRestartEvidenceHelper, /recoveredStreamSequence !== 1/);
  assert.match(natsRestartEvidenceHelper, /workerAckWaitNanos !== expectedContract\.workerAckWaitNanos/);
  assert.match(natsRestartEvidenceHelper, /natsBroker remains not_recorded/);
  assert.match(natsRestartEvidenceHelper, /exact ordered NATS restart evidence artifact set/);
  assert.match(natsRestartEvidenceTests, /verified\.artifactPaths\.length, 10/);
  assert.match(natsRestartEvidenceTests, /scope no longer matches/);
  assert.match(natsRestartEvidenceTests, /SHA256SUMS must contain the exact ordered/);
  assert.match(natsClusterEvidenceRunner, /buildNatsClusterEvidenceReport/);
  assert.match(natsClusterEvidenceRunner, /buildNatsClusterChecksums/);
  assert.match(natsClusterEvidenceRunner, /verifyNatsClusterEvidence/);
  assert.match(natsClusterEvidenceHelper, /natsClusterEvidenceSchemaVersion = 1/);
  assert.match(natsClusterEvidenceHelper, /schemaVersion !== 6/);
  assert.match(natsClusterEvidenceHelper, /requiredLeaseNanos !== 8_515_000_000/);
  assert.match(natsClusterEvidenceHelper, /workerAckWaitNanos !== expectedContract\.workerAckWaitNanos/);
  assert.match(natsClusterEvidenceHelper, /natsBroker remains not_recorded/);
  assert.match(natsClusterEvidenceHelper, /exact ordered NATS cluster evidence artifact set/);
  assert.match(natsClusterEvidenceTests, /verified\.artifactPaths\.length, 11/);
  assert.match(natsClusterEvidenceTests, /scope no longer matches/);
  assert.match(natsClusterEvidenceTests, /SHA256SUMS must contain the exact ordered/);
  const [metrics, metricsTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
  ]);
  assert.match(metrics, /goexample_queue_workers_active/);
  assert.match(metrics, /goexample_queue_worker_events_total/);
  assert.match(metrics, /goexample_queue_delivery_events_total/);
  assert.match(metrics, /goexample_queue_delivery_lease_events_total/);
  assert.match(metricsTests, /TestMetricsRecordsBoundedQueueWorkerLifecycle/);
  assert.match(rules, /GoExampleQueueDeliveryDeadLetters/);
  assert.match(rules, /GoExampleQueueSettlementFailures/);
  assert.match(rules, /GoExampleQueueLeaseExtensionFailures/);
  assert.match(sloRunbook, /acknowledged.*retried.*dead_lettered.*settlement_failed/);
  assert.match(sloRunbook, /lease events use only `extended` and `failure`/);
  assert.match(readme, /ReceiveDelivery/);
  assert.match(readme, /ErrDeliverySettlement/);
  assert.match(readme, /ErrDeliveryLeaseExtension/);
  assert.match(changelog, /opt-in mutually exclusive delivery mode/);
  assert.match(changelog, /Opt-in Core NATS integration contract/);
  assert.match(changelog, /Bounded positive jitter for reliable-delivery handler retries/);
  assert.match(readme, /每次 retry 在基础等待之上增加/);
  assert.match(readme, /每次 retry 的最大 jitter 等待/);
  assert.match(changelog, /NATS JetStream adapter/);
  assertEvidenceInput('Framework/queueclient/client.go');
  assertEvidenceInput('Framework/queueclient/client_test.go');
  assertEvidenceInput('Framework/queueclient/worker.go');
  assertEvidenceInput('Framework/queueclient/worker_test.go');
  assertEvidenceInput('Framework/queueclient/nats_integration_test.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/adapter.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/adapter_test.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/integration_test.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/restart_integration_test.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/snapshot_integration_test.go');
  assertEvidenceInput('Framework/queueclient/natsjetstream/cluster_integration_test.go');
  assert.match(evidenceManifest, /verifyNatsDeliveryEvidence/);
  assert.match(evidenceManifest, /verifyNatsRestartContractArtifacts/);
  assert.match(evidenceManifest, /verifyNatsRestartEvidence/);
  assert.match(evidenceManifest, /verifyNatsSnapshotEvidence/);
  assert.match(evidenceVerify, /NATS restart evidence artifact is missing from the manifest/);
  assert.match(evidenceVerify, /NATS snapshot evidence artifact is missing from the manifest/);
  assert.match(evidenceVerify, /NATS delivery evidence artifact is missing from the manifest/);
  assert.match(evidenceManifest, /natsBroker/);
  assert.match(evidenceManifest, /natsRestartArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsRestartArtifacts/);
  assert.match(evidenceManifest, /localNatsRestartStatus/);
  assert.match(evidenceManifest, /localNatsRestart/);
  assert.match(evidenceManifest, /natsSnapshotArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsSnapshotArtifacts/);
  assert.match(evidenceManifest, /localNatsSnapshotRestoreStatus/);
  assert.match(evidenceManifest, /localNatsSnapshotRestore/);
  assert.match(evidenceManifest, /report\.restoreElapsedNanos <= report\.restoreBudgetNanos/);
  assert.match(evidenceManifest, /natsClusterArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsClusterArtifacts/);
  assert.match(evidenceManifest, /localNatsClusterFailoverStatus/);
  assert.match(evidenceManifest, /localNatsClusterFailover/);
  assert.match(evidenceManifest, /verifyNatsClusterContractArtifacts/);
  assert.match(evidenceManifest, /verifyNatsClusterEvidence/);
  assert.match(evidenceManifest, /natsClusterOuterEvidenceRoot/);
  assert.match(evidenceManifest, /natsDeliveryOuterEvidenceRoot/);
  assert.match(evidenceVerify, /verifyNatsDeliveryEvidence/);
  assert.match(evidenceVerify, /verifyNatsClusterContractArtifacts/);
  assert.match(evidenceVerify, /verifyNatsClusterEvidence/);
  assert.match(evidenceVerify, /NATS cluster evidence artifact is missing from the manifest/);
  assert.doesNotMatch(evidenceManifest, /clusterNodeNamePattern/);
});

test('external OIDC/JWKS bearer verification stays bounded and separate from demo login', async () => {
  const [authService, verifier, verifierTests, oidcFlow, oidcFlowTests, authorizationRequestStore, authorizationRequestStoreTests, oidcClient, oidcClientTests, oidcCallback, oidcCallbackTests, oidcBrowser, oidcBrowserTests, session, sessionTests, sessionStore, sessionStoreTests, browserSession, browserSessionTests, browserSessionStore, browserSessionStoreTests, app, authRoutes, middleware, httpTests, config, configTests, entrypoint, entrypointTests, projectRoutes, exampleEnvironment, template, readme, changelog, evidenceManifest] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'jwks.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'jwks_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_flow.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_flow_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_callback.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_callback_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'oidc_browser.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'oidc_browser_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'session.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'session_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'browser_session.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'browser_session_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'token_verifier_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
  ]);

  assert.match(authService, /type TokenVerifier interface/);
  assert.match(authService, /VerifyToken\(context\.Context, string\) \(Claims, error\)/);
  assert.match(verifier, /jwt\.SigningMethodRS256/);
  assert.match(verifier, /minRSAKeyBits\s*=\s*2048/);
  assert.match(verifier, /maxRSAKeyBits\s*=\s*8192/);
  assert.match(verifier, /maxAccessTokenBytes\s*=\s*16 << 10/);
  assert.match(verifier, /maxJWKSResponseBytes\s*=\s*1 << 20/);
  assert.match(verifier, /maxJWKSKeys\s*=\s*100/);
  assert.match(verifier, /unknownKeyRefreshInterval\s*=\s*5 \* time\.Second/);
  assert.match(verifier, /refreshGate\s+chan struct\{\}/);
  assert.doesNotMatch(verifier, /refreshMu\s+sync\.Mutex/);
  assert.match(verifier, /io\.LimitReader\(response\.Body, maxJWKSResponseBytes\+1\)/);
  assert.match(verifier, /jwt\.WithIssuer\(verifier\.issuer\)/);
  assert.match(verifier, /jwt\.WithAudience\(verifier\.audience\)/);
  assert.match(verifier, /jwt\.WithExpirationRequired\(\)/);
  assert.match(verifier, /jwt\.WithNotBeforeRequired\(\)/);
  assert.match(verifier, /func \(verifier \*JWKSVerifier\) VerifyIDToken/);
  assert.match(verifier, /func \(verifier \*JWKSVerifier\) VerifyIDTokenWithAccessToken/);
  assert.match(verifier, /sha256\.Sum256\(\[\]byte\(accessToken\)\)/);
  assert.match(verifier, /subtle\.ConstantTimeCompare/);
  assert.match(verifier, /validIDTokenClaims/);
	assert.match(verifier, /validIDTokenAssurance/);
	assert.match(verifier, /requiredACR == "" && len\(requiredAMR\) == 0/);
	assert.match(verifier, /claims\.AuthTime == nil/);
	assert.match(verifier, /len\(actualAMR\) > maxOIDCAssuranceValues/);
	assert.match(verifier, /requiredACR != "" && actualACR != requiredACR/);
  assert.match(verifier, /claims\.Azp != audience/);
  assert.doesNotMatch(verifier, /RecordError|response\.Request|response\.Body\.String/);
  assert.match(verifierTests, /TestJWKSVerifierValidatesRS256ClaimsAndRefreshesRotatedKey/);
  assert.match(verifierTests, /TestJWKSVerifierCollapsesUnknownKeyRefreshes/);
  assert.match(verifierTests, /TestJWKSVerifierFailsClosedOnExpiredCacheAndCanceledRefresh/);
  assert.match(verifierTests, /TestJWKSVerifierValidatesIDTokenNonceAudienceAndAge/);
	assert.match(verifierTests, /TestJWKSVerifierBindsOptionalIDTokenAccessTokenHash/);
	assert.match(verifierTests, /TestJWKSVerifierEnforcesIDTokenAssurancePolicy/);
  assert.match(verifierTests, /TestNewJWKSVerifierRejectsUnsafeConfigurationAndDocuments/);
  assert.match(session, /type SessionConfig struct/);
  assert.match(session, /type SessionStore interface/);
  assert.match(session, /Store\s+SessionStore/);
  assert.match(session, /type SessionManager struct/);
  assert.match(session, /RefreshTTL\s+time\.Duration/);
  assert.match(session, /AbsoluteTTL\s+time\.Duration/);
  assert.match(session, /MaxFamilies\s+int/);
  assert.match(session, /maxSessionTokensPerFamily\s*=\s*1024/);
  assert.match(session, /sha256\.Sum256\(\[\]byte\(rawToken\)\)/);
  assert.match(session, /family\.used\[tokenHash\]/);
  assert.match(session, /family\.revoked = true/);
  assert.match(session, /func \(manager \*SessionManager\) RevokeUser/);
  assert.match(session, /func \(manager \*SessionManager\) RevokeFamily/);
  assert.match(session, /func \(manager \*SessionManager\) ActiveFamilies/);
  assert.doesNotMatch(session, /rawToken\s+string\s+`/);
  assert.match(sessionTests, /TestSessionStartRotateAndReuseRevokesFamily/);
  assert.match(sessionTests, /TestSessionConcurrentRotationDetectsReuse/);
  assert.match(sessionTests, /TestSessionFamilyLimitAndInputValidation/);
  assert.match(sessionTests, /TestSessionRotationHistoryIsBounded/);
  assert.match(sessionStore, /rotateSessionScript/);
  assert.match(sessionStore, /hash-only|hash-only/i);
  assert.match(sessionStore, /var _ auth\.SessionStore = \(\*Redis\)\(nil\)/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreRotatesAcrossClientsAndDetectsReuse/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreCentralUserRevokeAndFamilyLimit/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreFailsClosedWhenBackendStops/);
	assert.match(browserSession, /type BrowserSessionManager struct/);
	assert.match(browserSession, /type BrowserSessionStore interface/);
	assert.match(browserSession, /type BrowserSessionInventoryStore interface/);
	assert.match(browserSession, /type BrowserSessionMetadataStore interface/);
	assert.match(browserSession, /MaxSessionsPerSubject int/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) ListForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) RevokeForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) RevokeAllForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) SetDeviceNameForSubject/);
	assert.match(browserSession, /sha256\.Sum256\(\[\]byte\(sessionToken\)\)/);
	assert.match(browserSession, /expiresAt\.After\(claims\.ExpiresAt\.Time\)/);
	assert.match(browserSession, /subtle\.ConstantTimeCompare/);
	assert.match(browserSessionTests, /TestBrowserSessionCapsLifetimeBindsCSRFAndCopiesClaims/);
	assert.match(browserSessionTests, /TestBrowserSessionStoreSharesHashOnlyStateAcrossManagers/);
	assert.match(browserSessionTests, /TestBrowserSessionInventoryEnforcesSubjectLimitAndScopesRevocation/);
	assert.match(browserSessionTests, /TestBrowserSessionLegacyStoreKeepsStartCompatibilityWithoutInventory/);
	assert.match(browserSessionTests, /TestBrowserSessionDeviceNameLocalUpdateClearAndValidation/);
	assert.match(browserSessionStore, /createBrowserSessionScript/);
	assert.match(browserSessionStore, /deleteBrowserSessionsForSubjectScript/);
	assert.match(browserSessionStore, /updateBrowserSessionDeviceNameScript/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionInventoryStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionMetadataStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionStoreSharesAndRevokesHashOnlySession/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionStoreEnforcesLimitExpiryAndOutage/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryCrossClientLimitsAndScopesRevocation/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryRejectsTamperAndOutage/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionSubjectLimitIsAtomicAcrossClients/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionDeviceNameUpdateIsAtomicAndPreservesSession/);

  assert.match(oidcFlow, /type AuthorizationRequestManager struct/);
	assert.match(oidcFlow, /type AuthorizationRequestStore interface/);
	assert.match(oidcFlow, /Store\s+AuthorizationRequestStore/);
	assert.match(oidcFlow, /code_challenge_method\", \"S256\"/);
	assert.match(oidcFlow, /query\.Set\("acr_values", strings\.Join\(config\.ACRValues, " "\)\)/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) Complete/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) StartContext/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) CompleteContext/);
	assert.match(oidcFlow, /pending map\[\[sha256\.Size\]byte\]AuthorizationRequestRecord/);
	assert.match(oidcFlow, /delete\(manager\.pending, stateHash\)/);
	assert.match(oidcFlow, /func ValidateAuthorizationNonce/);
	assert.match(oidcFlow, /subtle\.ConstantTimeCompare/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestManagerBuildsSingleUsePKCERequest/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestStoreSharesHashOnlyStateAcrossManagers/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestManagerExpiresAndBoundsPendingState/);
	assert.match(oidcFlowTests, /TestNewAuthorizationRequestManagerRejectsUnsafeConfiguration/);
	assert.match(authorizationRequestStore, /createAuthorizationRequestScript/);
	assert.match(authorizationRequestStore, /consumeAuthorizationRequestScript/);
	assert.match(authorizationRequestStore, /var _ auth\.AuthorizationRequestStore = \(\*Redis\)\(nil\)/);
	assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreConsumesAcrossClientsExactlyOnce/);
	assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreEnforcesGlobalLimitExpiryTamperAndOutage/);

  assert.match(oidcClient, /type OIDCClient struct/);
  assert.match(oidcClient, /func NewOIDCClient/);
  assert.match(oidcClient, /func \(client \*OIDCClient\) ExchangeCode/);
  assert.match(oidcClient, /CheckRedirect/);
  assert.match(oidcClient, /maxOIDCMetadataBytes\s*=\s*64 << 10/);
  assert.match(oidcClient, /maxOIDCTokenResponseBytes\s*=\s*64 << 10/);
	assert.match(oidcClient, /code_challenge_methods_supported/);
	assert.match(oidcClient, /token_endpoint_auth_methods_supported/);
	assert.match(oidcClient, /required == oidcTokenAuthClientSecretBasic/);
	assert.match(oidcClient, /func unmarshalOIDCJSON/);
	assert.match(oidcClient, /func scanOIDCJSONValue/);
	assert.match(oidcClient, /duplicate keys/);
	assert.match(oidcClient, /multiple top-level values/);
	assert.match(oidcClient, /form\.Set\("client_id", client\.clientID\)/);
	assert.match(oidcClient, /request\.SetBasicAuth\(url\.QueryEscape\(client\.clientID\), url\.QueryEscape\(client\.clientSecret\)\)/);
	assert.match(oidcClientTests, /TestOIDCClientDiscoversAndExchangesAuthorizationCode/);
	assert.match(oidcClientTests, /TestOIDCClientNegotiatesTokenEndpointAuthentication/);
	assert.match(oidcClientTests, /TestOIDCClientBuildsCompliantTokenAuthenticationRequests/);
	assert.match(oidcClientTests, /duplicate discovery key/);
	assert.match(oidcClientTests, /duplicate token JSON/);
	assert.match(oidcClientTests, /TestOIDCJSONRejectsAmbiguousDocuments/);
  assert.match(oidcClientTests, /TestNewOIDCClientRejectsUnsafeOrIncompleteDiscovery/);
  assert.match(oidcClientTests, /TestOIDCClientBoundsTokenExchangeAndStopsRedirects/);
  assert.match(oidcCallback, /func CompleteOIDCCallback/);
	assert.match(oidcCallback, /manager\.CompleteContext\(ctx, state, code\)/);
  assert.match(oidcCallback, /verifier\.VerifyIDTokenWithAccessToken\(ctx, tokens\.IDToken, authorization\.Nonce, tokens\.AccessToken\)/);
  assert.match(oidcCallbackTests, /TestCompleteOIDCCallbackConsumesStateAndBindsIDTokenNonce/);
  assert.match(oidcCallbackTests, /TestCompleteOIDCCallbackRejectsMismatchedAccessTokenHash/);
  assert.match(oidcCallbackTests, /TestCompleteOIDCCallbackFailsClosedAndDoesNotLeakProviderErrors/);

	assert.match(oidcBrowser, /type OIDCBrowser struct/);
	assert.match(oidcBrowser, /__Host-goexample-oidc-state/);
	assert.match(oidcBrowser, /Secure:\s+true/);
	assert.match(oidcBrowser, /HTTPOnly:\s+true/);
	assert.match(oidcBrowser, /CookieSameSiteLaxMode/);
	assert.match(oidcBrowser, /browser\.requests\.StartContext\(requestContext\)/);
	assert.match(oidcBrowser, /browser\.requests\.CompleteContext\(requestContext, state, code\)/);
	assert.match(oidcBrowser, /subtle\.ConstantTimeCompare/);
	assert.match(oidcBrowser, /VerifyIDTokenWithAccessToken/);
	assert.match(oidcBrowser, /sameOIDCSubject/);
	assert.match(oidcBrowser, /NewOIDCBrowserWithSessions/);
	assert.match(oidcBrowser, /__Host-goexample-session/);
	assert.match(oidcBrowser, /__Host-goexample-csrf/);
	assert.match(oidcBrowser, /browser\.sessions\.Start/);
	assert.match(oidcBrowser, /browser\.sessions\.End/);
	assert.match(oidcBrowser, /browser\.sessions\.ListForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.RevokeForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.RevokeAllForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.SetDeviceNameForSubject/);
	assert.match(oidcBrowser, /browserSessionDeviceNameRequest/);
	assert.match(oidcBrowser, /fiber\.StatusNotFound/);
	assert.match(oidcBrowser, /fiber\.StatusServiceUnavailable/);
	assert.doesNotMatch(oidcBrowser, /Logger\..*(?:state|code|token|cookie)|fiber\.Map.*(?:state|code|token|cookie)/i);
	assert.match(oidcBrowserTests, /TestOIDCBrowserCompletesStateCookieBoundCallbackOnce/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryAndSubjectBoundRevocation/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionDeviceNameRequiresCSRFAndScopesUpdates/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryFailsClosedForLegacyStore/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryCollapsesBackendOutage/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserRejectsMissingOrMismatchedCookieAndConsumesState/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserCollapsesProviderFailuresAndPrivateQueryValues/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserRequiresExternalAuthenticationMode/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserRejectsMismatchedAccessTokenHash/);
	assert.match(oidcBrowserTests, /missing CSRF logout/);

  assert.match(app, /TokenVerifier\s+auth\.TokenVerifier/);
  assert.match(authRoutes, /if options\.Auth\.Enabled\(\)/);
  assert.match(middleware, /options\.TokenVerifier\.VerifyToken/);
	assert.match(middleware, /requireBrowserSession/);
	assert.match(middleware, /subtle\.ConstantTimeCompare/);
  assert.match(httpTests, /TestExternalTokenVerifierProtectsRoutesWithoutDemoLogin/);
  assert.match(httpTests, /StatusNotFound/);
  assert.match(httpTests, /TestExternalTokenVerifierFailureUsesPrivateBearerResponse/);
  assert.match(config, /DEMO_AUTH_ENABLED and OIDC_AUTH_ENABLED cannot both be true/);
  assert.match(config, /if cfg\.DemoAuthEnabled && len\(cfg\.JWTSecret\) < 32/);
  assert.match(config, /validateOIDCEndpoint\("OIDC_JWKS_URL"/);
	assert.match(config, /OIDC_BROWSER_ENABLED requires OIDC_AUTH_ENABLED=true/);
	assert.match(config, /validateOIDCRedirectURL/);
	assert.match(config, /production browser OIDC sessions require SHARED_STATE_MODE=external/);
	assert.match(config, /OIDC_BROWSER_MAX_SESSIONS must be between 1 and 10000/);
	assert.match(config, /OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT must be between 1 and OIDC_BROWSER_MAX_SESSIONS/);
	assert.match(config, /OIDC_REQUIRED_ACR/);
	assert.match(config, /OIDC_REQUIRED_AMR/);
	assert.match(config, /OIDC_MAX_AUTH_AGE/);
	assert.match(config, /OIDC assurance settings require OIDC_BROWSER_ENABLED=true/);
  assert.match(configTests, /TestLoadValidatesOIDCResourceServerConfiguration/);
	assert.match(configTests, /TestLoadValidatesOIDCBrowserAuthorizationConfiguration/);
  assert.match(configTests, /TestLoadDoesNotRequireInactiveDemoJWTSecret/);

  assert.match(entrypoint, /auth\.NewJWKSVerifier\(ctx, auth\.JWKSConfig/);
  assert.match(entrypoint, /authMode = "oidc"/);
  assert.match(entrypoint, /TokenVerifier:\s+tokenVerifier/);
	assert.match(entrypoint, /httpapi\.NewOIDCBrowserWithSessions\(oidcRequests, oidcClient, oidcVerifier, browserSessions\)/);
	assert.match(entrypoint, /authorizationRequestStore = externalState/);
	assert.match(entrypoint, /Store:\s+authorizationRequestStore/);
	assert.match(entrypoint, /ACRValues:\s+authorizationACRValues/);
	assert.match(entrypoint, /browserSessionStore = externalState/);
	assert.match(entrypoint, /MaxSessionsPerSubject:\s+cfg\.OIDCBrowserMaxSessionsPerSubject/);
	assert.match(entrypoint, /RequiredACR:\s+cfg\.OIDCRequiredACR/);
	assert.match(entrypoint, /RequiredAMR:\s+cfg\.OIDCRequiredAMR/);
	assert.match(entrypoint, /MaxAuthAge:\s+cfg\.OIDCMaxAuthAge/);
	assert.match(entrypoint, /OIDCBrowser:\s+oidcBrowser/);
  assert.match(entrypoint, /EndpointsForAuth\(tokenVerifier\.Enabled\(\), authService\.Enabled\(\)\)/);
  assert.match(entrypointTests, /TestRunFailsClosedWhenOIDCJWKSIsUnavailable/);
	assert.match(entrypointTests, /TestRunFailsClosedWhenOIDCBrowserDiscoveryIsUnavailable/);
  assert.match(entrypointTests, /TestRunServesAuthorizedProjectRouteWithOIDCJWKS/);
  assert.match(projectRoutes, /DefaultEndpointsForAuth\(authEnabled, demoLoginEnabled\)/);
	assert.match(exampleEnvironment, /OIDC_REQUIRED_ACR=/);
	assert.match(exampleEnvironment, /OIDC_REQUIRED_AMR=/);
	assert.match(exampleEnvironment, /OIDC_MAX_AUTH_AGE=0s/);
	assert.match(exampleEnvironment, /OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT=10/);
  assert.match(template, /"DEMO_AUTH_ENABLED": "false"/);
  assert.match(template, /"OIDC_AUTH_ENABLED": "true"/);
  assert.match(readme, /资源服务器基础/);
  assert.match(readme, /OIDC discovery\/token exchange/);
  assert.match(readme, /auth\.NewSessionManager/);
  assert.match(changelog, /Bounded RS256 JWKS verifier/);
  assert.match(changelog, /Bounded transport-neutral refresh session manager/);
  assert.match(evidenceManifest, /oidcProvider/);
  assertEvidenceInput('Framework/auth/oidc_client.go');
  assertEvidenceInput('Framework/auth/oidc_callback.go');
  assertEvidenceInput('Framework/httpapi/oidc_browser.go');
  assertEvidenceInput('Framework/auth/browser_session.go');
  assertEvidenceInput('Framework/sharedstate/browser_session_store.go');
});

test('server shared-state boundary keeps production fail-fast explicit', async () => {
  const [config, sharedState, redisState, redisTracing, redisTests, httpRedisTests, entrypoint, exampleEnvironment, middleware, fingerprint, response, appTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'shared_state.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_tracing.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'redis_shared_state_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'response.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  assert.match(config, /SHARED_STATE_MODE/);
  assert.match(config, /ALLOW_IN_MEMORY_SHARED_STATE/);
  assert.match(config, /REDIS_LOCK_TTL must be greater than HTTP_REQUEST_TIMEOUT/);
  assert.match(config, /REDIS_LOCK_WAIT_TIMEOUT must be less than HTTP_REQUEST_TIMEOUT/);
  assert.match(config, /environment == 'production'|environment == "production"/);
  assert.match(sharedState, /external shared state requires a shared storage implementation/);
  assert.match(sharedState, /external shared state requires an atomic rate limiter implementation/);
  assert.match(sharedState, /external shared state requires a distributed idempotency lock/);
  assert.match(sharedState, /goexample:/);
  assert.match(redisState, /redis\.NewScript/);
  assert.match(redisState, /redis\.call\("INCR"/);
  assert.match(redisState, /redis\.call\("GET", KEYS\[1\]\) == ARGV\[1\]/);
  assert.match(redisState, /SetNX/);
  assert.match(redisState, /ContextTimeoutEnabled = true/);
  assert.match(redisState, /Scan\(operationCtx/);
  assert.doesNotMatch(redisState, /FlushDB|FlushAll/);
  assert.match(redisState, /newRedisTracingHook\(config\.TracerProvider\)/);
  assert.match(redisTracing, /goexample\.redis\.result/);
  assert.match(redisTracing, /semconv\.DBOperationBatchSize/);
  assert.match(redisTracing, /redis operation failed/);
  assert.doesNotMatch(redisTracing, /DBStatement|RecordError|cmd\.String|FullName|server\.address|server\.port/);
  assert.match(redisTests, /TestRedisCreatesLowSensitivityClientSpans/);
  assert.match(redisTests, /TestRedisFailureSpanDoesNotExposeBackendError/);
  assert.match(redisTests, /TestRedisLockOwnerCannotDeleteReplacementLease/);
  assert.match(redisTests, /REDIS_TEST_URL/);
  assert.match(httpRedisTests, /TestRedisRateLimitIsAtomicAcrossApplications/);
  assert.match(httpRedisTests, /TestRedisIdempotencyIsCoordinatedAcrossApplications/);
  assert.match(entrypoint, /ValidateSharedState/);
  assert.match(entrypoint, /sharedstate\.NewRedis/);
  assert.match(entrypoint, /healthChecker\.Register\("redis", externalState\.Check\)/);
  assert.match(exampleEnvironment, /SHARED_STATE_MODE=memory/);
  assert.match(exampleEnvironment, /ALLOW_IN_MEMORY_SHARED_STATE=false/);
  assert.match(exampleEnvironment, /REDIS_URL=/);
  assert.match(middleware, /idempotencyRequestFingerprint/);
  assert.match(middleware, /sharedstate\.AtomicRateLimiter/);
  assert.match(fingerprint, /errIdempotencyFingerprintConflict/);
  assert.match(fingerprint, /sha256\.New\(\)/);
  assert.match(response, /fiber\.StatusConflict/);
  assert.match(appTests, /TestIdempotencyConcurrentFingerprintConflictExecutesOneRequest/);
});

test('Redis Sentinel contract stays ACL-separated, pinned, archived, and target-explicit', async () => {
  const [config, redisState, integrationTest, runner, evidenceHelper, evidenceCLI, evidenceTests, workflow, packageDocument, exampleEnvironment, readme, changelog, recoveryRunbook, evidenceManifest, evidenceVerify] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_sentinel_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'redis-sentinel-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'redis-sentinel-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'redis-sentinel-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'redis-sentinel-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;
  const pinnedImage = 'redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232';

  assert.match(redisState, /type RedisTopology string/);
  assert.match(redisState, /RedisTopologySentinel\s+RedisTopology = "sentinel"/);
  assert.match(redisState, /redis\.NewFailoverClient/);
  assert.match(redisState, /SentinelUsername:\s+config\.SentinelUsername/);
  assert.match(redisState, /TLSConfig:\s+tlsConfig/);
  assert.match(config, /production Redis Sentinel requires REDIS_TLS_ENABLED=true/);
  assert.match(config, /production Redis Sentinel requires REDIS_USERNAME and REDIS_PASSWORD/);
  assert.match(config, /production Redis Sentinel requires REDIS_SENTINEL_USERNAME and REDIS_SENTINEL_PASSWORD/);
  assert.match(integrationTest, /TestRedisSentinelFailoverReconnectsSharedStateClients/);
  assert.match(integrationTest, /sentinel\.Failover/);
  assert.match(integrationTest, /"WAIT", 1, 5000/);
  assert.match(integrationTest, /first\.Take/);
  assert.match(integrationTest, /second\.Lock/);
  for (const checkpoint of ['discovery', 'replication_before_failover', 'master_changed', 'clients_reconnected', 'rate_limit_atomic', 'lock_owner_safe']) {
    assert.match(integrationTest, new RegExp(`sentinel-checkpoint=${checkpoint}`));
  }
  assert.match(runner, /process\.platform !== 'linux'/);
  assert.match(runner, new RegExp(pinnedImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runner, /'--network', 'host'/);
  assert.match(runner, /'SENTINEL', 'CKQUORUM'/);
  assert.match(runner, /sentinel sentinel-user/);
  assert.match(runner, /sentinel sentinel-pass/);
  assert.match(runner, /tls_enabled=false/);
  assert.match(runner, /target_redis_ha=not_recorded/);
  assert.match(runner, /workflow-artifacts.*redis-sentinel-contract/s);
  assert.match(runner, /buildRedisSentinelEvidenceReport/);
  assert.match(runner, /buildRedisSentinelChecksums/);
  assert.match(evidenceHelper, /redisSentinelEvidenceSchemaVersion = 1/);
  assert.match(evidenceHelper, /passed evidence must contain all/);
  assert.match(evidenceHelper, /productionSharedStore remains not_recorded/);
  assert.match(evidenceHelper, /SHA256SUMS must contain the exact ordered Redis Sentinel evidence artifact set/);
  assert.match(evidenceCLI, /verifyRedisSentinelEvidence/);
  assert.match(evidenceTests, /accepts only ordered checkpoint prefixes and bounded errors/);
  assert.match(evidenceTests, /rejects scope, status, log, semantic, and checksum tampering/);
  assert.equal(scripts['redis:sentinel:contract'], 'node scripts/redis-sentinel-contract.mjs');
  assert.equal(scripts['redis:sentinel:contract:verify'], 'node scripts/redis-sentinel-evidence.mjs');
  assert.match(scripts['test:node'], /redis-sentinel-evidence\.test\.mjs/);
  assert.match(workflow, /redis-sentinel-contract:/);
  assert.match(workflow, /run: yarn redis:sentinel:contract/);
  assert.match(workflow, /name: Verify Redis Sentinel contract evidence\s+if: always\(\)\s+run: yarn redis:sentinel:contract:verify/);
  assert.match(workflow, /name: redis-sentinel-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/redis-sentinel-contract/);
  assert.match(workflow, /name: Upload Redis Sentinel contract evidence\s+if: always\(\)/);
  assert.match(exampleEnvironment, /REDIS_TOPOLOGY=standalone/);
  assert.match(exampleEnvironment, /REDIS_SENTINEL_ADDRESSES=/);
  assert.match(readme, /`sentinel` 拓扑/);
  assert.match(changelog, /Redis Sentinel/);
  assert.match(recoveryRunbook, /redis:sentinel:contract:verify/);
  assert.match(recoveryRunbook, /report\.json/);
  assert.match(evidenceManifest, /verifyRedisSentinelEvidence/);
  assert.match(evidenceVerify, /Redis Sentinel evidence artifact is missing from the manifest/);
  assert.match(evidenceManifest, /productionSharedStore:\s*\{\s*status: 'not_recorded'/s);
  assert.match(evidenceManifest, /local non-TLS Sentinel ACL\/failover CI contract/);
});

test('Nginx edge baseline stays pinned, bounded, archived, and target-explicit', async () => {
  const [contractDocument, renderer, realRunner, evidenceHelper, evidenceCLI, edgeTests, evidenceTests, workflow, packageDocument, readme, evidenceManifest, evidenceVerify] = await Promise.all([
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'goexample-nginx.contract.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nginx-edge.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nginx-edge-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'lib', 'nginx-edge-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nginx-edge-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nginx-edge.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nginx-edge-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const contract = JSON.parse(contractDocument);
  const scripts = JSON.parse(packageDocument).scripts;
  const pinnedImage = 'nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';

  assert.equal(contract.implementation.image, pinnedImage);
  assert.deepEqual(contract.listener.protocols, ['http/1.1', 'h2']);
  assert.deepEqual(contract.listener.tls, {
    minimumVersion: 'TLSv1.2',
    maximumVersion: 'TLSv1.3',
    certificatePath: '/run/secrets/goexample-edge/tls.crt',
    privateKeyPath: '/run/secrets/goexample-edge/tls.key',
  });
  assert.equal(contract.limits.largeHeaderBufferCount, 4);
  assert.equal(contract.limits.largeHeaderBufferBytes, 16 * 1024);
  assert.equal(contract.limits.clientMaxBodyBytes, 4 * 1024 * 1024);
  assert.equal(contract.behavior.proxyRequestBuffering, false);
  assert.equal(contract.behavior.proxyResponseBuffering, false);
  assert.equal(contract.behavior.proxyRetry, false);
  assert.deepEqual(contract.behavior.edgeStatusCodes, [431, 502, 504]);
  assert.deepEqual(contract.behavior.passThroughStatusCodes, [503]);
  assert.deepEqual(contract.lifecycle, {
    workerShutdownSeconds: 25,
    containerStopSeconds: 30,
    stopSignal: 'SIGQUIT',
  });

  assert.match(renderer, /ssl_protocols \$\{listener\.tls\.minimumVersion\} \$\{listener\.tls\.maximumVersion\}/);
  assert.match(renderer, /http2 on/);
  assert.match(renderer, /large_client_header_buffers/);
  assert.match(renderer, /client_max_body_size/);
  assert.match(renderer, /proxy_request_buffering off/);
  assert.match(renderer, /proxy_buffering off/);
  assert.match(renderer, /proxy_next_upstream off/);
  assert.match(renderer, /worker_shutdown_timeout/);
  assert.match(renderer, /error_page 494 = @header_too_large/);

  assert.match(realRunner, /process\.platform !== 'linux'/);
  assert.match(realRunner, /createContractCommandRunner/);
  assert.match(realRunner, /contractCommandMaximumOutputBytes/);
  assert.match(realRunner, /edgeImagePullTimeoutMs = 120_000/);
  assert.match(realRunner, /edgeCleanupTimeoutMs = 30_000/);
  assert.doesNotMatch(realRunner, /node:child_process/);
  assert.doesNotMatch(realRunner, /\bspawn\s*\(/);
  assert.match(realRunner, /docker.*nginx.*-t/s);
  assert.match(realRunner, /assert\.equal\(trace\.alpnProtocol, 'h2'\)/);
  assert.match(realRunner, /assert\.equal\(oversizedHeaders\.status, 431\)/);
  assert.match(realRunner, /assert\.equal\(broken\.status, 502\)/);
  assert.match(realRunner, /assert\.equal\(unavailable\.status, 503\)/);
  assert.match(realRunner, /assert\.equal\(timedOut\.status, 504\)/);
  assert.match(realRunner, /upload_interruption_propagated/);
  assert.match(realRunner, /sigquit_drain/);
  assert.match(realRunner, /localContractOnly: true/);
  assert.match(realRunner, /workflow-artifacts.*nginx-edge-contract/s);
  assert.match(realRunner, /buildNginxEdgeEvidenceReport/);
  assert.match(realRunner, /buildNginxEdgeChecksums/);

  assert.match(evidenceHelper, /nginxEdgeEvidenceSchemaVersion = 1/);
  for (const scenario of ['tls_http2_trace', 'header_limit', 'upstream_503_passthrough', 'upstream_502', 'upstream_504', 'upload_interruption_propagated', 'sigquit_drain']) {
    assert.match(evidenceHelper, new RegExp(scenario));
  }
  assert.match(evidenceHelper, /passed evidence must contain all/);
  assert.match(evidenceHelper, /targetEdge remains not_recorded/);
  assert.match(evidenceHelper, /SHA256SUMS must contain the exact ordered Nginx evidence artifact set/);
  assert.match(evidenceCLI, /verifyNginxEdgeEvidence/);

  assert.match(edgeTests, /Nginx edge contract renders bounded TLS HTTP\/2 proxy configuration/);
  assert.match(edgeTests, /rejects unsafe destinations and weakened contracts/);
  assert.match(evidenceTests, /accepts only an ordered scenario prefix and bounded error/);
  assert.match(evidenceTests, /rejects scope, status, hash, checksum, and semantic tampering/);
  assert.equal(scripts['edge:check'], 'node scripts/nginx-edge.mjs check');
  assert.equal(scripts['edge:contract'], 'node scripts/nginx-edge-contract.mjs');
  assert.equal(scripts['edge:contract:verify'], 'node scripts/nginx-edge-evidence.mjs');
  assert.match(scripts['test:node'], /nginx-edge-evidence\.test\.mjs/);
  assert.match(workflow, /nginx-edge-contract:/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /run: yarn edge:contract/);
  assert.match(workflow, /name: Verify Nginx edge contract evidence\s+if: always\(\)\s+run: yarn edge:contract:verify/);
  assert.match(workflow, /name: nginx-edge-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/nginx-edge-contract/);
  assert.match(workflow, /name: Upload Nginx edge contract evidence\s+if: always\(\)/);
  assert.match(readme, /localContractOnly/);
  assert.match(readme, /edge:contract:verify/);
  assert.match(readme, /report\.json/);
  assert.match(readme, /HTTP\/3 is not enabled or claimed/);
  assert.match(readme, /targetEdge=not_recorded/);
  assert.match(evidenceManifest, /verifyNginxEdgeEvidence/);
  assert.match(evidenceVerify, /Nginx edge evidence artifact is missing from the manifest/);
  assert.match(evidenceManifest, /targetEdge:\s*\{\s*status: 'not_recorded'/s);
  assert.match(evidenceManifest, /no target edge, real certificate\/DNS, HTTP\/3, or target lifecycle artifact/);
});

test('V13 evidence index keeps production boundaries strict and complete', async () => {
  const [script, tests, packageDocument, backlog, nextBacklog] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'v13-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'v13-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V13.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V14.md'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;
  for (const id of ['V13-01', 'V13-02', 'V13-03', 'V13-04', 'V13-05', 'V13-06', 'V13-07', 'V13-08', 'V13-09']) {
    assert.match(script, new RegExp(`\\['${id}',`));
  }
  assert.match(script, /statusValues = new Set\(\['not_recorded', 'recorded', 'failed'\]\)/);
  assert.match(script, /requires a non-local targetEnvironment/);
  assert.match(script, /requires an immutable digest or Git commit/);
  assert.match(script, /requires an https runUrl/);
  assert.match(script, /requires a complete fingerprint/);
  assert.match(script, /recorded requires provenance/);
  assert.match(script, /execution metadata/);
  assert.match(script, /sourceCommit/);
  assert.match(script, /packageRequirements/);
  assert.match(script, /function requireExactKeys\(value, name, keys\)/);
  assert.match(script, /must contain exactly these keys/);
  assert.match(script, /notRecordedReason = 'No immutable target-environment run and archived artifact has been recorded\.'/);
  assert.match(script, /not_recorded reason must preserve the fixed boundary/);
  assert.match(script, /verifiedAt must not precede execution\.finishedAt/);
  assert.match(script, /finishedAt must not be after document\.generatedAt/);
  assert.match(script, /verifiedAt must not be after document\.generatedAt/);
  assert.match(script, /approvedAt must not be after document\.generatedAt/);
  assert.match(script, /must follow the fixed V13 package order/);
  assert.match(script, /must follow the fixed requirement order/);
  assert.match(script, /verifyCompletion\(value, name, outputPaths, requirement/);
  assert.match(script, /requires completion coverage/);
  assert.match(script, /requires an approved RPO\/RTO/);
  assert.match(script, /hashFile\(filePath\) !== item\.sha256/);
  assert.match(script, /value\.startsWith\('\.temp\/'\)/);
  assert.match(tests, /exactKeyCases/);
  assert.match(tests, /rejects forged recorded state and unsafe artifact paths/);
  assert.equal(scripts['evidence:v13'], 'node scripts/v13-evidence.mjs');
  assert.equal(scripts['evidence:v13:verify'], 'node scripts/v13-evidence.mjs --verify');
  assert.match(backlog, /9 个工作包仍保持 `not_recorded`/);
  assert.match(backlog, /状态：\*\*已完结\*\*/);
  for (const id of ['V14-07', 'V14-08', 'V14-09', 'V14-10', 'V14-11', 'V14-12', 'V14-13', 'V14-14', 'V14-15']) {
    assert.match(nextBacklog, new RegExp(id));
  }
  assert.match(nextBacklog, /均未取得满足严格 verifier 的完整目标环境证据/);
});
