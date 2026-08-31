import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const defaultTemplate = path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json');
const defaultOutput = path.join(repositoryRoot, '.temp', 'deployment', 'kubernetes', 'goexample-api.json');
const kubernetesEvidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'kubernetes-manifest');
const namespacePlaceholder = '__GOEXAMPLE_NAMESPACE__';
const imagePlaceholder = '__GOEXAMPLE_IMAGE_DIGEST__';
const originPlaceholder = '__GOEXAMPLE_ALLOWED_ORIGIN__';
const oidcIssuerPlaceholder = '__GOEXAMPLE_OIDC_ISSUER__';
const oidcAudiencePlaceholder = '__GOEXAMPLE_OIDC_AUDIENCE__';
const oidcJWKSURLPlaceholder = '__GOEXAMPLE_OIDC_JWKS_URL__';
const configChecksumPlaceholder = '__GOEXAMPLE_CONFIG_SHA256__';
const configChecksumAnnotation = 'goexample.io/config-sha256';
const secretRevisionPlaceholder = '__GOEXAMPLE_SECRET_REVISION__';
const secretRevisionAnnotation = 'goexample.io/secret-revision';
const workloadLabels = Object.freeze({
  'app.kubernetes.io/name': 'goexample-api',
  'app.kubernetes.io/component': 'api',
});
const workloadSelector = Object.freeze({ matchLabels: workloadLabels });
const resourceIdentities = Object.freeze([
  'apps/v1/Deployment/goexample-api',
  'autoscaling/v2/HorizontalPodAutoscaler/goexample-api',
  'networking.k8s.io/v1/NetworkPolicy/goexample-api-egress',
  'networking.k8s.io/v1/NetworkPolicy/goexample-api-ingress',
  'policy/v1/PodDisruptionBudget/goexample-api',
  'v1/ConfigMap/goexample-api-config',
  'v1/Service/goexample-api',
  'v1/ServiceAccount/goexample-api',
]);
const probeDefinitions = Object.freeze({
  startupProbe: Object.freeze({
    httpGet: Object.freeze({ path: '/startupz', port: 'http', scheme: 'HTTP' }),
    periodSeconds: 2,
    timeoutSeconds: 2,
    failureThreshold: 30,
    successThreshold: 1,
  }),
  readinessProbe: Object.freeze({
    httpGet: Object.freeze({ path: '/readyz', port: 'http', scheme: 'HTTP' }),
    periodSeconds: 5,
    timeoutSeconds: 3,
    failureThreshold: 2,
    successThreshold: 1,
  }),
  livenessProbe: Object.freeze({
    httpGet: Object.freeze({ path: '/livez', port: 'http', scheme: 'HTTP' }),
    periodSeconds: 10,
    timeoutSeconds: 2,
    failureThreshold: 3,
    successThreshold: 1,
  }),
});
const resourceQuantities = Object.freeze({
  requests: Object.freeze({ cpu: '100m', memory: '128Mi', 'ephemeral-storage': '64Mi' }),
  limits: Object.freeze({ cpu: '1000m', memory: '512Mi', 'ephemeral-storage': '256Mi' }),
});
const podSecurityContext = Object.freeze({
  runAsNonRoot: true,
  runAsUser: 65532,
  runAsGroup: 65532,
  fsGroup: 65532,
  seccompProfile: Object.freeze({ type: 'RuntimeDefault' }),
});
const topologySpreadConstraints = Object.freeze([
  Object.freeze({
    maxSkew: 1,
    topologyKey: 'kubernetes.io/hostname',
    whenUnsatisfiable: 'DoNotSchedule',
    labelSelector: workloadSelector,
  }),
  Object.freeze({
    maxSkew: 1,
    topologyKey: 'topology.kubernetes.io/zone',
    whenUnsatisfiable: 'ScheduleAnyway',
    labelSelector: workloadSelector,
  }),
]);
const containerSecurityContext = Object.freeze({
  allowPrivilegeEscalation: false,
  privileged: false,
  procMount: 'Default',
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
  capabilities: Object.freeze({ drop: Object.freeze(['ALL']) }),
});
const containerPorts = Object.freeze([
  Object.freeze({ name: 'http', containerPort: 3001, protocol: 'TCP' }),
]);
const serviceSpec = Object.freeze({
  type: 'ClusterIP',
  selector: workloadLabels,
  ports: Object.freeze([
    Object.freeze({ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }),
  ]),
});
const environmentSources = Object.freeze([
  Object.freeze({
    configMapRef: Object.freeze({ name: 'goexample-api-config', optional: false }),
  }),
  Object.freeze({
    secretRef: Object.freeze({ name: 'goexample-api-runtime', optional: false }),
  }),
]);

function containerDefinition(image) {
  return Object.freeze({
    name: 'api',
    image,
    imagePullPolicy: 'IfNotPresent',
    ports: containerPorts,
    envFrom: environmentSources,
    startupProbe: probeDefinitions.startupProbe,
    readinessProbe: probeDefinitions.readinessProbe,
    livenessProbe: probeDefinitions.livenessProbe,
    resources: resourceQuantities,
    securityContext: containerSecurityContext,
  });
}

function podSpecDefinition(image) {
  return Object.freeze({
    serviceAccountName: 'goexample-api',
    automountServiceAccountToken: false,
    enableServiceLinks: false,
    hostNetwork: false,
    hostPID: false,
    hostIPC: false,
    shareProcessNamespace: false,
    terminationGracePeriodSeconds: 30,
    securityContext: podSecurityContext,
    topologySpreadConstraints,
    containers: Object.freeze([containerDefinition(image)]),
  });
}

function podTemplateDefinition(image, configChecksum, secretRevision) {
  return Object.freeze({
    metadata: Object.freeze({
      labels: workloadLabels,
      annotations: Object.freeze({
        [configChecksumAnnotation]: configChecksum,
        [secretRevisionAnnotation]: secretRevision,
      }),
    }),
    spec: podSpecDefinition(image),
  });
}
const environmentConfigKeys = Object.freeze([
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
]);
const fixedEnvironmentConfigValues = Object.freeze({
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
});
const ingressNetworkPolicySpec = {
  podSelector: { matchLabels: workloadLabels },
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
};
const egressNetworkPolicySpec = {
  podSelector: { matchLabels: workloadLabels },
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
};

function fail(message) {
  throw new Error(`Kubernetes manifest: ${message}`);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseArguments(args) {
  const task = args[0];
  if (!['check', 'render'].includes(task)) {
    fail('task must be check or render');
  }
  const options = {
    task,
    template: defaultTemplate,
    output: defaultOutput,
    namespace: '',
    image: '',
    allowedOrigin: '',
    oidcIssuer: '',
    oidcAudience: '',
    oidcJWKSURL: '',
    secretRevision: '',
  };
  const names = new Map([
    ['--template', 'template'],
    ['--output', 'output'],
    ['--namespace', 'namespace'],
    ['--image', 'image'],
    ['--allowed-origin', 'allowedOrigin'],
    ['--oidc-issuer', 'oidcIssuer'],
    ['--oidc-audience', 'oidcAudience'],
    ['--oidc-jwks-url', 'oidcJWKSURL'],
    ['--secret-revision', 'secretRevision'],
  ]);
  const seen = new Set();
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    const property = names.get(name);
    if (!property) {
      fail(`unknown argument: ${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`${name} requires a value`);
    }
    if (seen.has(name)) {
      fail(`${name} may only be specified once`);
    }
    seen.add(name);
    options[property] = property === 'template' || property === 'output'
      ? path.resolve(repositoryRoot, value)
      : value.trim();
    index += 1;
  }
  if (!isWithin(repositoryRoot, options.template)) {
    fail('template must be inside the repository');
  }
  if (task === 'check' && (
    options.namespace || options.image || options.allowedOrigin || options.oidcIssuer || options.oidcAudience ||
    options.oidcJWKSURL || options.secretRevision || options.output !== defaultOutput
  )) {
    fail('check only accepts --template');
  }
  if (task === 'render') {
    if (!options.namespace || !options.image || !options.allowedOrigin || !options.oidcIssuer || !options.oidcAudience || !options.oidcJWKSURL || !options.secretRevision) {
      fail('render requires --namespace, --image, --allowed-origin, --oidc-issuer, --oidc-audience, --oidc-jwks-url, and --secret-revision');
    }
    const deploymentRoot = path.join(repositoryRoot, '.temp', 'deployment');
    if (
      (!isWithin(deploymentRoot, options.output) && !isWithin(kubernetesEvidenceRoot, options.output)) ||
      path.extname(options.output).toLowerCase() !== '.json'
    ) {
      fail('output must be a .json file inside .temp/deployment or the fixed Kubernetes evidence directory');
    }
  }
  return options;
}

function readManifest(templatePath) {
  if (!existsSync(templatePath)) {
    fail(`template does not exist: ${path.relative(repositoryRoot, templatePath)}`);
  }
  try {
    return JSON.parse(readFileSync(templatePath, 'utf8'));
  } catch (error) {
    fail(`template must be valid JSON: ${error.message}`);
  }
}

function hasExactWorkloadLabels(actual) {
  return isDeepStrictEqual(actual, workloadLabels);
}

function hasExactWorkloadSelector(actual) {
  return isDeepStrictEqual(actual, workloadSelector);
}

function resource(manifest, kind, name) {
  const matches = manifest.items.filter((item) => item.kind === kind && item.metadata?.name === name);
  if (matches.length !== 1) {
    fail(`expected exactly one ${kind}/${name}`);
  }
  return matches[0];
}

function integerAtLeast(value, minimum, field) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(`${field} must be an integer greater than or equal to ${minimum}`);
  }
}

function sameScalingPolicies(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((policy, index) =>
      policy?.type === expected[index].type &&
      policy.value === expected[index].value &&
      policy.periodSeconds === expected[index].periodSeconds
    )
  );
}

function isUtilizationMetric(metric, name, averageUtilization) {
  return (
    metric?.type === 'Resource' &&
    metric.resource?.name === name &&
    metric.resource?.target?.type === 'Utilization' &&
    metric.resource.target.averageUtilization === averageUtilization
  );
}

function requireProbe(container, name) {
  const expected = probeDefinitions[name];
  if (!isDeepStrictEqual(container[name], expected)) {
    fail(`${name} must exactly match the fixed HTTP endpoint and timing baseline`);
  }
}

function hasExactResourceQuantities(actual, expected) {
  return (
    actual &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([name, value]) => actual[name] === value)
  );
}

function parseSeconds(value, field) {
  const match = `${value ?? ''}`.match(/^(\d+)s$/);
  if (!match) {
    fail(`${field} must be expressed as whole seconds`);
  }
  return Number(match[1]);
}

function validateImage(image, allowPlaceholder) {
  if (allowPlaceholder && image === imagePlaceholder) {
    return;
  }
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/.test(image)) {
    fail('image must be an immutable registry reference ending in @sha256:<64 lowercase hex characters>');
  }
}

function validateNamespace(value, allowPlaceholder) {
  if (allowPlaceholder && value === namespacePlaceholder) {
    return;
  }
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    fail('namespace must be a 1-63 character lowercase Kubernetes DNS label');
  }
  if (['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(value)) {
    fail('namespace must not use default or Kubernetes system namespaces');
  }
}

function validateOrigin(origin, allowPlaceholder) {
  if (allowPlaceholder && origin === originPlaceholder) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail('allowed origin must be an absolute HTTPS origin');
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    origin.endsWith('/')
  ) {
    fail('allowed origin must be an absolute HTTPS origin without credentials, path, query, fragment, or trailing slash');
  }
}

function validateOIDCEndpoint(value, placeholder, field, allowPlaceholder) {
  if (allowPlaceholder && value === placeholder) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${field} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${field} must be an absolute HTTPS URL without credentials, query, or fragment`);
  }
}

function validateOIDCAudience(value, allowPlaceholder) {
  if (allowPlaceholder && value === oidcAudiencePlaceholder) {
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    fail('OIDC_AUDIENCE must be 1-128 safe ASCII characters');
  }
}

function validateSecretRevision(value, allowPlaceholder) {
  if (allowPlaceholder && value === secretRevisionPlaceholder) {
    return;
  }
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail('secret revision must be 1-128 safe non-secret ASCII characters');
  }
}

function configDataChecksum(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    fail('ConfigMap data must be an object');
  }
  const entries = Object.entries(data);
  if (entries.some(([, value]) => typeof value !== 'string')) {
    fail('ConfigMap data values must be strings');
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(entries)), 'utf8')
    .digest('hex');
}

export function validateManifest(manifest, { allowPlaceholders }) {
  if (manifest?.apiVersion !== 'v1' || manifest.kind !== 'List' || !Array.isArray(manifest.items)) {
    fail('template root must be a Kubernetes v1 List');
  }
  if (manifest.items.some((item) => item.kind === 'Secret')) {
    fail('checked-in manifests must not contain Secret resources');
  }
  const namespaces = new Set(manifest.items.map((item) => item.metadata?.namespace));
  if (namespaces.size !== 1) {
    fail('all resources must use exactly one explicit namespace');
  }
  validateNamespace(namespaces.values().next().value, allowPlaceholders);
  const identities = new Set();
  for (const item of manifest.items) {
    const identity = `${item.apiVersion}/${item.kind}/${item.metadata?.name}`;
    if (identities.has(identity)) {
      fail(`duplicate resource ${identity}`);
    }
    identities.add(identity);
  }
  if (!isDeepStrictEqual([...identities].sort(), resourceIdentities)) {
    fail('manifest resource identities must exactly match the reviewed eight-resource inventory');
  }

  const config = resource(manifest, 'ConfigMap', 'goexample-api-config');
  if (!isDeepStrictEqual(Object.keys(config.data ?? {}).sort(), environmentConfigKeys)) {
    fail('ConfigMap data keys must exactly match the reviewed non-secret environment inventory');
  }
  if (Object.entries(fixedEnvironmentConfigValues).some(([key, value]) => config.data[key] !== value)) {
    fail('ConfigMap fixed environment values must exactly match the reviewed production baseline');
  }
  if (config.data?.APP_ENV !== 'production' || config.data?.SHARED_STATE_MODE !== 'external') {
    fail('production must use APP_ENV=production and SHARED_STATE_MODE=external');
  }
  if (config.data?.ALLOW_IN_MEMORY_SHARED_STATE !== 'false' || config.data?.DEMO_AUTH_ENABLED !== 'false') {
    fail('production must disable in-memory shared-state fallback and demo authentication');
  }
  if (config.data?.OIDC_AUTH_ENABLED !== 'true') {
    fail('production template must enable OIDC bearer verification');
  }
  if (config.data?.PPROF_ENABLED !== 'false' || config.data?.SYSTEM_INFO_DETAILED !== 'false') {
    fail('production template must disable pprof and detailed system information');
  }
  validateOrigin(config.data?.CORS_ALLOW_ORIGINS, allowPlaceholders);
  validateOIDCEndpoint(config.data?.OIDC_ISSUER, oidcIssuerPlaceholder, 'OIDC_ISSUER', allowPlaceholders);
  validateOIDCEndpoint(config.data?.OIDC_JWKS_URL, oidcJWKSURLPlaceholder, 'OIDC_JWKS_URL', allowPlaceholders);
  validateOIDCAudience(config.data?.OIDC_AUDIENCE, allowPlaceholders);

  const serviceAccount = resource(manifest, 'ServiceAccount', 'goexample-api');
  if (serviceAccount.automountServiceAccountToken !== false) {
    fail('ServiceAccount token automount must be disabled');
  }

  const deployment = resource(manifest, 'Deployment', 'goexample-api');
  integerAtLeast(deployment.spec?.replicas, 3, 'Deployment replicas');
  if (
    !hasExactWorkloadSelector(deployment.spec?.selector) ||
    !hasExactWorkloadLabels(deployment.spec?.template?.metadata?.labels)
  ) {
    fail('Deployment selector must contain only the fixed workload matchLabels and pod labels must exactly equal them');
  }
  const configChecksum = deployment.spec?.template?.metadata?.annotations?.[configChecksumAnnotation];
  if (
    !(allowPlaceholders && configChecksum === configChecksumPlaceholder) &&
    configChecksum !== configDataChecksum(config.data)
  ) {
    fail(`Deployment pod template ${configChecksumAnnotation} must match the canonical ConfigMap data SHA-256`);
  }
  const secretRevision = deployment.spec?.template?.metadata?.annotations?.[secretRevisionAnnotation];
  validateSecretRevision(secretRevision, allowPlaceholders);
  if (
    deployment.spec?.strategy?.type !== 'RollingUpdate' ||
    deployment.spec?.strategy?.rollingUpdate?.maxUnavailable !== 0 ||
    deployment.spec?.strategy?.rollingUpdate?.maxSurge !== 1
  ) {
    fail('Deployment rolling update must use maxUnavailable=0 and maxSurge=1');
  }
  if (
    deployment.spec?.revisionHistoryLimit !== 5 ||
    deployment.spec?.minReadySeconds !== 10 ||
    deployment.spec?.progressDeadlineSeconds !== 600
  ) {
    fail('Deployment rollout guardrails must retain 5 revisions, require 10 ready seconds, and use a 600-second deadline');
  }
  const pod = deployment.spec?.template?.spec;
  if (pod?.serviceAccountName !== 'goexample-api' || pod.automountServiceAccountToken !== false) {
    fail('pods must use the tokenless goexample-api ServiceAccount');
  }
  if (
    pod?.enableServiceLinks !== false ||
    pod?.hostNetwork !== false ||
    pod?.hostPID !== false ||
    pod?.hostIPC !== false ||
    pod?.shareProcessNamespace !== false
  ) {
    fail('pods must disable service links and host namespace sharing');
  }
  if (!isDeepStrictEqual(pod?.securityContext, podSecurityContext)) {
    fail('pod security context must exactly match the fixed UID/GID/fsGroup and RuntimeDefault seccomp baseline');
  }
  integerAtLeast(pod?.terminationGracePeriodSeconds, 1, 'terminationGracePeriodSeconds');
  const shutdownSeconds = parseSeconds(config.data?.SHUTDOWN_TIMEOUT, 'SHUTDOWN_TIMEOUT');
  if (pod.terminationGracePeriodSeconds <= shutdownSeconds) {
    fail('terminationGracePeriodSeconds must exceed SHUTDOWN_TIMEOUT');
  }
  const hostnameSpread = pod?.topologySpreadConstraints?.find(
    (constraint) => constraint.topologyKey === 'kubernetes.io/hostname',
  );
  if (
    pod?.topologySpreadConstraints?.length !== 2 ||
    hostnameSpread?.maxSkew !== 1 ||
    hostnameSpread.whenUnsatisfiable !== 'DoNotSchedule' ||
    !hasExactWorkloadSelector(hostnameSpread.labelSelector)
  ) {
    fail('pods must use strict hostname topology spreading with maxSkew=1 and only the fixed workload matchLabels');
  }
  const zoneSpread = pod.topologySpreadConstraints.find(
    (constraint) => constraint.topologyKey === 'topology.kubernetes.io/zone',
  );
  if (
    zoneSpread?.maxSkew !== 1 ||
    zoneSpread.whenUnsatisfiable !== 'ScheduleAnyway' ||
    !hasExactWorkloadSelector(zoneSpread.labelSelector)
  ) {
    fail('pods must use soft zone topology spreading with maxSkew=1 and only the fixed workload matchLabels');
  }
  if (!Array.isArray(pod?.containers) || pod.containers.length !== 1) {
    fail('Deployment must define exactly one container');
  }
  const container = pod.containers[0];
  if (container.name !== 'api' || !isDeepStrictEqual(container.ports, containerPorts)) {
    fail('api container ports must exactly expose TCP 3001 as http');
  }
  validateImage(container.image, allowPlaceholders);
  if (!isDeepStrictEqual(container.envFrom, environmentSources)) {
    fail('api container envFrom must exactly load the required ConfigMap then Secret with optional=false and no prefixes or extra sources');
  }
  if (container.env !== undefined) {
    fail('api container must not define inline env overrides');
  }
  requireProbe(container, 'startupProbe');
  requireProbe(container, 'readinessProbe');
  requireProbe(container, 'livenessProbe');
  if (
    !hasExactResourceQuantities(container.resources?.requests, resourceQuantities.requests) ||
    !hasExactResourceQuantities(container.resources?.limits, resourceQuantities.limits)
  ) {
    fail('container resources must exactly define bounded cpu, memory, and ephemeral-storage requests and limits');
  }
  if (!isDeepStrictEqual(container.securityContext, containerSecurityContext)) {
    fail('container security context must exactly match the fixed non-root, read-only, non-privileged, drop-all baseline');
  }
  if (!isDeepStrictEqual(container, containerDefinition(container.image))) {
    fail('api container must exactly match the fixed image policy, runtime surface, probes, resources, and security baseline');
  }
  if (!isDeepStrictEqual(pod, podSpecDefinition(container.image))) {
    fail('PodSpec must exactly match the fixed identity, isolation, shutdown, topology, and container baseline');
  }
  if (!isDeepStrictEqual(deployment.spec?.template, podTemplateDefinition(container.image, configChecksum, secretRevision))) {
    fail('PodTemplateSpec must exactly match the fixed labels, rollout annotations, and PodSpec baseline');
  }

  const service = resource(manifest, 'Service', 'goexample-api');
  if (!isDeepStrictEqual(service.spec, serviceSpec)) {
    fail('Service spec must exactly expose ClusterIP TCP 80 to the fixed http workload port and selector');
  }

  const disruptionBudget = resource(manifest, 'PodDisruptionBudget', 'goexample-api');
  integerAtLeast(disruptionBudget.spec?.minAvailable, 2, 'PodDisruptionBudget minAvailable');
  if (disruptionBudget.spec?.unhealthyPodEvictionPolicy !== 'AlwaysAllow') {
    fail('PodDisruptionBudget unhealthyPodEvictionPolicy must be AlwaysAllow');
  }
  if (!hasExactWorkloadSelector(disruptionBudget.spec?.selector)) {
    fail('PodDisruptionBudget selector must contain only the fixed workload matchLabels');
  }

  const autoscaler = resource(manifest, 'HorizontalPodAutoscaler', 'goexample-api');
  if (autoscaler.apiVersion !== 'autoscaling/v2') {
    fail('HorizontalPodAutoscaler must use autoscaling/v2');
  }
  if (autoscaler.spec?.minReplicas !== 3 || autoscaler.spec?.maxReplicas !== 10) {
    fail('HorizontalPodAutoscaler replica bounds must remain 3 through 10');
  }
  if (
    autoscaler.spec?.scaleTargetRef?.apiVersion !== 'apps/v1' ||
    autoscaler.spec?.scaleTargetRef?.kind !== 'Deployment' ||
    autoscaler.spec?.scaleTargetRef?.name !== 'goexample-api'
  ) {
    fail('HorizontalPodAutoscaler must target apps/v1 Deployment/goexample-api');
  }
  const autoscalerMetrics = autoscaler.spec?.metrics;
  if (
    !Array.isArray(autoscalerMetrics) ||
    autoscalerMetrics.length !== 2 ||
    !autoscalerMetrics.some((metric) => isUtilizationMetric(metric, 'cpu', 70)) ||
    !autoscalerMetrics.some((metric) => isUtilizationMetric(metric, 'memory', 75))
  ) {
    fail('HorizontalPodAutoscaler must define exact CPU 70% and memory 75% utilization targets');
  }
  const scaleUp = autoscaler.spec?.behavior?.scaleUp;
  if (
    scaleUp?.stabilizationWindowSeconds !== 0 ||
    scaleUp?.selectPolicy !== 'Max' ||
    !sameScalingPolicies(scaleUp?.policies, [
      { type: 'Percent', value: 100, periodSeconds: 60 },
      { type: 'Pods', value: 2, periodSeconds: 60 },
    ])
  ) {
    fail('HorizontalPodAutoscaler scale-up behavior must allow at most 100% or 2 Pods per 60 seconds');
  }
  const scaleDown = autoscaler.spec?.behavior?.scaleDown;
  if (
    scaleDown?.stabilizationWindowSeconds !== 300 ||
    scaleDown?.selectPolicy !== 'Min' ||
    !sameScalingPolicies(scaleDown?.policies, [
      { type: 'Percent', value: 25, periodSeconds: 60 },
      { type: 'Pods', value: 1, periodSeconds: 60 },
    ])
  ) {
    fail('HorizontalPodAutoscaler scale-down behavior must stabilize for 300 seconds and remove at most 25% and 1 Pod per 60 seconds');
  }

  const networkPolicies = manifest.items.filter((item) => item.kind === 'NetworkPolicy');
  if (networkPolicies.length !== 2) {
    fail('manifest must define exactly the fixed ingress and egress NetworkPolicies');
  }
  const ingressNetworkPolicy = resource(manifest, 'NetworkPolicy', 'goexample-api-ingress');
  if (
    ingressNetworkPolicy.apiVersion !== 'networking.k8s.io/v1' ||
    !isDeepStrictEqual(ingressNetworkPolicy.spec, ingressNetworkPolicySpec)
  ) {
    fail('ingress NetworkPolicy must exactly allow same-namespace and labeled-namespace TCP 3001 access');
  }
  const egressNetworkPolicy = resource(manifest, 'NetworkPolicy', 'goexample-api-egress');
  if (
    egressNetworkPolicy.apiVersion !== 'networking.k8s.io/v1' ||
    !isDeepStrictEqual(egressNetworkPolicy.spec, egressNetworkPolicySpec)
  ) {
    fail('egress NetworkPolicy must exactly allow kube-system DNS plus TCP 443 and 6380');
  }
}

function requireTemplatePlaceholders(manifest) {
  const config = resource(manifest, 'ConfigMap', 'goexample-api-config');
  const deployment = resource(manifest, 'Deployment', 'goexample-api');
  if (manifest.items.some((item) => item.metadata?.namespace !== namespacePlaceholder)) {
    fail(`template resource namespaces must remain ${namespacePlaceholder}`);
  }
  if (config.data?.CORS_ALLOW_ORIGINS !== originPlaceholder) {
    fail(`template CORS_ALLOW_ORIGINS must remain ${originPlaceholder}`);
  }
  if (config.data?.OIDC_ISSUER !== oidcIssuerPlaceholder || config.data?.OIDC_AUDIENCE !== oidcAudiencePlaceholder || config.data?.OIDC_JWKS_URL !== oidcJWKSURLPlaceholder) {
    fail('template OIDC values must remain environment-specific placeholders');
  }
  if (deployment.spec?.template?.spec?.containers?.[0]?.image !== imagePlaceholder) {
    fail(`template image must remain ${imagePlaceholder}`);
  }
  if (deployment.spec?.template?.metadata?.annotations?.[configChecksumAnnotation] !== configChecksumPlaceholder) {
    fail(`template config checksum must remain ${configChecksumPlaceholder}`);
  }
  if (deployment.spec?.template?.metadata?.annotations?.[secretRevisionAnnotation] !== secretRevisionPlaceholder) {
    fail(`template secret revision must remain ${secretRevisionPlaceholder}`);
  }
}

function replaceExact(value, replacements) {
  if (typeof value === 'string') {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceExact(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, replaceExact(item, replacements)]));
  }
  return value;
}

export function renderManifest(template, { namespace, image, allowedOrigin, oidcIssuer, oidcAudience, oidcJWKSURL, secretRevision }) {
  validateManifest(template, { allowPlaceholders: true });
  requireTemplatePlaceholders(template);
  validateNamespace(namespace, false);
  validateImage(image, false);
  validateOrigin(allowedOrigin, false);
  validateOIDCEndpoint(oidcIssuer, oidcIssuerPlaceholder, 'OIDC issuer', false);
  validateOIDCEndpoint(oidcJWKSURL, oidcJWKSURLPlaceholder, 'OIDC JWKS URL', false);
  validateOIDCAudience(oidcAudience, false);
  validateSecretRevision(secretRevision, false);
  const rendered = replaceExact(template, new Map([
    [namespacePlaceholder, namespace],
    [imagePlaceholder, image],
    [originPlaceholder, allowedOrigin],
    [oidcIssuerPlaceholder, oidcIssuer],
    [oidcAudiencePlaceholder, oidcAudience],
    [oidcJWKSURLPlaceholder, oidcJWKSURL],
    [secretRevisionPlaceholder, secretRevision],
  ]));
  const renderedConfig = resource(rendered, 'ConfigMap', 'goexample-api-config');
  const renderedDeployment = resource(rendered, 'Deployment', 'goexample-api');
  renderedDeployment.spec.template.metadata.annotations[configChecksumAnnotation] = configDataChecksum(renderedConfig.data);
  validateManifest(rendered, { allowPlaceholders: false });
  return rendered;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const template = readManifest(options.template);
  validateManifest(template, { allowPlaceholders: true });
  requireTemplatePlaceholders(template);
  if (options.task === 'check') {
    console.log(`Kubernetes template passed: ${path.relative(repositoryRoot, options.template)}`);
    return;
  }
  const rendered = renderManifest(template, options);
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(rendered, null, 2)}\n`, 'utf8');
  console.log(`Kubernetes manifest written to ${path.relative(repositoryRoot, options.output)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
