import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 64;
const algorithm = 'scrypt';
const formatVersion = '1';
const cost = 1 << 17;
const blockSize = 8;
const parallelization = 1;
const maxmem = 192 * 1024 * 1024;

function derivePassword(password: string, salt: string, legacy = false) {
  return new Promise<Buffer>((resolve, reject) => {
    const callback = (error: Error | null, derivedKey: Buffer) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    };

    if (legacy) {
      scrypt(password, salt, keyLength, callback);
      return;
    }
    scrypt(password, salt, keyLength, { N: cost, r: blockSize, p: parallelization, maxmem }, callback);
  });
}

export async function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
) {
  const hash = await derivePassword(password, salt);
  return [algorithm, formatVersion, cost, blockSize, parallelization, salt, hash.toString('hex')]
    .join('$');
}

export async function verifyPassword(password: string, storedValue: string) {
  try {
    const versioned = storedValue.split('$');
    if (versioned.length === 7 && versioned[0] === algorithm && versioned[1] === formatVersion) {
      const parsedCost = Number(versioned[2]);
      const parsedBlockSize = Number(versioned[3]);
      const parsedParallelization = Number(versioned[4]);
      const salt = versioned[5];
      const expectedHash = versioned[6];
      if (
        parsedCost !== cost ||
        parsedBlockSize !== blockSize ||
        parsedParallelization !== parallelization ||
        !/^[a-f0-9]{32}$/i.test(salt) ||
        !/^[a-f0-9]{128}$/i.test(expectedHash)
      ) {
        return false;
      }
      return compareHash(await derivePassword(password, salt), expectedHash);
    }

    const [salt, expectedHash, ...unexpected] = storedValue.split(':');
    if (!salt || !expectedHash || unexpected.length > 0 || !/^[a-f0-9]{128}$/i.test(expectedHash)) {
      return false;
    }
    return compareHash(await derivePassword(password, salt, true), expectedHash);
  } catch {
    return false;
  }
}

function compareHash(actualHash: Buffer, expectedHash: string) {
  const expected = Buffer.from(expectedHash, 'hex');
  if (expected.length !== actualHash.length) {
    return false;
  }
  return timingSafeEqual(actualHash, expected);
}

export function needsPasswordRehash(storedValue: string) {
  return !storedValue.startsWith(
    `${algorithm}$${formatVersion}$${cost}$${blockSize}$${parallelization}$`,
  );
}
