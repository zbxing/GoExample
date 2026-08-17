import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import {
  createSystemRoleSchema,
  deleteByIdSchema,
  updateSystemRoleSchema,
} from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const roles = await getSystemAdapter().listRoles();
    return jsonOk({ roles });
  } catch (err) {
    return jsonApiError(err, '加载角色失败');
  }
}

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, createSystemRoleSchema);
    const role = await getSystemAdapter().createRole(body);
    return jsonOk({ role });
  } catch (err) {
    return jsonApiError(err, '创建角色失败');
  }
}

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, updateSystemRoleSchema);
    const role = await getSystemAdapter().updateRole(body);
    return jsonOk({ role });
  } catch (err) {
    return jsonApiError(err, '更新角色失败');
  }
}

export async function DELETE(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, deleteByIdSchema);
    const result = await getSystemAdapter().deleteRole(body.id);
    return jsonOk(result);
  } catch (err) {
    return jsonApiError(err, '删除角色失败');
  }
}
