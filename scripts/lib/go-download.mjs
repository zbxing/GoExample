import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';

const sha256Pattern = /^[a-f0-9]{64}$/i;

export function findGoArchiveChecksum(releases, requiredVersion, fileName) {
  if (!Array.isArray(releases)) {
    throw new Error('Go download metadata must be an array.');
  }

  const release = releases.find((item) => item?.version === `go${requiredVersion}`);
  const archive = release?.files?.find(
    (item) => item?.filename === fileName && item?.kind === 'archive',
  );
  const checksum = archive?.sha256;
  if (typeof checksum !== 'string' || !sha256Pattern.test(checksum)) {
    throw new Error(`Official SHA-256 was not found for ${fileName}.`);
  }
  return checksum.toLowerCase();
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function fileMatchesSha256(filePath, expectedChecksum) {
  if (typeof expectedChecksum !== 'string' || !sha256Pattern.test(expectedChecksum)) {
    return false;
  }

  const actual = Buffer.from(await sha256File(filePath), 'hex');
  const expected = Buffer.from(expectedChecksum, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
