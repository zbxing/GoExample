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
    assert.ok(document.workPackages.every((item) => item.reason === 'No immutable target-environment run and archived artifact has been recorded.'));
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

    const packageOrder = [...document.workPackages];
    document.workPackages = [...packageOrder].reverse();
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const reorderedPackages = run(index, true);
    assert.equal(reorderedPackages.status, 1);
    assert.match(reorderedPackages.stderr, /must follow the fixed V13 package order/);
    document.workPackages = packageOrder;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    assert.equal(run(index, true).status, 0);

    const criteriaOrder = [...packageItem.completion.criteria];
    packageItem.completion.criteria = [...criteriaOrder].reverse();
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const reorderedCriteria = run(index, true);
    assert.equal(reorderedCriteria.status, 1);
    assert.match(reorderedCriteria.stderr, /must follow the fixed requirement order/);
    packageItem.completion.criteria = criteriaOrder;
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    assert.equal(run(index, true).status, 0);

    const exactKeyCases = [
      [document, 'document'],
      [packageItem, 'workPackages[1]'],
      [packageItem.fingerprint, 'V13-02.fingerprint'],
      [packageItem.outputs[0], 'V13-02.outputs[0]'],
      [packageItem.execution, 'V13-02.execution'],
      [packageItem.provenance, 'V13-02.provenance'],
      [packageItem.completion, 'V13-02.completion'],
      [packageItem.completion.criteria[0], 'V13-02.completion.criteria[0]'],
      [packageItem.completion.rpoApproval, 'V13-02.completion.rpoApproval'],
    ];
    for (const [object, name] of exactKeyCases) {
      object.__unexpected = true;
      await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
      const rejected = run(index, true);
      assert.equal(rejected.status, 1);
      assert.ok(rejected.stderr.includes(`${name} must contain exactly`), rejected.stderr);
      delete object.__unexpected;
    }
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    assert.equal(run(index, true).status, 0);

    packageItem.provenance.verifiedAt = '2026-08-27T00:00:00Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const outOfOrderProvenance = run(index, true);
    assert.equal(outOfOrderProvenance.status, 1);
    assert.match(outOfOrderProvenance.stderr, /verifiedAt must not precede execution\.finishedAt/);
    packageItem.provenance.verifiedAt = '2026-08-27T00:00:02Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    assert.equal(run(index, true).status, 0);

    packageItem.execution.finishedAt = '2026-09-01T00:00:01Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const futureExecution = run(index, true);
    assert.equal(futureExecution.status, 1);
    assert.match(futureExecution.stderr, /execution\.finishedAt must not be after document\.generatedAt/);
    packageItem.execution.finishedAt = '2026-08-27T00:00:01Z';

    packageItem.provenance.verifiedAt = '2026-09-01T00:00:02Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const futureProvenance = run(index, true);
    assert.equal(futureProvenance.status, 1);
    assert.match(futureProvenance.stderr, /provenance\.verifiedAt must not be after document\.generatedAt/);
    packageItem.provenance.verifiedAt = '2026-08-27T00:00:02Z';

    packageItem.completion.rpoApproval.approvedAt = '2026-09-01T00:00:03Z';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const futureApproval = run(index, true);
    assert.equal(futureApproval.status, 1);
    assert.match(futureApproval.stderr, /rpoApproval\.approvedAt must not be after document\.generatedAt/);
    packageItem.completion.rpoApproval.approvedAt = '2026-08-27T00:00:03Z';

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
    document.workPackages[0].reason = 'target run completed';
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const forgedReason = run(index, true);
    assert.equal(forgedReason.status, 1);
    assert.match(forgedReason.stderr, /not_recorded reason must preserve the fixed boundary/);
    document.workPackages[0].reason = 'No immutable target-environment run and archived artifact has been recorded.';
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

test('V13 evidence verifier rejects artifact reuse across work packages', async () => {
  const root = await mkdtemp(path.join(repositoryRoot, '.temp', 'v13-evidence-test-'));
  const artifact = path.join(root, 'shared-run.txt');
  const index = path.join(root, 'index.json');
  try {
    const bytes = Buffer.from('bounded target run failed\n');
    await writeFile(artifact, bytes);
    const output = {
      path: `.temp/${path.relative(path.join(repositoryRoot, '.temp'), artifact).split(path.sep).join('/')}`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const generated = run(index);
    assert.equal(generated.status, 0, generated.stderr);
    const document = JSON.parse(await readFile(index, 'utf8'));
    for (const [indexInDocument, criterion] of [
      [0, 'target-edge-certificate-dns'],
      [1, 'redis-ha-topology-security'],
    ]) {
      const item = document.workPackages[indexInDocument];
      item.status = 'failed';
      item.targetEnvironment = `target-fixture-${indexInDocument}`;
      item.immutableVersion = `sha256:${String(indexInDocument).repeat(64)}`;
      item.runUrl = `https://ci.example.invalid/runs/${indexInDocument}`;
      item.sourceCommit = document.repository.gitCommit;
      item.fingerprint = { runner: 'runner-abc', toolchain: 'go1.25.0', environment: 'fixture@sha256:abc' };
      item.outputs = [output];
      item.execution = {
        command: 'yarn target:contract',
        startedAt: '2026-08-29T00:00:00Z',
        finishedAt: '2026-08-29T00:00:01Z',
        exitCode: 1,
        rawOutputPath: output.path,
      };
      item.completion = {
        criteria: [{ id: criterion, outputPath: output.path, summary: 'The bounded target run was attempted.' }],
        rpoApproval: null,
      };
    }
    await writeFile(index, `${JSON.stringify(document, null, 2)}\n`);
    const verified = run(index, true);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /already used by V13-01/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
