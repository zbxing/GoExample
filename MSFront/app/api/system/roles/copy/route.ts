import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import { copySystemRoleSchema } from '@/lib/server/request-schemas';

export async function POST(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, copySystemRoleSchema);
    const role = await getSystemAdapter().copyRole(body);
    return jsonOk({ role });
  } catch (err) {
    return jsonApiError(err, '拷贝角色失败');
  }
}
