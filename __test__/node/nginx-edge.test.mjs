import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const tempRoot = path.join(repositoryRoot, '.temp');
const deploymentRoot = path.join(tempRoot, 'deployment');
const scriptPath = path.join(repositoryRoot, 'scripts', 'nginx-edge.mjs');
const contractPath = path.join(repositoryRoot, 'support', 'deploy', 'edge', 'goexample-nginx.contract.json');

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('Nginx edge contract renders bounded TLS HTTP/2 proxy configuration', async (t) => {
  await mkdir(deploymentRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(deploymentRoot, 'nginx-edge-contract-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const output = path.join(testRoot, 'nginx.conf');

  const check = run(['check']);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Nginx edge contract passed/);

  const render = run([
    'render',
    '--server-name',
    'api.example.com',
    '--upstream-host',
    'goexample-api',
    '--upstream-port',
    '80',
    '--output',
    path.relative(repositoryRoot, output),
  ]);
  assert.equal(render.status, 0, render.stderr);
  const config = await readFile(output, 'utf8');
  assert.match(config, /listen 8443 ssl;/);
  assert.match(config, /http2 on;/);
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(config, /client_header_buffer_size 4k;/);
  assert.match(config, /large_client_header_buffers 4 16k;/);
  assert.match(config, /client_max_body_size 4m;/);
  assert.match(config, /proxy_connect_timeout 2s;/);
  assert.match(config, /proxy_read_timeout 10s;/);
  assert.match(config, /proxy_request_buffering off;/);
  assert.match(config, /proxy_buffering off;/);
  assert.match(config, /proxy_next_upstream off;/);
  assert.match(config, /error_page 494 = @header_too_large;/);
  assert.match(config, /return 431/);
  assert.match(config, /proxy_set_header X-Request-ID \$request_id;/);
  assert.match(config, /proxy_set_header traceparent \$http_traceparent;/);
  assert.match(config, /worker_shutdown_timeout 25s;/);
  assert.doesNotMatch(config, /__GOEXAMPLE_|Authorization|request_uri|http_cookie|request_body/);
});

test('Nginx edge renderer rejects unsafe destinations and weakened contracts', async (t) => {
  const baseArguments = [
    'render',
    '--server-name',
    'api.example.com',
    '--upstream-host',
    'goexample-api',
    '--upstream-port',
    '80',
  ];
  const wildcard = run([...baseArguments.slice(0, 2), '*.example.com', ...baseArguments.slice(3)]);
  assert.equal(wildcard.status, 1);
  assert.match(wildcard.stderr, /plain DNS hostname/);

  const upstreamURL = run([
    'render', '--server-name', 'api.example.com', '--upstream-host', 'http://goexample-api', '--upstream-port', '80',
  ]);
  assert.equal(upstreamURL.status, 1);
  assert.match(upstreamURL.stderr, /plain DNS hostname/);

  const invalidPort = run([
    'render', '--server-name', 'api.example.com', '--upstream-host', 'goexample-api', '--upstream-port', '65536',
  ]);
  assert.equal(invalidPort.status, 1);
  assert.match(invalidPort.stderr, /between 1 and 65535/);

  const duplicate = run([...baseArguments, '--upstream-port', '80']);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /--upstream-port may only be specified once/);

  await mkdir(tempRoot, { recursive: true });
  const testRoot = await mkdtemp(path.join(tempRoot, 'nginx-edge-tamper-'));
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const tamperedPath = path.join(testRoot, 'goexample-nginx.contract.json');
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  contract.behavior.proxyRequestBuffering = true;
  await writeFile(tamperedPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const tampered = run(['check', '--contract', path.relative(repositoryRoot, tamperedPath)]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /behavior\.proxyRequestBuffering must equal false/);

  contract.behavior.proxyRequestBuffering = false;
  contract.implementation.image = 'nginx:latest';
  await writeFile(tamperedPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const mutableImage = run(['check', '--contract', path.relative(repositoryRoot, tamperedPath)]);
  assert.equal(mutableImage.status, 1);
  assert.match(mutableImage.stderr, /implementation\.image must equal/);
});
