import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const defaultTemplate = path.join(repositoryRoot, 'deploy', 'kubernetes', 'goexample-api.template.json');
const defaultOutput = path.join(repositoryRoot, '.temp', 'deployment', 'kubernetes', 'goexample-api.json');
const imagePlaceholder = '__GOEXAMPLE_IMAGE_DIGEST__';
const originPlaceholder = '__GOEXAMPLE_ALLOWED_ORIGIN__';
const oidcIssuerPlaceholder = '__GOEXAMPLE_OIDC_ISSUER__';
const oidcAudiencePlaceholder = '__GOEXAMPLE_OIDC_AUDIENCE__';
const oidcJWKSURLPlaceholder = '__GOEXAMPLE_OIDC_JWKS_URL__';
const workloadLabels = {
  'app.kubernetes.io/name': 'goexample-api',
  'app.kubernetes.io/component': 'api',
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
    image: '',
    allowedOrigin: '',
    oidcIssuer: '',
    oidcAudience: '',
    oidcJWKSURL: '',
  };
  const names = new Map([
    ['--template', 'template'],
    ['--output', 'output'],
    ['--image', 'image'],
    ['--allowed-origin', 'allowedOrigin'],
    ['--oidc-issuer', 'oidcIssuer'],
    ['--oidc-audience', 'oidcAudience'],
    ['--oidc-jwks-url', 'oidcJWKSURL'],
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
    options.image || options.allowedOrigin || options.oidcIssuer || options.oidcAudience ||
    options.oidcJWKSURL || options.output !== defaultOutput
  )) {
    fail('check only accepts --template');
  }
  if (task === 'render') {
    if (!options.image || !options.allowedOrigin || !options.oidcIssuer || !options.oidcAudience || !options.oidcJWKSURL) {
      fail('render requires --image, --allowed-origin, --oidc-issuer, --oidc-audience, and --oidc-jwks-url');
    }
    const deploymentRoot = path.join(repositoryRoot, '.temp', 'deployment');
    if (!isWithin(deploymentRoot, options.output) || path.extname(options.output).toLowerCase() !== '.json') {
      fail('output must be a .json file inside .temp/deployment');
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

function sameLabels(actual) {
  return Object.entries(workloadLabels).every(([name, value]) => actual?.[name] === value);
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

function requireProbe(container, name, pathName) {
  const probe = container[name];
  if (probe?.httpGet?.path !== pathName || probe.httpGet.port !== 'http' || probe.httpGet.scheme !== 'HTTP') {
    fail(`${name} must use HTTP ${pathName} on the named http port`);
  }
  integerAtLeast(probe.periodSeconds, 1, `${name}.periodSeconds`);
  integerAtLeast(probe.timeoutSeconds, 1, `${name}.timeoutSeconds`);
  integerAtLeast(probe.failureThreshold, 1, `${name}.failureThreshold`);
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

function validateManifest(manifest, { allowPlaceholders }) {
  if (manifest?.apiVersion !== 'v1' || manifest.kind !== 'List' || !Array.isArray(manifest.items)) {
    fail('template root must be a Kubernetes v1 List');
  }
  if (manifest.items.some((item) => item.kind === 'Secret')) {
    fail('checked-in manifests must not contain Secret resources');
  }
  const identities = new Set();
  for (const item of manifest.items) {
    const identity = `${item.apiVersion}/${item.kind}/${item.metadata?.name}`;
    if (identities.has(identity)) {
      fail(`duplicate resource ${identity}`);
    }
    identities.add(identity);
  }

  const config = resource(manifest, 'ConfigMap', 'goexample-api-config');
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
  if (!sameLabels(deployment.spec?.selector?.matchLabels) || !sameLabels(deployment.spec?.template?.metadata?.labels)) {
    fail('Deployment selector and pod labels must contain the fixed workload labels');
  }
  if (
    deployment.spec?.strategy?.type !== 'RollingUpdate' ||
    deployment.spec?.strategy?.rollingUpdate?.maxUnavailable !== 0 ||
    deployment.spec?.strategy?.rollingUpdate?.maxSurge !== 1
  ) {
    fail('Deployment rolling update must use maxUnavailable=0 and maxSurge=1');
  }
  integerAtLeast(deployment.spec?.minReadySeconds, 1, 'Deployment minReadySeconds');
  const pod = deployment.spec?.template?.spec;
  if (pod?.serviceAccountName !== 'goexample-api' || pod.automountServiceAccountToken !== false) {
    fail('pods must use the tokenless goexample-api ServiceAccount');
  }
  if (
    pod?.securityContext?.runAsNonRoot !== true ||
    pod?.securityContext?.seccompProfile?.type !== 'RuntimeDefault'
  ) {
    fail('pod security context must require non-root and RuntimeDefault seccomp');
  }
  integerAtLeast(pod?.terminationGracePeriodSeconds, 1, 'terminationGracePeriodSeconds');
  const shutdownSeconds = parseSeconds(config.data?.SHUTDOWN_TIMEOUT, 'SHUTDOWN_TIMEOUT');
  if (pod.terminationGracePeriodSeconds <= shutdownSeconds) {
    fail('terminationGracePeriodSeconds must exceed SHUTDOWN_TIMEOUT');
  }
  const hostnameSpread = pod?.topologySpreadConstraints?.find(
    (constraint) => constraint.topologyKey === 'kubernetes.io/hostname',
  );
  if (hostnameSpread?.maxSkew !== 1 || hostnameSpread.whenUnsatisfiable !== 'DoNotSchedule') {
    fail('pods must use strict hostname topology spreading with maxSkew=1');
  }
  if (!Array.isArray(pod?.containers) || pod.containers.length !== 1) {
    fail('Deployment must define exactly one container');
  }
  const container = pod.containers[0];
  if (container.name !== 'api' || container.ports?.[0]?.containerPort !== 3001 || container.ports?.[0]?.name !== 'http') {
    fail('api container must expose TCP port 3001 as http');
  }
  validateImage(container.image, allowPlaceholders);
  const envSources = container.envFrom ?? [];
  if (!envSources.some((source) => source.configMapRef?.name === 'goexample-api-config')) {
    fail('api container must load goexample-api-config');
  }
  if (!envSources.some((source) => source.secretRef?.name === 'goexample-api-runtime')) {
    fail('api container must require the external goexample-api-runtime Secret');
  }
  requireProbe(container, 'startupProbe', '/startupz');
  requireProbe(container, 'readinessProbe', '/readyz');
  requireProbe(container, 'livenessProbe', '/livez');
  for (const resourceType of ['requests', 'limits']) {
    if (!container.resources?.[resourceType]?.cpu || !container.resources?.[resourceType]?.memory) {
      fail(`container resources.${resourceType} must define cpu and memory`);
    }
  }
  const containerSecurity = container.securityContext;
  if (
    containerSecurity?.allowPrivilegeEscalation !== false ||
    containerSecurity?.readOnlyRootFilesystem !== true ||
    containerSecurity?.runAsNonRoot !== true ||
    !containerSecurity?.capabilities?.drop?.includes('ALL')
  ) {
    fail('container must be non-root, read-only, non-privileged, and drop all capabilities');
  }

  const service = resource(manifest, 'Service', 'goexample-api');
  if (service.spec?.type !== 'ClusterIP' || !sameLabels(service.spec?.selector)) {
    fail('Service must be ClusterIP and select the fixed workload labels');
  }
  if (service.spec?.ports?.length !== 1 || service.spec.ports[0].port !== 80 || service.spec.ports[0].targetPort !== 'http') {
    fail('Service must map port 80 to the named http port');
  }

  const disruptionBudget = resource(manifest, 'PodDisruptionBudget', 'goexample-api');
  integerAtLeast(disruptionBudget.spec?.minAvailable, 2, 'PodDisruptionBudget minAvailable');
  if (!sameLabels(disruptionBudget.spec?.selector?.matchLabels)) {
    fail('PodDisruptionBudget must select the fixed workload labels');
  }

  const autoscaler = resource(manifest, 'HorizontalPodAutoscaler', 'goexample-api');
  integerAtLeast(autoscaler.spec?.minReplicas, 3, 'HorizontalPodAutoscaler minReplicas');
  integerAtLeast(autoscaler.spec?.maxReplicas, autoscaler.spec.minReplicas + 1, 'HorizontalPodAutoscaler maxReplicas');
  if (autoscaler.spec?.scaleTargetRef?.name !== 'goexample-api') {
    fail('HorizontalPodAutoscaler must target goexample-api');
  }
  const metricNames = new Set((autoscaler.spec?.metrics ?? []).map((metric) => metric.resource?.name));
  if (!metricNames.has('cpu') || !metricNames.has('memory')) {
    fail('HorizontalPodAutoscaler must define CPU and memory utilization targets');
  }
  integerAtLeast(autoscaler.spec?.behavior?.scaleDown?.stabilizationWindowSeconds, 300, 'HPA scale-down stabilization');

  const networkPolicy = resource(manifest, 'NetworkPolicy', 'goexample-api-ingress');
  if (!sameLabels(networkPolicy.spec?.podSelector?.matchLabels)) {
    fail('NetworkPolicy must select the fixed workload labels');
  }
  if (networkPolicy.spec?.policyTypes?.length !== 1 || networkPolicy.spec.policyTypes[0] !== 'Ingress') {
    fail('baseline NetworkPolicy must restrict ingress without claiming an environment-specific egress contract');
  }
  const ingressPorts = networkPolicy.spec?.ingress?.flatMap((rule) => rule.ports ?? []) ?? [];
  if (!ingressPorts.some((port) => port.protocol === 'TCP' && port.port === 3001)) {
    fail('NetworkPolicy must allow TCP port 3001');
  }
}

function requireTemplatePlaceholders(manifest) {
  const config = resource(manifest, 'ConfigMap', 'goexample-api-config');
  const deployment = resource(manifest, 'Deployment', 'goexample-api');
  if (config.data?.CORS_ALLOW_ORIGINS !== originPlaceholder) {
    fail(`template CORS_ALLOW_ORIGINS must remain ${originPlaceholder}`);
  }
  if (config.data?.OIDC_ISSUER !== oidcIssuerPlaceholder || config.data?.OIDC_AUDIENCE !== oidcAudiencePlaceholder || config.data?.OIDC_JWKS_URL !== oidcJWKSURLPlaceholder) {
    fail('template OIDC values must remain environment-specific placeholders');
  }
  if (deployment.spec?.template?.spec?.containers?.[0]?.image !== imagePlaceholder) {
    fail(`template image must remain ${imagePlaceholder}`);
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

function main() {
  const options = parseArguments(process.argv.slice(2));
  const template = readManifest(options.template);
  validateManifest(template, { allowPlaceholders: true });
  requireTemplatePlaceholders(template);
  if (options.task === 'check') {
    console.log(`Kubernetes template passed: ${path.relative(repositoryRoot, options.template)}`);
    return;
  }
  validateImage(options.image, false);
  validateOrigin(options.allowedOrigin, false);
  validateOIDCEndpoint(options.oidcIssuer, oidcIssuerPlaceholder, 'OIDC issuer', false);
  validateOIDCEndpoint(options.oidcJWKSURL, oidcJWKSURLPlaceholder, 'OIDC JWKS URL', false);
  validateOIDCAudience(options.oidcAudience, false);
  const rendered = replaceExact(template, new Map([
    [imagePlaceholder, options.image],
    [originPlaceholder, options.allowedOrigin],
    [oidcIssuerPlaceholder, options.oidcIssuer],
    [oidcAudiencePlaceholder, options.oidcAudience],
    [oidcJWKSURLPlaceholder, options.oidcJWKSURL],
  ]));
  validateManifest(rendered, { allowPlaceholders: false });
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(rendered, null, 2)}\n`, 'utf8');
  console.log(`Kubernetes manifest written to ${path.relative(repositoryRoot, options.output)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
