import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const defaultIndex = path.join(tempRoot, 'evidence', 'v13.json');
const statusValues = new Set(['not_recorded', 'recorded', 'failed']);
const notRecordedReason = 'No immutable target-environment run and archived artifact has been recorded.';
const packageScopes = new Map([
  ['V13-01', 'target edge and protocol evidence'],
  ['V13-02', 'target Redis HA and recovery evidence'],
  ['V13-03', 'production identity and policy evidence'],
  ['V13-04', 'production audit closure evidence'],
  ['V13-05', 'target database and messaging evidence'],
  ['V13-06', 'remote performance and capacity evidence'],
  ['V13-07', 'orchestration and signed release evidence'],
  ['V13-08', 'second consumer and SDK migration evidence'],
  ['V13-09', 'target soak, fault, and RPO/RTO evidence'],
]);
const packageIds = [...packageScopes.keys()];
const packageRequirements = new Map([
  ['V13-01', { criteria: ['target-edge-certificate-dns', 'tls-http2-http3', 'proxy-lifecycle-failure-trace'], requiresRPOApproval: false }],
  ['V13-02', { criteria: ['redis-ha-topology-security', 'failover-resilience-and-alerts', 'backup-recovery-rpo-rto'], requiresRPOApproval: true }],
  ['V13-03', { criteria: ['idp-mfa-session-key-governance', 'policy-source-distribution-recovery'], requiresRPOApproval: false }],
  ['V13-04', { criteria: ['durable-audit-security-retention', 'siem-paging-owner-response-drill'], requiresRPOApproval: false }],
  ['V13-05', { criteria: ['versioned-api-data-and-queue', 'target-fault-and-recovery', 'delivery-semantics-boundary'], requiresRPOApproval: false }],
  ['V13-06', { criteria: ['remote-runner-baseline', 'target-workload-capacity-soak', 'transport-decision'], requiresRPOApproval: false }],
  ['V13-07', { criteria: ['attestation-image-registry-provenance', 'target-cluster-rollout-resilience-rollback'], requiresRPOApproval: false }],
  ['V13-08', { criteria: ['formal-sdk-release', 'external-consumer-version-matrix', 'target-deployment-migration', 'second-framework-service'], requiresRPOApproval: false }],
  ['V13-09', { criteria: ['target-soak-fault-injection', 'alert-and-operator-response', 'signed-artifacts-rpo-rto-approval'], requiresRPOApproval: true }],
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const immutableVersionPattern = /^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) {
  console.error(`V13 evidence: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', shell: false, windowsHide: true });
  return result.status === 0 ? `${result.stdout ?? ''}`.trim() || 'unknown' : 'unknown';
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const positional = args.filter((arg) => arg !== '--verify');
  if (positional.length > 1 || positional.some((arg) => arg.startsWith('--'))) {
    fail('usage: [--verify] [path]');
  }
  return { verify, file: path.resolve(repositoryRoot, positional[0] ?? path.relative(repositoryRoot, defaultIndex)) };
}

function ensureIndexPath(filePath) {
  const relative = path.relative(tempRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !relative.toLowerCase().endsWith('.json')) {
    fail('index must be a .json file inside the repository .temp directory');
  }
}

function skeleton() {
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    repository: { gitCommit: run('git', ['rev-parse', 'HEAD']) },
    workPackages: [...packageScopes].map(([id, scope]) => ({
      id,
      scope,
      status: 'not_recorded',
      targetEnvironment: null,
      immutableVersion: null,
      runUrl: null,
      sourceCommit: null,
      fingerprint: { runner: null, toolchain: null, environment: null },
      execution: null,
      provenance: null,
      completion: null,
      outputs: [],
      reason: 'No immutable target-environment run and archived artifact has been recorded.',
    })),
  };
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function requireExactKeys(value, name, keys) {
  const object = requireObject(value, name);
  const expected = [...keys].sort();
  const actual = Object.keys(object).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${name} must contain exactly these keys: ${expected.join(', ')}`);
  }
  return object;
}

function requireString(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string${nullable ? ' or null' : ''}`);
}

function requireCommit(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requireString(value, name);
  if (!commitPattern.test(value)) fail(`${name} must be a full lowercase Git commit SHA`);
}

function requireTimestamp(value, name) {
  requireString(value, name);
  if (!timestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${name} must be an RFC 3339 UTC timestamp`);
  }
  return Date.parse(value);
}

function requireHTTPSURL(value, name) {
  requireString(value, name);
  let parsed;
  try { parsed = new URL(value); } catch { fail(`${name} must be an absolute HTTPS URL`); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    fail(`${name} must be an absolute HTTPS URL without credentials or fragment`);
  }
}

function resolveArtifact(value, name) {
  requireString(value, name);
  if (value.includes('\\') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.normalize(value) !== value || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail(`${name} contains an unsafe path`);
  }
  if (!value.startsWith('.temp/')) fail(`${name} must be inside .temp`);
  const resolved = path.resolve(repositoryRoot, ...value.split('/'));
  const relative = path.relative(tempRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`${name} escapes .temp`);
  return resolved;
}

function verifyOutput(output, name) {
  const item = requireExactKeys(output, name, ['path', 'bytes', 'sha256']);
  const filePath = resolveArtifact(item.path, `${name}.path`);
  if (!existsSync(filePath)) fail(`${name} is missing: ${item.path}`);
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${name} must be a regular file: ${item.path}`);
  if (!Number.isSafeInteger(item.bytes) || item.bytes < 1) fail(`${name}.bytes must be a positive safe integer`);
  if (stats.size !== item.bytes) fail(`${name} size mismatch: ${item.path}`);
  if (typeof item.sha256 !== 'string' || !sha256Pattern.test(item.sha256)) fail(`${name}.sha256 must be a lowercase SHA-256 digest`);
  if (hashFile(filePath) !== item.sha256) fail(`${name} hash mismatch: ${item.path}`);
}

function verifyExecution(value, name, documentGeneratedAt = null) {
  const execution = requireExactKeys(value, name, ['command', 'startedAt', 'finishedAt', 'exitCode', 'rawOutputPath']);
  requireString(execution.command, `${name}.command`);
  const startedAt = requireTimestamp(execution.startedAt, `${name}.startedAt`);
  const finishedAt = requireTimestamp(execution.finishedAt, `${name}.finishedAt`);
  if (finishedAt < startedAt) fail(`${name}.finishedAt must not precede startedAt`);
  if (documentGeneratedAt !== null && startedAt > documentGeneratedAt) fail(`${name}.startedAt must not be after document.generatedAt`);
  if (documentGeneratedAt !== null && finishedAt > documentGeneratedAt) fail(`${name}.finishedAt must not be after document.generatedAt`);
  if (!Number.isSafeInteger(execution.exitCode) || execution.exitCode < 0 || execution.exitCode > 255) {
    fail(`${name}.exitCode must be an integer from 0 through 255`);
  }
  requireString(execution.rawOutputPath, `${name}.rawOutputPath`);
  return execution;
}

function verifyProvenance(value, name, outputPaths, executionFinishedAt = null, documentGeneratedAt = null) {
  const provenance = requireExactKeys(value, name, ['kind', 'reference', 'verificationCommand', 'verifiedAt', 'verificationOutputPath']);
  if (!['signature', 'platform'].includes(provenance.kind)) fail(`${name}.kind must be signature or platform`);
  requireHTTPSURL(provenance.reference, `${name}.reference`);
  requireString(provenance.verificationCommand, `${name}.verificationCommand`);
  const verifiedAt = requireTimestamp(provenance.verifiedAt, `${name}.verifiedAt`);
  if (executionFinishedAt !== null && verifiedAt < executionFinishedAt) {
    fail(`${name}.verifiedAt must not precede execution.finishedAt`);
  }
  if (documentGeneratedAt !== null && verifiedAt > documentGeneratedAt) fail(`${name}.verifiedAt must not be after document.generatedAt`);
  requireString(provenance.verificationOutputPath, `${name}.verificationOutputPath`);
  if (!outputPaths.has(provenance.verificationOutputPath)) {
    fail(`${name}.verificationOutputPath must reference an archived output`);
  }
}

function verifyRPOApproval(value, name, outputPaths, documentGeneratedAt = null) {
  const approval = requireExactKeys(value, name, ['approver', 'decision', 'approvedAt', 'rpoMinutes', 'rtoMinutes', 'outputPath']);
  requireString(approval.approver, `${name}.approver`);
  if (approval.decision !== 'approved') fail(`${name}.decision must be approved`);
  const approvedAt = requireTimestamp(approval.approvedAt, `${name}.approvedAt`);
  if (documentGeneratedAt !== null && approvedAt > documentGeneratedAt) {
    fail(`${name}.approvedAt must not be after document.generatedAt`);
  }
  for (const field of ['rpoMinutes', 'rtoMinutes']) {
    if (!Number.isSafeInteger(approval[field]) || approval[field] < 1) {
      fail(`${name}.${field} must be a positive safe integer`);
    }
  }
  requireString(approval.outputPath, `${name}.outputPath`);
  if (!outputPaths.has(approval.outputPath)) fail(`${name}.outputPath must reference an archived output`);
}

function verifyCompletion(value, name, outputPaths, requirement, { complete, documentGeneratedAt = null }) {
  const completion = requireExactKeys(value, name, ['criteria', 'rpoApproval']);
  if (!Array.isArray(completion.criteria) || completion.criteria.length === 0) {
    fail(`${name}.criteria must contain at least one criterion`);
  }
  const expected = new Set(requirement.criteria);
  const seen = new Set();
  let previousCriterionIndex = -1;
  for (const [index, raw] of completion.criteria.entries()) {
    const criterion = requireExactKeys(raw, `${name}.criteria[${index}]`, ['id', 'outputPath', 'summary']);
    requireString(criterion.id, `${name}.criteria[${index}].id`);
    if (!expected.has(criterion.id) || seen.has(criterion.id)) {
      fail(`${name}.criteria[${index}].id is not a unique requirement for this work package`);
    }
    const criterionIndex = requirement.criteria.indexOf(criterion.id);
    if (criterionIndex <= previousCriterionIndex) {
      fail(`${name}.criteria[${index}].id must follow the fixed requirement order`);
    }
    previousCriterionIndex = criterionIndex;
    seen.add(criterion.id);
    requireString(criterion.outputPath, `${name}.criteria[${index}].outputPath`);
    if (!outputPaths.has(criterion.outputPath)) {
      fail(`${name}.criteria[${index}].outputPath must reference an archived output`);
    }
    requireString(criterion.summary, `${name}.criteria[${index}].summary`);
  }
  if (complete && seen.size !== expected.size) fail(`${name} must cover every required criterion`);
  if (completion.rpoApproval !== null && (typeof completion.rpoApproval !== 'object' || Array.isArray(completion.rpoApproval))) {
    fail(`${name}.rpoApproval must be an object or null`);
  }
  if (complete && requirement.requiresRPOApproval && completion.rpoApproval === null) {
    fail(`${name} requires an approved RPO/RTO`);
  }
  if (!requirement.requiresRPOApproval && completion.rpoApproval !== null) {
    fail(`${name}.rpoApproval is only valid for a work package with RPO/RTO approval`);
  }
  if (completion.rpoApproval !== null) verifyRPOApproval(completion.rpoApproval, `${name}.rpoApproval`, outputPaths, documentGeneratedAt);
}

function verifyDocument(document) {
  requireExactKeys(document, 'document', ['schemaVersion', 'generatedAt', 'repository', 'workPackages']);
  if (document.schemaVersion !== 3) fail('schemaVersion must be 3');
  const documentGeneratedAt = requireTimestamp(document.generatedAt, 'generatedAt');
  const repository = requireExactKeys(document.repository, 'repository', ['gitCommit']);
  requireCommit(repository.gitCommit, 'repository.gitCommit');
  if (!Array.isArray(document.workPackages) || document.workPackages.length !== packageScopes.size) fail('workPackages must contain exactly V13-01 through V13-09');
  const seen = new Set();
  const artifactOwners = new Map();
  for (const [index, raw] of document.workPackages.entries()) {
    const item = requireExactKeys(raw, `workPackages[${index}]`, [
      'id', 'scope', 'status', 'targetEnvironment', 'immutableVersion', 'runUrl', 'sourceCommit',
      'fingerprint', 'execution', 'provenance', 'completion', 'outputs', 'reason',
    ]);
    const id = item.id;
    if (!packageScopes.has(id) || seen.has(id)) fail(`workPackages[${index}].id is not a unique V13 package`);
    if (id !== packageIds[index]) fail(`workPackages[${index}].id must follow the fixed V13 package order`);
    seen.add(id);
    const requirement = packageRequirements.get(id);
    if (!requirement) fail(`${id} has no fixed completion requirements`);
    if (item.scope !== packageScopes.get(id)) fail(`${id}.scope does not match the fixed V13 scope`);
    if (!statusValues.has(item.status)) fail(`${id}.status must be recorded, failed, or not_recorded`);
    requireString(item.reason, `${id}.reason`);
    requireString(item.targetEnvironment, `${id}.targetEnvironment`, { nullable: true });
    requireString(item.immutableVersion, `${id}.immutableVersion`, { nullable: true });
    requireString(item.runUrl, `${id}.runUrl`, { nullable: true });
    requireCommit(item.sourceCommit, `${id}.sourceCommit`, { nullable: true });
    const fingerprint = requireExactKeys(item.fingerprint, `${id}.fingerprint`, ['runner', 'toolchain', 'environment']);
    for (const field of ['runner', 'toolchain', 'environment']) requireString(fingerprint[field], `${id}.fingerprint.${field}`, { nullable: true });
    if (item.execution !== null && (typeof item.execution !== 'object' || Array.isArray(item.execution))) fail(`${id}.execution must be an object or null`);
    if (item.provenance !== null && (typeof item.provenance !== 'object' || Array.isArray(item.provenance))) fail(`${id}.provenance must be an object or null`);
    if (item.completion !== null && (typeof item.completion !== 'object' || Array.isArray(item.completion))) fail(`${id}.completion must be an object or null`);
    if (!Array.isArray(item.outputs)) fail(`${id}.outputs must be an array`);
    const outputPaths = new Set();
    for (const [outputIndex, output] of item.outputs.entries()) {
      const outputName = `${id}.outputs[${outputIndex}]`;
      verifyOutput(output, outputName);
      if (outputPaths.has(output.path)) fail(`${id}.outputs contains a duplicate path`);
      const previousOwner = artifactOwners.get(output.path);
      if (previousOwner) {
        fail(`${id}.outputs path is already used by ${previousOwner}; work-package artifacts must be independent`);
      }
      artifactOwners.set(output.path, id);
      outputPaths.add(output.path);
    }
    if (item.status === 'not_recorded') {
      if (item.reason !== notRecordedReason) fail(`${id} not_recorded reason must preserve the fixed boundary`);
      if (item.targetEnvironment !== null || item.immutableVersion !== null || item.runUrl !== null || item.sourceCommit !== null || Object.values(fingerprint).some((value) => value !== null) || item.execution !== null || item.provenance !== null || item.completion !== null || item.outputs.length !== 0) {
        fail(`${id} not_recorded must not claim target-run evidence`);
      }
      continue;
    }
    if (item.targetEnvironment === null || /^local(?:$|[-_])/i.test(item.targetEnvironment)) fail(`${id} ${item.status} requires a non-local targetEnvironment`);
    if (item.immutableVersion === null || !immutableVersionPattern.test(item.immutableVersion)) fail(`${id} ${item.status} requires an immutable digest or Git commit`);
    if (item.runUrl === null) fail(`${id} ${item.status} requires an https runUrl`);
    requireHTTPSURL(item.runUrl, `${id}.runUrl`);
    if (item.sourceCommit === null) fail(`${id} ${item.status} requires a sourceCommit`);
    if (Object.values(fingerprint).some((value) => value === null)) fail(`${id} ${item.status} requires a complete fingerprint`);
    if (item.outputs.length === 0) fail(`${id} ${item.status} requires at least one archived output`);
    if (item.execution === null) fail(`${id} ${item.status} requires execution metadata`);
    const execution = verifyExecution(item.execution, `${id}.execution`, documentGeneratedAt);
    if (!outputPaths.has(execution.rawOutputPath)) fail(`${id}.execution.rawOutputPath must reference an archived output`);
    if (item.completion === null) fail(`${id} ${item.status} requires completion coverage`);
    verifyCompletion(item.completion, `${id}.completion`, outputPaths, requirement, {
      complete: item.status === 'recorded',
      documentGeneratedAt,
    });
    if (item.status === 'recorded') {
      if (execution.exitCode !== 0) fail(`${id} recorded requires a zero execution exitCode`);
      if (item.provenance === null) fail(`${id} recorded requires provenance`);
      verifyProvenance(
        item.provenance,
        `${id}.provenance`,
        outputPaths,
        requireTimestamp(execution.finishedAt, `${id}.execution.finishedAt`),
        documentGeneratedAt,
      );
    }
    if (item.status === 'failed' && execution.exitCode === 0) fail(`${id} failed requires a non-zero execution exitCode`);
  }
  if (seen.size !== packageScopes.size) fail('workPackages is missing a V13 package');
}

const { verify, file } = parseArgs();
ensureIndexPath(file);
if (verify) {
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) fail(`index must be a regular file: ${relativePath(file)}`);
  let document;
  try { document = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('index is not valid JSON'); }
  verifyDocument(document);
  console.log(`V13 evidence verified: ${relativePath(file)}`);
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  const document = skeleton();
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`V13 evidence index written to ${relativePath(file)}`);
}
