import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repositoryRoot, 'scripts', 'v13-evidence.mjs');

function run(file, verify = false) {
  return spawnSync(process.execPath, [script, ...(verify ? ['--verify'] : []), file], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('V13 evidence index generates and verifies all packages as not_recorded', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const index = path.join(root, 'index.json');
  try {
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const verified = run(index, true);
    assert.equal(verified.status, 0, verified.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    assert.equal(document.schemaVersion, 3);
    assert.equal(document.workPackages.length, 9);
    assert.ok(document.workPackages.every((item) => item.status === 'not_recorded'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V13 evidence verifier accepts complete immutable recorded evidence', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const artifact = path.join(root, 'run.txt');
  const index = path.join(root, 'index.json');
  try {
    const bytes = Buffer.from('target run passed\n');
    await writeFile(artifact, bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    const packageItem = document.workPackages[1];
    packageItem.status = 'recorded';
    packageItem.targetEnvironment = 'prod-redis-ha-01';
    packageItem.immutableVersion = `sha256:${'a'.repeat(64)}`;
    packageItem.runUrl = 'https://ci.example.invalid/runs/123';
    packageItem.sourceCommit = document.repository.gitCommit;
    packageItem.fingerprint = { runner: 'runner-abc', toolchain: 'go1.25.0', environment: 'image@sha256:abc' };
    packageItem.outputs = [{ path: `.temp/${path.relative(path.join(repositoryRoot, '.temp'), artifact).split(path.sep).join('/')}`, bytes: bytes.length, sha256: hash }];
    packageItem.execution = {
      command: 'yarn redis:sentinel:contract',
      startedAt: '2026-08-27T00:00:00Z',
      finishedAt: '2026-08-27T00:00:01Z',
      exitCode: 0,
      rawOutputPath: packageItem.outputs[0].path,
    };
    packageItem.provenance = {
      kind: 'platform',
      reference: 'https://ci.example.invalid/runs/123/attestation',
      verificationCommand: 'gh attestation verify run.txt',
      verifiedAt: '2026-08-27T00:00:02Z',
      verificationOutputPath: packageItem.outputs[0].path,
    };
    packageItem.completion = {
      criteria: [
        { id: 'redis-ha-topology-security', outputPath: packageItem.outputs[0].path, summary: 'TLS and ACL topology was verified.' },
        { id: 'failover-resilience-and-alerts', outputPath: packageItem.outputs[0].path, summary: 'Failover, reconnection, and alert response were verified.' },
        { id: 'backup-recovery-rpo-rto', outputPath: packageItem.outputs[0].path, summary: 'Recovery artifacts contain the measured RPO and RTO.' },
      ],
      rpoApproval: {
        approver: 'database-resilience-owner',
        decision: 'approved',
        approvedAt: '2026-08-27T00:00:03Z',
        rpoMinutes: 5,
        rtoMinutes: 30,
        outputPath: packageItem.outputs[0].path,
      },
    };
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const verified = run(index, true);
    assert.equal(verified.status, 0, verified.stderr);

    packageItem.completion.rpoApproval = null;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const missingApproval = run(index, true);
    assert.equal(missingApproval.status, 1);
    assert.match(missingApproval.stderr, /requires an approved RPO\/RTO/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V13 evidence verifier requires source, execution, and provenance before recording success', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const artifact = path.join(root, 'run.txt');
  const index = path.join(root, 'index.json');
  try {
    const bytes = Buffer.from('target run passed\n');
    await writeFile(artifact, bytes);
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    const packageItem = document.workPackages[0];
    packageItem.status = 'recorded';
    packageItem.targetEnvironment = 'prod-linux-edge-01';
    packageItem.immutableVersion = `sha256:${'b'.repeat(64)}`;
    packageItem.runUrl = 'https://ci.example.invalid/runs/124';
    packageItem.fingerprint = { runner: 'runner-abc', toolchain: 'go1.25.0', environment: 'image@sha256:abc' };
    packageItem.outputs = [{
      path: `.temp/${path.relative(path.join(repositoryRoot, '.temp'), artifact).split(path.sep).join('/')}`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }];
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);

    let verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /sourceCommit/);

    packageItem.sourceCommit = document.repository.gitCommit;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /execution metadata/);

    packageItem.execution = {
      command: 'yarn edge:contract',
      startedAt: '2026-08-27T00:00:01Z',
      finishedAt: '2026-08-27T00:00:00Z',
      exitCode: 0,
      rawOutputPath: packageItem.outputs[0].path,
    };
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /must not precede/);

    packageItem.execution.finishedAt = '2026-08-27T00:00:02Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /requires completion coverage/);

    packageItem.completion = {
      criteria: [
        { id: 'target-edge-certificate-dns', outputPath: packageItem.outputs[0].path, summary: 'Target certificate and DNS were checked.' },
        { id: 'tls-http2-http3', outputPath: packageItem.outputs[0].path, summary: 'TLS and protocol coverage were checked.' },
        { id: 'proxy-lifecycle-failure-trace', outputPath: packageItem.outputs[0].path, summary: 'Proxy lifecycle and failure traces were checked.' },
      ],
      rpoApproval: null,
    };
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /requires provenance/);

    packageItem.provenance = {
      kind: 'platform',
      reference: 'https://ci.example.invalid/runs/124/attestation',
      verificationCommand: 'gh attestation verify run.txt',
      verifiedAt: '2026-08-27T00:00:03Z',
      verificationOutputPath: packageItem.outputs[0].path,
    };
    packageItem.execution.exitCode = 1;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /zero execution exitCode/);

    packageItem.execution.exitCode = 0;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    verified = run(index, true);
    assert.equal(verified.status, 0, verified.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V13 evidence verifier rejects forged recorded state and unsafe artifact paths', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const index = path.join(root, 'index.json');
  try {
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    document.workPackages[0].status = 'recorded';
    document.workPackages[0].targetEnvironment = 'prod';
    const forged = await writeFile(index, `${JSON.stringify(document, null, 2)}\n`).then(() => run(index, true));
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /immutable digest|runUrl|fingerprint|outputs/);

    document.workPackages[0].status = 'not_recorded';
    document.workPackages[0].targetEnvironment = 'local-loopback';
    document.workPackages[0].outputs = [{ path: '.temp/../outside.txt', bytes: 1, sha256: '0'.repeat(64) }];
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const unsafe = run(index, true);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /unsafe path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
