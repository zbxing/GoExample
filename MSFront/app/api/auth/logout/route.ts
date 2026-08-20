import { jsonFail, jsonOk } from '@/lib/server/auth-request';
import { buildClearAuthCookie } from '@/lib/server/auth-token';
import { isTrustedMutationOrigin } from '@/lib/server/request-security';
import { disableResponseCaching } from '@/lib/server/response-security';

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return disableResponseCaching(jsonFail('请求来源不受信任', 403));
  }

  const response = jsonOk({ ok: true });
  response.headers.set('Set-Cookie', buildClearAuthCookie());
  return disableResponseCaching(response);
}
