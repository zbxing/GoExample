import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  releaseProvenanceSchema,
  verifyReleaseAttestationURL,
  verifyReleaseAttestationVerification,
  verifyReleaseProvenanceBundleSubjects,
} from '../../scripts/lib/release-provenance.mjs';

const expectedSubjects = [
  { name: 'goexample-api_0.1.0_linux_amd64', sha256: '1'.repeat(64) },
  { name: 'release-manifest.json', sha256: '2'.repeat(64) },
  { name: 'source-manifest.json', sha256: '3'.repeat(64) },
  { name: 'reproducibility-report.json', sha256: '4'.repeat(64) },
];
const expectedBuildIdentity = {
  repository: 'github.com/zbxing/goexample',
  sourceCommit: 'a'.repeat(40),
  workflowPath: '.github/workflows/go-quality.yml',
};
const repositoryURL = 'https://github.com/zbxing/GoExample';
const workflowRef = 'refs/heads/master';

function encodePayload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function statement(subjects = expectedSubjects) {
  return {
    _type: releaseProvenanceSchema.inTotoStatementType,
    subject: subjects.map(({ name, sha256 }) => ({ name, digest: { sha256 } })),
    predicateType: releaseProvenanceSchema.slsaProvenancePredicateType,
    predicate: {
      buildDefinition: {
        buildType: releaseProvenanceSchema.githubWorkflowBuildType,
        externalParameters: {
          workflow: {
            ref: workflowRef,
            repository: repositoryURL,
            path: expectedBuildIdentity.workflowPath,
          },
        },
        internalParameters: {
          github: {
            event_name: 'push',
            repository_id: '123456789',
            repository_owner_id: '987654321',
            runner_environment: 'github-hosted',
          },
        },
        resolvedDependencies: [
          {
            uri: `git+${repositoryURL}@${workflowRef}`,
            digest: { gitCommit: expectedBuildIdentity.sourceCommit },
          },
        ],
      },
      runDetails: {
        builder: {
          id: `${repositoryURL}/${expectedBuildIdentity.workflowPath}@${workflowRef}`,
        },
        metadata: {
          invocationId: `${repositoryURL}/actions/runs/123456789/attempts/1`,
        },
      },
    },
  };
}

function bundle(payload = statement()) {
  return {
    mediaType: releaseProvenanceSchema.bundleMediaType,
    verificationMaterial: { certificate: { rawBytes: 'fixture' } },
    dsseEnvelope: {
      payload: encodePayload(payload),
      payloadType: releaseProvenanceSchema.dssePayloadType,
      signatures: [{ keyid: '', sig: Buffer.from('fixture-signature').toString('base64') }],
    },
  };
}

function verifyBundle(value) {
  return verifyReleaseProvenanceBundleSubjects(value, expectedSubjects, expectedBuildIdentity);
}

function verificationOutput(subjects = expectedSubjects, exitCode = 0) {
  return subjects
    .map(({ name }) => `subject=${name}\nGitHub CLI verification output\nsubject_exit_code=${exitCode}\n`)
    .join('');
}

test('offline release provenance parser binds the exact four in-toto subjects', () => {
  const reordered = statement([...expectedSubjects].reverse());
  assert.deepEqual(verifyBundle(bundle(reordered)), reordered);

  const digestDrift = statement();
  digestDrift.subject[0].digest.sha256 = 'f'.repeat(64);
  assert.throws(
    () => verifyBundle(bundle(digestDrift)),
    /subjects do not match/,
  );

  const missing = statement(expectedSubjects.slice(0, -1));
  assert.throws(
    () => verifyBundle(bundle(missing)),
    /exactly the expected release subjects/,
  );

  const additional = statement([
    ...expectedSubjects,
    { name: 'unexpected.json', sha256: '5'.repeat(64) },
  ]);
  assert.throws(
    () => verifyBundle(bundle(additional)),
    /exactly the expected release subjects/,
  );

  const duplicate = statement();
  duplicate.subject[3] = structuredClone(duplicate.subject[0]);
  assert.throws(
    () => verifyBundle(bundle(duplicate)),
    /subject names must be unique/,
  );

  const unsafeName = statement();
  unsafeName.subject[0].name = '../outside';
  assert.throws(
    () => verifyBundle(bundle(unsafeName)),
    /in-toto subject 0 is invalid/,
  );

  const digestAlgorithmDrift = statement();
  digestAlgorithmDrift.subject[0].digest = { sha512: 'a'.repeat(128) };
  assert.throws(
    () => verifyBundle(bundle(digestAlgorithmDrift)),
    /in-toto subject 0 is invalid/,
  );

  const wrongStatementType = statement();
  wrongStatementType._type = 'https://in-toto.io/Statement/v0.1';
  assert.throws(
    () => verifyBundle(bundle(wrongStatementType)),
    /statement type is invalid/,
  );

  const wrongPredicate = statement();
  wrongPredicate.predicateType = 'https://slsa.dev/provenance/v0.2';
  assert.throws(
    () => verifyBundle(bundle(wrongPredicate)),
    /predicate is invalid/,
  );

  const malformedEnvelope = bundle();
  malformedEnvelope.dsseEnvelope.payloadType = 'application/json';
  assert.throws(
    () => verifyBundle(malformedEnvelope),
    /payload type is invalid/,
  );

  const malformedBase64 = bundle();
  malformedBase64.dsseEnvelope.payload = 'not-base64';
  assert.throws(
    () => verifyBundle(malformedBase64),
    /canonical base64/,
  );

  const invalidJSON = bundle();
  invalidJSON.dsseEnvelope.payload = Buffer.from('{', 'utf8').toString('base64');
  assert.throws(
    () => verifyBundle(invalidJSON),
    /must contain valid JSON/,
  );

  const unsigned = bundle();
  unsigned.dsseEnvelope.signatures = [];
  assert.throws(
    () => verifyBundle(unsigned),
    /signatures must contain/,
  );

  const noVerificationMaterial = bundle();
  noVerificationMaterial.verificationMaterial = {};
  assert.throws(
    () => verifyBundle(noVerificationMaterial),
    /verification material must not be empty/,
  );
});

test('offline release provenance parser binds the GitHub workflow and source commit', () => {
  const repositoryDrift = statement();
  repositoryDrift.predicate.buildDefinition.externalParameters.workflow.repository =
    'https://github.com/attacker/goexample';
  assert.throws(() => verifyBundle(bundle(repositoryDrift)), /workflow identity is invalid/);

  const workflowDrift = statement();
  workflowDrift.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/untrusted.yml';
  assert.throws(() => verifyBundle(bundle(workflowDrift)), /workflow identity is invalid/);

  const commitDrift = statement();
  commitDrift.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40);
  assert.throws(() => verifyBundle(bundle(commitDrift)), /source dependency is invalid/);

  const buildTypeDrift = statement();
  buildTypeDrift.predicate.buildDefinition.buildType =
    'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1';
  assert.throws(() => verifyBundle(bundle(buildTypeDrift)), /build type is invalid/);

  const builderDrift = statement();
  builderDrift.predicate.runDetails.builder.id = 'https://github.com/actions/runner/github-hosted';
  assert.throws(() => verifyBundle(bundle(builderDrift)), /builder identity is invalid/);

  const invocationDrift = statement();
  invocationDrift.predicate.runDetails.metadata.invocationId =
    'https://github.com/attacker/goexample/actions/runs/123/attempts/1';
  assert.throws(() => verifyBundle(bundle(invocationDrift)), /invocation identity is invalid/);

  const pullRequest = statement();
  pullRequest.predicate.buildDefinition.internalParameters.github.event_name = 'pull_request';
  assert.throws(() => verifyBundle(bundle(pullRequest)), /GitHub parameters are invalid/);

  const selfHosted = statement();
  selfHosted.predicate.buildDefinition.internalParameters.github.runner_environment = 'self-hosted';
  assert.throws(() => verifyBundle(bundle(selfHosted)), /GitHub parameters are invalid/);
});

test('archived attestation URL and verification transcript bind the repository and four subjects', () => {
  assert.equal(
    verifyReleaseAttestationURL(
      'https://github.com/zbxing/GoExample/attestations/123456',
      expectedBuildIdentity.repository,
    ),
    'https://github.com/zbxing/GoExample/attestations/123456',
  );
  assert.equal(
    verifyReleaseAttestationVerification(verificationOutput(), expectedSubjects),
    verificationOutput(),
  );

  assert.throws(
    () => verifyReleaseAttestationURL(
      'https://github.com/attacker/goexample/attestations/123456',
      expectedBuildIdentity.repository,
    ),
    /attestation URL is invalid/,
  );
  assert.throws(
    () => verifyReleaseAttestationVerification(verificationOutput(expectedSubjects.slice(0, -1)), expectedSubjects),
    /cover exactly the expected release subjects/,
  );
  assert.throws(
    () => verifyReleaseAttestationVerification(verificationOutput(expectedSubjects, 1), expectedSubjects),
    /subject status is invalid/,
  );
  assert.throws(
    () => verifyReleaseAttestationVerification(
      verificationOutput([expectedSubjects[0], expectedSubjects[0], ...expectedSubjects.slice(2)]),
      expectedSubjects,
    ),
    /verification subjects are invalid/,
  );
});
