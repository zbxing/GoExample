import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNginxEdgeEvidence } from './lib/nginx-edge-evidence.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const evidenceRoot = path.join(repositoryRoot, '.temp', 'workflow-artifacts', 'nginx-edge-contract');

try {
  if (process.argv.length !== 2) {
    throw new Error('Nginx edge evidence: verify accepts no arguments');
  }
  const verified = verifyNginxEdgeEvidence({ repositoryRoot, evidenceRoot });
  console.log(`Nginx edge evidence verified: ${verified.report.status}, ${verified.report.events.length} scenarios`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
