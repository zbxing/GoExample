import 'server-only';
import type { HttpMethod, SystemApiRecord } from '@/lib/types/system';
import { readApiInventorySummary } from '@/lib/server/api-inventory';
import { readJsonFile, writeJsonFile } from '@/lib/server/json-store';
import { listSystemApis, createSystemApi, deleteSystemApi } from '@/lib/server/system-api-repository';

export interface SyncApiItem {
  path: string;
  method: HttpMethod;
  apiGroup: string;
  description: string;
}

export interface SyncApiPreview {
  newApis: SyncApiItem[];
  deleteApis: SystemApiRecord[];
  ignoreApis: SyncApiItem[];
}

interface IgnoreFile {
  ignores: SyncApiItem[];
}

const ignoreFileName = 'system-api-ignores.json';

async function loadIgnores() {
  const data = await readJsonFile<IgnoreFile>(ignoreFileName, { ignores: [] });
  return data.ignores;
}

async function saveIgnores(ignores: SyncApiItem[]) {
  await writeJsonFile<IgnoreFile>(ignoreFileName, { ignores });
}

function apiKey(path: string, method: string) {
  return `${method.toUpperCase()} ${path}`;
}

function groupFromPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[1] || parts[0] || 'default';
}

export async function previewApiSync(): Promise<SyncApiPreview> {
  const [apis, ignores, inventory] = await Promise.all([
    listSystemApis(),
    loadIgnores(),
    readApiInventorySummary(),
  ]);

  const ignoreKeys = new Set(ignores.map((item) => apiKey(item.path, item.method)));
  const existingKeys = new Set(apis.map((item) => apiKey(item.path, item.method)));

  const inventoryOps = (inventory?.operations ?? [])
    .filter((op) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method))
    .map((op) => ({
      path: op.path,
      method: op.method as HttpMethod,
      apiGroup: groupFromPath(op.path),
      description: `${op.method} ${op.path}`,
    }));

  const inventoryKeys = new Set(inventoryOps.map((item) => apiKey(item.path, item.method)));

  const newApis = inventoryOps.filter((item) => {
    const key = apiKey(item.path, item.method);
    return !existingKeys.has(key) && !ignoreKeys.has(key);
  });

  const deleteApis = apis.filter((item) => !inventoryKeys.has(apiKey(item.path, item.method)));

  return {
    newApis,
    deleteApis,
    ignoreApis: ignores,
  };
}

export async function applyApiSync(input: {
  newApis: SyncApiItem[];
  deleteApis: Array<{ id: string }>;
  ignoreApis: SyncApiItem[];
}) {
  for (const api of input.newApis) {
    await createSystemApi({
      path: api.path,
      method: api.method,
      apiGroup: api.apiGroup || groupFromPath(api.path),
      description: api.description || '',
    });
  }

  for (const item of input.deleteApis) {
    await deleteSystemApi(item.id);
  }

  await saveIgnores(input.ignoreApis);
  return previewApiSync();
}

export async function ignoreSyncApi(item: SyncApiItem, ignored: boolean) {
  const ignores = await loadIgnores();
  const key = apiKey(item.path, item.method);
  const next = ignored
    ? [...ignores.filter((row) => apiKey(row.path, row.method) !== key), item]
    : ignores.filter((row) => apiKey(row.path, row.method) !== key);
  await saveIgnores(next);
  return next;
}

export async function createSingleSyncApi(item: SyncApiItem) {
  return createSystemApi({
    path: item.path,
    method: item.method,
    apiGroup: item.apiGroup || groupFromPath(item.path),
    description: item.description || '',
  });
}
