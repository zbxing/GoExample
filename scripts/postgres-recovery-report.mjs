import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'postgres-recovery-contract');
const maximumContractDurationMs = 120_000;
const expectedSnapshotRows = 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`PostgreSQL recovery report: ${message}`);
  process.exit(1);
}

function parseArguments() {
  const options = {
    input: path.join(evidenceRoot, 'recovery-raw.json'),
    backup: path.join(evidenceRoot, 'backup.dump'),
    output: path.join(evidenceRoot, 'recovery-report.json'),
  };
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!['--input', '--backup', '--output'].includes(option)) {
      fail(`unknown argument: ${option}`);
    }
    if (seen.has(option)) {
      fail(`${option} may only be specified once`);
    }
    if (!value || value.startsWith('--')) {
      fail(`${option} requires a path`);
    }
    seen.add(option);
    options[option.slice(2)] = path.resolve(repositoryRoot, value);
  }
  return options;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function requireInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireDigest(value, name) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    fail(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireCheckpoint(value, name) {
  const checkpoint = requireObject(value, name);
  return {
    rows: requireInteger(checkpoint.rows, `${name}.rows`, 1),
    digest: requireDigest(checkpoint.digest, `${name}.digest`),
  };
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const options = parseArguments();
for (const [name, filePath] of Object.entries(options)) {
  if (!isWithin(evidenceRoot, filePath)) {
    fail(`${name} must stay inside .temp/workflow-artifacts/postgres-recovery-contract`);
  }
}
if (!options.input.toLowerCase().endsWith('.json') || !options.output.toLowerCase().endsWith('.json')) {
  fail('input and output must be JSON files');
}
for (const [name, filePath] of [['input', options.input], ['backup', options.backup]]) {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile() || lstatSync(filePath).isSymbolicLink()) {
    fail(`${name} must be an existing regular file`);
  }
}

let raw;
try {
  raw = JSON.parse(readFileSync(options.input, 'utf8'));
} catch (error) {
  fail(`input contains invalid JSON: ${error.message}`);
}
requireObject(raw, 'input');
if (raw.schemaVersion !== 1 || raw.scope !== 'linux_docker_logical_backup_restore') {
  fail('input must use schemaVersion 1 and the Linux Docker recovery scope');
}
if (typeof raw.image !== 'string' || !raw.image.includes('@sha256:')) {
  fail('input.image must be pinned by digest');
}
const startedAt = Date.parse(raw.startedAt);
const completedAt = Date.parse(raw.completedAt);
if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
  fail('input timestamps must be valid and ordered');
}
const durationMs = requireInteger(raw.durationMs, 'input.durationMs', 1);
if (durationMs > maximumContractDurationMs || Math.abs(durationMs - (completedAt - startedAt)) > 2_000) {
  fail('recovery duration exceeds the bounded contract or disagrees with timestamps');
}
if (typeof raw.recoveryPointLSN !== 'string' || !/^[A-F0-9]+\/[A-F0-9]+$/.test(raw.recoveryPointLSN)) {
  fail('input.recoveryPointLSN must be a PostgreSQL LSN');
}
const snapshot = requireCheckpoint(raw.sourceAtBackup, 'input.sourceAtBackup');
const live = requireCheckpoint(raw.sourceAfterBackup, 'input.sourceAfterBackup');
const restored = requireCheckpoint(raw.restored, 'input.restored');
if (snapshot.rows !== expectedSnapshotRows) {
  fail(`backup checkpoint must contain exactly ${expectedSnapshotRows} rows`);
}
if (live.rows !== snapshot.rows + 1 || live.digest === snapshot.digest) {
  fail('source-after-backup must contain one distinct post-checkpoint write');
}
if (restored.rows !== snapshot.rows || restored.digest !== snapshot.digest) {
  fail('restored data must exactly match the backup checkpoint');
}
if (restored.rows === live.rows || restored.digest === live.digest) {
  fail('restored data must exclude the post-checkpoint write');
}
const backupBytes = lstatSync(options.backup).size;
if (backupBytes < 1_024) {
  fail('backup archive is unexpectedly small');
}
const backupSha256 = sha256File(options.backup);
if (raw.backup?.bytes !== backupBytes || raw.backup?.sha256 !== backupSha256) {
  fail('backup archive size or SHA-256 does not match the raw recovery record');
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: raw.scope,
  status: 'passed',
  source: {
    input: relativePath(options.input),
    backup: relativePath(options.backup),
  },
  image: raw.image,
  databaseVersion: raw.databaseVersion,
  durationMs,
  recoveryPointLSN: raw.recoveryPointLSN,
  sourceAtBackup: snapshot,
  sourceAfterBackup: live,
  restored,
  backup: { bytes: backupBytes, sha256: backupSha256 },
  assertions: {
    restoredMatchesCheckpoint: true,
    postCheckpointWriteExcluded: true,
  },
  limitations: [
    'the contract uses a disposable single-node PostgreSQL container and a logical custom-format archive',
    'the contract does not establish physical backup, WAL archiving, PITR, replication, failover, or target data-volume behavior',
    'target RPO, RTO, alert delivery, operator response, and signed provenance remain unrecorded',
  ],
};
mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`PostgreSQL recovery report written to ${relativePath(options.output)}`);
