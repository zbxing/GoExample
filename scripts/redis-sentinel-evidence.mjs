import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRedisSentinelEvidence } from './lib/redis-sentinel-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'redis-sentinel-contract');

try {
  if (process.argv.length !== 2) {
    throw new Error('Redis Sentinel evidence: verify accepts no arguments');
  }
  const verified = verifyRedisSentinelEvidence({ repositoryRoot, evidenceRoot });
  console.log(
    `Redis Sentinel evidence verified: ${verified.report.status}, ${verified.report.checkpoints.length} checkpoints`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
