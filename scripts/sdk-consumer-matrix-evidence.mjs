import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSDKConsumerMatrixEvidenceReport,
  sdkConsumerMatrixEvidenceArguments,
  sdkConsumerMatrixEvidenceArtifactNames,
  sdkConsumerMatrixProcessTimeoutMs,
  verifySDKConsumerMatrixEvidence,
  writeSDKConsumerMatrixEvidenceChecksums,
} from './lib/sdk-consumer-matrix-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'sdk-consumer-matrix');

function fail(message) {
  console.error(`SDK consumer matrix evidence: ${message}`);
  process.exit(1);
}

function clearGeneratedArtifacts() {
  mkdirSync(evidenceRoot, { recursive: true });
  for (const name of sdkConsumerMatrixEvidenceArtifactNames) {
    const filePath = path.join(evidenceRoot, name);
    if (!existsSync(filePath)) {
      continue;
    }
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(`${name} must be a regular generated file`);
    }
    unlinkSync(filePath);
  }
}

function statusText(result) {
  return [
    `exit_code=${Number.isInteger(result.status) ? result.status : ''}`,
    `signal=${result.signal ?? ''}`,
    `spawn_error=${result.error?.code ?? ''}`,
    '',
  ].join('\n');
}

function run() {
  clearGeneratedArtifacts();
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, sdkConsumerMatrixEvidenceArguments, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    timeout: sdkConsumerMatrixProcessTimeoutMs,
    killSignal: 'SIGTERM',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const completedAt = new Date().toISOString();
  const stdout = `${result.stdout ?? ''}`;
  const stderr = `${result.stderr ?? ''}`;
  writeFileSync(path.join(evidenceRoot, 'verification-output.txt'), stdout, 'utf8');
  writeFileSync(path.join(evidenceRoot, 'verification-error.txt'), stderr, 'utf8');
  writeFileSync(path.join(evidenceRoot, 'verification-status.txt'), statusText(result), 'utf8');
  const execution = {
    startedAt,
    completedAt,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    spawnErrorCode: result.error?.code ?? null,
  };
  const report = buildSDKConsumerMatrixEvidenceReport({ repositoryRoot, evidenceRoot, execution });
  writeFileSync(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeSDKConsumerMatrixEvidenceChecksums(evidenceRoot);
  const verified = verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  console.log(
    `SDK consumer matrix evidence ${verified.report.status}: ${verified.artifactPaths.length} checksum-bound artifacts verified`,
  );
  if (result.status !== 0 || result.signal || result.error) {
    process.exitCode = Number.isInteger(result.status) && result.status !== 0 ? result.status : 1;
  }
}

function verify() {
  if (!existsSync(evidenceRoot)) {
    fail('evidence directory is missing; run the evidence command first');
  }
  const verified = verifySDKConsumerMatrixEvidence({ repositoryRoot, evidenceRoot });
  const status = readFileSync(path.join(evidenceRoot, 'verification-status.txt'), 'utf8').trim();
  console.log(
    `SDK consumer matrix evidence verified: ${verified.report.status}, ${verified.artifactPaths.length} artifacts, ${status}`,
  );
}

const [command, ...extra] = process.argv.slice(2);
if (extra.length > 0 || !['run', 'verify'].includes(command)) {
  fail('usage: node scripts/sdk-consumer-matrix-evidence.mjs <run|verify>');
}
if (command === 'run') {
  run();
} else {
  verify();
}
