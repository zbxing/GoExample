import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createId,
  readJsonFile,
  resolveDataFilePath,
  writeJsonFile,
} from '@/lib/server/json-store';

describe('JSON store', () => {
  let temporaryRoot = '';
  const originalDataDirectory = process.env.MSFRONT_DATA_DIR;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'msfront-json-store-'));
    process.env.MSFRONT_DATA_DIR = temporaryRoot;
  });

  afterEach(async () => {
    if (originalDataDirectory === undefined) {
      delete process.env.MSFRONT_DATA_DIR;
    } else {
      process.env.MSFRONT_DATA_DIR = originalDataDirectory;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('uses fallback only when the data file does not exist', async () => {
    await expect(readJsonFile('missing.json', { items: [] })).resolves.toEqual({ items: [] });

    await writeFile(path.join(temporaryRoot, 'broken.json'), '{broken', 'utf8');
    await expect(readJsonFile('broken.json', { items: [] })).rejects.toBeInstanceOf(SyntaxError);
  });

  it('atomically replaces JSON and cleans temporary files', async () => {
    await writeJsonFile('state.json', { revision: 1 });
    await writeJsonFile('state.json', { revision: 2 });

    expect(JSON.parse(await readFile(path.join(temporaryRoot, 'state.json'), 'utf8')))
      .toEqual({ revision: 2 });
    expect(await readdir(temporaryRoot)).toEqual(['state.json']);
  });

  it('rejects path traversal and uses unpredictable identifiers', () => {
    expect(() => resolveDataFilePath('../outside.json')).toThrow(/must not contain a path/);
    const first = createId('user');
    const second = createId('user');
    expect(first).toMatch(/^user-[a-f0-9-]{36}$/);
    expect(second).not.toBe(first);
  });
});
