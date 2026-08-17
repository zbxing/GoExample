import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The migration CLI helper is intentionally plain Node ESM.
import { discoverMigrations, migrationChecksum } from '../../scripts/migration-lib.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('migration discovery', () => {
  it('sorts migrations and calculates stable SHA-256 checksums', async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(path.join(directory, '0002_add_index.sql'), 'SELECT 2;\n', 'utf8');
    await writeFile(path.join(directory, '0001_initial.sql'), 'SELECT 1;\n', 'utf8');

    const migrations = await discoverMigrations(directory);

    expect(migrations.map((migration: { version: string }) => migration.version)).toEqual([
      '0001_initial',
      '0002_add_index',
    ]);
    expect(migrations[0].checksum).toBe(migrationChecksum('SELECT 1;\n'));
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid names and empty migrations', async () => {
    const invalidNameDirectory = await createTemporaryDirectory();
    await writeFile(path.join(invalidNameDirectory, 'initial.sql'), 'SELECT 1;', 'utf8');
    await expect(discoverMigrations(invalidNameDirectory)).rejects.toThrow('Invalid migration name');

    const emptyDirectory = await createTemporaryDirectory();
    await writeFile(path.join(emptyDirectory, '0001_initial.sql'), '  \n', 'utf8');
    await expect(discoverMigrations(emptyDirectory)).rejects.toThrow('is empty');
  });
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'msfront-migration-'));
  temporaryDirectories.push(directory);
  return directory;
}
