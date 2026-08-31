import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySDKConsumerMatrix } from './lib/sdk-consumer-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const task = process.argv[2] ?? 'check';

if (task !== 'check' || process.argv.length !== 3) {
  console.error('SDK consumer matrix: usage node scripts/sdk-consumer-matrix.mjs check');
  process.exit(1);
}

try {
  const result = verifySDKConsumerMatrix(repositoryRoot);
  console.log(`SDK consumer matrix verified: ${result.consumerCount} repository-local consumers`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
