import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPostgresRecoveryEvidence } from './lib/postgres-recovery-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'postgres-recovery-contract');

try {
  if (process.argv.length !== 2) {
    throw new Error('PostgreSQL recovery evidence: verify accepts no arguments');
  }
  const verified = verifyPostgresRecoveryEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `PostgreSQL recovery evidence verified: ${verified.report.status}, ${verified.report.goTests.passed.length} Go contracts`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
