import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  fileMatchesSha256,
  findGoArchiveChecksum,
  sha256File,
} from '../../scripts/lib/go-download.mjs';

test('Go download metadata resolves the exact archive checksum', () => {
  const checksum = 'a'.repeat(64);
  const releases = [
    {
      version: 'go1.25.13',
      files: [
        { filename: 'go1.25.13.windows-amd64.zip', kind: 'archive', sha256: checksum },
      ],
    },
  ];

  assert.equal(
    findGoArchiveChecksum(releases, '1.25.13', 'go1.25.13.windows-amd64.zip'),
    checksum,
  );
  assert.throws(
    () => findGoArchiveChecksum(releases, '1.25.13', 'go1.25.13.linux-amd64.tar.gz'),
    /Official SHA-256 was not found/,
  );
});

test('Go archive verification hashes file content and rejects mismatches', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'goexample-go-download-'));
  const archivePath = path.join(temporaryRoot, 'archive.bin');

  try {
    await writeFile(archivePath, 'goexample', 'utf8');
    const checksum = 'fdcace2791ba6eb273a49a05641679fa5c88c5f38cf63433d1ea3420947e501b';
    assert.equal(await sha256File(archivePath), checksum);
    assert.equal(await fileMatchesSha256(archivePath, checksum), true);
    assert.equal(await fileMatchesSha256(archivePath, '0'.repeat(64)), false);
    assert.equal(await fileMatchesSha256(archivePath, 'invalid'), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
