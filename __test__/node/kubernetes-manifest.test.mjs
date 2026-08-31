import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const templatePath = path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json');
const immutableImage = `ghcr.io/zbxing/goexample-api@sha256:${'a'.repeat(64)}`;
const namespace = 'goexample-production';
const secretRevision = 'vault-version-2026-08-30-001';
const oidcArguments = [
  '--oidc-issuer',
  'https://identity.example.com/tenant',
  '--oidc-audience',
  'goexample-api',
  '--oidc-jwks-url',
  'https://identity.example.com/tenant/jwks',
];
const renderEnvironmentArguments = [
  '--namespace',
  namespace,
  ...oidcArguments,
  '--secret-revision',
  secretRevision,
];
const expectedEnvironmentConfigKeys = [
  'ALLOW_IN_MEMORY_SHARED_STATE',
  'APP_ENV',
  'APP_NAME',
  'CORS_ALLOW_CREDENTIALS',
  'CORS_ALLOW_ORIGINS',
  'DEMO_AUTH_ENABLED',
  'HEALTH_CACHE_TTL',
  'HEALTH_CHECK_TIMEOUT',
  'HTTP_HOST',
  'HTTP_IDLE_TIMEOUT',
  'HTTP_MAX_IN_FLIGHT',
  'HTTP_PORT',
  'HTTP_READ_TIMEOUT',
  'HTTP_REQUEST_TIMEOUT',
  'HTTP_WRITE_TIMEOUT',
  'IDEMPOTENCY_ENABLED',
  'IDEMPOTENCY_LIFETIME',
  'LOG_FORMAT',
  'LOG_LEVEL',
  'LOG_SKIP_PATHS',
  'OIDC_AUDIENCE',
  'OIDC_AUTH_ENABLED',
  'OIDC_ISSUER',
  'OIDC_JWKS_HTTP_TIMEOUT',
  'OIDC_JWKS_REFRESH_INTERVAL',
  'OIDC_JWKS_URL',
  'OIDC_MAX_TOKEN_AGE',
  'OTEL_TRACES_EXPORTER',
  'OTEL_TRACES_SAMPLER_ARG',
  'PPROF_ENABLED',
  'REDIS_KEY_PREFIX',
  'REDIS_LOCK_RETRY_INTERVAL',
  'REDIS_LOCK_TTL',
  'REDIS_LOCK_WAIT_TIMEOUT',
  'REDIS_MIN_IDLE_CONNECTIONS',
  'REDIS_OPERATION_TIMEOUT',
  'REDIS_POOL_SIZE',
  'SHARED_STATE_MODE',
  'SHUTDOWN_DRAIN_DELAY',
  'SHUTDOWN_TIMEOUT',
  'SYSTEM_INFO_DETAILED',
];
const expectedFixedEnvironmentConfigValues = {
  ALLOW_IN_MEMORY_SHARED_STATE: 'false',
  APP_ENV: 'production',
  APP_NAME: 'GoExample API',
  CORS_ALLOW_CREDENTIALS: 'false',
  DEMO_AUTH_ENABLED: 'false',
  HEALTH_CACHE_TTL: '1s',
  HEALTH_CHECK_TIMEOUT: '2s',
  HTTP_HOST: '0.0.0.0',
  HTTP_IDLE_TIMEOUT: '60s',
  HTTP_MAX_IN_FLIGHT: '256',
  HTTP_PORT: '3001',
  HTTP_READ_TIMEOUT: '10s',
  HTTP_REQUEST_TIMEOUT: '8s',
  HTTP_WRITE_TIMEOUT: '10s',
  IDEMPOTENCY_ENABLED: 'true',
  IDEMPOTENCY_LIFETIME: '30m',
  LOG_FORMAT: 'json',
  LOG_LEVEL: 'info',
  LOG_SKIP_PATHS: '/livez,/readyz,/startupz,/metrics',
  OIDC_AUTH_ENABLED: 'true',
  OIDC_JWKS_HTTP_TIMEOUT: '3s',
  OIDC_JWKS_REFRESH_INTERVAL: '5m',
  OIDC_MAX_TOKEN_AGE: '15m',
  OTEL_TRACES_EXPORTER: 'none',
  OTEL_TRACES_SAMPLER_ARG: '0.1',
  PPROF_ENABLED: 'false',
  REDIS_KEY_PREFIX: 'goexample:production:example:',
  REDIS_LOCK_RETRY_INTERVAL: '25ms',
  REDIS_LOCK_TTL: '15s',
  REDIS_LOCK_WAIT_TIMEOUT: '2s',
  REDIS_MIN_IDLE_CONNECTIONS: '2',
  REDIS_OPERATION_TIMEOUT: '500ms',
  REDIS_POOL_SIZE: '32',
  SHARED_STATE_MODE: 'external',
  SHUTDOWN_DRAIN_DELAY: '5s',
  SHUTDOWN_TIMEOUT: '20s',
  SYSTEM_INFO_DETAILED: 'false',
};
const expectedResourceIdentities = [
  'apps/v1/Deployment/goexample-api',
  'autoscaling/v2/HorizontalPodAutoscaler/goexample-api',
  'networking.k8s.io/v1/NetworkPolicy/goexample-api-egress',
  'networking.k8s.io/v1/NetworkPolicy/goexample-api-ingress',
  'policy/v1/PodDisruptionBudget/goexample-api',
  'v1/ConfigMap/goexample-api-config',
  'v1/Service/goexample-api',
  'v1/ServiceAccount/goexample-api',
];
const expectedWorkloadLabels = {
  'app.kubernetes.io/name': 'goexample-api',
  'app.kubernetes.io/component': 'api',
};
const expectedWorkloadSelector = { matchLabels: expectedWorkloadLabels };

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function findResource(manifest, kind, name) {
  return manifest.items.find((item) => item.kind === kind && item.metadata?.name === name);
}

function expectedConfigChecksum(data) {
  const entries = Object.entries(data)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(entries)), 'utf8')
    .digest('hex');
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
    ...renderEnvironmentArguments,
    '--output',
    path.relative(repositoryRoot, output),
  ]);
  assert.equal(render.status, 0, render.stderr);

  const manifest = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(manifest.kind, 'List');
  assert.equal(manifest.items.some((item) => item.kind === 'Secret'), false);
  assert.deepEqual([...new Set(manifest.items.map((item) => item.metadata.namespace))], [namespace]);
  assert.deepEqual(
    manifest.items.map((item) => `${item.apiVersion}/${item.kind}/${item.metadata.name}`).sort(),
    expectedResourceIdentities,
  );
  const deployment = findResource(manifest, 'Deployment', 'goexample-api');
  const pod = deployment.spec.template.spec;
  const container = deployment.spec.template.spec.containers[0];
  assert.deepEqual(deployment.spec.selector, expectedWorkloadSelector);
  assert.deepEqual(deployment.spec.template.metadata.labels, expectedWorkloadLabels);
  assert.deepEqual(container, {
    name: 'api',
    image: immutableImage,
    imagePullPolicy: 'IfNotPresent',
    ports: [{ name: 'http', containerPort: 3001, protocol: 'TCP' }],
    envFrom: [
      { configMapRef: { name: 'goexample-api-config', optional: false } },
      { secretRef: { name: 'goexample-api-runtime', optional: false } },
    ],
    startupProbe: {
      httpGet: { path: '/startupz', port: 'http', scheme: 'HTTP' },
      periodSeconds: 2,
      timeoutSeconds: 2,
      failureThreshold: 30,
      successThreshold: 1,
    },
    readinessProbe: {
      httpGet: { path: '/readyz', port: 'http', scheme: 'HTTP' },
      periodSeconds: 5,
      timeoutSeconds: 3,
      failureThreshold: 2,
      successThreshold: 1,
    },
    livenessProbe: {
      httpGet: { path: '/livez', port: 'http', scheme: 'HTTP' },
      periodSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
      successThreshold: 1,
    },
    resources: {
      requests: { cpu: '100m', memory: '128Mi', 'ephemeral-storage': '64Mi' },
      limits: { cpu: '1000m', memory: '512Mi', 'ephemeral-storage': '256Mi' },
    },
    securityContext: {
      allowPrivilegeEscalation: false,
      privileged: false,
      procMount: 'Default',
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      capabilities: { drop: ['ALL'] },
    },
  });
  assert.deepEqual(pod.securityContext, {
    runAsNonRoot: true,
    runAsUser: 65532,
    runAsGroup: 65532,
    fsGroup: 65532,
    seccompProfile: { type: 'RuntimeDefault' },
  });
  assert.equal(deployment.spec.replicas, 3);
  assert.deepEqual(
    {
      revisionHistoryLimit: deployment.spec.revisionHistoryLimit,
      minReadySeconds: deployment.spec.minReadySeconds,
      progressDeadlineSeconds: deployment.spec.progressDeadlineSeconds,
    },
    { revisionHistoryLimit: 5, minReadySeconds: 10, progressDeadlineSeconds: 600 },
  );
  assert.equal(pod.enableServiceLinks, false);
  assert.equal(pod.hostNetwork, false);
  assert.equal(pod.hostPID, false);
  assert.equal(pod.hostIPC, false);
  assert.equal(pod.shareProcessNamespace, false);
  assert.deepEqual(Object.keys(pod).sort(), [
    'automountServiceAccountToken',
    'containers',
    'enableServiceLinks',
    'hostIPC',
    'hostNetwork',
    'hostPID',
    'securityContext',
    'serviceAccountName',
    'shareProcessNamespace',
    'terminationGracePeriodSeconds',
    'topologySpreadConstraints',
  ]);
  assert.deepEqual(
    pod.topologySpreadConstraints.map((constraint) => [
      constraint.topologyKey,
      constraint.maxSkew,
      constraint.whenUnsatisfiable,
    ]),
    [
      ['kubernetes.io/hostname', 1, 'DoNotSchedule'],
      ['topology.kubernetes.io/zone', 1, 'ScheduleAnyway'],
    ],
  );
  for (const constraint of pod.topologySpreadConstraints) {
    assert.deepEqual(constraint.labelSelector, expectedWorkloadSelector);
  }
  const service = findResource(manifest, 'Service', 'goexample-api');
  assert.deepEqual(service.spec, {
    type: 'ClusterIP',
    selector: expectedWorkloadLabels,
    ports: [{ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }],
  });
  const disruptionBudget = findResource(manifest, 'PodDisruptionBudget', 'goexample-api');
  assert.equal(disruptionBudget.spec.minAvailable, 2);
  assert.equal(disruptionBudget.spec.unhealthyPodEvictionPolicy, 'AlwaysAllow');
  assert.deepEqual(disruptionBudget.spec.selector, expectedWorkloadSelector);
  const autoscaler = findResource(manifest, 'HorizontalPodAutoscaler', 'goexample-api');
  assert.deepEqual(
    {
      apiVersion: autoscaler.apiVersion,
      scaleTargetRef: autoscaler.spec.scaleTargetRef,
      minReplicas: autoscaler.spec.minReplicas,
      maxReplicas: autoscaler.spec.maxReplicas,
    },
    {
      apiVersion: 'autoscaling/v2',
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'goexample-api' },
      minReplicas: 3,
      maxReplicas: 10,
    },
  );
  assert.deepEqual(autoscaler.spec.behavior, {
    scaleUp: {
      stabilizationWindowSeconds: 0,
      selectPolicy: 'Max',
      policies: [
        { type: 'Percent', value: 100, periodSeconds: 60 },
        { type: 'Pods', value: 2, periodSeconds: 60 },
      ],
    },
    scaleDown: {
      stabilizationWindowSeconds: 300,
      selectPolicy: 'Min',
      policies: [
        { type: 'Percent', value: 25, periodSeconds: 60 },
        { type: 'Pods', value: 1, periodSeconds: 60 },
      ],
    },
  });
  assert.deepEqual(
    autoscaler.spec.metrics.map((metric) => [
      metric.resource.name,
      metric.resource.target.type,
      metric.resource.target.averageUtilization,
    ]),
    [
      ['cpu', 'Utilization', 70],
      ['memory', 'Utilization', 75],
    ],
  );
  const ingressNetworkPolicy = findResource(manifest, 'NetworkPolicy', 'goexample-api-ingress');
  const egressNetworkPolicy = findResource(manifest, 'NetworkPolicy', 'goexample-api-egress');
  assert.equal(manifest.items.filter((item) => item.kind === 'NetworkPolicy').length, 2);
  assert.deepEqual(ingressNetworkPolicy.spec, {
    podSelector: {
      matchLabels: {
        'app.kubernetes.io/name': 'goexample-api',
        'app.kubernetes.io/component': 'api',
      },
    },
    policyTypes: ['Ingress'],
    ingress: [
      {
        from: [
          { podSelector: {} },
          { namespaceSelector: { matchLabels: { 'goexample.io/ingress-access': 'true' } } },
        ],
        ports: [{ protocol: 'TCP', port: 3001 }],
      },
    ],
  });
  assert.deepEqual(egressNetworkPolicy.spec, {
    podSelector: {
      matchLabels: {
        'app.kubernetes.io/name': 'goexample-api',
        'app.kubernetes.io/component': 'api',
      },
    },
    policyTypes: ['Egress'],
    egress: [
      {
        to: [
          { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } },
        ],
        ports: [
          { protocol: 'UDP', port: 53 },
          { protocol: 'TCP', port: 53 },
        ],
      },
      {
        ports: [
          { protocol: 'TCP', port: 443 },
          { protocol: 'TCP', port: 6380 },
        ],
      },
    ],
  });
  assert.equal(
    findResource(manifest, 'ConfigMap', 'goexample-api-config').data.CORS_ALLOW_ORIGINS,
    'https://console.example.com',
  );
  const config = findResource(manifest, 'ConfigMap', 'goexample-api-config').data;
  assert.deepEqual(Object.keys(config).sort(), expectedEnvironmentConfigKeys);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(expectedFixedEnvironmentConfigValues).map((key) => [key, config[key]]),
    ),
    expectedFixedEnvironmentConfigValues,
  );
  assert.equal(config.OIDC_AUTH_ENABLED, 'true');
  assert.equal(config.OIDC_ISSUER, 'https://identity.example.com/tenant');
  assert.equal(config.OIDC_AUDIENCE, 'goexample-api');
  assert.equal(config.OIDC_JWKS_URL, 'https://identity.example.com/tenant/jwks');
  assert.equal(
    deployment.spec.template.metadata.annotations['goexample.io/config-sha256'],
    expectedConfigChecksum(config),
  );
  assert.equal(
    deployment.spec.template.metadata.annotations['goexample.io/secret-revision'],
    secretRevision,
  );
  assert.deepEqual(deployment.spec.template.metadata, {
    labels: expectedWorkloadLabels,
    annotations: {
      'goexample.io/config-sha256': expectedConfigChecksum(config),
      'goexample.io/secret-revision': secretRevision,
    },
  });
  assert.doesNotMatch(await readFile(output, 'utf8'), /__GOEXAMPLE_/);
});

test('Kubernetes renderer rejects mutable images, unsafe origins, and weakened availability policy', async (t) => {
  const mutableImage = run([
    'render',
    '--image',
    'ghcr.io/zbxing/goexample-api:latest',
    '--allowed-origin',
    'https://console.example.com',
    ...renderEnvironmentArguments,
  ]);
  assert.equal(mutableImage.status, 1);
  assert.match(mutableImage.stderr, /immutable registry reference/);

  const unsafeOrigin = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'http://console.example.com',
    ...renderEnvironmentArguments,
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
    ...renderEnvironmentArguments,
  ]);
  assert.equal(duplicateImage.status, 1);
  assert.match(duplicateImage.stderr, /--image may only be specified once/);

  const unsafeOIDC = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--namespace',
    namespace,
    '--oidc-issuer',
    'http://identity.example.com/tenant',
    '--oidc-audience',
    'goexample-api',
    '--oidc-jwks-url',
    'https://identity.example.com/tenant/jwks?credential=secret',
    '--secret-revision',
    secretRevision,
  ]);
  assert.equal(unsafeOIDC.status, 1);
  assert.match(unsafeOIDC.stderr, /OIDC issuer must be an absolute HTTPS URL/);

  const unsafeJWKSURL = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--namespace',
    namespace,
    '--oidc-issuer',
    'https://identity.example.com/tenant',
    '--oidc-audience',
    'goexample-api',
    '--oidc-jwks-url',
    'https://identity.example.com/tenant/jwks?credential=secret',
    '--secret-revision',
    secretRevision,
  ]);
  assert.equal(unsafeJWKSURL.status, 1);
  assert.match(unsafeJWKSURL.stderr, /OIDC JWKS URL must be an absolute HTTPS URL/);

  const missingSecretRevision = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--namespace',
    namespace,
    ...oidcArguments,
  ]);
  assert.equal(missingSecretRevision.status, 1);
  assert.match(missingSecretRevision.stderr, /render requires .*--secret-revision/);

  const unsafeSecretRevision = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    '--namespace',
    namespace,
    ...oidcArguments,
    '--secret-revision',
    '../../runtime-secret',
  ]);
  assert.equal(unsafeSecretRevision.status, 1);
  assert.match(unsafeSecretRevision.stderr, /secret revision must be 1-128 safe non-secret ASCII characters/);

  const missingNamespace = run([
    'render',
    '--image',
    immutableImage,
    '--allowed-origin',
    'https://console.example.com',
    ...oidcArguments,
    '--secret-revision',
    secretRevision,
  ]);
  assert.equal(missingNamespace.status, 1);
  assert.match(missingNamespace.stderr, /render requires --namespace/);

  for (const invalidNamespace of ['default', 'GoExample-production']) {
    const rejectedNamespace = run([
      'render',
      '--namespace',
      invalidNamespace,
      '--image',
      immutableImage,
      '--allowed-origin',
      'https://console.example.com',
      ...oidcArguments,
      '--secret-revision',
      secretRevision,
    ]);
    assert.equal(rejectedNamespace.status, 1);
    assert.match(rejectedNamespace.stderr, /namespace must (?:be a 1-63 character lowercase Kubernetes DNS label|not use default or Kubernetes system namespaces)/);
  }

  await mkdir(tempRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(tempRoot, 'kubernetes-tamper-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const tamperedPath = path.join(testRoot, 'goexample-api.template.json');
  const tamperCases = [
    [
      'resource namespace drift',
      (template) => { findResource(template, 'Service', 'goexample-api').metadata.namespace = 'goexample-other'; },
      /all resources must use exactly one explicit namespace/,
    ],
    [
      'concrete namespace in template',
      (template) => {
        for (const item of template.items) {
          item.metadata.namespace = namespace;
        }
      },
      /template resource namespaces must remain/,
    ],
    [
      'extra deployment selector label',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.selector.matchLabels['goexample.io/revision'] = 'unreviewed';
      },
      /Deployment selector must contain only the fixed workload matchLabels/,
    ],
    [
      'deployment selector match expression',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.selector.matchExpressions = [
          { key: 'goexample.io/revision', operator: 'In', values: ['unreviewed'] },
        ];
      },
      /Deployment selector must contain only the fixed workload matchLabels/,
    ],
    [
      'mismatched pod template label',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.labels['app.kubernetes.io/component'] = 'worker';
      },
      /pod labels must exactly equal/,
    ],
    [
      'extra service selector label',
      (template) => {
        findResource(template, 'Service', 'goexample-api').spec.selector['goexample.io/revision'] = 'unreviewed';
      },
      /Service spec must exactly expose/,
    ],
    [
      'extra container port',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].ports.push({
          name: 'admin',
          containerPort: 9000,
          protocol: 'TCP',
        });
      },
      /container ports must exactly expose/,
    ],
    [
      'container port protocol drift',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].ports[0].protocol = 'UDP';
      },
      /container ports must exactly expose/,
    ],
    [
      'service external IP exposure',
      (template) => {
        findResource(template, 'Service', 'goexample-api').spec.externalIPs = ['203.0.113.10'];
      },
      /Service spec must exactly expose/,
    ],
    [
      'service port protocol drift',
      (template) => {
        findResource(template, 'Service', 'goexample-api').spec.ports[0].protocol = 'UDP';
      },
      /Service spec must exactly expose/,
    ],
    [
      'extra disruption selector label',
      (template) => {
        findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.selector.matchLabels['goexample.io/revision'] = 'unreviewed';
      },
      /PodDisruptionBudget selector must contain only the fixed workload matchLabels/,
    ],
    [
      'disruption selector match expression',
      (template) => {
        findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.selector.matchExpressions = [
          { key: 'goexample.io/revision', operator: 'In', values: ['unreviewed'] },
        ];
      },
      /PodDisruptionBudget selector must contain only the fixed workload matchLabels/,
    ],
    [
      'extra topology selector label',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.topologySpreadConstraints[0]
          .labelSelector.matchLabels['goexample.io/revision'] = 'unreviewed';
      },
      /strict hostname topology spreading.*only the fixed workload matchLabels/,
    ],
    [
      'topology selector match expression',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.topologySpreadConstraints[0]
          .labelSelector.matchExpressions = [
            { key: 'goexample.io/revision', operator: 'In', values: ['unreviewed'] },
          ];
      },
      /strict hostname topology spreading.*only the fixed workload matchLabels/,
    ],
    [
      'availability budget',
      (template) => { findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.minAvailable = 1; },
      /PodDisruptionBudget minAvailable/,
    ],
    [
      'unhealthy pod eviction',
      (template) => { delete findResource(template, 'PodDisruptionBudget', 'goexample-api').spec.unhealthyPodEvictionPolicy; },
      /unhealthyPodEvictionPolicy must be AlwaysAllow/,
    ],
    [
      'zone spreading',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.topologySpreadConstraints.pop();
      },
      /strict hostname topology spreading|soft zone topology spreading/,
    ],
    [
      'host namespace isolation',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.hostNetwork = true; },
      /disable service links and host namespace sharing/,
    ],
    [
      'service link isolation',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.enableServiceLinks = true; },
      /disable service links and host namespace sharing/,
    ],
    [
      'missing config checksum annotation',
      (template) => {
        delete findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.annotations['goexample.io/config-sha256'];
      },
      /goexample\.io\/config-sha256 must match/,
    ],
    [
      'forged config checksum annotation',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.annotations['goexample.io/config-sha256'] = '0'.repeat(64);
      },
      /goexample\.io\/config-sha256 must match/,
    ],
    [
      'missing secret revision annotation',
      (template) => {
        delete findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.annotations['goexample.io/secret-revision'];
      },
      /secret revision must be 1-128/,
    ],
    [
      'concrete secret revision in template',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.annotations['goexample.io/secret-revision'] = secretRevision;
      },
      /template secret revision must remain/,
    ],
    [
      'extra config environment key',
      (template) => {
        findResource(template, 'ConfigMap', 'goexample-api-config').data.UNREVIEWED_SETTING = 'true';
      },
      /ConfigMap data keys must exactly match the reviewed non-secret environment inventory/,
    ],
    [
      'missing config environment key',
      (template) => {
        delete findResource(template, 'ConfigMap', 'goexample-api-config').data.APP_NAME;
      },
      /ConfigMap data keys must exactly match the reviewed non-secret environment inventory/,
    ],
    [
      'fixed config environment value drift',
      (template) => {
        findResource(template, 'ConfigMap', 'goexample-api-config').data.HTTP_REQUEST_TIMEOUT = '60s';
      },
      /ConfigMap fixed environment values must exactly match the reviewed production baseline/,
    ],
    [
      'optional runtime secret',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].envFrom[1].secretRef.optional = true;
      },
      /envFrom must exactly load the required ConfigMap then Secret/,
    ],
    [
      'extra environment source',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].envFrom.push({
          configMapRef: { name: 'unreviewed-config', optional: false },
        });
      },
      /envFrom must exactly load the required ConfigMap then Secret/,
    ],
    [
      'environment source precedence',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].envFrom.reverse();
      },
      /envFrom must exactly load the required ConfigMap then Secret/,
    ],
    [
      'inline environment override',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].env = [
          { name: 'APP_ENV', value: 'development' },
        ];
      },
      /must not define inline env overrides/,
    ],
    [
      'container image pull policy drift',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .imagePullPolicy = 'Never';
      },
      /api container must exactly match/,
    ],
    [
      'container command override',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .command = ['/bin/sh', '-c', 'sleep 3600'];
      },
      /api container must exactly match/,
    ],
    [
      'container lifecycle hook',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .lifecycle = { postStart: { exec: { command: ['/bin/sh', '-c', 'true'] } } };
      },
      /api container must exactly match/,
    ],
    [
      'interactive container standard input',
      (template) => {
        const container = findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0];
        container.stdin = true;
        container.tty = true;
      },
      /api container must exactly match/,
    ],
    [
      'pod init container injection',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.initContainers = [{
          name: 'bootstrap',
          image: `busybox@sha256:${'b'.repeat(64)}`,
          command: ['sh', '-c', 'true'],
        }];
      },
      /PodSpec must exactly match/,
    ],
    [
      'pod host path volume injection',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.volumes = [{
          name: 'host-root',
          hostPath: { path: '/', type: 'Directory' },
        }];
      },
      /PodSpec must exactly match/,
    ],
    [
      'pod DNS policy drift',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.dnsPolicy = 'Default';
      },
      /PodSpec must exactly match/,
    ],
    [
      'pod registry credential injection',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.imagePullSecrets = [
          { name: 'unreviewed-registry' },
        ];
      },
      /PodSpec must exactly match/,
    ],
    [
      'pod template sidecar injection annotation',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.annotations[
          'sidecar.istio.io/inject'
        ] = 'true';
      },
      /PodTemplateSpec must exactly match/,
    ],
    [
      'pod template finalizer injection',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.finalizers = [
          'goexample.io/hold',
        ];
      },
      /PodTemplateSpec must exactly match/,
    ],
    [
      'pod template owner reference injection',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.metadata.ownerReferences = [{
          apiVersion: 'v1',
          kind: 'ConfigMap',
          name: 'goexample-api-config',
          uid: '00000000-0000-0000-0000-000000000000',
        }];
      },
      /PodTemplateSpec must exactly match/,
    ],
    [
      'pod identity',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.securityContext.runAsUser = 65533; },
      /pod security context must exactly match/,
    ],
    [
      'pod security sysctl',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.securityContext.sysctls = [
          { name: 'net.ipv4.ip_forward', value: '1' },
        ];
      },
      /pod security context must exactly match/,
    ],
    [
      'startup probe timing',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].startupProbe.failureThreshold = 60; },
      /startupProbe must exactly match/,
    ],
    [
      'readiness probe timing',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].readinessProbe.timeoutSeconds = 10; },
      /readinessProbe must exactly match/,
    ],
    [
      'liveness probe timing',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].livenessProbe.periodSeconds = 60; },
      /livenessProbe must exactly match/,
    ],
    [
      'readiness probe HTTP host override',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .readinessProbe.httpGet.host = '127.0.0.1';
      },
      /readinessProbe must exactly match/,
    ],
    [
      'liveness probe HTTP headers',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .livenessProbe.httpGet.httpHeaders = [{ name: 'Host', value: 'spoofed.invalid' }];
      },
      /livenessProbe must exactly match/,
    ],
    [
      'startup probe initial delay',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .startupProbe.initialDelaySeconds = 300;
      },
      /startupProbe must exactly match/,
    ],
    [
      'liveness probe termination grace period',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .livenessProbe.terminationGracePeriodSeconds = 600;
      },
      /livenessProbe must exactly match/,
    ],
    [
      'ephemeral storage request',
      (template) => { delete findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].resources.requests['ephemeral-storage']; },
      /bounded cpu, memory, and ephemeral-storage/,
    ],
    [
      'resource limit',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].resources.limits.memory = '1Gi'; },
      /bounded cpu, memory, and ephemeral-storage/,
    ],
    [
      'privileged container',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].securityContext.privileged = true; },
      /container security context must exactly match/,
    ],
    [
      'non-default proc mount',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].securityContext.procMount = 'Unmasked'; },
      /container security context must exactly match/,
    ],
    [
      'container capability re-add',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .securityContext.capabilities.add = ['NET_ADMIN'];
      },
      /container security context must exactly match/,
    ],
    [
      'container identity override',
      (template) => {
        findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0]
          .securityContext.runAsUser = 0;
      },
      /container security context must exactly match/,
    ],
    [
      'missing egress policy',
      (template) => {
        template.items = template.items.filter((item) => item.metadata?.name !== 'goexample-api-egress');
      },
      /resource identities must exactly match the reviewed eight-resource inventory/,
    ],
    [
      'extra permissive network policy',
      (template) => {
        template.items.push({
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: { name: 'goexample-api-allow-all', namespace: '__GOEXAMPLE_NAMESPACE__' },
          spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'], ingress: [{}], egress: [{}] },
        });
      },
      /resource identities must exactly match the reviewed eight-resource inventory/,
    ],
    [
      'extra namespaced role',
      (template) => {
        template.items.push({
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'Role',
          metadata: { name: 'unreviewed-role', namespace: '__GOEXAMPLE_NAMESPACE__' },
          rules: [],
        });
      },
      /resource identities must exactly match the reviewed eight-resource inventory/,
    ],
    [
      'ingress source broadening',
      (template) => { delete findResource(template, 'NetworkPolicy', 'goexample-api-ingress').spec.ingress[0].from; },
      /ingress NetworkPolicy must exactly allow/,
    ],
    [
      'dns namespace broadening',
      (template) => {
        findResource(template, 'NetworkPolicy', 'goexample-api-egress').spec.egress[0].to[0].namespaceSelector = {};
      },
      /egress NetworkPolicy must exactly allow/,
    ],
    [
      'egress port broadening',
      (template) => {
        findResource(template, 'NetworkPolicy', 'goexample-api-egress').spec.egress[1].ports.push({ protocol: 'TCP', port: 80 });
      },
      /egress NetworkPolicy must exactly allow/,
    ],
    [
      'rollout guardrails',
      (template) => { findResource(template, 'Deployment', 'goexample-api').spec.progressDeadlineSeconds = 60; },
      /Deployment rollout guardrails/,
    ],
    [
      'autoscaler replica bounds',
      (template) => { findResource(template, 'HorizontalPodAutoscaler', 'goexample-api').spec.maxReplicas = 100; },
      /HorizontalPodAutoscaler replica bounds/,
    ],
    [
      'autoscaler utilization targets',
      (template) => {
        findResource(template, 'HorizontalPodAutoscaler', 'goexample-api').spec.metrics[1].resource.target.averageUtilization = 95;
      },
      /exact CPU 70% and memory 75% utilization targets/,
    ],
    [
      'autoscaler scale-up rate',
      (template) => {
        findResource(template, 'HorizontalPodAutoscaler', 'goexample-api').spec.behavior.scaleUp.policies[0].value = 1000;
      },
      /HorizontalPodAutoscaler scale-up behavior/,
    ],
    [
      'autoscaler scale-down rate',
      (template) => {
        findResource(template, 'HorizontalPodAutoscaler', 'goexample-api').spec.behavior.scaleDown.selectPolicy = 'Max';
      },
      /HorizontalPodAutoscaler scale-down behavior/,
    ],
  ];
  for (const [name, mutate, expectedError] of tamperCases) {
    const tamperedTemplate = JSON.parse(await readFile(templatePath, 'utf8'));
    mutate(tamperedTemplate);
    await writeFile(tamperedPath, `${JSON.stringify(tamperedTemplate, null, 2)}\n`, 'utf8');
    const tampered = run(['check', '--template', path.relative(repositoryRoot, tamperedPath)]);
    assert.equal(tampered.status, 1, name);
    assert.match(tampered.stderr, expectedError, name);
  }

  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  findResource(template, 'Deployment', 'goexample-api').spec.template.spec.containers[0].image = immutableImage;
  await writeFile(tamperedPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  const concreteTemplate = run(['check', '--template', path.relative(repositoryRoot, tamperedPath)]);
  assert.equal(concreteTemplate.status, 1);
  assert.match(concreteTemplate.stderr, /template image must remain/);
});
