import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function discoverMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of sqlFiles) {
    if (!migrationFilePattern.test(fileName)) {
      throw new Error(
        `Invalid migration name ${fileName}; expected NNNN_lowercase_description.sql.`,
      );
    }
  }

  const migrations = [];

  for (const fileName of sqlFiles) {
    const sql = await readFile(path.join(directory, fileName), 'utf8');

    if (!sql.trim()) {
      throw new Error(`Migration ${fileName} is empty.`);
    }

    migrations.push({
      version: fileName.slice(0, -4),
      fileName,
      sql,
      checksum: migrationChecksum(sql),
    });
  }

  return migrations;
}
