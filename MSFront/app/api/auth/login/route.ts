import { getSystemAdapter } from '@/lib/api/get-system-adapter';
import { jsonApiError, jsonFail, jsonOk } from '@/lib/server/auth-request';
import { buildAuthCookie, signAuthToken } from '@/lib/server/auth-token';
import { isTrustedMutationOrigin } from '@/lib/server/request-security';
import { readJsonBody } from '@/lib/server/request-body';
import { loginRequestSchema } from '@/lib/server/request-schemas';

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return jsonFail('请求来源不受信任', 403);
  }

  try {
    const { username, password } = await readJsonBody(request, loginRequestSchema);

    const adapter = getSystemAdapter();
    const session = await adapter.login(username, password);
    if (!session) {
      return jsonFail('用户名或密码错误', 401);
    }

    const token = await signAuthToken({
      sub: session.id,
      username: session.username,
      roleIds: session.roleIds,
    });

    const response = jsonOk({ user: session });
    response.headers.set('Set-Cookie', buildAuthCookie(token));
    return response;
  } catch (error) {
    return jsonApiError(error, '登录服务暂时不可用');
  }
}
