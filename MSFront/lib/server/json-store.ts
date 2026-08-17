import 'server-only';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { msFrontRootPath } from '@/lib/server/runtime-paths';

function dataRootPath() {
  const configuredRoot = process.env.MSFRONT_DATA_DIR?.trim();
  return configuredRoot
    ? path.resolve(/* turbopackIgnore: true */ configuredRoot)
    : path.join(msFrontRootPath, 'data');
}

export function resolveDataFilePath(fileName: string) {
  if (!fileName || path.basename(fileName) !== fileName) {
    throw new Error('MSFront data file name must not contain a path.');
  }
  return path.join(dataRootPath(), fileName);
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const filePath = resolveDataFilePath(fileName);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  await writeJsonPath(resolveDataFilePath(fileName), value);
}

export async function writeJsonPath<T>(filePath: string, value: T): Promise<void> {
  const parentDirectory = path.dirname(filePath);
  const temporaryPath = path.join(
    parentDirectory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await fs.mkdir(parentDirectory, { recursive: true });

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
