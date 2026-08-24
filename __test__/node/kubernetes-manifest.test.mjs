import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const deploymentTempRoot = path.join(tempRoot, 'deployment');
const scriptPath = path.join(repositoryRoot, 'scripts', 'kubernetes-manifest.mjs');
const templatePath = path.join(repositoryRoot, 'deploy', 'kubernetes', 'goexample-api.template.json');
const immutableImage = `ghcr.io/zbxing/goexample-api@sha256:${'a'.repeat(64)}`;
const oidcArguments = [
  '--oidc-issuer',
  'https://identity.example.com/tenant',
  '--oidc-audience',
  'goexample-api',
  '--oidc-jwks-url',
  'https://identity.example.com/tenant/jwks',
];

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function findResource(manifest, kind, name) {
  return manifest.items.find((item) => item.kind === kind && item.metadata?.name === name);
}

test('Kubernetes deployment template renders only with environment-specific immutable inputs', async (t) => {
  await mkdir(deploymentTempRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(deploymentTempRoot, 'kubernetes-contract-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const output = path.join(testRoot, 'deployment', 'goexample-api.json');

  const check = run(['check']);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Kubernetes template passed/);

  const render = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    ...oidcArguments,
    '--output',
    path.relative(repositoryRoot, output),
  ]);
  assert.equal(render.status, 0, render.stderr);

  const manifest = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(manifest.kind, 'List');
  assert.equal(manifest.items.some((item) => item.kind === 'Secret'), false);
  const deployment = findResource(manifest, 'Deployment', 'goexample-api');
  const container = deployment.spec.template.spec.containers[0];
  assert.equal(container.image, immutableImage);
  assert.equal(container.readinessProbe.httpGet.path, '/readyz');
  assert.equal(container.livenessProbe.httpGet.path, '/livez');
  assert.equal(container.startupProbe.httpGet.path, '/startupz');
  assert.equal(container.securityContext.readOnlyRootFilesystem, true);
  assert.equal(deployment.spec.replicas, 3);
  assert.equal(findResource(manifest, 'PodDisruptionBudget', 'goexample-api').spec.minAvailable, 2);
  assert.equal(findResource(manifest, 'HorizontalPodAutoscaler', 'goexample-api').spec.minReplicas, 3);
  assert.equal(
    findResource(manifest, 'ConfigMap', 'goexample-api-config').data.CORS_ALLOW_ORIGINS,
    'https://console.example.com',
  );
  const config = findResource(manifest, 'ConfigMap', 'goexample-api-config').data;
  assert.equal(config.OIDC_AUTH_ENABLED, 'true');
  assert.equal(config.OIDC_ISSUER, 'https://identity.example.com/tenant');
  assert.equal(config.OIDC_AUDIENCE, 'goexample-api');
  assert.equal(config.OIDC_JWKS_URL, 'https://identity.example.com/tenant/jwks');
  assert.doesNotMatch(await readFile(output, 'utf8'), /__GOEXAMPLE_/);
});

test('Kubernetes renderer rejects mutable images, unsafe origins, and weakened availability policy', async (t) => {
  const mutableImage = run([
    'render',
    '--image',
    'ghcr.io/zbxing/goexample-api:latest',
    '--allowed-origin',
    'https://console.example.com',
    ...oidcArguments,
  ]);
  assert.equal(mutableImage.status, 1);
  assert.match(mutableImage.stderr, /immutable registry reference/);

  const unsafeOrigin = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'http://console.example.com',
    ...oidcArguments,
  ]);
  assert.equal(unsafeOrigin.status, 1);
  assert.match(unsafeOrigin.stderr, /absolute HTTPS origin/);

  const duplicateImage = run([
    'render',
    '--image',
    immutableImage,
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    ...oidcArguments,
  ]);
  assert.equal(duplicateImage.status, 1);
  assert.match(duplicateImage.stderr, /--image may only be specified once/);

  const unsafeOIDC = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--oidc-issuer',
    'http://identity.example.com/tenant',
    '--oidc-audience',
    'goexample-api',
    '--oidc-jwks-url',
    'https://identity.example.com/tenant/jwks?credential=secret',
  ]);
  assert.equal(unsafeOIDC.status, 1);
  assert.match(unsafeOIDC.stderr, /OIDC issuer must be an absolute HTTPS URL/);

  const unsafeJWKSURL = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--oidc-issuer',
    'https://identity.example.com/tenant',
    '--oidc-audience',
    'goexample-api',
    '--oidc-jwks-url',
    'https://identity.example.com/tenant/jwks?credential=secret',
  ]);
  assert.equal(unsafeJWKSURL.status, 1);
  assert.match(unsafeJWKSURL.stderr, /OIDC JWKS URL must be an absolute HTTPS URL/);

  await mkdir(tempRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(tempRoot, 'kubernetes-tamper-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const tamperedPath = path.join(testRoot, 'goexample-api.template.json');
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.minAvailable = 1;
  await writeFile(tamperedPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');

  const tampered = run(['check', '--template', path.relative(repositoryRoot, tamperedPath)]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /PodDisruptionBudget minAvailable/);

  findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.minAvailable = 2;
  findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].image = immutableImage;
  await writeFile(tamperedPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  const concreteTemplate = run(['check', '--template', path.relative(repositoryRoot, tamperedPath)]);
  assert.equal(concreteTemplate.status, 1);
  assert.match(concreteTemplate.stderr, /template image must remain/);
});
