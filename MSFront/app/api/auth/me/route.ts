import {
  jsonFail,
  jsonOk,
  requireSession,
} from '@/lib/server/auth-request';
import { buildClearAuthCookie } from '@/lib/server/auth-token';
import { disableResponseCaching } from '@/lib/server/response-security';

export async function GET(request: Request) {
  const { session, error } = await requireSession(request);
  if (error || !session) {
    const response = disableResponseCaching(error ?? jsonFail('未登录', 401));
    response.headers.set('Set-Cookie', buildClearAuthCookie());
    return response;
  }
  return disableResponseCaching(jsonOk({ user: session }));
}
