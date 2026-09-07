import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRedisSentinelChecksums,
  buildRedisSentinelEvidenceReport,
} from './lib/redis-sentinel-evidence.mjs';
import { createContractCommandRunner } from './lib/contract-command.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const image = 'redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232';
const masterName = 'goexample-primary';
const dataUsername = 'goexample-data';
const sentinelUsername = 'goexample-sentinel';
const dataPassword = `data-${randomUUID()}`;
const sentinelPassword = `sentinel-${randomUUID()}`;
const runID = randomUUID();
const runtimeDirectory = path.join(repositoryRoot, '.temp', 'redis-sentinel-contract', runID);
const artifactDirectory = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'redis-sentinel-contract');
const containers = [];
const contractOutput = [];
const startedAt = new Date().toISOString();
let testOutput = '';
let exitCode = 1;
let gitCommit = 'unavailable';
let goVersion = 'unavailable';
let dockerVersion = 'unavailable';

const run = createContractCommandRunner({ cwd: repositoryRoot });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      reservations.push(server);
    }
    const ports = reservations.map((server) => server.address().port);
    await Promise.all(reservations.map((server) => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    return ports;
  } catch (error) {
    await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));
    throw error;
  }
}

function dataConfiguration(port, masterPort) {
  const replica = masterPort === null ? '' : [
    `replicaof 127.0.0.1 ${masterPort}`,
    `masteruser ${dataUsername}`,
    `masterauth ${dataPassword}`,
  ].join('\n');
  return [
    `port ${port}`,
    'bind 127.0.0.1',
    'protected-mode no',
    'daemonize no',
    'logfile ""',
    'save ""',
    'appendonly no',
    'dir /data',
    'user default off',
    `user ${dataUsername} on >${dataPassword} ~* +@all`,
    replica,
    '',
  ].filter((line) => line !== '').join('\n');
}

function sentinelConfiguration(port, masterPort) {
  return [
    `port ${port}`,
    'bind 127.0.0.1',
    'protected-mode no',
    'daemonize no',
    'logfile ""',
    'dir /data',
    'user default off',
    `user ${sentinelUsername} on >${sentinelPassword} ~* +@all`,
    `sentinel sentinel-user ${sentinelUsername}`,
    `sentinel sentinel-pass ${sentinelPassword}`,
    `sentinel monitor ${masterName} 127.0.0.1 ${masterPort} 2`,
    `sentinel auth-user ${masterName} ${dataUsername}`,
    `sentinel auth-pass ${masterName} ${dataPassword}`,
    `sentinel down-after-milliseconds ${masterName} 1000`,
    `sentinel failover-timeout ${masterName} 10000`,
    `sentinel parallel-syncs ${masterName} 1`,
    '',
  ].join('\n');
}

async function writeNodeConfiguration(name, contents) {
  const directory = path.join(runtimeDirectory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'redis.conf'), contents, { mode: 0o600 });
  return directory;
}

async function startContainer(name, directory, sentinel = false) {
  const containerName = `goexample-redis-${name}-${runID}`;
  const args = [
    'run', '--detach', '--name', containerName,
    '--network', 'host', '--user', '0:0',
    '--volume', `${directory}:/data`,
    image, 'redis-server', '/data/redis.conf',
  ];
  if (sentinel) {
    args.push('--sentinel');
  }
  const result = await run('docker', args);
  containers.push({ name, containerName });
  contractOutput.push(`started ${name}: ${result.stdout.trim()}`);
}

async function waitFor(description, probe, attempts = 60) {
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await probe();
    if (lastResult.status === 0) {
      contractOutput.push(`${description}: ready after ${attempt} attempt(s)`);
      return lastResult;
    }
    await delay(250);
  }
  throw new Error(`${description} did not become ready: ${lastResult?.stderr || lastResult?.stdout || 'no output'}`);
}

function dataCLI(containerName, port, ...commands) {
  return run('docker', [
    'exec', '--env', `REDISCLI_AUTH=${dataPassword}`, containerName,
    'redis-cli', '--no-auth-warning', '-h', '127.0.0.1', '-p', `${port}`, '--user', dataUsername,
    ...commands,
  ], { allowFailure: true, timeoutMs: 5_000 });
}

function sentinelCLI(containerName, port, ...commands) {
  return run('docker', [
    'exec', '--env', `REDISCLI_AUTH=${sentinelPassword}`, containerName,
    'redis-cli', '--no-auth-warning', '-h', '127.0.0.1', '-p', `${port}`, '--user', sentinelUsername,
    ...commands,
  ], { allowFailure: true, timeoutMs: 5_000 });
}

async function archive(environment, failure) {
  await mkdir(artifactDirectory, { recursive: true });
  const logDirectory = path.join(artifactDirectory, 'container-logs');
  await mkdir(logDirectory, { recursive: true });
  for (const container of containers) {
    const result = await run('docker', ['logs', container.containerName], {
      allowFailure: true,
      timeoutMs: 30_000,
    });
    await writeFile(path.join(logDirectory, `${container.name}.log`), `${result.stdout}${result.stderr}`);
  }
  await writeFile(path.join(artifactDirectory, 'environment.txt'), environment);
  await writeFile(path.join(artifactDirectory, 'contract-output.txt'), `${contractOutput.join('\n')}\n`);
  await writeFile(path.join(artifactDirectory, 'test-output.txt'), testOutput);
  await writeFile(path.join(artifactDirectory, 'test-status.txt'), `exit_code=${exitCode}\n`);
  const containerNames = containers.map((container) => container.name);
  const report = buildRedisSentinelEvidenceReport({
    repositoryRoot,
    evidenceRoot: artifactDirectory,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    goVersion,
    dockerVersion,
    gitCommit,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode,
    error: failure?.message ?? null,
    containerNames,
    ports,
  });
  await writeFile(path.join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.join(artifactDirectory, 'SHA256SUMS'),
    buildRedisSentinelChecksums(artifactDirectory, containerNames),
  );
}

async function cleanup() {
  for (const container of [...containers].reverse()) {
    await run('docker', ['rm', '--force', container.containerName], {
      allowFailure: true,
      timeoutMs: 30_000,
    });
  }
  await rm(runtimeDirectory, { recursive: true, force: true });
}

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
let ports = [];
let failure;
try {
  if (process.platform !== 'linux') {
    throw new Error('Redis Sentinel contract requires Linux Docker host networking');
  }
  const [git, go, docker] = await Promise.all([
    run('git', ['rev-parse', 'HEAD']),
    run('go', ['version']),
    run('docker', ['version', '--format', '{{.Server.Version}}']),
  ]);
  gitCommit = git.stdout.trim();
  goVersion = go.stdout.trim();
  dockerVersion = docker.stdout.trim();
  contractOutput.push(`docker server: ${dockerVersion}`);
  const pull = await run('docker', ['pull', image], { timeoutMs: 120_000 });
  contractOutput.push(pull.stdout.trim());

  ports = await reservePorts(5);
  const [masterPort, replicaPort, ...sentinelPorts] = ports;
  const masterDirectory = await writeNodeConfiguration('master', dataConfiguration(masterPort, null));
  const replicaDirectory = await writeNodeConfiguration('replica', dataConfiguration(replicaPort, masterPort));
  const sentinelDirectories = await Promise.all(sentinelPorts.map((port, index) =>
    writeNodeConfiguration(`sentinel-${index + 1}`, sentinelConfiguration(port, masterPort))));

  await startContainer('master', masterDirectory);
  await startContainer('replica', replicaDirectory);
  await waitFor('master', async () => {
    const result = await dataCLI(containers[0].containerName, masterPort, 'PING');
    return result.status === 0 && result.stdout.trim() === 'PONG' ? result : { ...result, status: 1 };
  });
  await waitFor('replica link', async () => {
    const result = await dataCLI(containers[1].containerName, replicaPort, 'INFO', 'replication');
    return result.status === 0 && result.stdout.includes('master_link_status:up')
      ? result
      : { ...result, status: 1 };
  });

  for (let index = 0; index < sentinelPorts.length; index += 1) {
    await startContainer(`sentinel-${index + 1}`, sentinelDirectories[index], true);
  }
  for (let index = 0; index < sentinelPorts.length; index += 1) {
    await waitFor(`sentinel ${index + 1} quorum`, async () => {
      const result = await sentinelCLI(
        containers[index + 2].containerName,
        sentinelPorts[index],
        'SENTINEL', 'CKQUORUM', masterName,
      );
      return result.status === 0 && result.stdout.includes('OK') ? result : { ...result, status: 1 };
    }, 120);
  }

  const test = await run('go', [
    '-C', 'Framework', 'test', '-v', '-count=1', '-timeout=1m',
    '-run', '^TestRedisSentinelFailoverReconnectsSharedStateClients$', './sharedstate',
  ], {
    allowFailure: true,
    timeoutMs: 150_000,
    env: {
      ...process.env,
      REDIS_SENTINEL_TEST_ADDRESSES: sentinelPorts.map((port) => `127.0.0.1:${port}`).join(','),
      REDIS_SENTINEL_TEST_MASTER_NAME: masterName,
      REDIS_SENTINEL_TEST_USERNAME: dataUsername,
      REDIS_SENTINEL_TEST_PASSWORD: dataPassword,
      REDIS_SENTINEL_TEST_SENTINEL_USERNAME: sentinelUsername,
      REDIS_SENTINEL_TEST_SENTINEL_PASSWORD: sentinelPassword,
    },
  });
  testOutput = `${test.stdout}${test.stderr}`;
  exitCode = test.status;
  if (test.status !== 0) {
    throw new Error(`Go Redis Sentinel contract exited with code ${test.status}`);
  }
} catch (error) {
  failure = error;
  contractOutput.push(`failure: ${error.message}`);
} finally {
  const environment = [
    'contract=redis-sentinel-failover',
    `platform=${process.platform}`,
    `architecture=${process.arch}`,
    `node=${process.version}`,
    `go=${goVersion}`,
    `docker=${dockerVersion}`,
    `git_commit=${gitCommit}`,
    `image=${image}`,
    `topology=1-master,1-replica,3-sentinels`,
    `ports=${ports.join(',')}`,
    'tls_enabled=false',
    'local_contract_only=true',
    'target_redis_ha=not_recorded',
    '',
  ].join('\n');
  try {
    await archive(environment, failure);
  } finally {
    await cleanup();
  }
}

if (failure) {
  console.error(failure.message);
  process.exit(1);
}
console.log(`Redis Sentinel contract passed; evidence: ${path.relative(repositoryRoot, artifactDirectory)}`);
