import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNatsRestartChecksums,
  buildNatsRestartEvidenceReport,
  verifyNatsRestartEvidence,
} from './lib/nats-restart-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(
  repositoryRoot,
  '.temp',
  'workflow-artifacts',
  'nats-contract',
  'restart',
);

async function generate() {
  await mkdir(evidenceRoot, { recursive: true });
  const report = buildNatsRestartEvidenceReport({ repositoryRoot, evidenceRoot });
  await writeFile(path.join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'SHA256SUMS'), buildNatsRestartChecksums(evidenceRoot), 'utf8');
  const verified = verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `NATS restart evidence written: ${verified.report.status}, ${verified.artifactPaths.length} artifacts`,
  );
  if (verified.report.status !== 'passed') {
    process.exitCode = 1;
  }
}

function verify() {
  const verified = verifyNatsRestartEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `NATS restart evidence verified: ${verified.report.status}, ${verified.report.goTests.passed.length} Go contract`,
  );
}

try {
  const [action, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !['run', 'verify'].includes(action)) {
    throw new Error('NATS restart evidence: expected exactly one action: run or verify');
  }
  if (action === 'run') {
    await generate();
  } else {
    verify();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
