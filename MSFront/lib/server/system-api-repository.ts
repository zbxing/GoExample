import 'server-only';
import type {
  CreateSystemApiInput,
  HttpMethod,
  SystemApiRecord,
  UpdateSystemApiInput,
} from '@/lib/types/system';
import { createId, readJsonFile, writeJsonFile } from '@/lib/server/json-store';

interface ApisFile {
  apis: SystemApiRecord[];
}

const fileName = 'system-apis.json';

async function loadApis() {
  const data = await readJsonFile<ApisFile>(fileName, { apis: [] });
  return data.apis;
}

async function saveApis(apis: SystemApiRecord[]) {
  await writeJsonFile<ApisFile>(fileName, { apis });
}

export async function listSystemApis(search = '') {
  const apis = await loadApis();
  const keyword = search.trim().toLowerCase();
  if (!keyword) {
    return apis;
  }

  return apis.filter(
    (api) =>
      api.path.toLowerCase().includes(keyword) ||
      api.apiGroup.toLowerCase().includes(keyword) ||
      api.description.toLowerCase().includes(keyword) ||
      api.method.toLowerCase().includes(keyword),
  );
}

export async function createSystemApi(input: CreateSystemApiInput) {
  const apis = await loadApis();
  const api: SystemApiRecord = {
    id: createId('api'),
    path: input.path.trim(),
    method: input.method,
    apiGroup: input.apiGroup.trim(),
    description: input.description?.trim() || '',
  };
  apis.push(api);
  await saveApis(apis);
  return api;
}

export async function updateSystemApi(input: UpdateSystemApiInput) {
  const apis = await loadApis();
  const index = apis.findIndex((api) => api.id === input.id);
  if (index < 0) {
    throw new Error(`API not found: ${input.id}`);
  }

  const current = apis[index];
  const next: SystemApiRecord = {
    ...current,
    path: input.path?.trim() ?? current.path,
    method: (input.method as HttpMethod | undefined) ?? current.method,
    apiGroup: input.apiGroup?.trim() ?? current.apiGroup,
    description: input.description?.trim() ?? current.description,
  };
  apis[index] = next;
  await saveApis(apis);
  return next;
}

export async function deleteSystemApi(apiId: string) {
  const apis = await loadApis();
  if (!apis.some((api) => api.id === apiId)) {
    throw new Error(`API not found: ${apiId}`);
  }
  await saveApis(apis.filter((api) => api.id !== apiId));
  return { id: apiId };
}
