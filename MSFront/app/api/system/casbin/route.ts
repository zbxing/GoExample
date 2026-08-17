import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonOk, requireApiAccess } from '@/lib/server/auth-request';
import { readJsonBody } from '@/lib/server/request-body';
import { replaceCasbinPoliciesSchema } from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const roleId = new URL(request.url).searchParams.get('roleId') ?? undefined;
    const policies = await getSystemAdapter().listCasbin(roleId);
    return jsonOk({ policies });
  } catch (err) {
    return jsonApiError(err, '加载策略失败');
  }
}

export async function PUT(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) {
    return error;
  }

  try {
    const body = await readJsonBody(request, replaceCasbinPoliciesSchema);
    const policies = await getSystemAdapter().replaceCasbin(body);
    return jsonOk({ policies });
  } catch (err) {
    return jsonApiError(err, '更新策略失败');
  }
}
