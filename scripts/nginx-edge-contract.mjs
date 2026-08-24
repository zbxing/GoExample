import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const contractPath = path.join(repositoryRoot, 'deploy', 'edge', 'goexample-nginx.contract.json');
const contract = JSON.parse(await readFile(contractPath, 'utf8'));
const image = contract.implementation.image;
const runID = randomUUID();
const containerName = `goexample-nginx-edge-${runID}`;
const deploymentDirectory = path.join(repositoryRoot, '.temp', 'deployment', `edge-contract-${runID}`);
const runtimeDirectory = path.join(repositoryRoot, '.temp', 'edge-contract', runID);
const artifactDirectory = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'nginx-edge-contract');
const configPath = path.join(deploymentDirectory, 'nginx.conf');
const certificatePath = path.join(runtimeDirectory, 'tls.crt');
const privateKeyPath = path.join(runtimeDirectory, 'tls.key');
const events = [];
let containerCreated = false;
let upstreamServer;

function record(name, details = {}) {
  events.push({ name, ...details });
}

function commandError(command, args, code, stdout, stderr) {
  const error = new Error(`${command} ${args.join(' ')} exited with code ${code}`);
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const status = signal ? 1 : (code ?? 1);
      const result = { status, stdout, stderr };
      if (status !== 0 && !allowFailure) {
        reject(commandError(command, args, status, stdout, stderr));
        return;
      }
      resolve(result);
    });
  });
}

function withTimeout(promise, milliseconds, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} exceeded ${milliseconds}ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function startUpstream() {
  let uploadStartedResolve;
  let uploadAbortedResolve;
  let drainStartedResolve;
  const uploadStarted = new Promise((resolve) => { uploadStartedResolve = resolve; });
  const uploadAborted = new Promise((resolve) => { uploadAbortedResolve = resolve; });
  const drainStarted = new Promise((resolve) => { drainStartedResolve = resolve; });
  let uploadObserved = false;
  upstreamServer = http.createServer((request, response) => {
    if (request.url === '/trace') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        traceparent: request.headers.traceparent ?? '',
        tracestate: request.headers.tracestate ?? '',
        requestID: request.headers['x-request-id'] ?? '',
        forwardedProto: request.headers['x-forwarded-proto'] ?? '',
      }));
      return;
    }
    if (request.url === '/status/503') {
      response.statusCode = 503;
      response.end('upstream unavailable');
      return;
    }
    if (request.url === '/broken') {
      request.socket.destroy();
      return;
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        if (!response.destroyed) {
          response.end('late upstream response');
        }
      }, 15000);
      return;
    }
    if (request.url === '/upload') {
      request.once('data', () => {
        if (!uploadObserved) {
          uploadObserved = true;
          uploadStartedResolve();
        }
      });
      request.once('aborted', uploadAbortedResolve);
      request.on('error', () => {});
      return;
    }
    if (request.url === '/drain') {
      drainStartedResolve();
      setTimeout(() => response.end('drained response'), 1000);
      return;
    }
    response.end('ok');
  });
  return new Promise((resolve, reject) => {
    upstreamServer.once('error', reject);
    upstreamServer.listen(0, '0.0.0.0', () => {
      const address = upstreamServer.address();
      resolve({
        port: address.port,
        uploadStarted,
        uploadAborted,
        drainStarted,
      });
    });
  });
}

function httpsRequest(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: options.method ?? 'GET',
      headers: options.headers,
      rejectUnauthorized: false,
      servername: 'localhost',
      agent: false,
      timeout: options.timeout ?? 20000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
      }));
    });
    request.on('timeout', () => request.destroy(new Error('HTTPS request timed out')));
    request.on('error', reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function h2Request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
    const chunks = [];
    let responseHeaders;
    session.once('error', reject);
    const request = session.request({ ':path': requestPath, ...headers });
    request.on('response', (value) => { responseHeaders = value; });
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const result = {
        status: responseHeaders[':status'],
        body: Buffer.concat(chunks).toString('utf8'),
        alpnProtocol: session.socket.alpnProtocol,
        tlsProtocol: session.socket.getProtocol(),
      };
      session.close();
      resolve(result);
    });
    request.end();
  });
}

function beginInterruptedUpload(port) {
  const request = https.request({
    hostname: '127.0.0.1',
    port,
    path: '/upload',
    method: 'POST',
    headers: { 'Content-Length': 1024 * 1024, 'Content-Type': 'application/octet-stream' },
    rejectUnauthorized: false,
    servername: 'localhost',
    agent: false,
  });
  request.on('error', () => {});
  request.write(Buffer.alloc(16 * 1024, 'a'));
  return request;
}

async function waitForEdge(port) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await httpsRequest(port, '/trace', { timeout: 1000 });
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nginx did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function writeArtifacts(status, error, containerLogs) {
  await rm(artifactDirectory, { recursive: true, force: true });
  await mkdir(artifactDirectory, { recursive: true });
  const git = await run('git', ['rev-parse', 'HEAD'], { allowFailure: true });
  const environment = [
    `runner_os=${process.env.RUNNER_OS ?? os.platform()}`,
    `runner_arch=${process.env.RUNNER_ARCH ?? os.arch()}`,
    `git_commit=${git.status === 0 ? git.stdout.trim() : 'unknown'}`,
    `node=${process.version}`,
    `nginx_image=${image}`,
    `contract=${path.relative(repositoryRoot, contractPath).split(path.sep).join('/')}`,
  ].join('\n');
  await writeFile(path.join(artifactDirectory, 'environment.txt'), `${environment}\n`, 'utf8');
  await writeFile(path.join(artifactDirectory, 'test-output.json'), `${JSON.stringify({
    localContractOnly: true,
    status: status === 0 ? 'passed' : 'failed',
    events,
    error: error ? error.message : null,
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(artifactDirectory, 'nginx.log'), containerLogs || '', 'utf8');
  await writeFile(path.join(artifactDirectory, 'test-status.txt'), `exit_code=${status}\n`, 'utf8');
  const artifactNames = ['environment.txt', 'test-output.json', 'nginx.log', 'test-status.txt'];
  const checksums = [];
  for (const name of artifactNames) {
    checksums.push(`${await sha256(path.join(artifactDirectory, name))}  ${name}`);
  }
  await writeFile(path.join(artifactDirectory, 'SHA256SUMS'), `${checksums.join('\n')}\n`, 'utf8');
}

async function executeContract() {
  if (process.platform !== 'linux') {
    throw new Error('the real Nginx edge contract requires a Linux Docker host');
  }
  await mkdir(deploymentDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  const upstream = await startUpstream();

  await run(process.execPath, [
    path.join('scripts', 'nginx-edge.mjs'),
    'render',
    '--server-name', 'localhost',
    '--upstream-host', 'host.docker.internal',
    '--upstream-port', `${upstream.port}`,
    '--output', path.relative(repositoryRoot, configPath),
  ]);
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', privateKeyPath, '-out', certificatePath,
  ]);

  const mounts = [
    '--volume', `${configPath}:/etc/nginx/nginx.conf:ro`,
    '--volume', `${runtimeDirectory}:/run/secrets/goexample-edge:ro`,
  ];
  await run('docker', ['run', '--rm', ...mounts, image, 'nginx', '-t']);
  const started = await run('docker', [
    'run', '--detach', '--name', containerName,
    '--add-host', 'host.docker.internal:host-gateway',
    '--publish', '127.0.0.1::8443',
    '--stop-signal', contract.lifecycle.stopSignal,
    '--stop-timeout', `${contract.lifecycle.containerStopSeconds}`,
    ...mounts,
    image,
  ]);
  assert.match(started.stdout.trim(), /^[a-f0-9]{12,64}$/);
  containerCreated = true;
  const portResult = await run('docker', ['port', containerName, '8443/tcp']);
  const portMatch = portResult.stdout.trim().match(/127\.0\.0\.1:(\d+)$/);
  assert.ok(portMatch, `unexpected Docker port mapping: ${portResult.stdout}`);
  const edgePort = Number(portMatch[1]);
  await waitForEdge(edgePort);

  const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const trace = await h2Request(edgePort, '/trace', {
    traceparent,
    tracestate: 'vendor=value',
    'x-request-id': 'client-controlled-request-id',
  });
  assert.equal(trace.status, 200);
  assert.equal(trace.alpnProtocol, 'h2');
  assert.match(trace.tlsProtocol, /^TLSv1\.[23]$/);
  const observed = JSON.parse(trace.body);
  assert.equal(observed.traceparent, traceparent);
  assert.equal(observed.tracestate, 'vendor=value');
  assert.equal(observed.forwardedProto, 'https');
  assert.match(observed.requestID, /^[a-f0-9]{32}$/);
  assert.notEqual(observed.requestID, 'client-controlled-request-id');
  record('tls_http2_trace', { status: trace.status, alpn: trace.alpnProtocol, tls: trace.tlsProtocol });

  const oversizedHeaders = await httpsRequest(edgePort, '/trace', {
    headers: { 'X-Oversized-Header': 'a'.repeat(20 * 1024) },
  });
  assert.equal(oversizedHeaders.status, 431);
  record('header_limit', { status: oversizedHeaders.status });

  const unavailable = await httpsRequest(edgePort, '/status/503');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body, 'upstream unavailable');
  record('upstream_503_passthrough', { status: unavailable.status });

  const broken = await httpsRequest(edgePort, '/broken');
  assert.equal(broken.status, 502);
  record('upstream_502', { status: broken.status });

  const timedOut = await httpsRequest(edgePort, '/slow', { timeout: 13000 });
  assert.equal(timedOut.status, 504);
  record('upstream_504', { status: timedOut.status });

  const uploadRequest = beginInterruptedUpload(edgePort);
  await withTimeout(upstream.uploadStarted, 3000, 'streaming upload start');
  uploadRequest.destroy(new Error('intentional client upload interruption'));
  await withTimeout(upstream.uploadAborted, 3000, 'upstream upload cancellation');
  record('upload_interruption_propagated');

  const drainingResponse = httpsRequest(edgePort, '/drain', { timeout: 5000 });
  await withTimeout(upstream.drainStarted, 3000, 'drain request start');
  const stopped = run('docker', ['stop', '--time', `${contract.lifecycle.containerStopSeconds}`, containerName]);
  const drained = await drainingResponse;
  assert.equal(drained.status, 200);
  assert.equal(drained.body, 'drained response');
  await stopped;
  record('sigquit_drain', { status: drained.status });
}

let status = 0;
let failure = null;
let containerLogs = '';
try {
  await executeContract();
} catch (error) {
  status = 1;
  failure = error;
} finally {
  if (containerCreated) {
    const logs = await run('docker', ['logs', containerName], { allowFailure: true });
    containerLogs = `${logs.stdout}${logs.stderr}`;
    await run('docker', ['rm', '--force', containerName], { allowFailure: true });
  }
  if (upstreamServer) {
    upstreamServer.closeAllConnections?.();
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
  await writeArtifacts(status, failure, containerLogs);
  await rm(deploymentDirectory, { recursive: true, force: true });
  await rm(runtimeDirectory, { recursive: true, force: true });
}

if (failure) {
  console.error(`Nginx edge contract failed: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`Nginx edge contract passed with ${events.length} scenarios using ${image}`);
}
