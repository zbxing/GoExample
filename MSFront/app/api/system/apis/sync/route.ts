import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import {
  applyApiSync,
  createSingleSyncApi,
  ignoreSyncApi,
  previewApiSync,
  type SyncApiItem,
} from '@/lib/server/system-api-sync';
import { z } from 'zod';

const httpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const syncItemSchema = z
  .object({
    path: z.string().trim().min(1).max(2048),
    method: httpMethod,
    apiGroup: z.string().trim().max(256).optional().default(''),
    description: z.string().trim().max(1024).optional().default(''),
  })
  .strict();

const applySyncSchema = z
  .object({
    action: z.literal('apply'),
    newApis: z.array(syncItemSchema).max(5000),
    deleteApis: z.array(z.object({ id: z.string().trim().min(1) }).strict()).max(5000),
    ignoreApis: z.array(syncItemSchema).max(5000),
  })
  .strict();

const ignoreSchema = z
  .object({
    action: z.literal('ignore'),
    item: syncItemSchema,
    ignored: z.boolean(),
  })
  .strict();

const addOneSchema = z
  .object({
    action: z.literal('add-one'),
    item: syncItemSchema,
  })
  .strict();

const syncMutationSchema = z.discriminatedUnion('action', [
  applySyncSchema,
  ignoreSchema,
  addOneSchema,
]);

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request, '/api/system/apis');
  if (error) {
    return error;
  }

  try {
    const preview = await previewApiSync();
    return jsonOk(preview);
  } catch (err) {
    return jsonApiError(err, '同步预览失败');
  }
}

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request, '/api/system/apis');
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, syncMutationSchema);
    if (body.action === 'apply') {
      const preview = await applyApiSync({
        newApis: body.newApis as SyncApiItem[],
        deleteApis: body.deleteApis,
        ignoreApis: body.ignoreApis as SyncApiItem[],
      });
      return jsonOk(preview);
    }
    if (body.action === 'ignore') {
      const ignores = await ignoreSyncApi(body.item as SyncApiItem, body.ignored);
      return jsonOk({ ignoreApis: ignores });
    }
    const api = await createSingleSyncApi(body.item as SyncApiItem);
    return jsonOk({ api });
  } catch (err) {
    return jsonApiError(err, '同步操作失败');
  }
}
