import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const defaultContract = path.join(repositoryRoot, 'support', 'deploy', 'edge', 'goexample-nginx.contract.json');
const defaultOutput = path.join(repositoryRoot, '.temp', 'deployment', 'edge', 'goexample-nginx.conf');
const expectedImage = 'nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';

function fail(message) {
  throw new Error(`Nginx edge: ${message}`);
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
    contract: defaultContract,
    output: defaultOutput,
    serverName: '',
    upstreamHost: '',
    upstreamPort: 0,
  };
  const names = new Map([
    ['--contract', 'contract'],
    ['--output', 'output'],
    ['--server-name', 'serverName'],
    ['--upstream-host', 'upstreamHost'],
    ['--upstream-port', 'upstreamPort'],
  ]);
  const seen = new Set();
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    const property = names.get(name);
    if (!property) {
      fail(`unknown argument: ${name}`);
    }
    if (seen.has(name)) {
      fail(`${name} may only be specified once`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`${name} requires a value`);
    }
    seen.add(name);
    if (property === 'contract' || property === 'output') {
      options[property] = path.resolve(repositoryRoot, value);
    } else if (property === 'upstreamPort') {
      options[property] = Number(value);
    } else {
      options[property] = value.trim();
    }
    index += 1;
  }
  if (!isWithin(repositoryRoot, options.contract)) {
    fail('contract must be inside the repository');
  }
  if (task === 'check' && (
    options.output !== defaultOutput || options.serverName || options.upstreamHost || options.upstreamPort
  )) {
    fail('check only accepts --contract');
  }
  if (task === 'render') {
    if (!options.serverName || !options.upstreamHost || !options.upstreamPort) {
      fail('render requires --server-name, --upstream-host, and --upstream-port');
    }
    const deploymentRoot = path.join(repositoryRoot, '.temp', 'deployment');
    if (!isWithin(deploymentRoot, options.output) || path.extname(options.output).toLowerCase() !== '.conf') {
      fail('output must be a .conf file inside .temp/deployment');
    }
  }
  return options;
}

function readContract(contractPath) {
  if (!existsSync(contractPath)) {
    fail(`contract does not exist: ${path.relative(repositoryRoot, contractPath)}`);
  }
  try {
    return JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    fail(`contract must be valid JSON: ${error.message}`);
  }
}

function requireExact(actual, expected, name) {
  if (actual !== expected) {
    fail(`${name} must equal ${JSON.stringify(expected)}`);
  }
}

function requireExactArray(actual, expected, name) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${name} must equal ${JSON.stringify(expected)}`);
  }
}

function validateContract(contract) {
  requireExact(contract?.schemaVersion, 1, 'schemaVersion');
  requireExact(contract?.implementation?.name, 'nginx', 'implementation.name');
  requireExact(contract?.implementation?.version, '1.30.4', 'implementation.version');
  requireExact(contract?.implementation?.image, expectedImage, 'implementation.image');
  requireExact(contract?.listener?.port, 8443, 'listener.port');
  requireExactArray(contract?.listener?.protocols, ['http/1.1', 'h2'], 'listener.protocols');
  requireExact(contract?.listener?.tls?.minimumVersion, 'TLSv1.2', 'listener.tls.minimumVersion');
  requireExact(contract?.listener?.tls?.maximumVersion, 'TLSv1.3', 'listener.tls.maximumVersion');
  requireExact(contract?.listener?.tls?.certificatePath, '/run/secrets/goexample-edge/tls.crt', 'listener.tls.certificatePath');
  requireExact(contract?.listener?.tls?.privateKeyPath, '/run/secrets/goexample-edge/tls.key', 'listener.tls.privateKeyPath');

  const expectedLimits = {
    clientHeaderBufferBytes: 4096,
    largeHeaderBufferCount: 4,
    largeHeaderBufferBytes: 16384,
    clientBodyBufferBytes: 131072,
    clientMaxBodyBytes: 4194304,
    workerConnections: 1024,
    upstreamKeepaliveConnections: 64,
  };
  for (const [name, value] of Object.entries(expectedLimits)) {
    requireExact(contract?.limits?.[name], value, `limits.${name}`);
  }
  const expectedTimeouts = {
    clientHeaderSeconds: 10,
    clientBodySeconds: 10,
    sendSeconds: 10,
    keepaliveSeconds: 60,
    upstreamConnectSeconds: 2,
    upstreamSendSeconds: 10,
    upstreamReadSeconds: 10,
  };
  for (const [name, value] of Object.entries(expectedTimeouts)) {
    requireExact(contract?.timeouts?.[name], value, `timeouts.${name}`);
  }
  requireExact(contract?.lifecycle?.workerShutdownSeconds, 25, 'lifecycle.workerShutdownSeconds');
  requireExact(contract?.lifecycle?.containerStopSeconds, 30, 'lifecycle.containerStopSeconds');
  requireExact(contract?.lifecycle?.stopSignal, 'SIGQUIT', 'lifecycle.stopSignal');
  if (contract.lifecycle.workerShutdownSeconds >= contract.lifecycle.containerStopSeconds) {
    fail('worker shutdown timeout must be less than the container stop timeout');
  }
  requireExact(contract?.behavior?.proxyRequestBuffering, false, 'behavior.proxyRequestBuffering');
  requireExact(contract?.behavior?.proxyResponseBuffering, false, 'behavior.proxyResponseBuffering');
  requireExact(contract?.behavior?.proxyRetry, false, 'behavior.proxyRetry');
  requireExact(contract?.behavior?.replaceRequestID, true, 'behavior.replaceRequestID');
  requireExact(contract?.behavior?.preserveTraceContext, true, 'behavior.preserveTraceContext');
  requireExactArray(contract?.behavior?.edgeStatusCodes, [431, 502, 504], 'behavior.edgeStatusCodes');
  requireExactArray(contract?.behavior?.passThroughStatusCodes, [503], 'behavior.passThroughStatusCodes');
  return contract;
}

function validateHostname(value, name) {
  if (value.length > 253 || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)) {
    fail(`${name} must be a plain DNS hostname without a wildcard, port, scheme, path, or whitespace`);
  }
  for (const label of value.split('.')) {
    if (label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) {
      fail(`${name} contains an invalid DNS label`);
    }
  }
}

function validateUpstreamPort(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    fail('upstream port must be an integer between 1 and 65535');
  }
}

function kibibytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes % 1024 !== 0) {
    fail('buffer sizes must be whole KiB values');
  }
  return `${bytes / 1024}k`;
}

function mebibytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes % (1024 * 1024) !== 0) {
    fail('body size must be a whole MiB value');
  }
  return `${bytes / (1024 * 1024)}m`;
}

function renderConfig(contract, options) {
  const { limits, timeouts, listener, lifecycle } = contract;
  return `user nginx;
worker_processes auto;
worker_shutdown_timeout ${lifecycle.workerShutdownSeconds}s;
error_log /dev/stderr warn;
pid /tmp/nginx.pid;

events {
    worker_connections ${limits.workerConnections};
    multi_accept off;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    server_tokens off;

    log_format goexample escape=json '{"timestamp":"$time_iso8601","request_id":"$request_id","method":"$request_method","status":$status,"request_time":$request_time,"upstream_status":"$upstream_status","upstream_response_time":"$upstream_response_time"}';
    access_log /dev/stdout goexample;

    client_header_timeout ${timeouts.clientHeaderSeconds}s;
    client_body_timeout ${timeouts.clientBodySeconds}s;
    send_timeout ${timeouts.sendSeconds}s;
    keepalive_timeout ${timeouts.keepaliveSeconds}s;
    client_header_buffer_size ${kibibytes(limits.clientHeaderBufferBytes)};
    large_client_header_buffers ${limits.largeHeaderBufferCount} ${kibibytes(limits.largeHeaderBufferBytes)};
    client_body_buffer_size ${kibibytes(limits.clientBodyBufferBytes)};
    client_max_body_size ${mebibytes(limits.clientMaxBodyBytes)};

    proxy_http_version 1.1;
    proxy_connect_timeout ${timeouts.upstreamConnectSeconds}s;
    proxy_send_timeout ${timeouts.upstreamSendSeconds}s;
    proxy_read_timeout ${timeouts.upstreamReadSeconds}s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_intercept_errors off;
    proxy_next_upstream off;
    proxy_socket_keepalive on;

    upstream goexample_api {
        server ${options.upstreamHost}:${options.upstreamPort} max_fails=3 fail_timeout=10s;
        keepalive ${limits.upstreamKeepaliveConnections};
    }

    server {
        listen ${listener.port} ssl;
        http2 on;
        server_name ${options.serverName};

        ssl_certificate ${listener.tls.certificatePath};
        ssl_certificate_key ${listener.tls.privateKeyPath};
        ssl_protocols ${listener.tls.minimumVersion} ${listener.tls.maximumVersion};
        ssl_session_cache shared:TLS:10m;
        ssl_session_timeout 10m;
        ssl_session_tickets off;

        error_page 494 = @header_too_large;
        location @header_too_large {
            default_type application/json;
            return 431 '{"code":431,"data":null,"msg":"request headers are too large"}';
        }

        location / {
            proxy_pass http://goexample_api;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $request_id;
            proxy_set_header traceparent $http_traceparent;
            proxy_set_header tracestate $http_tracestate;
        }
    }
}
`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const contract = validateContract(readContract(options.contract));
  if (options.task === 'check') {
    console.log(`Nginx edge contract passed: ${path.relative(repositoryRoot, options.contract)}`);
    return;
  }
  validateHostname(options.serverName, 'server name');
  validateHostname(options.upstreamHost, 'upstream host');
  validateUpstreamPort(options.upstreamPort);
  const config = renderConfig(contract, options);
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, config, 'utf8');
  console.log(`Nginx edge config written to ${path.relative(repositoryRoot, options.output)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
