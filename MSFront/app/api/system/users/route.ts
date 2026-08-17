import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import {
  createSystemUserSchema,
  deleteByIdSchema,
  updateSystemUserSchema,
} from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const search = new URL(request.url).searchParams.get('search') ?? '';
    const users = await getSystemAdapter().listUsers(search);
    return jsonOk({ users });
  } catch (err) {
    return jsonApiError(err, '加载用户失败');
  }
}

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, createSystemUserSchema);
    const user = await getSystemAdapter().createUser(body);
    return jsonOk({ user });
  } catch (err) {
    return jsonApiError(err, '创建用户失败');
  }
}

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, updateSystemUserSchema);
    const user = await getSystemAdapter().updateUser(body);
    return jsonOk({ user });
  } catch (err) {
    return jsonApiError(err, '更新用户失败');
  }
}

export async function DELETE(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, deleteByIdSchema);
    const result = await getSystemAdapter().deleteUser(body.id);
    return jsonOk(result);
  } catch (err) {
    return jsonApiError(err, '删除用户失败');
  }
}
