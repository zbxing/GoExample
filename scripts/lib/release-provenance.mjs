const bundleMediaType = 'application/vnd.dev.sigstore.bundle.v0.3+json';
const dssePayloadType = 'application/vnd.in-toto+json';
const inTotoStatementType = 'https://in-toto.io/Statement/v1';
const slsaProvenancePredicateType = 'https://slsa.dev/provenance/v1';
const githubWorkflowBuildType = 'https://actions.github.io/buildtypes/workflow/v1';
const maxStatementBytes = 1024 * 1024;
const maxSignatureBytes = 64 * 1024;
const maxVerificationBytes = 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const subjectNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]+$/;
const repositoryPattern = /^github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const workflowPathPattern = /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/;
const workflowRefPattern = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,240}$/;
const positiveIntegerPattern = /^[1-9][0-9]*$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function reject(message) {
  throw new Error(`Release provenance: ${message}`);
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject(`${name} must be an object`);
  }
  return value;
}

function requireExactKeys(value, expectedKeys, name) {
  const object = requireObject(value, name);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(`${name} fields are invalid`);
  }
  return object;
}

function decodeCanonicalBase64(value, name, maximumBytes) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    !base64Pattern.test(value)
  ) {
    reject(`${name} must be bounded canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    reject(`${name} must be bounded canonical base64`);
  }
  return bytes;
}

function normalizeExpectedSubjects(expectedSubjects) {
  if (!Array.isArray(expectedSubjects) || expectedSubjects.length !== 4) {
    reject('expected subjects must contain exactly four entries');
  }
  const subjects = new Map();
  for (const [index, subject] of expectedSubjects.entries()) {
    const value = requireObject(subject, `expected subject ${index}`);
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'sha256') {
      reject(`expected subject ${index} fields are invalid`);
    }
    if (!subjectNamePattern.test(value.name ?? '') || !sha256Pattern.test(value.sha256 ?? '')) {
      reject(`expected subject ${index} is invalid`);
    }
    if (subjects.has(value.name)) {
      reject('expected subject names must be unique');
    }
    subjects.set(value.name, value.sha256);
  }
  return subjects;
}

function normalizeExpectedBuild(expectedBuild) {
  const value = requireExactKeys(
    expectedBuild,
    ['repository', 'sourceCommit', 'workflowPath'],
    'expected build identity',
  );
  if (
    typeof value.repository !== 'string' ||
    !repositoryPattern.test(value.repository) ||
    value.repository !== value.repository.toLowerCase() ||
    typeof value.sourceCommit !== 'string' ||
    !commitPattern.test(value.sourceCommit) ||
    typeof value.workflowPath !== 'string' ||
    !workflowPathPattern.test(value.workflowPath)
  ) {
    reject('expected build identity is invalid');
  }
  return {
    repositoryURL: `https://${value.repository}`,
    sourceCommit: value.sourceCommit,
    workflowPath: value.workflowPath,
  };
}

function verifyGitHubWorkflowPredicate(predicate, expectedBuild) {
  const buildDefinition = requireExactKeys(
    predicate.buildDefinition,
    ['buildType', 'externalParameters', 'internalParameters', 'resolvedDependencies'],
    'SLSA build definition',
  );
  if (buildDefinition.buildType !== githubWorkflowBuildType) {
    reject('SLSA build type is invalid');
  }
  const externalParameters = requireExactKeys(
    buildDefinition.externalParameters,
    ['workflow'],
    'SLSA external parameters',
  );
  const workflow = requireExactKeys(
    externalParameters.workflow,
    ['path', 'ref', 'repository'],
    'SLSA workflow parameters',
  );
  if (
    typeof workflow.repository !== 'string' ||
    workflow.repository.toLowerCase() !== expectedBuild.repositoryURL ||
    workflow.path !== expectedBuild.workflowPath ||
    typeof workflow.ref !== 'string' ||
    !workflowRefPattern.test(workflow.ref) ||
    workflow.ref.includes('..') ||
    workflow.ref.includes('//') ||
    workflow.ref.includes('@{') ||
    workflow.ref.endsWith('/') ||
    workflow.ref.endsWith('.lock')
  ) {
    reject('SLSA workflow identity is invalid');
  }

  const internalParameters = requireExactKeys(
    buildDefinition.internalParameters,
    ['github'],
    'SLSA internal parameters',
  );
  const github = requireExactKeys(
    internalParameters.github,
    ['event_name', 'repository_id', 'repository_owner_id', 'runner_environment'],
    'SLSA GitHub parameters',
  );
  if (
    !['push', 'workflow_dispatch'].includes(github.event_name) ||
    github.runner_environment !== 'github-hosted' ||
    typeof github.repository_id !== 'string' ||
    !positiveIntegerPattern.test(github.repository_id) ||
    typeof github.repository_owner_id !== 'string' ||
    !positiveIntegerPattern.test(github.repository_owner_id)
  ) {
    reject('SLSA GitHub parameters are invalid');
  }

  if (!Array.isArray(buildDefinition.resolvedDependencies) || buildDefinition.resolvedDependencies.length !== 1) {
    reject('SLSA resolved dependencies must contain exactly the source repository');
  }
  const dependency = requireExactKeys(
    buildDefinition.resolvedDependencies[0],
    ['digest', 'uri'],
    'SLSA source dependency',
  );
  const digest = requireExactKeys(dependency.digest, ['gitCommit'], 'SLSA source dependency digest');
  if (
    dependency.uri !== `git+${workflow.repository}@${workflow.ref}` ||
    digest.gitCommit !== expectedBuild.sourceCommit
  ) {
    reject('SLSA source dependency is invalid');
  }

  const runDetails = requireExactKeys(predicate.runDetails, ['builder', 'metadata'], 'SLSA run details');
  const builder = requireExactKeys(runDetails.builder, ['id'], 'SLSA builder');
  if (builder.id !== `${workflow.repository}/${workflow.path}@${workflow.ref}`) {
    reject('SLSA builder identity is invalid');
  }
  const metadata = requireExactKeys(runDetails.metadata, ['invocationId'], 'SLSA run metadata');
  const invocationPrefix = `${workflow.repository}/actions/runs/`;
  if (
    typeof metadata.invocationId !== 'string' ||
    !metadata.invocationId.startsWith(invocationPrefix) ||
    !/^\d+\/attempts\/\d+$/.test(metadata.invocationId.slice(invocationPrefix.length)) ||
    metadata.invocationId.split('/').some((part) => /^\d+$/.test(part) && !positiveIntegerPattern.test(part))
  ) {
    reject('SLSA invocation identity is invalid');
  }
}

export function verifyReleaseProvenanceBundleSubjects(bundle, expectedSubjects, expectedBuildIdentity) {
  const expected = normalizeExpectedSubjects(expectedSubjects);
  const expectedBuild = normalizeExpectedBuild(expectedBuildIdentity);
  const document = requireObject(bundle, 'bundle');
  if (document.mediaType !== bundleMediaType) {
    reject('bundle media type is invalid');
  }
  const verificationMaterial = requireObject(document.verificationMaterial, 'verification material');
  if (Object.keys(verificationMaterial).length === 0) {
    reject('verification material must not be empty');
  }
  const envelope = requireObject(document.dsseEnvelope, 'DSSE envelope');
  if (envelope.payloadType !== dssePayloadType) {
    reject('DSSE payload type is invalid');
  }
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0 || envelope.signatures.length > 8) {
    reject('DSSE signatures must contain between one and eight entries');
  }
  for (const [index, signature] of envelope.signatures.entries()) {
    const value = requireObject(signature, `DSSE signature ${index}`);
    decodeCanonicalBase64(value.sig, `DSSE signature ${index}`, maxSignatureBytes);
    if (value.keyid !== undefined && (typeof value.keyid !== 'string' || value.keyid.length > 512)) {
      reject(`DSSE signature ${index} keyid is invalid`);
    }
  }

  const payload = decodeCanonicalBase64(envelope.payload, 'DSSE payload', maxStatementBytes);
  let statement;
  try {
    statement = JSON.parse(payload.toString('utf8'));
  } catch {
    reject('DSSE payload must contain valid JSON');
  }
  const value = requireObject(statement, 'in-toto statement');
  if (value._type !== inTotoStatementType) {
    reject('in-toto statement type is invalid');
  }
  if (value.predicateType !== slsaProvenancePredicateType || !requireObject(value.predicate, 'SLSA predicate')) {
    reject('SLSA provenance predicate is invalid');
  }
  verifyGitHubWorkflowPredicate(value.predicate, expectedBuild);
  if (!Array.isArray(value.subject) || value.subject.length !== expected.size) {
    reject('in-toto statement must contain exactly the expected release subjects');
  }

  const actual = new Map();
  for (const [index, subject] of value.subject.entries()) {
    const item = requireObject(subject, `in-toto subject ${index}`);
    const subjectKeys = Object.keys(item).sort();
    if (subjectKeys.length !== 2 || subjectKeys[0] !== 'digest' || subjectKeys[1] !== 'name') {
      reject(`in-toto subject ${index} fields are invalid`);
    }
    const digest = requireObject(item.digest, `in-toto subject ${index} digest`);
    if (
      !subjectNamePattern.test(item.name ?? '') ||
      Object.keys(digest).length !== 1 ||
      typeof digest.sha256 !== 'string' ||
      !sha256Pattern.test(digest.sha256)
    ) {
      reject(`in-toto subject ${index} is invalid`);
    }
    if (actual.has(item.name)) {
      reject('in-toto subject names must be unique');
    }
    actual.set(item.name, digest.sha256);
  }
  for (const [name, sha256] of expected) {
    if (actual.get(name) !== sha256) {
      reject('in-toto subjects do not match the expected release files');
    }
  }
  return value;
}

export function verifyReleaseAttestationURL(value, expectedRepository) {
  const expected = normalizeExpectedBuild({
    repository: expectedRepository,
    sourceCommit: '0'.repeat(40),
    workflowPath: '.github/workflows/go-quality.yml',
  });
  if (typeof value !== 'string') {
    reject('attestation URL is invalid');
  }
  const prefix = `${expected.repositoryURL}/attestations/`;
  if (
    !value.toLowerCase().startsWith(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length))
  ) {
    reject('attestation URL is invalid');
  }
  return value;
}

export function verifyReleaseAttestationVerification(value, expectedSubjects) {
  const expectedNames = [...normalizeExpectedSubjects(expectedSubjects).keys()];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maxVerificationBytes ||
    value.includes('\0')
  ) {
    reject('attestation verification output is invalid');
  }
  const lines = value.trimEnd().split(/\r?\n/);
  let subjectIndex = 0;
  let pendingSubject = false;
  for (const line of lines) {
    if (line.startsWith('subject=')) {
      if (pendingSubject || subjectIndex >= expectedNames.length || line !== `subject=${expectedNames[subjectIndex]}`) {
        reject('attestation verification subjects are invalid');
      }
      pendingSubject = true;
    } else if (line.startsWith('subject_exit_code=')) {
      if (!pendingSubject || line !== 'subject_exit_code=0') {
        reject('attestation verification subject status is invalid');
      }
      pendingSubject = false;
      subjectIndex += 1;
    }
  }
  if (pendingSubject || subjectIndex !== expectedNames.length) {
    reject('attestation verification must cover exactly the expected release subjects');
  }
  return value;
}

export const releaseProvenanceSchema = Object.freeze({
  bundleMediaType,
  dssePayloadType,
  inTotoStatementType,
  slsaProvenancePredicateType,
  githubWorkflowBuildType,
});
