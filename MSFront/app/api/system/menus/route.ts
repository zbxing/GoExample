import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import {
  createSystemMenuSchema,
  deleteByIdSchema,
  updateSystemMenuSchema,
} from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const tree = await getSystemAdapter().listMenuTree();
    return jsonOk({ menus: tree });
  } catch (err) {
    return jsonApiError(err, '加载菜单失败');
  }
}

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, createSystemMenuSchema);
    const menu = await getSystemAdapter().createMenu(body);
    return jsonOk({ menu });
  } catch (err) {
    return jsonApiError(err, '创建菜单失败');
  }
}

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, updateSystemMenuSchema);
    const menu = await getSystemAdapter().updateMenu(body);
    return jsonOk({ menu });
  } catch (err) {
    return jsonApiError(err, '更新菜单失败');
  }
}

export async function DELETE(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, deleteByIdSchema);
    const result = await getSystemAdapter().deleteMenu(body.id);
    return jsonOk(result);
  } catch (err) {
    return jsonApiError(err, '删除菜单失败');
  }
}
