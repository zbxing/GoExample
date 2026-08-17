import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import {
  createSystemApiSchema,
  deleteByIdSchema,
  updateSystemApiSchema,
} from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const search = new URL(request.url).searchParams.get('search') ?? '';
    const apis = await getSystemAdapter().listApis(search);
    return jsonOk({ apis });
  } catch (err) {
    return jsonApiError(err, '加载 API 失败');
  }
}

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, createSystemApiSchema);
    const api = await getSystemAdapter().createApi(body);
    return jsonOk({ api });
  } catch (err) {
    return jsonApiError(err, '创建 API 失败');
  }
}

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, updateSystemApiSchema);
    const api = await getSystemAdapter().updateApi(body);
    return jsonOk({ api });
  } catch (err) {
    return jsonApiError(err, '更新 API 失败');
  }
}

export async function DELETE(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, deleteByIdSchema);
    const result = await getSystemAdapter().deleteApi(body.id);
    return jsonOk(result);
  } catch (err) {
    return jsonApiError(err, '删除 API 失败');
  }
}
