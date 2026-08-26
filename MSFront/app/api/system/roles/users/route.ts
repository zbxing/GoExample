import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import { setRoleUsersSchema } from '@/lib/server/request-schemas';

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, setRoleUsersSchema);
    const result = await getSystemAdapter().setRoleUsers(body);
    return jsonOk(result);
  } catch (err) {
    return jsonApiError(err, '分配用户失败');
  }
}
