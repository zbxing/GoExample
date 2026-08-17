import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonFail, jsonOk, requireApiAccess } from '@/lib/server/auth-request';

export async function GET(request: Request) {
  const { session, error } = await requireApiAccess(request, '/api/system/menus/async');
  if (error || !session) {
    return error ?? jsonFail('未登录', 401);
  }

  try {
    const menus = await getSystemAdapter().listAsyncMenus(session.menuIds);
    return jsonOk({ menus });
  } catch (err) {
    return jsonApiError(err, '加载菜单失败');
  }
}
