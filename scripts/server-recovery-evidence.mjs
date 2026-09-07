import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildServerRecoveryEvidenceReport,
  verifyServerRecoveryEvidence,
  writeServerRecoveryEvidenceChecksums,
} from './lib/server-recovery-evidence.mjs';
import { runServerRecoveryDrill } from './lib/server-recovery-command.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'recovery', 'server-local');

function fail(message) {
  console.error(`Server recovery evidence: ${message}`);
  process.exit(1);
}

function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = runServerRecoveryDrill({
    cwd: repositoryRoot,
    scriptPath: path.join(scriptDirectory, 'server-recovery-drill.mjs'),
  });
  const completedAt = new Date().toISOString();
  const execution = {
    startedAt,
    completedAt,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    spawnErrorCode: result.spawnErrorCode,
  };
  const report = buildServerRecoveryEvidenceReport({ repositoryRoot, evidenceRoot, execution });
  writeFileSync(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeServerRecoveryEvidenceChecksums(evidenceRoot);
  const verified = verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `Server recovery evidence ${verified.report.status}: ${verified.artifactPaths.length} checksum-bound artifacts verified`,
  );
  if (result.status !== 0 || result.signal || result.spawnErrorCode) {
    process.exitCode = Number.isInteger(result.status) && result.status !== 0 ? result.status : 1;
  }
}

function verify() {
  if (!existsSync(evidenceRoot)) {
    fail('evidence directory is missing; run the evidence command first');
  }
  const verified = verifyServerRecoveryEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `Server recovery evidence verified: ${verified.report.status}, ${verified.artifactPaths.length} artifacts`,
  );
}

const [command, ...extra] = process.argv.slice(2);
if (extra.length > 0 || !['run', 'verify'].includes(command)) {
  fail('usage: node scripts/server-recovery-evidence.mjs <run|verify>');
}
if (command === 'run') {
  run();
} else {
  verify();
}
