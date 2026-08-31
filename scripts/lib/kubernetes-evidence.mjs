import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderManifest } from '../kubernetes-manifest.mjs';

export const kubernetesEvidenceSchemaVersion = 15;
export const kubernetesValidationFixture = Object.freeze({
  namespace: 'goexample-validation',
  image: `ghcr.io/zbxing/goexample-api@sha256:${'0'.repeat(64)}`,
  allowedOrigin: 'https://console.validation.invalid',
  oidcIssuer: 'https://identity.validation.invalid/tenant',
  oidcAudience: 'goexample-api',
  oidcJWKSURL: 'https://identity.validation.invalid/tenant/jwks',
  secretRevision: 'validation-secret-revision-00000001',
});

const limitations = Object.freeze([
  'the deterministic fixture namespace, image, origin, and identity provider are not target deployment inputs or credentials',
  'an explicit non-system namespace does not prove namespace creation, labels, quotas, RBAC, admission policy, or isolation',
  'the fixed non-secret revision does not prove target Secret contents, provider version, or rotation',
  'exact eight-resource identity validation rejects unreviewed repository resources but does not prove the target cluster applied the same inventory or excluded overlays',
  'exact workload label maps and complete selector objects reject extra matchLabels and matchExpressions but do not prove target overlays preserve selectors or target controllers select the intended Pods',
  'exact Pod and container security-context objects reject extra sysctls, identity overrides, and capability re-additions but do not prove target Pod Security admission or runtime enforcement',
  'the exact PodSpec object rejects init containers, volumes, DNS or scheduler drift, registry credentials, and other unreviewed Pod fields but does not prove target API defaulting, admission mutation, scheduling, or runtime enforcement',
  'the exact PodTemplateSpec object rejects unreviewed annotations, finalizers, owner references, and other Pod-template metadata but does not prove target admission preserves the rendered template',
  'exact container-port and Service-spec objects reject extra ports, protocol drift, external IP exposure, and unreviewed Service fields but do not prove target API defaults, EndpointSlice selection, or network reachability',
  'exact ConfigMap key, fixed-value, dynamic-input, and environment-source validation does not prove target ConfigMap or Secret existence, target dynamic values, Secret key inventory, access isolation, rotation, or successful Pod consumption',
  'repository rendering and semantic validation do not prove Kubernetes API admission, rollout, autoscaling, disruption, network policy enforcement, or rollback',
  'kubernetesDrill remains not_recorded until signed target-cluster evidence is archived and independently verified',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(message) {
  throw new Error(`Kubernetes evidence: ${message}`);
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function requireExactKeys(value, expectedKeys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject(`${name} must be an object`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    reject(`${name} keys must be exactly ${sortedExpectedKeys.join(', ')}`);
  }
  return value;
}

function describeFile(filePath, root) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    reject(`${relativePath(root, filePath)} must be a regular file and not a symbolic link`);
  }
  return {
    path: relativePath(root, filePath),
    bytes: stats.size,
    sha256: hashFile(filePath),
  };
}

function resolveEvidenceFile(evidenceRoot, value, name) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    reject(`${name} contains an unsafe path`);
  }
  const resolved = path.resolve(evidenceRoot, ...value.split('/'));
  const relative = path.relative(evidenceRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    reject(`${name} must stay inside the Kubernetes evidence directory`);
  }
  return resolved;
}

function verifyFileRecord(record, evidenceRoot, name, maximumBytes) {
  const value = requireExactKeys(record, ['bytes', 'path', 'sha256'], name);
  const filePath = resolveEvidenceFile(evidenceRoot, value.path, `${name}.path`);
  if (!existsSync(filePath)) {
    reject(`${name} is missing: ${value.path}`);
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    reject(`${name} must resolve to a regular file and not a symbolic link`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > maximumBytes) {
    reject(`${name}.bytes must be between 0 and ${maximumBytes}`);
  }
  if (stats.size !== value.bytes) {
    reject(`${name} size mismatch`);
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    reject(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (hashFile(filePath) !== value.sha256) {
    reject(`${name} hash mismatch`);
  }
  return filePath;
}

function requireTimestamp(value, name) {
  if (
    typeof value !== 'string' ||
    !canonicalTimestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    reject(`${name} must be a canonical UTC timestamp`);
  }
}

function collectScope(repositoryRoot) {
  return {
    runbook: describeFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'README.md'), repositoryRoot),
    template: describeFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json'), repositoryRoot),
    renderer: describeFile(path.join(repositoryRoot, 'scripts', 'kubernetes-manifest.mjs'), repositoryRoot),
  };
}

function expectedCommands(repositoryRoot, renderedManifestPath) {
  const outputPath = relativePath(repositoryRoot, renderedManifestPath);
  return {
    check: ['node', 'scripts/kubernetes-manifest.mjs', 'check'],
    render: [
      'node',
      'scripts/kubernetes-manifest.mjs',
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
      outputPath,
    ],
  };
}

export function buildKubernetesEvidenceReport({
  repositoryRoot,
  evidenceRoot,
  renderedManifestPath,
  nodeVersion,
  platform,
  startedAt,
  endedAt,
  checkExitCode,
  renderExitCode,
  checkOutputPath,
  renderOutputPath,
}) {
  return {
    schemaVersion: kubernetesEvidenceSchemaVersion,
    status: checkExitCode === 0 && renderExitCode === 0 ? 'passed' : 'failed',
    runtime: { nodeVersion, platform },
    scope: collectScope(repositoryRoot),
    fixture: { ...kubernetesValidationFixture },
    commands: expectedCommands(repositoryRoot, renderedManifestPath),
    execution: { startedAt, endedAt, checkExitCode, renderExitCode },
    outputs: {
      check: describeFile(checkOutputPath, evidenceRoot),
      render: describeFile(renderOutputPath, evidenceRoot),
      manifest: existsSync(renderedManifestPath) ? describeFile(renderedManifestPath, evidenceRoot) : null,
    },
    limitations: [...limitations],
  };
}

export function verifyKubernetesEvidence({ repositoryRoot, evidenceRoot }) {
  const reportPath = path.join(evidenceRoot, 'report.json');
  if (!existsSync(reportPath)) {
    reject('report.json is missing');
  }
  const reportStats = lstatSync(reportPath);
  if (!reportStats.isFile() || reportStats.isSymbolicLink() || reportStats.size > 256 * 1024) {
    reject('report.json must be a regular file no larger than 256 KiB');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    reject('report.json must contain valid JSON');
  }
  const report = requireExactKeys(
    parsed,
    ['commands', 'execution', 'fixture', 'limitations', 'outputs', 'runtime', 'schemaVersion', 'scope', 'status'],
    'report',
  );
  if (report.schemaVersion !== kubernetesEvidenceSchemaVersion || report.status !== 'passed') {
    reject(`report must be a passed schemaVersion ${kubernetesEvidenceSchemaVersion} document`);
  }

  const runtime = requireExactKeys(report.runtime, ['nodeVersion', 'platform'], 'runtime');
  const nodeMatch = `${runtime.nodeVersion ?? ''}`.match(/^v(\d+)\.\d+\.\d+$/);
  if (!nodeMatch || Number(nodeMatch[1]) < 20) {
    reject('runtime.nodeVersion must identify a supported Node.js release');
  }
  if (typeof runtime.platform !== 'string' || !/^[a-z0-9]+\/[a-z0-9]+$/.test(runtime.platform)) {
    reject('runtime.platform must be a platform/architecture pair');
  }

  const scope = requireExactKeys(report.scope, ['renderer', 'runbook', 'template'], 'scope');
  if (JSON.stringify(scope) !== JSON.stringify(collectScope(repositoryRoot))) {
    reject('scope no longer matches the Kubernetes renderer, template, and runbook');
  }
  if (JSON.stringify(report.fixture) !== JSON.stringify(kubernetesValidationFixture)) {
    reject('fixture must match the fixed non-production Kubernetes validation inputs');
  }

  const execution = requireExactKeys(
    report.execution,
    ['checkExitCode', 'endedAt', 'renderExitCode', 'startedAt'],
    'execution',
  );
  requireTimestamp(execution.startedAt, 'execution.startedAt');
  requireTimestamp(execution.endedAt, 'execution.endedAt');
  const duration = Date.parse(execution.endedAt) - Date.parse(execution.startedAt);
  if (duration < 0 || duration > 5 * 60 * 1000) {
    reject('execution timestamps must describe a non-negative run no longer than five minutes');
  }
  for (const name of ['checkExitCode', 'renderExitCode']) {
    if (execution[name] !== 0) {
      reject(`execution.${name} must be zero for verified evidence`);
    }
  }

  const outputs = requireExactKeys(report.outputs, ['check', 'manifest', 'render'], 'outputs');
  if (outputs.manifest === null) {
    reject('outputs.manifest is required for passed evidence');
  }
  const checkOutputPath = verifyFileRecord(outputs.check, evidenceRoot, 'outputs.check', 512 * 1024);
  const renderOutputPath = verifyFileRecord(outputs.render, evidenceRoot, 'outputs.render', 512 * 1024);
  const renderedManifestPath = verifyFileRecord(outputs.manifest, evidenceRoot, 'outputs.manifest', 2 * 1024 * 1024);
  if (path.basename(renderedManifestPath) !== 'goexample-api.json') {
    reject('outputs.manifest must be named goexample-api.json');
  }
  if (JSON.stringify(report.commands) !== JSON.stringify(expectedCommands(repositoryRoot, renderedManifestPath))) {
    reject('commands must match the fixed Kubernetes check and render invocations');
  }
  if (!readFileSync(checkOutputPath, 'utf8').includes('Kubernetes template passed:')) {
    reject('check output does not contain the successful template result');
  }
  if (!readFileSync(renderOutputPath, 'utf8').includes('Kubernetes manifest written to')) {
    reject('render output does not contain the successful manifest result');
  }

  let template;
  let rendered;
  try {
    template = JSON.parse(readFileSync(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json'), 'utf8'));
    rendered = JSON.parse(readFileSync(renderedManifestPath, 'utf8'));
  } catch {
    reject('template and rendered manifest must contain valid JSON');
  }
  const expectedRendered = renderManifest(template, kubernetesValidationFixture);
  const expectedBytes = `${JSON.stringify(expectedRendered, null, 2)}\n`;
  if (readFileSync(renderedManifestPath, 'utf8') !== expectedBytes || JSON.stringify(rendered) !== JSON.stringify(expectedRendered)) {
    reject('rendered manifest does not exactly match the deterministic validated fixture');
  }
  if (JSON.stringify(report.limitations) !== JSON.stringify(limitations)) {
    reject('limitations must preserve the repository-only Kubernetes evidence boundary');
  }

  return {
    report,
    artifactPaths: [reportPath, checkOutputPath, renderOutputPath, renderedManifestPath]
      .map((filePath) => relativePath(repositoryRoot, filePath))
      .sort(),
  };
}
